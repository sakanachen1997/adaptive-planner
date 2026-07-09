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
  return task.executionContext === CONTEXTS.ANY
    || block.context === CONTEXTS.ANY
    || task.executionContext === block.context;
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
        status: TASK_STATUSES.COMPLETED
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
      return null;
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

  return pool.filter((item) => item.taken > 0);
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

function attemptPlacement({ fixedTasks, flexibleTasks, allocations, available, planDate, now }) {
  let blocks = available.map((block) => ({ ...block }));
  const scheduled = [];
  const unscheduled = [];

  const record = (task, allocatedMinutes, candidateBlocks, result) => {
    const scheduledMinutes = result.segments.reduce((sum, segment) => (
      sum + segment.allocatedMinutes
    ), 0);

    if (scheduledMinutes < task.effectiveMinimumMinutes) {
      return { task, scheduledMinutes, plannedMinutes: allocatedMinutes, candidateBlocks };
    }

    scheduled.push(...result.segments);
    blocks = result.blocks;

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
    const candidateBlocks = fixedInterval
      ? [{ ...fixedInterval, context: task.executionContext, usableMinutes: intervalMinutes(fixedInterval.start, fixedInterval.end) }]
      : [];
    const failure = record(
      task,
      allocatedMinutes,
      candidateBlocks,
      placeFixedTask(task, allocatedMinutes, blocks, planDate, now)
    );

    if (failure) {
      return { scheduled, unscheduled, failure };
    }
  }

  for (const task of flexibleTasks) {
    const allocatedMinutes = allocations.get(task.taskId) ?? task.effectiveMinimumMinutes;
    const candidateBlocks = candidateBlocksForTask(task, blocks);
    const failure = record(task, allocatedMinutes, candidateBlocks, placeTask(task, allocatedMinutes, blocks));

    if (failure) {
      return { scheduled, unscheduled, failure };
    }
  }

  return { scheduled, unscheduled, failure: null };
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
      actions
    }
  };
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
  const orderedTasks = [...schedulableTasks].sort(placementComparator(now));
  const fixedTasks = orderedTasks.filter((task) => task.fixed && task.fixedStart && task.fixedEnd);
  const flexibleTasks = orderedTasks.filter((task) => !fixedTasks.includes(task));

  const compressionCaps = new Map();
  let allocations = null;
  let attempt = null;

  while (true) {
    allocations = withAllocationCaps(
      allocateDurations(schedulableTasks, availableMinutes, now),
      compressionCaps
    );
    attempt = attemptPlacement({
      fixedTasks,
      flexibleTasks,
      allocations,
      available,
      planDate,
      now: schedulingNow
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
          competingDonors(
            failedTask,
            schedulableTasks,
            allocations,
            available,
            attempt.scheduled
          ),
          now
        );

    if (!compression) {
      return conflictResult(
        planDate,
        completed,
        availableMinutes,
        requiredMinimumMinutes,
        placementFailure(
          failedTask,
          attempt.failure.scheduledMinutes,
          attempt.failure.plannedMinutes,
          attempt.failure.candidateBlocks
        )
      );
    }

    for (const item of compression) {
      const current = allocations.get(item.task.taskId)
        ?? item.task.effectiveMinimumMinutes;
      compressionCaps.set(item.task.taskId, current - item.taken);
    }
  }

  const durationPlan = durationPlanSummary(schedulableTasks, allocations, availableMinutes);

  return {
    status: attempt.unscheduled.length > 0 ? 'partial' : 'ok',
    planDate,
    segments: sortSegments([...completed, ...attempt.scheduled]),
    unscheduled: attempt.unscheduled,
    durationPlan: withPlacedActualDurations(durationPlan, attempt.scheduled)
  };
}
