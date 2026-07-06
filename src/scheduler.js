import { CONTEXTS, TASK_STATUSES } from './models.js';
import { calculatePriority, scorePlacement } from './priority.js';
import {
  addMinutes,
  minutesBetween,
  normalizeDateTime,
  subtractIntervals,
  totalMinutes
} from './time.js';

const CONFLICT_ACTIONS = Object.freeze([
  '增加可用时间后重排',
  '降低部分任务最小时长后重排',
  '删除/跳过低优先级任务后重排'
]);

function contextCompatible(task, block) {
  return task.executionContext === CONTEXTS.ANY || task.executionContext === block.context;
}

function normalizePositiveBlocks(blocks) {
  return blocks
    .map((block) => ({
      ...block,
      start: normalizeDateTime(block.start),
      end: normalizeDateTime(block.end)
    }))
    .filter((block) => minutesBetween(block.start, block.end) > 0);
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
    .map((task) => ({
      taskId: task.taskId,
      taskName: task.taskName,
      start: normalizeDateTime(task.actualStart),
      end: normalizeDateTime(task.actualEnd),
      status: TASK_STATUSES.COMPLETED
    }));
}

function activeTasks(tasks) {
  return tasks.filter((task) => (
    task.status !== TASK_STATUSES.COMPLETED
      && task.status !== TASK_STATUSES.SKIPPED
  ));
}

function allocateDurations(tasks, capacityMinutes, now) {
  const requiredMinimum = tasks.reduce((sum, task) => sum + task.minimumMinutes, 0);
  const flexibleCapacity = Math.max(0, capacityMinutes - requiredMinimum);
  const weightedTasks = tasks.map((task) => ({
    task,
    desiredExtra: Math.max(0, task.desiredMinutes - task.minimumMinutes),
    weight: calculatePriority(task, now) * Math.max(1, task.desiredMinutes)
  }));
  const totalWeight = weightedTasks.reduce((sum, item) => sum + item.weight, 0) || 1;

  return new Map(weightedTasks.map(({ task, desiredExtra, weight }) => {
    const proportionalExtra = Math.floor((weight / totalWeight) * flexibleCapacity);
    return [
      task.taskId,
      task.minimumMinutes + Math.min(desiredExtra, proportionalExtra)
    ];
  }));
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

function placeTask(task, minutes, blocks) {
  const compatible = blocks
    .map((block, index) => ({ block, index, score: scorePlacement(task, block) }))
    .filter((item) => contextCompatible(task, item.block))
    .sort((left, right) => (
      right.score - left.score
        || left.block.start.localeCompare(right.block.start)
    ));

  const segments = [];
  let remaining = minutes;

  for (const item of compatible) {
    if (remaining <= 0) {
      break;
    }

    const block = blocks[item.index];
    const capacity = minutesBetween(block.start, block.end);
    const minimumForBlock = task.splittable
      ? Math.min(remaining, task.minSegmentMinutes)
      : remaining;

    if (capacity < minimumForBlock) {
      continue;
    }

    const used = task.splittable ? Math.min(remaining, capacity) : remaining;
    const segment = segmentForTask(task, block.start, used);
    segments.push(segment);
    block.start = segment.end;
    remaining -= used;

    if (!task.splittable) {
      break;
    }
  }

  return { segments, remaining };
}

function placeFixedTask(task, allocatedMinutes, blocks, planDate, now) {
  if (!task.fixed || !task.fixedStart || !task.fixedEnd) {
    return { segments: [], remaining: allocatedMinutes, blocks };
  }

  const start = fixedDateTime(planDate, task.fixedStart);
  const end = fixedDateTime(planDate, task.fixedEnd);
  const fixedMinutes = minutesBetween(start, end);

  if (fixedMinutes <= 0 || end <= normalizeDateTime(now)) {
    return { segments: [], remaining: allocatedMinutes, blocks };
  }

  const fixedBlock = {
    start: start < normalizeDateTime(now) ? normalizeDateTime(now) : start,
    end,
    context: task.executionContext
  };
  const containingBlock = blocks.find((block) => (
    contextCompatible(task, block)
      && block.start <= fixedBlock.start
      && block.end >= fixedBlock.end
  ));

  if (!containingBlock) {
    return { segments: [], remaining: allocatedMinutes, blocks };
  }

  const used = minutesBetween(fixedBlock.start, fixedBlock.end);
  const segment = {
    taskId: task.taskId,
    taskName: task.taskName,
    status: TASK_STATUSES.SCHEDULED,
    start: fixedBlock.start,
    end: fixedBlock.end,
    allocatedMinutes: used
  };

  return {
    segments: [segment],
    remaining: Math.max(0, allocatedMinutes - used),
    blocks: subtractIntervals(blocks, [segment])
  };
}

function priorityDescending(now) {
  return (left, right) => (
    calculatePriority(right, now) - calculatePriority(left, now)
      || left.taskName.localeCompare(right.taskName)
  );
}

function sortSegments(segments) {
  return [...segments].sort((left, right) => (
    left.start.localeCompare(right.start)
      || left.end.localeCompare(right.end)
      || left.taskName.localeCompare(right.taskName)
  ));
}

export function scheduleDay({
  planDate,
  now,
  availableBlocks = [],
  protectedBlocks = [],
  tasks = []
}) {
  const completed = completedSegments(tasks);
  const active = activeTasks(tasks);
  const available = futurePartOfBlocks(
    subtractIntervals(availableBlocks, protectedBlocks),
    now
  );
  const availableMinutes = totalMinutes(available);
  const requiredMinimumMinutes = active.reduce((sum, task) => sum + task.minimumMinutes, 0);

  if (requiredMinimumMinutes > availableMinutes) {
    return {
      status: 'conflict',
      planDate,
      segments: sortSegments(completed),
      conflict: {
        availableMinutes,
        requiredMinimumMinutes,
        actions: [...CONFLICT_ACTIONS]
      }
    };
  }

  const allocations = allocateDurations(active, availableMinutes, now);
  let blocks = available.map((block) => ({ ...block }));
  const orderedTasks = [...active].sort(priorityDescending(now));
  const fixedTasks = orderedTasks.filter((task) => task.fixed && task.fixedStart && task.fixedEnd);
  const flexibleTasks = orderedTasks.filter((task) => !fixedTasks.includes(task));
  const scheduled = [];
  const unscheduled = [];

  for (const task of fixedTasks) {
    const allocatedMinutes = allocations.get(task.taskId) ?? task.minimumMinutes;
    const result = placeFixedTask(task, allocatedMinutes, blocks, planDate, now);
    scheduled.push(...result.segments);
    blocks = result.blocks;

    if (result.remaining > 0) {
      unscheduled.push({
        taskId: task.taskId,
        taskName: task.taskName,
        remainingMinutes: result.remaining
      });
    }
  }

  for (const task of flexibleTasks) {
    const allocatedMinutes = allocations.get(task.taskId) ?? task.minimumMinutes;
    const result = placeTask(task, allocatedMinutes, blocks);
    scheduled.push(...result.segments);

    if (result.remaining > 0) {
      unscheduled.push({
        taskId: task.taskId,
        taskName: task.taskName,
        remainingMinutes: result.remaining
      });
    }
  }

  return {
    status: unscheduled.length > 0 ? 'partial' : 'ok',
    planDate,
    segments: sortSegments([...completed, ...scheduled]),
    unscheduled
  };
}
