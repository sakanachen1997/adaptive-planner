import { TASK_STATUSES } from './models.js';
import { calculatePriority } from './priority.js';

// Manual ranking ("时间不够时先保谁") coexists with importance / urgency /
// external commitment: while a day has a saved ranking, ranked tasks get a
// priorityOverride derived from their position and the numeric fields are
// ignored by the scheduler. Without a saved ranking nothing changes.

const MIN_RANK_STEP = 3;

function isActive(task) {
  return task.status !== TASK_STATUSES.COMPLETED && task.status !== TASK_STATUSES.SKIPPED;
}

function numericPriority(task) {
  return calculatePriority({ ...task, priorityOverride: null });
}

export function rankableTasks(tasks) {
  const byId = new Map();

  for (const task of tasks) {
    if (isActive(task) && !byId.has(task.taskId)) {
      byId.set(task.taskId, task);
    }
  }

  return [...byId.values()];
}

// Saved ids keep their relative order; a task not yet ranked is inserted just
// below the last ranked task whose numeric priority is at least as high, so it
// never jumps above a task the user deliberately promoted.
export function rankedTaskOrder(tasks, savedOrder = []) {
  const active = rankableTasks(tasks);
  const byId = new Map(active.map((task) => [task.taskId, task]));
  const order = [...new Set(savedOrder ?? [])].filter((taskId) => byId.has(taskId));
  const unranked = active
    .filter((task) => !order.includes(task.taskId))
    .sort((left, right) => (
      numericPriority(right) - numericPriority(left)
        || left.taskName.localeCompare(right.taskName)
    ));

  for (const task of unranked) {
    const score = numericPriority(task);
    const lastHigher = order.findLastIndex((taskId) => numericPriority(byId.get(taskId)) >= score);
    order.splice(lastHigher + 1, 0, task.taskId);
  }

  return order;
}

// Map rank positions onto the same scale the numeric formula produces, so the
// scheduler's proportional compression keeps behaving sensibly. Ranks are
// strictly decreasing even when every task has identical numeric fields.
export function rankPriorityOverrides(tasks, order) {
  const byId = new Map(rankableTasks(tasks).map((task) => [task.taskId, task]));
  const ids = order.filter((taskId) => byId.has(taskId));
  const result = new Map();

  if (ids.length === 0) {
    return result;
  }

  const scores = ids.map((taskId) => numericPriority(byId.get(taskId)));
  const high = Math.max(...scores);
  const low = Math.min(...scores);
  const steps = Math.max(1, ids.length - 1);
  const step = Math.max(high - low, MIN_RANK_STEP * steps) / steps;

  ids.forEach((taskId, index) => {
    result.set(taskId, Math.max(1, high - index * step));
  });

  return result;
}

export function applyRanking(tasks, savedOrder) {
  if (!Array.isArray(savedOrder)) {
    return tasks;
  }

  const overrides = rankPriorityOverrides(tasks, rankedTaskOrder(tasks, savedOrder));

  return tasks.map((task) => (
    isActive(task) && overrides.has(task.taskId)
      ? { ...task, priorityOverride: overrides.get(task.taskId) }
      : task
  ));
}

export function moveInOrder(order, taskId, offset) {
  const index = order.indexOf(taskId);
  const target = index + offset;

  if (index === -1 || target < 0 || target >= order.length) {
    return [...order];
  }

  const next = [...order];
  next.splice(index, 1);
  next.splice(target, 0, taskId);
  return next;
}
