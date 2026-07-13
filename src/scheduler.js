import { CONTEXTS, TASK_STATUSES } from './models.js';
import { calculatePriority, scorePlacement } from './priority.js';
import {
  addMinutes,
  minutesBetween,
  normalizeDateTime,
  subtractIntervals,
  toMillis,
  totalMinutes
} from './time.js';

const CONFLICT_ACTIONS = Object.freeze([
  '增加可用时间后重排',
  '降低部分任务最小时长后重排',
  '删除/跳过低优先级任务后重排'
]);

function intervalMinutes(start, end) {
  const minutes = minutesBetween(start, end);
  return Number.isFinite(minutes) ? minutes : 0;
}

function validDateTime(value) {
  const normalized = normalizeDateTime(value);
  return Number.isFinite(toMillis(normalized)) ? normalized : null;
}

function contextCompatible(task, block) {
  const taskContext = task.executionContext ?? CONTEXTS.ANY;
  return taskContext === CONTEXTS.ANY
    || taskContext === block.context
    || (
      taskContext === CONTEXTS.CUSTOM
        && String(block.context).startsWith(`${CONTEXTS.CUSTOM}:`)
    );
}

function normalizePositiveBlocks(blocks) {
  return blocks
    .map((block) => ({
      ...block,
      start: normalizeDateTime(block.start),
      end: normalizeDateTime(block.end)
    }))
    .filter((block) => intervalMinutes(block.start, block.end) > 0);
}

function futurePartOfBlocks(blocks, now) {
  const current = normalizeDateTime(now);

  return normalizePositiveBlocks(blocks)
    .map((block) => {
      if (block.end <= current) {
        return null;
      }

      if (block.start < current) {
        return { ...block, start: current };
      }

      return block;
    })
    .filter(Boolean);
}

function fixedDateTime(planDate, time) {
  const value = String(time ?? '');

  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return normalizeDateTime(value);
  }

  if (/^\d{2}:\d{2}$/.test(value)) {
    return `${planDate}T${value}:00`;
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${planDate}T${value}`;
  }

  return normalizeDateTime(value);
}

function completedSegments(tasks) {
  return tasks
    .filter((task) => task.status === TASK_STATUSES.COMPLETED)
    .map((task) => {
      const start = validDateTime(task.actualStart);
      const end = validDateTime(task.actualEnd);

      if (!start || !end || intervalMinutes(start, end) <= 0) {
        return null;
      }

      return {
        taskId: task.taskId,
        taskName: task.taskName,
        start,
        end,
        status: TASK_STATUSES.COMPLETED,
        ...(task.segmentId ? { segmentId: task.segmentId } : {}),
        ...(task.calendarEventId ? { calendarEventId: task.calendarEventId } : {})
      };
    })
    .filter(Boolean);
}

function activeTasks(tasks) {
  return tasks.filter((task) => (
    task.status !== TASK_STATUSES.COMPLETED
      && task.status !== TASK_STATUSES.SKIPPED
  ));
}

function fixedElapsedMinutes(task, planDate, now) {
  if (!task.fixed || !task.fixedStart || !task.fixedEnd) {
    return 0;
  }

  const start = fixedDateTime(planDate, task.fixedStart);
  const end = fixedDateTime(planDate, task.fixedEnd);
  const current = normalizeDateTime(now);

  if (current <= start) {
    return 0;
  }

  return intervalMinutes(start, current < end ? current : end);
}

function fixedDeadlineViolation(task, planDate) {
  if (!task.fixed || !task.fixedEnd) {
    return null;
  }

  const deadline = validDateTime(task.deadline);

  if (!deadline) {
    return null;
  }

  const end = fixedDateTime(planDate, task.fixedEnd);

  if (end <= deadline) {
    return null;
  }

  return {
    taskId: task.taskId,
    taskName: task.taskName,
    fixedStart: String(task.fixedStart ?? '').slice(0, 5),
    fixedEnd: String(task.fixedEnd).slice(0, 5),
    deadline
  };
}

function unlockAutoFixedDeadlineViolation(task, planDate) {
  if (!task.autoFixed || !fixedDeadlineViolation(task, planDate)) {
    return task;
  }

  return { ...task, fixed: false, fixedStart: null, fixedEnd: null };
}

function taskWithEffectiveWork(task, planDate, now) {
  const elapsedMinutes = fixedElapsedMinutes(task, planDate, now);
  const effectiveMinimumMinutes = Math.max(0, task.minimumMinutes - elapsedMinutes);
  const effectiveDesiredMinutes = Math.max(
    effectiveMinimumMinutes,
    Math.max(0, task.desiredMinutes - elapsedMinutes)
  );

  return {
    ...task,
    effectiveMinimumMinutes,
    effectiveDesiredMinutes
  };
}

function allocateDurations(tasks, capacityMinutes, now) {
  const requiredMinimum = tasks.reduce((sum, task) => (
    sum + task.effectiveMinimumMinutes
  ), 0);
  const flexibleCapacity = Math.max(0, capacityMinutes - requiredMinimum);
  const desiredExtraTotal = tasks.reduce((sum, task) => (
    sum + Math.max(0, task.effectiveDesiredMinutes - task.effectiveMinimumMinutes)
  ), 0);
  const usableExtra = Math.min(flexibleCapacity, desiredExtraTotal);
  const weightedTasks = tasks.map((task) => ({
    task,
    duration: task.effectiveMinimumMinutes,
    desiredExtra: Math.max(0, task.effectiveDesiredMinutes - task.effectiveMinimumMinutes),
    fraction: 0,
    priority: calculatePriority(task, now),
    weight: calculatePriority(task, now)
      * Math.max(0, task.effectiveDesiredMinutes - task.effectiveMinimumMinutes)
  }));
  const totalWeight = weightedTasks.reduce((sum, item) => sum + item.weight, 0) || 1;
  let distributedExtra = 0;

  for (const item of weightedTasks) {
    const exactExtra = (item.weight / totalWeight) * usableExtra;
    const flooredExtra = Math.floor(exactExtra);
    const extra = Math.min(item.desiredExtra, flooredExtra);
    item.duration += extra;
    item.fraction = exactExtra - flooredExtra;
    distributedExtra += extra;
  }

  let leftover = usableExtra - distributedExtra;

  while (leftover > 0) {
    const underDesired = weightedTasks
      .filter((item) => item.duration < item.task.effectiveDesiredMinutes)
      .sort((left, right) => (
        right.fraction - left.fraction
          || right.priority - left.priority
          || left.task.taskName.localeCompare(right.task.taskName)
      ));

    if (underDesired.length === 0) {
      break;
    }

    for (const item of underDesired) {
      if (leftover <= 0) {
        break;
      }

      item.duration += 1;
      leftover -= 1;
    }
  }

  return new Map(weightedTasks.map(({ task, duration }) => [task.taskId, duration]));
}

function durationPlanSummary(tasks, allocations, availableMinutes) {
  const desiredMinutes = tasks.reduce((sum, task) => sum + task.effectiveDesiredMinutes, 0);
  const minimumMinutes = tasks.reduce((sum, task) => sum + task.effectiveMinimumMinutes, 0);

  return {
    desiredMinutes,
    minimumMinutes,
    availableMinutes,
    allocations: tasks.map((task) => ({
      taskId: task.taskId,
      taskName: task.taskName,
      desiredMinutes: task.effectiveDesiredMinutes,
      minimumMinutes: task.effectiveMinimumMinutes,
      actualMinutes: allocations.get(task.taskId) ?? 0
    }))
  };
}

function withPlacedActualDurations(durationPlan, segments) {
  if (!durationPlan) {
    return null;
  }

  const actualByTask = new Map();

  for (const segment of segments) {
    if (segment.status !== TASK_STATUSES.SCHEDULED) {
      continue;
    }

    actualByTask.set(
      segment.taskId,
      (actualByTask.get(segment.taskId) ?? 0) + segment.allocatedMinutes
    );
  }

  return {
    ...durationPlan,
    allocations: durationPlan.allocations.map((item) => ({
      ...item,
      plannedMinutes: item.actualMinutes,
      actualMinutes: actualByTask.get(item.taskId) ?? 0
    }))
  };
}

function segmentForTask(task, start, minutes) {
  return {
    taskId: task.taskId,
    taskName: task.taskName,
    status: TASK_STATUSES.SCHEDULED,
    start,
    end: addMinutes(start, minutes),
    allocatedMinutes: minutes
  };
}

function usableMinutes(task, block) {
  const capacity = intervalMinutes(block.start, block.end);
  const deadline = validDateTime(task.deadline);

  if (!deadline) {
    return capacity;
  }

  return Math.min(capacity, intervalMinutes(block.start, deadline));
}

function rankedCompatibleBlocks(task, blocks) {
  return blocks
    .map((block, index) => ({ block, index, score: scorePlacement(task, block) }))
    .filter((item) => contextCompatible(task, item.block))
    .sort((left, right) => (
      right.score - left.score
        || left.block.start.localeCompare(right.block.start)
        || left.block.end.localeCompare(right.block.end)
    ));
}

function placeTask(task, minutes, blocks) {
  const segments = [];
  let remaining = minutes;
  let remainingBlocks = blocks.map((block) => ({ ...block }));
  const minimumSegmentMinutes = task.splittable
    ? Math.min(task.minSegmentMinutes, minutes)
    : task.effectiveMinimumMinutes;

  while (remaining > 0) {
    if (task.splittable && remaining < minimumSegmentMinutes) {
      break;
    }

    const compatible = rankedCompatibleBlocks(task, remainingBlocks);
    let placed = false;
    const capacityOf = (item) => usableMinutes(task, remainingBlocks[item.index]);

    const candidates = task.splittable
      ? [
          ...compatible.filter((item) => capacityOf(item) >= remaining),
          ...compatible.filter((item) => {
            const capacity = capacityOf(item);
            return capacity < remaining && remaining - capacity >= minimumSegmentMinutes;
          }),
          ...compatible
        ]
      : [
          compatible.find((item) => capacityOf(item) >= remaining),
          ...compatible
            .filter((item) => capacityOf(item) >= task.effectiveMinimumMinutes)
            .sort((left, right) => capacityOf(right) - capacityOf(left))
        ].filter(Boolean);

    for (const item of candidates) {
      const block = remainingBlocks[item.index];
      const capacity = usableMinutes(task, block);
      const minimumForSegment = task.splittable
        ? minimumSegmentMinutes
        : Math.min(remaining, task.effectiveMinimumMinutes);

      if (capacity < minimumForSegment) {
        continue;
      }

      const used = task.splittable ? Math.min(remaining, capacity) : remaining;
      const actualUsed = task.splittable ? used : Math.min(used, capacity);

      if (task.splittable && actualUsed < minimumSegmentMinutes) {
        continue;
      }

      const segment = segmentForTask(task, block.start, actualUsed);
      segments.push(segment);
      remaining -= actualUsed;
      remainingBlocks = subtractIntervals(remainingBlocks, [segment]);
      placed = true;
      break;
    }

    if (!placed || !task.splittable) {
      break;
    }
  }

  return { segments, remaining, blocks: remainingBlocks };
}

function fixedFutureInterval(task, planDate, now) {
  if (!task.fixed || !task.fixedStart || !task.fixedEnd) {
    return null;
  }

  const start = fixedDateTime(planDate, task.fixedStart);
  const end = fixedDateTime(planDate, task.fixedEnd);
  const current = normalizeDateTime(now);
  const futureStart = start < current ? current : start;

  if (intervalMinutes(futureStart, end) <= 0) {
    return null;
  }

  return { start: futureStart, end };
}

function placeFixedTask(task, allocatedMinutes, blocks, planDate, now) {
  const fixedInterval = fixedFutureInterval(task, planDate, now);

  if (!fixedInterval) {
    return { segments: [], remaining: allocatedMinutes, blocks };
  }

  const containingBlock = blocks.find((block) => (
    block.start <= fixedInterval.start && block.end >= fixedInterval.end
  ));

  if (!containingBlock) {
    return { segments: [], remaining: allocatedMinutes, blocks };
  }

  const used = intervalMinutes(fixedInterval.start, fixedInterval.end);
  const segment = {
    taskId: task.taskId,
    taskName: task.taskName,
    status: TASK_STATUSES.SCHEDULED,
    start: fixedInterval.start,
    end: fixedInterval.end,
    allocatedMinutes: used
  };

  return {
    segments: [segment],
    remaining: Math.max(0, allocatedMinutes - used),
    blocks: subtractIntervals(blocks, [segment])
  };
}

function isUserFixed(task) {
  return Boolean(task.fixed && task.fixedStart && task.fixedEnd);
}

function intervalsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function taskCapacityInterval(task, block) {
  const minutes = usableMinutes(task, block);

  if (minutes <= 0) {
    return null;
  }

  return {
    start: block.start,
    end: addMinutes(block.start, minutes)
  };
}

function consumesCompatibleCapacity(segment, failedTask, available) {
  return available.some((block) => {
    if (!contextCompatible(failedTask, block)) {
      return false;
    }

    const capacityInterval = taskCapacityInterval(failedTask, block);
    return capacityInterval ? intervalsOverlap(segment, capacityInterval) : false;
  });
}

function competingDonors(failedTask, tasks, allocations, available, placedSegments) {
  const competingTaskIds = new Set(
    placedSegments
      .filter((segment) => consumesCompatibleCapacity(segment, failedTask, available))
      .map((segment) => segment.taskId)
  );

  return tasks
    .filter((task) => task.taskId !== failedTask.taskId)
    .filter((task) => !isUserFixed(task))
    .filter((task) => competingTaskIds.has(task.taskId))
    .map((task) => ({
      task,
      slack: (allocations.get(task.taskId) ?? task.effectiveMinimumMinutes)
        - task.effectiveMinimumMinutes
    }))
    .filter((item) => item.slack > 0)
    .filter((item) => available.some((block) => (
      contextCompatible(item.task, block) && usableMinutes(item.task, block) > 0
    )));
}

function distributeCompression(deficit, donors, now) {
  const pool = donors
    .map((item) => ({
      ...item,
      weight: 1 / Math.max(1, calculatePriority(item.task, now)),
      taken: 0
    }))
    .sort((left, right) => (
      right.weight - left.weight
        || left.task.taskName.localeCompare(right.task.taskName)
    ));
  let remaining = deficit;

  while (remaining > 0) {
    const active = pool.filter((item) => item.slack > 0);

    if (active.length === 0) {
      break;
    }

    const base = remaining;
    const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);

    for (const item of active) {
      if (remaining <= 0) {
        break;
      }

      const share = Math.min(
        item.slack,
        remaining,
        Math.max(1, Math.floor(base * (item.weight / totalWeight)))
      );
      item.taken += share;
      item.slack -= share;
      remaining -= share;
    }
  }

  const taken = pool.filter((item) => item.taken > 0);
  return taken.length > 0 ? taken : null;
}

function withAllocationCaps(allocations, caps) {
  return new Map([...allocations].map(([taskId, minutes]) => [
    taskId,
    Math.min(minutes, caps.get(taskId) ?? Infinity)
  ]));
}

function candidateBlocksForTask(task, blocks) {
  return blocks
    .filter((block) => contextCompatible(task, block))
    .map((block) => ({
      start: block.start,
      end: block.end,
      context: block.context,
      usableMinutes: usableMinutes(task, block)
    }))
    .filter((block) => block.usableMinutes > 0);
}

function dependencyIds(task) {
  return Array.isArray(task.dependencyTaskIds) ? task.dependencyTaskIds : [];
}

function orderByDependencies(tasks, comparator) {
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const indegree = new Map(tasks.map((task) => [task.taskId, 0]));
  const successors = new Map(tasks.map((task) => [task.taskId, []]));

  for (const task of tasks) {
    for (const dependencyId of dependencyIds(task)) {
      if (!taskIds.has(dependencyId)) {
        continue;
      }
      indegree.set(task.taskId, indegree.get(task.taskId) + 1);
      successors.get(dependencyId).push(task.taskId);
    }
  }

  const ready = tasks.filter((task) => indegree.get(task.taskId) === 0).sort(comparator);
  const ordered = [];
  while (ready.length > 0) {
    const task = ready.shift();
    ordered.push(task);
    for (const successorId of successors.get(task.taskId)) {
      indegree.set(successorId, indegree.get(successorId) - 1);
      if (indegree.get(successorId) === 0) {
        ready.push(byId.get(successorId));
        ready.sort(comparator);
      }
    }
  }

  return ordered.length === tasks.length ? ordered : [...tasks].sort(comparator);
}

function latestDependencyEnd(task, dependencyEnds) {
  return dependencyIds(task).reduce((latest, dependencyId) => {
    const end = dependencyEnds.get(dependencyId);
    return end && (!latest || end > latest) ? end : latest;
  }, null);
}

function blocksAfter(blocks, earliestStart) {
  if (!earliestStart) {
    return blocks;
  }

  return blocks
    .filter((block) => block.end > earliestStart)
    .map((block) => ({
      ...block,
      start: block.start < earliestStart ? earliestStart : block.start
    }));
}

function recordLatestEnd(dependencyEnds, taskId, segments) {
  for (const segment of segments) {
    const current = dependencyEnds.get(taskId);
    if (!current || segment.end > current) {
      dependencyEnds.set(taskId, segment.end);
    }
  }
}

function attemptPlacement({
  fixedTasks,
  flexibleTasks,
  allocations,
  available,
  planDate,
  now,
  initialDependencyEnds = new Map()
}) {
  let blocks = available.map((block) => ({ ...block }));
  const scheduled = [];
  const unscheduled = [];
  const dependencyEnds = new Map(initialDependencyEnds);

  const record = (task, allocatedMinutes, candidateBlocks, result) => {
    const scheduledMinutes = result.segments.reduce((sum, segment) => (
      sum + segment.allocatedMinutes
    ), 0);

    if (scheduledMinutes < task.effectiveMinimumMinutes) {
      return { task, scheduledMinutes, plannedMinutes: allocatedMinutes, candidateBlocks };
    }

    scheduled.push(...result.segments);
    blocks = subtractIntervals(blocks, result.segments);
    recordLatestEnd(dependencyEnds, task.taskId, result.segments);

    if (result.remaining > 0) {
      unscheduled.push({
        taskId: task.taskId,
        taskName: task.taskName,
        plannedMinutes: allocatedMinutes,
        scheduledMinutes,
        minimumMinutes: task.effectiveMinimumMinutes,
        candidateBlocks,
        remainingMinutes: result.remaining
      });
    }

    return null;
  };

  for (const task of fixedTasks) {
    const allocatedMinutes = allocations.get(task.taskId) ?? task.effectiveMinimumMinutes;
    const fixedInterval = fixedFutureInterval(task, planDate, now);
    const earliestStart = latestDependencyEnd(task, dependencyEnds);
    const eligibleBlocks = blocksAfter(blocks, earliestStart);
    const candidateBlocks = fixedInterval
      ? [{ ...fixedInterval, context: task.executionContext, usableMinutes: intervalMinutes(fixedInterval.start, fixedInterval.end) }]
      : [];
    const failure = record(
      task,
      allocatedMinutes,
      candidateBlocks,
      placeFixedTask(task, allocatedMinutes, eligibleBlocks, planDate, now)
    );

    if (failure) {
      return { scheduled, unscheduled, failure };
    }
  }

  for (const task of flexibleTasks) {
    const allocatedMinutes = allocations.get(task.taskId) ?? task.effectiveMinimumMinutes;
    const eligibleBlocks = blocksAfter(blocks, latestDependencyEnd(task, dependencyEnds));
    const candidateBlocks = candidateBlocksForTask(task, eligibleBlocks);
    const failure = record(task, allocatedMinutes, candidateBlocks, placeTask(task, allocatedMinutes, eligibleBlocks));

    if (failure) {
      return { scheduled, unscheduled, failure };
    }
  }

  return { scheduled, unscheduled, failure: null, dependencyEnds };
}

function placementFailure(task, scheduledMinutes, plannedMinutes, candidateBlocks) {
  return {
    kind: 'placement_failure',
    belowMinimum: [{
      taskId: task.taskId,
      taskName: task.taskName,
      minimumMinutes: task.effectiveMinimumMinutes,
      scheduledMinutes,
      plannedMinutes,
      candidateBlocks
    }]
  };
}

function priorityDescending(now) {
  return (left, right) => (
    calculatePriority(right, now) - calculatePriority(left, now)
      || left.taskName.localeCompare(right.taskName)
  );
}

function placementComparator(now) {
  const byPriority = priorityDescending(now);

  return (left, right) => {
    const leftDeadline = validDateTime(left.deadline);
    const rightDeadline = validDateTime(right.deadline);

    if (leftDeadline && rightDeadline && leftDeadline !== rightDeadline) {
      return leftDeadline < rightDeadline ? -1 : 1;
    }

    if (Boolean(leftDeadline) !== Boolean(rightDeadline)) {
      return leftDeadline ? -1 : 1;
    }

    const leftRestricted = left.executionContext !== CONTEXTS.ANY;
    const rightRestricted = right.executionContext !== CONTEXTS.ANY;

    if (leftRestricted !== rightRestricted) {
      return leftRestricted ? -1 : 1;
    }

    return byPriority(left, right);
  };
}

function sortSegments(segments) {
  return [...segments].sort((left, right) => (
    left.start.localeCompare(right.start)
      || left.end.localeCompare(right.end)
      || left.taskName.localeCompare(right.taskName)
  ));
}

function conflictResult(
  planDate,
  completed,
  availableMinutes,
  requiredMinimumMinutes,
  {
    kind = 'minimum_overflow',
    desiredMinutes = null,
    belowMinimum = [],
    deadlineViolations = [],
    dependencyIssues = [],
    actions = [...CONFLICT_ACTIONS]
  } = {}
) {
  return {
    status: 'conflict',
    planDate,
    segments: sortSegments(completed),
    conflict: {
      kind,
      availableMinutes,
      requiredMinimumMinutes,
      desiredMinutes,
      belowMinimum,
      deadlineViolations,
      dependencyIssues,
      actions
    }
  };
}

function dependencyGraphIssue(tasks) {
  const completedIds = new Set(
    tasks.filter((task) => task.status === TASK_STATUSES.COMPLETED).map((task) => task.taskId)
  );
  const active = activeTasks(tasks);
  const activeById = new Map(active.map((task) => [task.taskId, task]));
  const missing = [];

  for (const task of active) {
    for (const dependencyId of dependencyIds(task)) {
      if (!activeById.has(dependencyId) && !completedIds.has(dependencyId)) {
        missing.push({
          taskId: task.taskId,
          taskName: task.taskName,
          dependencyTaskId: dependencyId
        });
      }
    }
  }

  if (missing.length > 0) {
    return { kind: 'missing_dependency', dependencyIssues: missing };
  }

  const indegree = new Map(active.map((task) => [task.taskId, 0]));
  const successors = new Map(active.map((task) => [task.taskId, []]));
  for (const task of active) {
    for (const dependencyId of dependencyIds(task)) {
      if (activeById.has(dependencyId)) {
        indegree.set(task.taskId, indegree.get(task.taskId) + 1);
        successors.get(dependencyId).push(task.taskId);
      }
    }
  }
  const ready = active.filter((task) => indegree.get(task.taskId) === 0);
  while (ready.length > 0) {
    const task = ready.shift();
    for (const successorId of successors.get(task.taskId)) {
      indegree.set(successorId, indegree.get(successorId) - 1);
      if (indegree.get(successorId) === 0) {
        ready.push(activeById.get(successorId));
      }
    }
  }
  const cyclic = active.filter((task) => indegree.get(task.taskId) > 0);

  if (cyclic.length > 0) {
    return {
      kind: 'dependency_cycle',
      dependencyIssues: cyclic.map((task) => ({ taskId: task.taskId, taskName: task.taskName }))
    };
  }

  return null;
}

function completedDependencyEnds(tasks) {
  const result = new Map();
  for (const task of tasks.filter((item) => item.status === TASK_STATUSES.COMPLETED)) {
    const end = validDateTime(task.actualEnd);
    if (end && (!result.has(task.taskId) || end > result.get(task.taskId))) {
      result.set(task.taskId, end);
    }
  }
  return result;
}

function dependencyOrderIssues(tasks, segments) {
  const starts = new Map();
  const ends = new Map();
  for (const segment of segments) {
    const start = starts.get(segment.taskId);
    const end = ends.get(segment.taskId);
    if (!start || segment.start < start) {
      starts.set(segment.taskId, segment.start);
    }
    if (!end || segment.end > end) {
      ends.set(segment.taskId, segment.end);
    }
  }

  return activeTasks(tasks).flatMap((task) => dependencyIds(task).flatMap((dependencyId) => {
    const dependencyEnd = ends.get(dependencyId);
    const taskStart = starts.get(task.taskId);
    if (!dependencyEnd || !taskStart || dependencyEnd <= taskStart) {
      return [];
    }
    return [{
      taskId: task.taskId,
      taskName: task.taskName,
      dependencyTaskId: dependencyId,
      dependencyEnd,
      taskStart
    }];
  }));
}

const FLOATING_ENUMERATION_LIMIT = 8;

function scheduleWindow({ tasks, blocks, planDate, now, dependencyEnds = new Map() }) {
  const capacity = totalMinutes(blocks);
  const ordered = orderByDependencies(tasks, placementComparator(now));
  const fixedTasks = ordered.filter((task) => task.fixed && task.fixedStart && task.fixedEnd);
  const flexibleTasks = ordered.filter((task) => !fixedTasks.includes(task));
  const compressionCaps = new Map();
  let allocations = null;
  let attempt = null;

  while (true) {
    allocations = withAllocationCaps(allocateDurations(tasks, capacity, now), compressionCaps);
    attempt = attemptPlacement({
      fixedTasks,
      flexibleTasks,
      allocations,
      available: blocks,
      planDate,
      now,
      initialDependencyEnds: dependencyEnds
    });

    if (!attempt.failure) {
      break;
    }

    const failedTask = attempt.failure.task;
    const deficit = failedTask.effectiveMinimumMinutes - attempt.failure.scheduledMinutes;
    const compression = isUserFixed(failedTask)
      ? null
      : distributeCompression(
          deficit,
          competingDonors(failedTask, tasks, allocations, blocks, attempt.scheduled),
          now
        );

    if (!compression) {
      return {
        scheduled: attempt.scheduled,
        unscheduled: attempt.unscheduled,
        failure: attempt.failure,
        allocations,
        compression: Infinity
      };
    }

    for (const item of compression) {
      const current = allocations.get(item.task.taskId) ?? item.task.effectiveMinimumMinutes;
      compressionCaps.set(item.task.taskId, current - item.taken);
    }
  }

  const placedByTask = new Map();
  for (const segment of attempt.scheduled) {
    placedByTask.set(segment.taskId, (placedByTask.get(segment.taskId) ?? 0) + segment.allocatedMinutes);
  }
  const compression = tasks.reduce((sum, task) => (
    sum + Math.max(0, task.effectiveDesiredMinutes - (placedByTask.get(task.taskId) ?? 0))
  ), 0);

  return {
    scheduled: attempt.scheduled,
    unscheduled: attempt.unscheduled,
    failure: null,
    allocations,
    compression,
    dependencyEnds: attempt.dependencyEnds
  };
}

function partitionWindows(blocks) {
  const byContext = new Map();
  for (const block of blocks) {
    if (!byContext.has(block.context)) {
      byContext.set(block.context, []);
    }
    byContext.get(block.context).push(block);
  }
  return byContext;
}

function fixedWindowContext(task, windowsMap, planDate, now) {
  const interval = fixedFutureInterval(task, planDate, now);
  if (!interval) {
    return null;
  }
  for (const [context, blocks] of windowsMap) {
    if (blocks.some((block) => block.start <= interval.start && block.end >= interval.end)) {
      return context;
    }
  }
  return null;
}

function classifyWindowTasks(schedulable, windowsMap, planDate, now) {
  const contexts = [...windowsMap.keys()];
  const fixedByWindow = new Map(contexts.map((context) => [context, []]));
  const dedicatedByWindow = new Map(contexts.map((context) => [context, []]));
  const floating = [];

  for (const task of schedulable) {
    if (task.fixed && task.fixedStart && task.fixedEnd) {
      const candidates = contexts.filter((context) => contextCompatible(task, { context }));
      const context = fixedWindowContext(task, windowsMap, planDate, now)
        ?? candidates[0]
        ?? contexts[0];
      fixedByWindow.get(context)?.push(task);
      continue;
    }

    const candidates = contexts.filter((context) => contextCompatible(task, { context }));
    if (candidates.length <= 1) {
      const context = candidates[0] ?? contexts[0];
      dedicatedByWindow.get(context)?.push(task);
    } else {
      floating.push({ task, candidates });
    }
  }

  return { fixedByWindow, dedicatedByWindow, floating };
}

function orderedContextsForDependencies(tasksByContext, fallbackOrder) {
  const contextIndex = new Map(fallbackOrder.map((context, index) => [context, index]));
  const contextByTaskId = new Map();
  for (const [context, tasks] of tasksByContext) {
    for (const task of tasks) {
      contextByTaskId.set(task.taskId, context);
    }
  }

  const indegree = new Map(fallbackOrder.map((context) => [context, 0]));
  const successors = new Map(fallbackOrder.map((context) => [context, new Set()]));
  for (const [context, tasks] of tasksByContext) {
    for (const task of tasks) {
      for (const dependencyId of dependencyIds(task)) {
        const dependencyContext = contextByTaskId.get(dependencyId);
        if (!dependencyContext || dependencyContext === context) {
          continue;
        }
        if (!successors.get(dependencyContext).has(context)) {
          successors.get(dependencyContext).add(context);
          indegree.set(context, indegree.get(context) + 1);
        }
      }
    }
  }

  const ready = fallbackOrder.filter((context) => indegree.get(context) === 0);
  const ordered = [];
  while (ready.length > 0) {
    ready.sort((left, right) => contextIndex.get(left) - contextIndex.get(right));
    const context = ready.shift();
    ordered.push(context);
    for (const successor of successors.get(context)) {
      indegree.set(successor, indegree.get(successor) - 1);
      if (indegree.get(successor) === 0) {
        ready.push(successor);
      }
    }
  }

  return ordered.length === fallbackOrder.length ? ordered : fallbackOrder;
}

function evaluateAssignment(assignment, ctx) {
  // Windows are scheduled in sequence over a shared remaining-time pool so that
  // blocks of different contexts that overlap in wall-clock time are never
  // double-booked. For time-disjoint windows (the common case) this is
  // identical to scheduling each window independently.
  let remaining = ctx.available.map((block) => ({ ...block }));
  const perWindow = new Map();
  let dependencyEnds = new Map(ctx.completedDependencyEnds);
  const tasksByContext = new Map(ctx.orderedContexts.map((context) => [
    context,
    [
      ...ctx.fixedByWindow.get(context),
      ...ctx.dedicatedByWindow.get(context),
      ...(assignment.get(context) ?? [])
    ]
  ]));
  const orderedContexts = orderedContextsForDependencies(tasksByContext, ctx.orderedContexts);

  for (const context of orderedContexts) {
    const blocks = remaining.filter((block) => block.context === context);
    const tasks = tasksByContext.get(context);
    const result = scheduleWindow({
      tasks,
      blocks,
      planDate: ctx.planDate,
      now: ctx.now,
      dependencyEnds
    });
    perWindow.set(context, result);
    remaining = subtractIntervals(remaining, result.scheduled);
    dependencyEnds = result.dependencyEnds ?? dependencyEnds;
  }

  const conflicts = [...perWindow.values()].filter((w) => w.failure).map((w) => w.failure);
  const totalCompression = [...perWindow.values()].reduce((sum, w) => (
    sum + (w.failure ? 0 : w.compression)
  ), 0);
  return { perWindow, conflicts, totalCompression };
}

function betterEvaluation(current, candidate) {
  if (!current) {
    return candidate;
  }
  if (candidate.conflicts.length !== current.conflicts.length) {
    return candidate.conflicts.length < current.conflicts.length ? candidate : current;
  }
  if (candidate.totalCompression !== current.totalCompression) {
    return candidate.totalCompression < current.totalCompression ? candidate : current;
  }
  return current;
}

function assignmentFromIndices(floating, indices) {
  const assignment = new Map();
  floating.forEach((item, k) => {
    const context = item.candidates[indices[k]];
    assignment.set(context, [...(assignment.get(context) ?? []), item.task]);
  });
  return assignment;
}

function bruteForceBest(ctx, floating) {
  const total = floating.reduce((product, item) => product * item.candidates.length, 1);
  let best = null;
  for (let i = 0; i < total; i += 1) {
    let n = i;
    const indices = floating.map((item) => {
      const idx = n % item.candidates.length;
      n = Math.floor(n / item.candidates.length);
      return idx;
    });
    best = betterEvaluation(best, evaluateAssignment(assignmentFromIndices(floating, indices), ctx));
  }
  return best;
}

function greedyBest(ctx, floating) {
  const sorted = [...floating].sort((a, b) => (
    calculatePriority(b.task, ctx.now) - calculatePriority(a.task, ctx.now)
      || a.task.taskName.localeCompare(b.task.taskName)
  ));
  const assignment = new Map();
  for (const item of sorted) {
    let bestContext = item.candidates[0];
    let bestEval = null;
    for (const context of item.candidates) {
      const trial = new Map(assignment);
      trial.set(context, [...(assignment.get(context) ?? []), item.task]);
      const evaluation = evaluateAssignment(trial, ctx);
      if (betterEvaluation(bestEval, evaluation) === evaluation) {
        bestEval = evaluation;
        bestContext = context;
      }
    }
    assignment.set(bestContext, [...(assignment.get(bestContext) ?? []), item.task]);
  }
  return evaluateAssignment(assignment, ctx);
}

function selectBestAssignment(ctx, floating) {
  if (floating.length === 0) {
    return evaluateAssignment(new Map(), ctx);
  }
  return floating.length <= FLOATING_ENUMERATION_LIMIT
    ? bruteForceBest(ctx, floating)
    : greedyBest(ctx, floating);
}

export function scheduleDay({
  planDate,
  now,
  scheduleStart = now,
  availableBlocks = [],
  protectedBlocks = [],
  tasks = []
}) {
  const completed = completedSegments(tasks);
  const blockedIntervals = [...protectedBlocks, ...completed];
  const schedulingNow = scheduleStart ?? now;
  const active = activeTasks(tasks)
    .map((task) => unlockAutoFixedDeadlineViolation(task, planDate))
    .map((task) => taskWithEffectiveWork(task, planDate, schedulingNow));
  const available = futurePartOfBlocks(
    subtractIntervals(availableBlocks, blockedIntervals),
    schedulingNow
  );
  const availableMinutes = totalMinutes(available);
  const requiredMinimumMinutes = active.reduce((sum, task) => (
    sum + task.effectiveMinimumMinutes
  ), 0);
  const desiredMinutes = active.reduce((sum, task) => (
    sum + task.effectiveDesiredMinutes
  ), 0);
  const deadlineViolations = active
    .map((task) => fixedDeadlineViolation(task, planDate))
    .filter(Boolean);
  const dependencyIssue = dependencyGraphIssue(tasks);

  if (dependencyIssue) {
    return conflictResult(planDate, completed, availableMinutes, requiredMinimumMinutes, {
      ...dependencyIssue,
      actions: ['修改任务的前置任务，消除缺失引用或依赖环后重排']
    });
  }

  if (deadlineViolations.length > 0) {
    return conflictResult(planDate, completed, availableMinutes, requiredMinimumMinutes, {
      kind: 'deadline_violation',
      deadlineViolations
    });
  }

  if (requiredMinimumMinutes > availableMinutes) {
    return conflictResult(planDate, completed, availableMinutes, requiredMinimumMinutes);
  }

  const schedulableTasks = active.filter((task) => (
    task.effectiveDesiredMinutes > 0 || fixedFutureInterval(task, planDate, schedulingNow)
  ));

  const windowsMap = partitionWindows(available);

  if (windowsMap.size === 0) {
    return {
      status: 'ok',
      planDate,
      segments: sortSegments(completed),
      unscheduled: [],
      durationPlan: withPlacedActualDurations(
        durationPlanSummary(schedulableTasks, new Map(), availableMinutes),
        []
      )
    };
  }

  const { fixedByWindow, dedicatedByWindow, floating } = classifyWindowTasks(
    schedulableTasks,
    windowsMap,
    planDate,
    schedulingNow
  );
  // Schedule concrete-context windows before the shared "any" window so that
  // context-restricted tasks claim overlapping time before flexible ones.
  const orderedContexts = [...windowsMap.keys()].sort((left, right) => (
    (left === CONTEXTS.ANY ? 1 : 0) - (right === CONTEXTS.ANY ? 1 : 0)
  ));
  const best = selectBestAssignment(
    {
      fixedByWindow,
      dedicatedByWindow,
      windowsMap,
      available,
      orderedContexts,
      planDate,
      now: schedulingNow,
      completedDependencyEnds: completedDependencyEnds(tasks)
    },
    floating
  );

  if (best.conflicts.length > 0) {
    const failure = best.conflicts[0];
    return conflictResult(
      planDate,
      completed,
      availableMinutes,
      requiredMinimumMinutes,
      placementFailure(
        failure.task,
        failure.scheduledMinutes,
        failure.plannedMinutes,
        failure.candidateBlocks
      )
    );
  }

  const windowResults = [...best.perWindow.values()];
  const scheduled = windowResults.flatMap((w) => w.scheduled);
  const unscheduled = windowResults.flatMap((w) => w.unscheduled);
  const mergedAllocations = new Map();
  for (const w of windowResults) {
    for (const [taskId, minutes] of w.allocations) {
      mergedAllocations.set(taskId, minutes);
    }
  }
  const durationPlan = durationPlanSummary(schedulableTasks, mergedAllocations, availableMinutes);
  const allSegments = sortSegments([...completed, ...scheduled]);
  const orderIssues = dependencyOrderIssues(tasks, allSegments);

  if (orderIssues.length > 0) {
    return conflictResult(planDate, completed, availableMinutes, requiredMinimumMinutes, {
      kind: 'dependency_order_violation',
      dependencyIssues: orderIssues,
      actions: ['调整固定时间、任务场景或可用时间，使前置任务能先完成']
    });
  }

  return {
    status: unscheduled.length > 0 ? 'partial' : 'ok',
    planDate,
    segments: allSegments,
    unscheduled,
    durationPlan: withPlacedActualDurations(durationPlan, scheduled)
  };
}
