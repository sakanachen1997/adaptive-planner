export const APP_ID = 'adaptive-planner';
export const PLAN_TITLE_PREFIX = '[Plan]';

export const CONTEXTS = Object.freeze({
  ANY: 'any',
  WORK: 'work',
  HOME: 'home',
  CUSTOM: 'custom'
});

export const TASK_STATUSES = Object.freeze({
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  SKIPPED: 'skipped'
});

export const ORDER_PREFERENCES = Object.freeze({
  MORNING: 'morning',
  AFTERNOON: 'afternoon',
  EVENING: 'evening',
  ANY: 'any'
});

function freezeDefaults(defaults) {
  for (const value of Object.values(defaults)) {
    Object.freeze(value);
  }
  return Object.freeze(defaults);
}

export const TASK_TYPE_DEFAULTS = freezeDefaults({
  编码工作: {
    energyDemand: 'high',
    physicalDemand: 'low',
    splittable: false,
    minSegmentMinutes: 45,
    executionContext: CONTEXTS.WORK,
    orderPreference: ORDER_PREFERENCES.MORNING,
    externalCommitment: 4,
    batchGroup: null
  },
  复杂教程和学习: {
    energyDemand: 'high',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 25,
    executionContext: CONTEXTS.ANY,
    orderPreference: ORDER_PREFERENCES.MORNING,
    externalCommitment: 2,
    batchGroup: null
  },
  背单词: {
    energyDemand: 'mediumLow',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 10,
    executionContext: CONTEXTS.ANY,
    orderPreference: ORDER_PREFERENCES.ANY,
    externalCommitment: 1,
    batchGroup: null
  },
  打游戏: {
    energyDemand: 'low',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 30,
    executionContext: CONTEXTS.HOME,
    orderPreference: ORDER_PREFERENCES.EVENING,
    externalCommitment: 0,
    batchGroup: null
  },
  运动健身: {
    energyDemand: 'medium',
    physicalDemand: 'high',
    splittable: false,
    minSegmentMinutes: 30,
    executionContext: CONTEXTS.HOME,
    orderPreference: ORDER_PREFERENCES.EVENING,
    externalCommitment: 2,
    batchGroup: null
  },
  绘画委托副业: {
    energyDemand: 'mediumHigh',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 30,
    executionContext: CONTEXTS.HOME,
    orderPreference: ORDER_PREFERENCES.EVENING,
    externalCommitment: 4,
    batchGroup: null
  },
  生活杂务: {
    energyDemand: 'low',
    physicalDemand: 'variable',
    splittable: true,
    minSegmentMinutes: 15,
    executionContext: CONTEXTS.ANY,
    orderPreference: ORDER_PREFERENCES.ANY,
    externalCommitment: 1,
    batchGroup: null
  },
  行政工作: {
    energyDemand: 'low',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 15,
    executionContext: CONTEXTS.ANY,
    orderPreference: ORDER_PREFERENCES.AFTERNOON,
    externalCommitment: 2,
    batchGroup: '行政工作'
  },
  自定义: {
    energyDemand: 'medium',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 20,
    executionContext: CONTEXTS.ANY,
    orderPreference: ORDER_PREFERENCES.ANY,
    externalCommitment: 1,
    batchGroup: null
  }
});

function generateTaskId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeTaskType(taskType) {
  return Object.hasOwn(TASK_TYPE_DEFAULTS, taskType) ? taskType : '自定义';
}

function finiteNumber(value, fieldName) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new RangeError(`${fieldName} must be a number or numeric string`);
  }

  if (typeof value === 'string' && value.trim() === '') {
    throw new RangeError(`${fieldName} must not be blank`);
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${fieldName} must be a finite number`);
  }
  return number;
}

function positiveNumber(value, fieldName) {
  const number = finiteNumber(value, fieldName);
  if (number <= 0) {
    throw new RangeError(`${fieldName} must be greater than 0`);
  }
  return number;
}

function importanceNumber(value) {
  const number = finiteNumber(value, 'importance');
  if (number < 1 || number > 5) {
    throw new RangeError('importance must be between 1 and 5');
  }
  return number;
}

function nonNegativeNumber(value, fieldName) {
  const number = finiteNumber(value, fieldName);
  if (number < 0) {
    throw new RangeError(`${fieldName} must be greater than or equal to 0`);
  }
  return number;
}

function valueOrDefault(input, fieldName, defaultValue) {
  return Object.hasOwn(input, fieldName) ? input[fieldName] : defaultValue;
}

function dependencyTaskIds(value, taskId) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new RangeError('dependencyTaskIds must be an array');
  }

  const result = [...new Set(value.map((id) => String(id).trim()).filter(Boolean))];
  if (result.includes(taskId)) {
    throw new RangeError('a task cannot depend on itself');
  }
  return result;
}

export function createTask(input) {
  const taskType = normalizeTaskType(input.taskType);
  const defaults = TASK_TYPE_DEFAULTS[taskType];
  const taskName = String(input.taskName ?? '').trim();

  if (!taskName) {
    throw new RangeError('taskName must not be blank');
  }

  const desiredMinutes = positiveNumber(input.desiredMinutes, 'desiredMinutes');
  const minimumMinutes = positiveNumber(input.minimumMinutes, 'minimumMinutes');

  if (minimumMinutes > desiredMinutes) {
    throw new RangeError('minimumMinutes must be less than or equal to desiredMinutes');
  }

  const taskId = input.taskId ?? generateTaskId();

  return {
    taskId,
    taskName,
    taskType,
    desiredMinutes,
    minimumMinutes,
    importance: importanceNumber(input.importance),
    deadline: input.deadline || null,
    executionContext: input.executionContext ?? defaults.executionContext,
    fixed: Boolean(input.fixed),
    fixedStart: input.fixedStart || null,
    fixedEnd: input.fixedEnd || null,
    energyDemand: input.energyDemand ?? defaults.energyDemand,
    physicalDemand: input.physicalDemand ?? defaults.physicalDemand,
    orderPreference: input.orderPreference ?? defaults.orderPreference,
    batchGroup: input.batchGroup ?? defaults.batchGroup ?? null,
    splittable: input.splittable ?? defaults.splittable,
    minSegmentMinutes: positiveNumber(valueOrDefault(input, 'minSegmentMinutes', defaults.minSegmentMinutes), 'minSegmentMinutes'),
    externalCommitment: nonNegativeNumber(valueOrDefault(input, 'externalCommitment', defaults.externalCommitment), 'externalCommitment'),
    status: input.status ?? TASK_STATUSES.PENDING,
    actualStart: input.actualStart ?? null,
    actualEnd: input.actualEnd ?? null,
    weekPlanId: input.weekPlanId ?? null,
    dependencyTaskIds: dependencyTaskIds(input.dependencyTaskIds, taskId)
  };
}
