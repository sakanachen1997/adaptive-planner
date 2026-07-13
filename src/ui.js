import {
  APP_ID,
  CONTEXTS,
  ORDER_PREFERENCES,
  TASK_STATUSES,
  TASK_TYPE_DEFAULTS,
  createTask
} from './models.js';
import {
  buildDescription,
  extractPlanMetadata,
  isPlanManagedEvent
} from './metadata.js';
import { scheduleDay } from './scheduler.js';
import { calculatePriority } from './priority.js';
import { combineDateAndTime, minutesBetween, normalizeDateTime } from './time.js';
import { loadSettings, saveSettings } from './storage.js';
import {
  createPlanEvent,
  deletePlanEvent,
  initGoogleAuth,
  listPrimaryEvents,
  requestAccessToken,
  updatePlanEvent
} from './calendarClient.js';

const BASE_CONTEXT_OPTIONS = Object.freeze([
  { value: CONTEXTS.ANY, label: '任意时间' },
  { value: CONTEXTS.WORK, label: '仅工作时间' },
  { value: CONTEXTS.HOME, label: '仅下班后' }
]);

const BLOCK_CONTEXT_OPTIONS = Object.freeze([
  { value: CONTEXTS.ANY, label: '任意时间' },
  { value: CONTEXTS.WORK, label: '工作时间' },
  { value: CONTEXTS.HOME, label: '下班后' },
  { value: CONTEXTS.CUSTOM, label: '自定义' }
]);

const ENERGY_DEMAND_OPTIONS = Object.freeze([
  { value: 'high', label: '高' },
  { value: 'mediumHigh', label: '中高' },
  { value: 'medium', label: '中' },
  { value: 'mediumLow', label: '中低' },
  { value: 'low', label: '低' }
]);

const PHYSICAL_DEMAND_OPTIONS = Object.freeze([
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
  { value: 'variable', label: '可变' }
]);

const ORDER_PREFERENCE_OPTIONS = Object.freeze([
  { value: ORDER_PREFERENCES.MORNING, label: '上午' },
  { value: ORDER_PREFERENCES.AFTERNOON, label: '下午' },
  { value: ORDER_PREFERENCES.EVENING, label: '晚上' },
  { value: ORDER_PREFERENCES.ANY, label: '不限' }
]);

const DEFAULT_MESSAGE = '先生成可用时间块并添加任务，然后点击调度。';
export const MAX_CUSTOM_BLOCKS = 8;
let customContextSequence = 0;

function localDateString(date = new Date()) {
  return normalizeDateTime(date).slice(0, 10);
}

function localNowString() {
  return normalizeDateTime(new Date());
}

function scheduleStartForDate(planDate) {
  return `${planDate}T00:00:00`;
}

function nextLocalDate(planDate) {
  const date = new Date(`${planDate}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return localDateString(date);
}

function toCalendarQueryDateTime(planDate, time) {
  return new Date(`${planDate}T${time}`).toISOString();
}

function toTimeInputValue(value) {
  return String(value ?? '').slice(0, 5);
}

function timeFromDateTime(value) {
  return normalizeDateTime(value).slice(11, 16);
}

function blockFromSetting(block) {
  return {
    start: toTimeInputValue(block.start) || '09:00',
    end: toTimeInputValue(block.end) || '10:00',
    context: block.context || CONTEXTS.ANY,
    enabled: block.enabled !== false,
    customName: String(block.customName ?? ''),
    customContextId: block.customContextId
      ?? (block.context === CONTEXTS.CUSTOM ? CONTEXTS.CUSTOM : null)
  };
}

function blockToSetting(block) {
  return {
    start: block.start,
    end: block.end,
    context: block.context,
    enabled: block.enabled !== false,
    customName: block.customName ?? '',
    customContextId: block.customContextId ?? null
  };
}

function generateCustomContextId() {
  customContextSequence += 1;
  return globalThis.crypto?.randomUUID?.()
    ? `custom:${globalThis.crypto.randomUUID()}`
    : `custom:${Date.now()}:${customContextSequence}`;
}

export function contextKeyForBlock(block) {
  if (block.context !== CONTEXTS.CUSTOM) {
    return block.context;
  }
  return block.customContextId || CONTEXTS.CUSTOM;
}

function customBlocks(blocks = state.availableBlocks) {
  return blocks.filter((block) => block.context === CONTEXTS.CUSTOM);
}

export function executionContextOptionsForBlocks(blocks, selectedValue = '') {
  const namedOptions = customBlocks(blocks)
    .map((block) => ({
      value: contextKeyForBlock(block),
      label: String(block.customName ?? '').trim()
        ? `自定义：${String(block.customName).trim()}`
        : '自定义时间块（未命名）'
    }))
    .filter((item, index, items) => (
      items.findIndex((candidate) => candidate.value === item.value) === index
    ));
  const options = [...BASE_CONTEXT_OPTIONS, ...namedOptions];

  if (selectedValue && !options.some((item) => item.value === selectedValue)) {
    options.push({ value: selectedValue, label: `已不存在的时间块：${selectedValue}` });
  }
  return options;
}

function nextCustomBlockName(blocks = state.availableBlocks) {
  const used = new Set(customBlocks(blocks).map((block) => block.customName));
  for (let index = 1; index <= MAX_CUSTOM_BLOCKS; index += 1) {
    const name = `自定义 ${index}`;
    if (!used.has(name)) {
      return name;
    }
  }
  return `自定义 ${MAX_CUSTOM_BLOCKS}`;
}

function element(id) {
  return document.getElementById(id);
}

function firstElement(selector) {
  return document.querySelector(selector);
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function appendText(parent, text, tagName = 'span') {
  const node = document.createElement(tagName);
  node.textContent = text;
  parent.append(node);
  return node;
}

export function calendarEventToProtectedBlock(event) {
  if (isPlanManagedEvent(event)) {
    return null;
  }

  const start = event?.start?.dateTime;
  const end = event?.end?.dateTime;

  if (!start || !end) {
    return null;
  }

  return {
    start: normalizeDateTime(start),
    end: normalizeDateTime(end),
    summary: event.summary || '普通日程',
    calendarEventId: event.id ?? null
  };
}

export function calendarEventToPlanTask(event) {
  const metadata = extractPlanMetadata(event?.description ?? '');

  if (!metadata) {
    return null;
  }

  const plannedStart = event?.start?.dateTime
    ? normalizeDateTime(event.start.dateTime)
    : null;
  const plannedEnd = event?.end?.dateTime
    ? normalizeDateTime(event.end.dateTime)
    : null;
  const task = {
    ...metadata,
    plannedStart,
    plannedEnd,
    calendarEventId: event.id ?? null
  };

  if (
    metadata.status === TASK_STATUSES.SCHEDULED
      && plannedStart
      && plannedEnd
  ) {
    task.fixed = Boolean(metadata.fixed) && metadata.autoFixed !== true;
    task.autoFixed = true;
    task.fixedStart = timeFromDateTime(plannedStart);
    task.fixedEnd = timeFromDateTime(plannedEnd);
  }

  return task;
}

function stableSegmentId(taskId, index) {
  return `${taskId}_segment_${index + 1}`;
}

function legacySegmentIdFor(segment) {
  return `${segment.taskId}_${segment.start}_${segment.end}`;
}

function metadataForSegment(segment, task, planDate, segmentId, status = TASK_STATUSES.SCHEDULED) {
  const {
    autoFixed,
    plannedStart,
    plannedEnd,
    calendarEventId,
    localOverride,
    taskLevelOverride,
    ...taskMetadata
  } = task ?? {};

  return {
    ...taskMetadata,
    schemaVersion: 1,
    app: APP_ID,
    planDate,
    taskId: segment.taskId,
    taskName: segment.taskName,
    segmentId,
    status
  };
}

function indexesForScheduledSegments(segments) {
  const indexes = new Map();
  const byTaskId = new Map();

  for (const segment of segments) {
    byTaskId.set(segment.taskId, [...(byTaskId.get(segment.taskId) ?? []), segment]);
  }

  for (const taskSegments of byTaskId.values()) {
    taskSegments
      .sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end))
      .forEach((segment, index) => indexes.set(segment, index));
  }

  return indexes;
}

function countsForSegmentsByTask(segments) {
  const counts = new Map();

  for (const segment of segments) {
    counts.set(segment.taskId, (counts.get(segment.taskId) ?? 0) + 1);
  }

  return counts;
}

function existingPlanTasksFrom({ existingPlanTasks = [], planEvents = [] }) {
  return [
    ...existingPlanTasks,
    ...planEvents.map(calendarEventToPlanTask).filter(Boolean)
  ];
}

function matchingPlanDate(task, planDate) {
  return task.planDate == null || task.planDate === planDate;
}

function sortablePlannedStart(task) {
  return task.plannedStart ?? task.fixedStart ?? task.segmentId ?? '';
}

function compareExistingPlanTasks(left, right) {
  return sortablePlannedStart(left).localeCompare(sortablePlannedStart(right))
    || String(left.calendarEventId ?? '').localeCompare(String(right.calendarEventId ?? ''));
}

function existingPlanLookup(existingPlanTasks) {
  const bySegmentId = new Map();
  const byTaskId = new Map();

  for (const task of existingPlanTasks) {
    if (task.segmentId && task.calendarEventId) {
      bySegmentId.set(task.segmentId, task);
    }

    if (
      task.taskId
        && task.calendarEventId
        && task.status !== TASK_STATUSES.COMPLETED
    ) {
      const matches = byTaskId.get(task.taskId) ?? [];
      matches.push(task);
      byTaskId.set(task.taskId, matches);
    }
  }

  for (const matches of byTaskId.values()) {
    matches.sort(compareExistingPlanTasks);
  }

  return { bySegmentId, byTaskId };
}

function findExistingByEventId(existingPlanTasks, eventId) {
  return existingPlanTasks.find((task) => task.calendarEventId === eventId) ?? null;
}

function unusedExistingForTask(byTaskId, taskId, usedEventIds) {
  const candidates = byTaskId.get(taskId) ?? [];
  return candidates.find((task) => !usedEventIds.has(task.calendarEventId)) ?? null;
}

function markUsed(usedEventIds, eventId) {
  if (eventId) {
    usedEventIds.add(eventId);
  }
}

function taskCandidatesByTaskId(tasks) {
  const candidates = new Map();

  for (const task of tasks) {
    const matches = candidates.get(task.taskId) ?? [];
    matches.push(task);
    candidates.set(task.taskId, matches);
  }

  return candidates;
}

function taskEditKey(task) {
  if (task.calendarEventId) {
    return `event:${task.calendarEventId}`;
  }

  if (task.segmentId) {
    return `segment:${task.segmentId}`;
  }

  return `task:${task.taskId}`;
}

function logicalTaskEditKey(task) {
  return `task:${task.taskId}`;
}

function sameEditableTask(left, right) {
  if (left.calendarEventId && right.calendarEventId) {
    return left.calendarEventId === right.calendarEventId;
  }

  if (left.segmentId && right.segmentId) {
    return left.segmentId === right.segmentId;
  }

  return !left.calendarEventId
    && !right.calendarEventId
    && !left.segmentId
    && !right.segmentId
    && left.taskId === right.taskId;
}

function activeEditableTask(task) {
  return task.status !== TASK_STATUSES.COMPLETED
    && task.status !== TASK_STATUSES.SKIPPED;
}

export function editableTasksForSchedule(schedule, tasks, now = new Date()) {
  if (schedule?.status !== 'conflict') {
    return [];
  }

  return tasks
    .filter(activeEditableTask)
    .sort((left, right) => calculatePriority(left, now) - calculatePriority(right, now));
}

export function removeTaskForReschedule(localTasks, task) {
  if (task.calendarEventId) {
    return upsertLocalTask(localTasks, {
      ...task,
      status: TASK_STATUSES.SKIPPED,
      localOverride: true
    });
  }

  return localTasks.filter((candidate) => !sameEditableTask(candidate, task));
}

export function uncompleteTaskInList(localTasks, task) {
  return upsertLocalTask(localTasks, {
    ...task,
    status: TASK_STATUSES.PENDING,
    actualStart: null,
    actualEnd: null,
    localOverride: Boolean(task.calendarEventId)
  });
}

export function formInputForTask(task) {
  const taskType = task.taskType ?? '自定义';
  const defaults = TASK_TYPE_DEFAULTS[taskType] ?? TASK_TYPE_DEFAULTS['自定义'];

  return {
    taskName: task.taskName ?? '',
    taskType,
    desiredMinutes: String(task.desiredMinutes ?? ''),
    minimumMinutes: String(task.minimumMinutes ?? ''),
    importance: String(task.importance ?? ''),
    deadline: task.deadline ? normalizeDateTime(task.deadline).slice(0, 16) : '',
    executionContext: task.executionContext ?? defaults.executionContext,
    energyDemand: task.energyDemand ?? defaults.energyDemand,
    physicalDemand: task.physicalDemand ?? defaults.physicalDemand,
    orderPreference: task.orderPreference ?? defaults.orderPreference,
    splittable: task.splittable ?? defaults.splittable,
    minSegmentMinutes: String(task.minSegmentMinutes ?? defaults.minSegmentMinutes),
    externalCommitment: String(task.externalCommitment ?? defaults.externalCommitment),
    fixed: Boolean(task.fixed) && !task.autoFixed,
    fixedStart: toTimeInputValue(task.fixedStart),
    fixedEnd: toTimeInputValue(task.fixedEnd),
    dependencyTaskIds: [...(task.dependencyTaskIds ?? [])]
  };
}

export function upsertLocalTask(tasks, editedTask) {
  const index = tasks.findIndex((task) => sameEditableTask(task, editedTask));

  if (index === -1) {
    return [...tasks, editedTask];
  }

  return [
    ...tasks.slice(0, index),
    editedTask,
    ...tasks.slice(index + 1)
  ];
}

function taskConfigurationFromOverride(task) {
  const {
    taskId,
    status,
    segmentId,
    calendarEventId,
    plannedStart,
    plannedEnd,
    actualStart,
    actualEnd,
    autoFixed,
    localOverride,
    taskLevelOverride,
    ...configuration
  } = task;
  return configuration;
}

export function shouldShowRecoveryActions(schedule) {
  return schedule?.status === 'conflict'
    && schedule.conflict?.kind === 'minimum_overflow';
}

function formatCandidateBlocks(blocks = []) {
  if (!blocks.length) {
    return '没有兼容的剩余时间块';
  }

  return blocks.map((block) => (
    `${block.start.slice(11, 16)}-${block.end.slice(11, 16)}`
      + `（${block.context}，可用 ${block.usableMinutes} 分钟）`
  )).join('；');
}

export function conflictSummaryLines(conflict) {
  if (conflict.kind === 'missing_dependency') {
    return (conflict.dependencyIssues ?? []).map((item) => (
      `任务「${item.taskName}」引用的前置任务 ${item.dependencyTaskId} 已不存在。请编辑任务并重新选择前置任务。`
    ));
  }

  if (conflict.kind === 'dependency_cycle') {
    const names = (conflict.dependencyIssues ?? []).map((item) => `「${item.taskName}」`).join('、');
    return [`任务依赖形成了环：${names}。环中的任务都无法成为第一个，请移除至少一条依赖。`];
  }

  if (conflict.kind === 'dependency_order_violation') {
    return (conflict.dependencyIssues ?? []).map((item) => (
      `任务「${item.taskName}」在前置任务完成前就开始了。请调整固定时间、执行场景或可用时间。`
    ));
  }

  if (conflict.kind === 'deadline_violation' && conflict.deadlineViolations?.length) {
    return conflict.deadlineViolations.map((item) => (
      `任务「${item.taskName}」固定在 ${item.fixedStart} - ${item.fixedEnd}，但截止时间是 ${item.deadline.slice(11, 16)}。请修改固定时间、截止时间，或删除该任务。`
    ));
  }

  if (conflict.kind === 'placement_failure' && conflict.belowMinimum?.length) {
    return [
      ...conflict.belowMinimum.flatMap((item) => [
        `任务「${item.taskName}」无法放入兼容的时间块：`
          + (item.plannedMinutes ? `计划分配 ${item.plannedMinutes} 分钟，` : '')
          + `最小需要 ${item.minimumMinutes} 分钟，只能安排 ${item.scheduledMinutes} 分钟。`,
        `尝试过的时间块：${formatCandidateBlocks(item.candidateBlocks)}。`
      ]),
      `总可用时间 ${conflict.availableMinutes} 分钟，全部任务最小共需 ${conflict.requiredMinimumMinutes} 分钟。`
    ];
  }

  return [
    `可用时间 ${conflict.availableMinutes} 分钟，任务最小需要 ${conflict.requiredMinimumMinutes} 分钟。`
  ];
}

export function actualDurationForTask(schedule, taskId) {
  return schedule?.durationPlan?.allocations?.find((item) => item.taskId === taskId) ?? null;
}

function timelineMinutes(value) {
  const time = normalizeDateTime(value).slice(11, 16);
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function fixedTimeOnDate(planDate, time) {
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

  return null;
}

function plannedIntervalForTask(task, planDate) {
  const start = task.plannedStart
    ? normalizeDateTime(task.plannedStart)
    : task.fixed && task.fixedStart && planDate
      ? fixedTimeOnDate(planDate, task.fixedStart)
      : null;
  const end = task.plannedEnd
    ? normalizeDateTime(task.plannedEnd)
    : task.fixed && task.fixedEnd && planDate
      ? fixedTimeOnDate(planDate, task.fixedEnd)
      : null;

  if (!start || !end || end <= start) {
    return null;
  }

  return { start, end };
}

function timelineSegmentKey(segment) {
  return [
    segment.segmentId ?? '',
    segment.calendarEventId ?? '',
    segment.taskId,
    segment.start,
    segment.end
  ].join('|');
}

function missedTimelineItems({ tasks, existingSegments, planDate, now, candidatesByTaskId }) {
  if (!now) {
    return [];
  }

  const current = normalizeDateTime(now);
  const existingKeys = new Set(existingSegments.map(timelineSegmentKey));

  return tasks
    .filter((task) => task.status !== TASK_STATUSES.COMPLETED)
    .filter((task) => task.status !== TASK_STATUSES.SKIPPED)
    .map((task) => {
      const interval = plannedIntervalForTask(task, task.planDate ?? planDate);

      if (!interval || interval.end > current) {
        return null;
      }

      const segment = {
        taskId: task.taskId,
        taskName: task.taskName,
        status: 'missed',
        start: interval.start,
        end: interval.end,
        allocatedMinutes: task.desiredMinutes,
        segmentId: task.segmentId ?? null,
        calendarEventId: task.calendarEventId ?? null
      };

      if (existingKeys.has(timelineSegmentKey(segment))) {
        return null;
      }

      return {
        kind: 'task',
        id: `missed:${task.calendarEventId ?? task.segmentId ?? task.taskId}:${interval.start}:${interval.end}`,
        task: findTaskForSegment(segment, candidatesByTaskId) ?? task,
        segment,
        title: task.taskName,
        start: interval.start,
        end: interval.end,
        startMinute: timelineMinutes(interval.start),
        endMinute: timelineMinutes(interval.end),
        status: 'missed',
        editable: true
      };
    })
    .filter(Boolean);
}

export function buildTimelineItems({
  schedule = null,
  protectedBlocks = [],
  tasks = [],
  now = null
}) {
  const candidatesByTaskId = taskCandidatesByTaskId(tasks);
  const scheduleSegments = schedule?.segments ?? [];
  const segmentCounts = countsForSegmentsByTask(scheduleSegments);
  const segmentIndexes = indexesForScheduledSegments(scheduleSegments);
  const taskItems = scheduleSegments.map((segment) => {
    const task = findTaskForSegment(segment, candidatesByTaskId, {
      allowLogicalTaskFallback: true
    });
    const segmentCount = segmentCounts.get(segment.taskId) ?? 1;
    const segmentNumber = (segmentIndexes.get(segment) ?? 0) + 1;
    const segmentLabel = segmentCount > 1 ? ` · ${segmentNumber}/${segmentCount}` : '';

    return {
      kind: 'task',
      id: segment.segmentId ?? `${segment.taskId}:${segment.start}:${segment.end}`,
      task,
      segment,
      title: `${segment.taskName}${segmentLabel}`,
      start: segment.start,
      end: segment.end,
      startMinute: timelineMinutes(segment.start),
      endMinute: timelineMinutes(segment.end),
      status: segment.status,
      editable: Boolean(task),
      segmentNumber,
      segmentCount
    };
  });
  const missedItems = missedTimelineItems({
    tasks,
    existingSegments: scheduleSegments,
    planDate: schedule?.planDate ?? null,
    now,
    candidatesByTaskId
  });
  const protectedItems = protectedBlocks.map((block) => ({
    kind: 'protected',
    id: `protected:${block.calendarEventId ?? block.start}`,
    block,
    title: block.summary ?? '普通日程',
    start: block.start,
    end: block.end,
    startMinute: timelineMinutes(block.start),
    endMinute: timelineMinutes(block.end),
    status: 'protected',
    editable: false
  }));

  return [...taskItems, ...missedItems, ...protectedItems].sort((left, right) => (
    left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
  ));
}

export function timelineBounds(items, markerTime = null) {
  const markerMinute = markerTime ? timelineMinutes(markerTime) : null;

  if (items.length === 0) {
    const defaultStart = 480;
    const defaultEnd = 1320;
    const startMinute = markerMinute === null
      ? defaultStart
      : Math.min(defaultStart, Math.floor(markerMinute / 60) * 60);
    const endMinute = markerMinute === null
      ? defaultEnd
      : Math.max(defaultEnd, Math.ceil(markerMinute / 60) * 60);

    return { startMinute, endMinute, totalMinutes: Math.max(60, endMinute - startMinute) };
  }

  const startMinute = Math.max(
    0,
    Math.floor(Math.min(
      ...items.map((item) => item.startMinute),
      markerMinute ?? Infinity
    ) / 60) * 60
  );
  const endMinute = Math.min(
    1440,
    Math.ceil(Math.max(
      ...items.map((item) => item.endMinute),
      markerMinute ?? -Infinity
    ) / 60) * 60 + 60
  );

  return {
    startMinute,
    endMinute,
    totalMinutes: Math.max(60, endMinute - startMinute)
  };
}

export function buildDebugReport({
  planDate,
  now,
  scheduleStart = null,
  availableBlocks = [],
  protectedBlocks = [],
  tasks = [],
  schedule = null
}) {
  return JSON.stringify(
    {
      app: APP_ID,
      generatedFor: '调试导出：粘贴给助手以分析调度问题',
      planDate,
      now,
      scheduleStart,
      availableBlocks,
      protectedBlocks,
      tasks,
      schedule
    },
    null,
    2
  );
}

export function deadlineLabel(deadline, planDate) {
  if (!deadline) {
    return '';
  }

  const normalized = normalizeDateTime(deadline);
  const date = normalized.slice(0, 10);
  const time = normalized.slice(11, 16);

  if (!date || !time) {
    return '';
  }

  return date === planDate ? `截止 ${time}` : `截止 ${date} ${time}`;
}

export function deadlineTodayValue(now, currentValue) {
  const today = normalizeDateTime(now).slice(0, 10);
  const time = String(currentValue ?? '').slice(11, 16) || '23:59';
  return `${today}T${time}`;
}

function sameDateTime(left, right) {
  return Boolean(left && right) && normalizeDateTime(left) === normalizeDateTime(right);
}

function sameTime(left, right) {
  return Boolean(left && right) && String(left).slice(0, 5) === String(right).slice(0, 5);
}

function taskMatchesSegmentTime(task, segment) {
  if (
    sameDateTime(task.plannedStart, segment.start)
      && sameDateTime(task.plannedEnd, segment.end)
  ) {
    return true;
  }

  if (
    sameDateTime(task.actualStart, segment.start)
      && sameDateTime(task.actualEnd, segment.end)
  ) {
    return true;
  }

  return sameTime(task.fixedStart, segment.start.slice(11, 16))
    && sameTime(task.fixedEnd, segment.end.slice(11, 16));
}

function findTaskForSegment(segment, candidatesByTaskId, {
  segmentId = null,
  calendarEventId = null,
  allowTaskIdFallback = true,
  allowLogicalTaskFallback = false
} = {}) {
  const candidates = candidatesByTaskId.get(segment.taskId) ?? [];
  const identitySegmentId = segmentId ?? segment.segmentId ?? null;
  const identityEventId = calendarEventId ?? segment.calendarEventId ?? null;

  if (identitySegmentId) {
    const match = candidates.find((task) => task.segmentId === identitySegmentId);
    if (match) {
      return match;
    }
  }

  if (identityEventId) {
    const match = candidates.find((task) => task.calendarEventId === identityEventId);
    if (match) {
      return match;
    }
  }

  const timeMatches = candidates.filter((task) => taskMatchesSegmentTime(task, segment));
  if (timeMatches.length === 1) {
    return timeMatches[0];
  }

  if (allowTaskIdFallback && candidates.length === 1) {
    return candidates[0];
  }

  if (allowLogicalTaskFallback && candidates.length > 1) {
    return candidates.find(activeEditableTask) ?? candidates[0];
  }

  return null;
}

export function selectTaskForCompletion(tasks, {
  taskId,
  segmentStart,
  segmentEnd = null,
  segmentId = null,
  calendarEventId = null
}) {
  return findTaskForSegment(
    {
      taskId,
      start: segmentStart,
      end: segmentEnd ?? segmentStart,
      status: TASK_STATUSES.SCHEDULED,
      segmentId,
      calendarEventId
    },
    taskCandidatesByTaskId(tasks),
    { segmentId, calendarEventId }
  );
}

export function mergePlanTasks({ calendarTasks = [], localTasks = [] }) {
  const merged = [];
  const calendarTaskIds = new Set();
  const taskLevelOverrides = new Map(
    localTasks
      .filter((task) => task.taskLevelOverride)
      .map((task) => [task.taskId, task])
  );

  for (const task of calendarTasks) {
    const override = taskLevelOverrides.get(task.taskId);
    merged.push(override ? {
      ...task,
      ...taskConfigurationFromOverride(override),
      taskId: task.taskId,
      status: task.status,
      segmentId: task.segmentId ?? null,
      calendarEventId: task.calendarEventId ?? null,
      plannedStart: task.plannedStart ?? null,
      plannedEnd: task.plannedEnd ?? null,
      autoFixed: task.autoFixed
    } : task);
    calendarTaskIds.add(task.taskId);
  }

  for (const task of localTasks) {
    if (task.taskLevelOverride) {
      if (!calendarTaskIds.has(task.taskId)) {
        merged.push(task);
      }
      continue;
    }

    const calendarIndex = merged.findIndex((candidate) => (
      candidate.calendarEventId && candidate.calendarEventId === task.calendarEventId
    ));
    const calendarTask = calendarIndex === -1 ? null : merged[calendarIndex];

    if (!task.calendarEventId && !calendarTaskIds.has(task.taskId)) {
      merged.push(task);
      continue;
    }

    if (
      calendarTask?.calendarEventId === task.calendarEventId
        && (task.status === TASK_STATUSES.COMPLETED || task.localOverride)
    ) {
      merged[calendarIndex] = task;
    }
  }

  return merged;
}

function durationMinutes(start, end) {
  const minutes = minutesBetween(start, end);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

export function logicalTasksForSchedule(tasks) {
  const groups = new Map();

  for (const task of tasks) {
    groups.set(task.taskId, [...(groups.get(task.taskId) ?? []), task]);
  }

  return [...groups.values()].flatMap((records) => {
    const completed = records.filter((task) => task.status === TASK_STATUSES.COMPLETED);
    const active = records.filter((task) => (
      task.status !== TASK_STATUSES.COMPLETED && task.status !== TASK_STATUSES.SKIPPED
    ));
    if (records.length === 1 || active.length === 0) {
      return records;
    }

    const representative = active[0];
    const completedMinutes = completed.reduce((sum, task) => (
      sum + durationMinutes(task.actualStart, task.actualEnd)
    ), 0);
    const remainingDesired = Math.max(0, representative.desiredMinutes - completedMinutes);
    const remainingMinimum = Math.max(0, representative.minimumMinutes - completedMinutes);
    const logicalActive = {
      ...representative,
      desiredMinutes: remainingDesired,
      minimumMinutes: Math.min(remainingDesired, remainingMinimum),
      calendarEventId: null,
      segmentId: null,
      plannedStart: null,
      plannedEnd: null
    };

    return [
      ...completed,
      ...(remainingDesired > 0 ? [logicalActive] : [])
    ];
  });
}

function emptySyncOperations() {
  return {
    creates: [],
    updates: [],
    deletes: []
  };
}

export function resetCalendarStateForDateChange(currentState, newDate) {
  return {
    ...currentState,
    planDate: newDate,
    calendarEvents: [],
    schedule: null,
    lastSyncOperations: emptySyncOperations()
  };
}

export function buildSyncOperations({
  schedule,
  tasks,
  planDate,
  existingPlanTasks = [],
  planEvents = []
}) {
  const result = emptySyncOperations();

  if (!schedule || schedule.status === 'conflict') {
    return result;
  }

  const scheduledSegments = (schedule.segments ?? [])
    .filter((segment) => segment.status === TASK_STATUSES.SCHEDULED);
  const completedSegments = (schedule.segments ?? [])
    .filter((segment) => segment.status === TASK_STATUSES.COMPLETED);
  const candidatesByTaskId = taskCandidatesByTaskId(tasks);
  const scheduledSegmentIndexes = indexesForScheduledSegments(scheduledSegments);
  const scheduledCountsByTask = countsForSegmentsByTask(scheduledSegments);
  const allExistingPlanTasks = existingPlanTasksFrom({
    existingPlanTasks,
    planEvents
  }).filter((task) => matchingPlanDate(task, planDate));
  const { bySegmentId, byTaskId } = existingPlanLookup(allExistingPlanTasks);
  const usedEventIds = new Set();

  for (const segment of completedSegments) {
    const task = findTaskForSegment(segment, candidatesByTaskId);

    if (!task?.calendarEventId) {
      continue;
    }

    const existing = findExistingByEventId(allExistingPlanTasks, task.calendarEventId);
    const segmentId = task.segmentId
      ?? existing?.segmentId
      ?? stableSegmentId(segment.taskId, 0);
    const completionTask = {
      ...task,
      actualStart: task.actualStart ?? segment.start,
      actualEnd: task.actualEnd ?? segment.end
    };
    const completionSegment = {
      ...segment,
      start: completionTask.actualStart,
      end: completionTask.actualEnd
    };
    const metadata = metadataForSegment(
      completionSegment,
      completionTask,
      planDate,
      segmentId,
      TASK_STATUSES.COMPLETED
    );
    const description = buildDescription('由 Adaptive Planner 创建。', metadata);

    result.updates.push({
      segment: completionSegment,
      task: completionTask,
      description,
      eventId: task.calendarEventId
    });
    markUsed(usedEventIds, task.calendarEventId);
  }

  for (const segment of scheduledSegments) {
    const identityTask = findTaskForSegment(segment, candidatesByTaskId);
    const task = identityTask
      ?? findTaskForSegment(segment, candidatesByTaskId, { allowLogicalTaskFallback: true })
      ?? {
      taskId: segment.taskId,
      taskName: segment.taskName
    };
    const segmentIndex = scheduledSegmentIndexes.get(segment) ?? 0;
    const segmentId = segment.segmentId
      ?? identityTask?.segmentId
      ?? stableSegmentId(segment.taskId, segmentIndex);
    const legacySegmentId = legacySegmentIdFor(segment);
    const exactExisting = bySegmentId.get(segmentId)
      ?? bySegmentId.get(legacySegmentId);
    const fallbackExisting = exactExisting?.calendarEventId
      && !usedEventIds.has(exactExisting.calendarEventId)
      ? exactExisting
      : unusedExistingForTask(byTaskId, segment.taskId, usedEventIds);
    const metadata = metadataForSegment(segment, task, planDate, segmentId);
    const description = buildDescription('由 Adaptive Planner 创建。', metadata);
    const operation = {
      segment,
      task,
      description
    };
    const taskLevelEventId = scheduledCountsByTask.get(segment.taskId) === 1
      && task.calendarEventId
      && !usedEventIds.has(task.calendarEventId)
      ? task.calendarEventId
      : null;
    const eventId = fallbackExisting?.calendarEventId
      ?? taskLevelEventId;

    if (eventId) {
      markUsed(usedEventIds, eventId);
      result.updates.push({
        ...operation,
        eventId
      });
    } else {
      result.creates.push(operation);
    }
  }

  for (const task of allExistingPlanTasks) {
    if (
      task.calendarEventId
        && task.status !== TASK_STATUSES.COMPLETED
        && !usedEventIds.has(task.calendarEventId)
    ) {
      result.deletes.push({
        eventId: task.calendarEventId,
        task
      });
    }
  }

  return result;
}

function createState() {
  const settings = loadSettings();

  return {
    settings,
    planDate: localDateString(),
    calendarEvents: [],
    tasks: [],
    availableBlocks: settings.defaultBlocks
      .filter((block) => block.enabled)
      .map(blockFromSetting),
    schedule: null,
    lastSyncOperations: emptySyncOperations(),
    editingTaskKey: null,
    selectedTimelineItemId: null
  };
}

let state = createState();

function planTasksFromCalendar() {
  return state.calendarEvents
    .map(calendarEventToPlanTask)
    .filter(Boolean);
}

function protectedBlocksFromCalendar() {
  return state.calendarEvents
    .map(calendarEventToProtectedBlock)
    .filter(Boolean);
}

function allTasks() {
  return mergePlanTasks({
    calendarTasks: planTasksFromCalendar(),
    localTasks: state.tasks
  });
}

function logicalTaskDefinitions(tasks = allTasks()) {
  const definitions = new Map();

  for (const task of tasks) {
    const current = definitions.get(task.taskId);
    if (!current || (!activeEditableTask(current) && activeEditableTask(task))) {
      definitions.set(task.taskId, task);
    }
  }

  return [...definitions.values()];
}

function concreteAvailableBlocks() {
  return state.availableBlocks
    .filter((block) => block.enabled !== false)
    .map((block) => ({
      start: combineDateAndTime(state.planDate, block.start),
      end: combineDateAndTime(state.planDate, block.end),
      context: contextKeyForBlock(block)
    }));
}

function showMessage(text, isError = false) {
  const target = element('syncPreview');

  if (!target) {
    return;
  }

  target.textContent = text;
  target.className = isError ? 'schedule-item error' : 'muted';
}

function saveCurrentBlocksAsDefaults() {
  state.settings.defaultBlocks = state.availableBlocks.map(blockToSetting);
  saveSettings(state.settings);
}

function renderTaskTypeOptions() {
  const select = firstElement('select[name="taskType"]');

  if (!select) {
    return;
  }

  select.replaceChildren(
    ...Object.keys(TASK_TYPE_DEFAULTS).map((taskType) => option(taskType, taskType))
  );
}

function renderExecutionContextOptions() {
  const select = firstElement('select[name="executionContext"]');

  if (!select) {
    return;
  }

  const selectedValue = select.value;
  const options = executionContextOptionsForBlocks(state.availableBlocks, selectedValue);

  select.replaceChildren(
    ...options.map(({ value, label }) => option(value, label))
  );
  if (selectedValue) {
    select.value = selectedValue;
  }
}

function renderSelectOptions(name, options) {
  const select = firstElement(`select[name="${name}"]`);

  if (!select) {
    return;
  }

  select.replaceChildren(
    ...options.map(({ value, label }) => option(value, label))
  );
}

function renderTaskPresetFieldOptions() {
  renderSelectOptions('energyDemand', ENERGY_DEMAND_OPTIONS);
  renderSelectOptions('physicalDemand', PHYSICAL_DEMAND_OPTIONS);
  renderSelectOptions('orderPreference', ORDER_PREFERENCE_OPTIONS);
}

function renderDependencyOptions(selectedTaskIds = []) {
  const root = element('dependencyTaskChoices');
  if (!root) {
    return;
  }

  const selected = new Set(selectedTaskIds);
  const editingTaskId = state.editingTaskKey?.startsWith('task:')
    ? state.editingTaskKey.slice('task:'.length)
    : null;
  const tasks = logicalTaskDefinitions()
    .filter((task) => task.status !== TASK_STATUSES.SKIPPED)
    .filter((task) => task.taskId !== editingTaskId)
    .sort((left, right) => left.taskName.localeCompare(right.taskName));

  clear(root);
  if (tasks.length === 0) {
    appendText(root, '还没有可作为前置条件的其他任务。', 'span').className = 'muted';
    return;
  }

  for (const task of tasks) {
    const label = task.status === TASK_STATUSES.COMPLETED
      ? `${task.taskName}（已完成）`
      : task.taskName;
    const wrapper = document.createElement('label');
    const checkbox = document.createElement('input');
    wrapper.className = 'checkbox-option';
    checkbox.type = 'checkbox';
    checkbox.name = 'dependencyTaskIds';
    checkbox.value = task.taskId;
    checkbox.checked = selected.has(task.taskId);
    wrapper.append(checkbox);
    appendText(wrapper, label, 'span');
    root.append(wrapper);
  }
}

function applyTaskTypePreset(taskType) {
  const form = element('taskForm');
  const defaults = TASK_TYPE_DEFAULTS[taskType] ?? TASK_TYPE_DEFAULTS['自定义'];

  if (!form) {
    return;
  }

  form.elements.executionContext.value = defaults.executionContext;
  form.elements.energyDemand.value = defaults.energyDemand;
  form.elements.physicalDemand.value = defaults.physicalDemand;
  form.elements.orderPreference.value = defaults.orderPreference;
  form.elements.splittable.checked = defaults.splittable;
  form.elements.minSegmentMinutes.value = String(defaults.minSegmentMinutes);
  form.elements.externalCommitment.value = String(defaults.externalCommitment);
}

function renderContextSelect(select, selectedValue) {
  select.replaceChildren(
    ...BLOCK_CONTEXT_OPTIONS.map(({ value, label }) => option(value, label))
  );
  select.value = selectedValue;
}

function renderAvailableBlocks() {
  const root = element('availableBlocks');

  if (!root) {
    return;
  }

  clear(root);

  if (state.availableBlocks.length === 0) {
    appendText(root, '没有可用时间块。', 'p');
    return;
  }

  appendText(
    root,
    `自定义时间块 ${customBlocks().length}/${MAX_CUSTOM_BLOCKS}；选择“自定义”后可命名。`,
    'p'
  ).className = 'muted';

  state.availableBlocks.forEach((block, index) => {
    const row = document.createElement('div');
    row.className = 'row';

    const start = document.createElement('input');
    start.type = 'time';
    start.value = block.start;
    start.dataset.blockIndex = String(index);
    start.dataset.blockField = 'start';
    start.setAttribute('aria-label', '开始时间');

    const end = document.createElement('input');
    end.type = 'time';
    end.value = block.end;
    end.dataset.blockIndex = String(index);
    end.dataset.blockField = 'end';
    end.setAttribute('aria-label', '结束时间');

    const context = document.createElement('select');
    context.dataset.blockIndex = String(index);
    context.dataset.blockField = 'context';
    context.setAttribute('aria-label', '时间块场景');
    renderContextSelect(context, block.context);

    const customName = document.createElement('input');
    customName.type = 'text';
    customName.value = block.customName ?? '';
    customName.placeholder = '名称，例如 A';
    customName.maxLength = 40;
    customName.className = 'custom-block-name';
    customName.dataset.blockIndex = String(index);
    customName.dataset.blockField = 'customName';
    customName.setAttribute('aria-label', '自定义时间块名称');

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除';
    remove.dataset.removeBlockIndex = String(index);

    row.append(start, end, context);
    if (block.context === CONTEXTS.CUSTOM) {
      row.append(customName);
    }
    row.append(remove);
    root.append(row);
  });
}

function renderConflictPanel() {
  const panel = element('conflictPanel');

  if (!panel) {
    return;
  }

  if (!state.schedule || state.schedule.status !== 'conflict') {
    panel.className = 'hidden';
    panel.replaceChildren();
    return;
  }

  panel.className = 'conflict';
  clear(panel);
  appendText(panel, '计划冲突', 'strong');

  for (const line of conflictSummaryLines(state.schedule.conflict)) {
    appendText(panel, line, 'p');
  }

  if (state.schedule.conflict.actions?.length) {
    const list = document.createElement('ol');
    for (const action of state.schedule.conflict.actions) {
      appendText(list, action, 'li');
    }
    panel.append(list);
  }
}

function appendEditButton(parent, task) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '编辑';
  button.dataset.editTaskKey = logicalTaskEditKey(task);
  parent.append(button);
}

function renderConflictEditableTasks(root, tasks) {
  const editableTasks = editableTasksForSchedule(state.schedule, tasks);

  if (editableTasks.length === 0) {
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'schedule-item';
  appendText(wrapper, '当前未完成任务（优先级低的排在前，可编辑或删除后重排）', 'strong');

  for (const task of editableTasks) {
    const row = document.createElement('div');
    row.className = 'schedule-actions';
    const taskDeadline = deadlineLabel(task.deadline, state.planDate);
    appendText(
      row,
      `${task.taskName}：想要 ${task.desiredMinutes} 分钟，最小 ${task.minimumMinutes} 分钟，优先级 ${Math.round(calculatePriority(task))}`
        + (taskDeadline ? `，${taskDeadline}` : ''),
      'span'
    );
    appendEditButton(row, task);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除并重排';
    remove.dataset.removeTaskKey = taskEditKey(task);
    row.append(remove);

    wrapper.append(row);
  }

  root.append(wrapper);
}

function timelineHourLabels(bounds) {
  const labels = [];

  for (let minute = bounds.startMinute; minute <= bounds.endMinute; minute += 60) {
    labels.push({
      minute,
      label: `${String(Math.floor(minute / 60)).padStart(2, '0')}:00`
    });
  }

  return labels;
}

function renderTimelineItem(parent, item, bounds) {
  const node = document.createElement('button');
  const top = ((item.startMinute - bounds.startMinute) / bounds.totalMinutes) * 100;
  const height = ((item.endMinute - item.startMinute) / bounds.totalMinutes) * 100;

  node.type = 'button';
  node.className = [
    'timeline-block',
    `timeline-${item.kind}`,
    `timeline-${item.status}`,
    item.id === state.selectedTimelineItemId ? 'selected' : ''
  ].filter(Boolean).join(' ');
  node.style.top = `${top}%`;
  node.style.height = `${Math.max(3, height)}%`;
  node.dataset.timelineItemId = item.id;
  appendText(node, item.title, 'strong');
  appendText(node, `${item.start.slice(11, 16)} - ${item.end.slice(11, 16)}`, 'span');
  parent.append(node);
}

function renderCurrentTimeMarker(parent, now, bounds) {
  if (!now) {
    return;
  }

  const minute = timelineMinutes(now);

  if (minute < bounds.startMinute || minute > bounds.endMinute) {
    return;
  }

  const marker = document.createElement('div');
  marker.className = 'timeline-now';
  marker.style.top = `${((minute - bounds.startMinute) / bounds.totalMinutes) * 100}%`;
  appendText(marker, `现在 ${now.slice(11, 16)}`, 'span');
  parent.append(marker);
}

function renderTimelineView(parent, items, bounds, now = null) {
  parent.className = 'timeline-view';
  clear(parent);

  for (const hour of timelineHourLabels(bounds)) {
    const label = document.createElement('div');
    label.className = 'timeline-hour';
    label.style.top = `${((hour.minute - bounds.startMinute) / bounds.totalMinutes) * 100}%`;
    label.textContent = hour.label;
    parent.append(label);
  }

  for (const item of items) {
    renderTimelineItem(parent, item, bounds);
  }

  renderCurrentTimeMarker(parent, now, bounds);
}

function renderScheduleSummary(parent) {
  if (!state.schedule) {
    appendText(parent, DEFAULT_MESSAGE, 'p');
    return;
  }

  appendText(parent, '计划概览', 'strong');

  if (state.schedule.durationPlan) {
    appendText(
      parent,
      `想要总时长 ${state.schedule.durationPlan.desiredMinutes} 分钟，最小总时长 ${state.schedule.durationPlan.minimumMinutes} 分钟，可用时间 ${state.schedule.durationPlan.availableMinutes} 分钟。`,
      'p'
    ).className = 'muted';
    return;
  }

  if (state.schedule.status === 'conflict') {
    appendText(parent, '当前计划存在冲突。请查看上方冲突说明，或编辑下方未完成任务。', 'p').className = 'muted';
    return;
  }

  appendText(parent, '选择左侧时间块查看详情。', 'p').className = 'muted';
}

function appendCompleteButton(parent, segment, task) {
  if (segment.status === TASK_STATUSES.COMPLETED) {
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '完成';
  button.dataset.completeTaskId = segment.taskId;
  button.dataset.segmentStart = segment.start;
  button.dataset.segmentEnd = segment.end;
  if (task?.segmentId) {
    button.dataset.segmentId = task.segmentId;
  }
  if (task?.calendarEventId) {
    button.dataset.calendarEventId = task.calendarEventId;
  }
  parent.append(button);
}

function appendRemoveButton(parent, task) {
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = task.calendarEventId ? '跳过并重排' : '删除并重排';
  remove.dataset.removeTaskKey = taskEditKey(task);
  parent.append(remove);
}

function appendUncompleteButton(parent, task) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '恢复为未完成';
  button.dataset.uncompleteTaskKey = taskEditKey(task);
  parent.append(button);
}

function completedTaskTimeLabel(task) {
  const start = task.actualStart ? normalizeDateTime(task.actualStart) : null;
  const end = task.actualEnd ? normalizeDateTime(task.actualEnd) : null;

  if (start && end && end > start) {
    return `${start.slice(11, 16)} - ${end.slice(11, 16)}`;
  }

  return '已完成';
}

function renderCompletedTasks(root, tasks) {
  const completedTasks = tasks.filter((task) => task.status === TASK_STATUSES.COMPLETED);

  if (completedTasks.length === 0) {
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'schedule-item';
  appendText(wrapper, '已完成（误点可恢复）', 'strong');

  for (const task of completedTasks) {
    const row = document.createElement('div');
    row.className = 'schedule-actions';
    appendText(row, `${task.taskName}：${completedTaskTimeLabel(task)}`, 'span');
    appendUncompleteButton(row, task);
    wrapper.append(row);
  }

  root.append(wrapper);
}

function renderTimelineTaskDetail(parent, item) {
  const task = item.task;
  const segment = item.segment;
  const actualDuration = actualDurationForTask(state.schedule, segment.taskId);
  const deadlineText = task ? deadlineLabel(task.deadline, state.planDate) : '';

  appendText(parent, item.title, 'strong');
  appendText(
    parent,
    `${item.start.slice(11, 16)} - ${item.end.slice(11, 16)}`
      + (segment.allocatedMinutes ? `，${segment.allocatedMinutes} 分钟` : '')
      + (deadlineText ? `，${deadlineText}` : ''),
    'p'
  ).className = 'muted';

  if (actualDuration) {
    appendText(
      parent,
      `想要 ${actualDuration.desiredMinutes} 分钟 / 最小 ${actualDuration.minimumMinutes} 分钟 / 实际 ${actualDuration.actualMinutes} 分钟`,
      'p'
    ).className = 'muted';
  }

  if (item.status === 'missed') {
    appendText(parent, '预定时间已过去，但任务尚未标记完成。它没有被自动完成；你可以手动完成、编辑，或跳过并重排。', 'p').className = 'schedule-item error';
  }

  if (!task) {
    appendText(parent, '找不到对应任务，无法编辑。', 'p').className = 'muted';
    return;
  }

  const actions = document.createElement('div');
  actions.className = 'schedule-actions';
  appendEditButton(actions, task);
  if (segment.status === TASK_STATUSES.COMPLETED) {
    appendUncompleteButton(actions, task);
  } else {
    appendCompleteButton(actions, segment, task);
  }
  appendRemoveButton(actions, task);
  parent.append(actions);
}

function renderProtectedDetail(parent, item) {
  appendText(parent, item.title, 'strong');
  appendText(parent, `${item.start.slice(11, 16)} - ${item.end.slice(11, 16)}`, 'p').className = 'muted';
  appendText(parent, '普通 Google Calendar 事件。此时间段受保护，不会被 Plan 修改或删除。', 'p').className = 'muted';
}

function renderTimelineDetail(parent, selectedItem) {
  parent.className = 'timeline-detail';
  clear(parent);

  if (!selectedItem) {
    renderScheduleSummary(parent);
    return;
  }

  if (selectedItem.kind === 'protected') {
    renderProtectedDetail(parent, selectedItem);
    return;
  }

  renderTimelineTaskDetail(parent, selectedItem);
}

function renderSchedule() {
  const root = element('scheduleList');
  const currentTasks = allTasks();
  const protectedBlocks = protectedBlocksFromCalendar();

  renderConflictPanel();

  if (!root) {
    return;
  }

  clear(root);

  if (!state.schedule) {
    appendText(root, DEFAULT_MESSAGE, 'p');
    renderSyncPreview();
    return;
  }

  const now = localNowString();
  const items = buildTimelineItems({
    schedule: state.schedule,
    protectedBlocks,
    tasks: currentTasks,
    now
  });
  const timelineNow = now.slice(0, 10) === state.planDate ? now : null;
  const selectedItem = items.find((item) => item.id === state.selectedTimelineItemId) ?? null;
  const bounds = timelineBounds(items, timelineNow);
  const layout = document.createElement('div');
  const timelineView = document.createElement('div');
  const timelineDetail = document.createElement('div');

  layout.className = 'timeline-layout';
  timelineView.id = 'timelineView';
  timelineDetail.id = 'timelineDetail';
  renderTimelineView(timelineView, items, bounds, timelineNow);
  renderTimelineDetail(timelineDetail, selectedItem);
  layout.append(timelineView, timelineDetail);
  root.append(layout);
  renderConflictEditableTasks(root, currentTasks);
  renderCompletedTasks(root, currentTasks);
  renderSyncPreview();
}

function renderSyncPreview() {
  const target = element('syncPreview');

  if (!target) {
    return;
  }

  if (!state.schedule) {
    target.textContent = '还没有可发布的计划。';
    target.className = 'muted';
    return;
  }

  if (state.schedule.status === 'conflict') {
    target.textContent = '解决冲突后才能发布到 Google Calendar。';
    target.className = 'schedule-item error';
    return;
  }

  state.lastSyncOperations = buildSyncOperations({
    schedule: state.schedule,
    tasks: allTasks(),
    existingPlanTasks: planTasksFromCalendar(),
    planDate: state.planDate
  });

  target.textContent = `发布预览：将创建 ${state.lastSyncOperations.creates.length} 个 Plan 事件，更新 ${state.lastSyncOperations.updates.length} 个 Plan 事件，删除 ${state.lastSyncOperations.deletes.length} 个 Plan 事件。普通 Google Calendar 事件不会被修改。`;
  target.className = 'muted';
}

function recalculate() {
  const taskRecords = allTasks();
  state.schedule = scheduleDay({
    planDate: state.planDate,
    now: localNowString(),
    scheduleStart: scheduleStartForDate(state.planDate),
    availableBlocks: concreteAvailableBlocks(),
    protectedBlocks: protectedBlocksFromCalendar(),
    tasks: logicalTasksForSchedule(taskRecords)
  });
  renderSchedule();
}

function fillDefaultBlocks() {
  state.availableBlocks = state.settings.defaultBlocks
    .filter((block) => block.enabled)
    .map(blockFromSetting);
  renderAvailableBlocks();
  renderExecutionContextOptions();
  recalculate();
}

function saveClientId() {
  const input = element('clientIdInput');
  state.settings.clientId = String(input?.value ?? '').trim();
  saveSettings(state.settings);
  showMessage('Client ID 已保存。');
}

function connectGoogleCalendar() {
  const input = element('clientIdInput');
  state.settings.clientId = String(input?.value ?? state.settings.clientId).trim();
  saveSettings(state.settings);

  try {
    initGoogleAuth(state.settings.clientId, (response) => {
      if (response?.error) {
        showMessage(`Google 授权失败：${response.error}`, true);
        return;
      }

      showMessage('Google Calendar 已连接。');
    });
    requestAccessToken();
  } catch (error) {
    showMessage(`Google 授权失败：${error.message}`, true);
  }
}

async function loadCalendar() {
  const timeMin = toCalendarQueryDateTime(state.planDate, '00:00:00');
  const timeMax = toCalendarQueryDateTime(nextLocalDate(state.planDate), '00:00:00');

  try {
    state.calendarEvents = await listPrimaryEvents(timeMin, timeMax);
    showMessage(`已读取并显示 ${state.calendarEvents.length} 个日历事件。此操作没有写入 Google Calendar。`);
    recalculate();
  } catch (error) {
    showMessage(`读取日历失败：${error.message}`, true);
  }
}

async function syncSchedule() {
  if (!state.schedule || state.schedule.status === 'conflict') {
    showMessage('没有可发布的计划，或当前计划仍有冲突。', true);
    return;
  }

  const operations = buildSyncOperations({
    schedule: state.schedule,
    tasks: allTasks(),
    existingPlanTasks: planTasksFromCalendar(),
    planDate: state.planDate
  });

  try {
    for (const operation of operations.updates) {
      await updatePlanEvent(operation.eventId, operation.segment, operation.description);
    }

    for (const operation of operations.creates) {
      await createPlanEvent(operation.segment, operation.description);
    }

    for (const operation of operations.deletes) {
      await deletePlanEvent(operation.eventId);
    }

    showMessage(`发布完成：创建 ${operations.creates.length} 个 Plan 事件，更新 ${operations.updates.length} 个 Plan 事件，删除 ${operations.deletes.length} 个 Plan 事件。`);
    await loadCalendar();
  } catch (error) {
    showMessage(`发布失败：${error.message}`, true);
  }
}

function minutesFromTimeRange(start, end) {
  const [startHour, startMinute] = String(start).split(':').map(Number);
  const [endHour, endMinute] = String(end).split(':').map(Number);

  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) {
    throw new RangeError('fixedStart and fixedEnd must be valid times');
  }

  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);

  if (minutes <= 0) {
    throw new RangeError('fixedEnd must be later than fixedStart');
  }

  return minutes;
}

function requiredFormValue(data, fieldName) {
  const value = data.get(fieldName);

  if (String(value ?? '').trim() === '') {
    throw new RangeError(`${fieldName} must not be blank`);
  }

  return value;
}

export function taskInputFromFormData(data) {
  const fixed = data.get('fixed') === 'on';
  const fixedStart = data.get('fixedStart');
  const fixedEnd = data.get('fixedEnd');
  let desiredMinutes = data.get('desiredMinutes');
  let minimumMinutes = data.get('minimumMinutes');

  if (fixed && fixedStart && fixedEnd) {
    const fixedMinutes = String(minutesFromTimeRange(fixedStart, fixedEnd));
    desiredMinutes = fixedMinutes;
    minimumMinutes = fixedMinutes;
  } else {
    desiredMinutes = requiredFormValue(data, 'desiredMinutes');
    minimumMinutes = requiredFormValue(data, 'minimumMinutes');
  }

  return {
    taskName: data.get('taskName'),
    taskType: data.get('taskType'),
    desiredMinutes,
    minimumMinutes,
    importance: data.get('importance'),
    deadline: data.get('deadline'),
    executionContext: data.get('executionContext'),
    energyDemand: data.get('energyDemand'),
    physicalDemand: data.get('physicalDemand'),
    orderPreference: data.get('orderPreference'),
    dependencyTaskIds: typeof data.getAll === 'function'
      ? data.getAll('dependencyTaskIds')
      : [],
    splittable: data.get('splittable') === 'on',
    minSegmentMinutes: data.get('minSegmentMinutes'),
    externalCommitment: data.get('externalCommitment'),
    fixed,
    fixedStart,
    fixedEnd
  };
}

function taskInputFromForm(form) {
  return taskInputFromFormData(new FormData(form));
}

function setTaskFormMode(task = null) {
  const submit = element('taskSubmitButton');
  const cancel = element('cancelEditTaskButton');

  if (submit) {
    submit.textContent = task ? '保存任务' : '添加任务';
  }

  if (cancel) {
    cancel.className = task ? '' : 'hidden';
  }
}

function fillTaskForm(task) {
  const form = element('taskForm');

  if (!form) {
    return;
  }

  const input = formInputForTask(task);
  renderDependencyOptions(input.dependencyTaskIds);
  form.elements.taskName.value = input.taskName;
  form.elements.taskType.value = input.taskType;
  form.elements.desiredMinutes.value = input.desiredMinutes;
  form.elements.minimumMinutes.value = input.minimumMinutes;
  form.elements.importance.value = input.importance;
  form.elements.deadline.value = input.deadline;
  form.elements.executionContext.value = input.executionContext;
  form.elements.energyDemand.value = input.energyDemand;
  form.elements.physicalDemand.value = input.physicalDemand;
  form.elements.orderPreference.value = input.orderPreference;
  form.elements.splittable.checked = input.splittable;
  form.elements.minSegmentMinutes.value = input.minSegmentMinutes;
  form.elements.externalCommitment.value = input.externalCommitment;
  form.elements.fixed.checked = input.fixed;
  form.elements.fixedStart.value = input.fixedStart;
  form.elements.fixedEnd.value = input.fixedEnd;
}

function resetTaskForm() {
  const form = element('taskForm');

  if (form) {
    form.reset();
  }

  state.editingTaskKey = null;
  renderTaskTypeOptions();
  renderExecutionContextOptions();
  renderTaskPresetFieldOptions();
  renderDependencyOptions();
  applyTaskTypePreset(form?.elements.taskType.value);
  setTaskFormMode(null);
}

function findEditableTaskByKey(key) {
  return allTasks().find((task) => taskEditKey(task) === key) ?? null;
}

function findLogicalTaskByKey(key) {
  if (!key?.startsWith('task:')) {
    return null;
  }

  const taskId = key.slice('task:'.length);
  return logicalTaskDefinitions().find((task) => task.taskId === taskId) ?? null;
}

function editTask(key) {
  const task = findLogicalTaskByKey(key);

  if (!task) {
    showMessage('找不到要编辑的任务。', true);
    return;
  }

  state.editingTaskKey = key;
  fillTaskForm(task);
  setTaskFormMode(task);
  element('taskForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editedTaskFromForm(form) {
  const existing = findLogicalTaskByKey(state.editingTaskKey);

  if (!existing) {
    throw new RangeError('editing task no longer exists');
  }

  const updated = createTask({
    ...taskInputFromForm(form),
    taskId: existing.taskId,
    status: existing.status
  });

  return {
    ...updated,
    planDate: existing.planDate ?? state.planDate,
    taskLevelOverride: Boolean(existing.calendarEventId || existing.segmentId),
    localOverride: Boolean(existing.calendarEventId || existing.segmentId)
  };
}

function submitTaskForm(event) {
  event.preventDefault();

  try {
    if (state.editingTaskKey) {
      state.tasks = upsertLocalTask(state.tasks, editedTaskFromForm(event.currentTarget));
      resetTaskForm();
      recalculate();
      showMessage('任务已保存。');
      return;
    }

    const task = createTask(taskInputFromForm(event.currentTarget));
    state.tasks = upsertLocalTask(state.tasks, task);
    resetTaskForm();
    recalculate();
    showMessage('任务已添加。');
  } catch (error) {
    showMessage(`保存任务失败：${error.message}`, true);
  }
}

function completeTask(taskId, segmentStart, {
  segmentEnd = null,
  segmentId = null,
  calendarEventId = null
} = {}) {
  const currentTasks = allTasks();
  const existing = selectTaskForCompletion(currentTasks, {
    taskId,
    segmentStart,
    segmentEnd,
    segmentId,
    calendarEventId
  });

  if (!existing) {
    showMessage('找不到要完成的任务。', true);
    return false;
  }

  let localTask = state.tasks.find((task) => (
    calendarEventId
      ? task.calendarEventId === calendarEventId
      : segmentId
        ? task.segmentId === segmentId
        : task.taskId === taskId && !task.calendarEventId && !task.segmentId
  ));

  if (!localTask) {
    localTask = { ...existing };
    state.tasks.push(localTask);
  }

  localTask.calendarEventId = existing.calendarEventId ?? calendarEventId ?? localTask.calendarEventId ?? null;
  localTask.segmentId = existing.segmentId ?? segmentId ?? localTask.segmentId ?? null;
  localTask.status = TASK_STATUSES.COMPLETED;
  localTask.actualStart = segmentStart;
  localTask.actualEnd = localNowString();
  recalculate();
  showMessage('任务已标记完成。下次同步时不会再创建新的未完成计划块。');
  return true;
}

function handleAvailableBlockInput(event) {
  const index = Number(event.target.dataset.blockIndex);
  const field = event.target.dataset.blockField;

  if (!Number.isInteger(index) || !field || !state.availableBlocks[index]) {
    return;
  }

  const block = state.availableBlocks[index];
  const value = event.target.value;

  if (field === 'context' && value === CONTEXTS.CUSTOM && block.context !== CONTEXTS.CUSTOM) {
    if (customBlocks().length >= MAX_CUSTOM_BLOCKS) {
      showMessage(`最多只能创建 ${MAX_CUSTOM_BLOCKS} 个自定义时间块。`, true);
      renderAvailableBlocks();
      return;
    }
    block.customContextId = block.customContextId || generateCustomContextId();
    block.customName = block.customName || nextCustomBlockName();
  }

  block[field] = value;
  saveCurrentBlocksAsDefaults();
  if (field === 'context') {
    renderAvailableBlocks();
  }
  if (field === 'context' || field === 'customName') {
    renderExecutionContextOptions();
  }
  recalculate();
}

function handleAvailableBlockClick(event) {
  const index = Number(event.target.dataset.removeBlockIndex);

  if (!Number.isInteger(index) || !state.availableBlocks[index]) {
    return;
  }

  state.availableBlocks.splice(index, 1);
  saveCurrentBlocksAsDefaults();
  renderAvailableBlocks();
  renderExecutionContextOptions();
  recalculate();
}

function addAvailableBlock() {
  state.availableBlocks.push({
    start: '09:00',
    end: '10:00',
    context: CONTEXTS.ANY,
    enabled: true,
    customName: '',
    customContextId: null
  });
  saveCurrentBlocksAsDefaults();
  renderAvailableBlocks();
  recalculate();
}

function fillDeadlineToday() {
  const form = element('taskForm');
  const input = form?.elements.deadline;

  if (!input) {
    return;
  }

  input.value = deadlineTodayValue(new Date(), input.value);
}

function currentDebugReport() {
  const scheduleStart = scheduleStartForDate(state.planDate);

  return buildDebugReport({
    planDate: state.planDate,
    now: localNowString(),
    scheduleStart,
    availableBlocks: concreteAvailableBlocks(),
    protectedBlocks: protectedBlocksFromCalendar(),
    tasks: allTasks(),
    schedule: state.schedule
  });
}

function copyTextFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();
  return copied;
}

async function copyDebugReport() {
  const report = currentDebugReport();

  try {
    await navigator.clipboard.writeText(report);
    showMessage('调试信息已复制到剪贴板，可直接粘贴给助手分析。');
    return;
  } catch {
    // clipboard API 不可用时走隐藏 textarea 兜底
  }

  if (copyTextFallback(report)) {
    showMessage('调试信息已复制到剪贴板，可直接粘贴给助手分析。');
  } else {
    showMessage('复制失败：请打开浏览器控制台，手动复制 window.__planDebugReport 的内容。', true);
    globalThis.__planDebugReport = report;
  }
}

function removeTask(key) {
  const task = findEditableTaskByKey(key);

  if (!task) {
    showMessage('找不到要删除的任务。', true);
    return;
  }

  state.tasks = removeTaskForReschedule(state.tasks, task);

  if (state.editingTaskKey === key) {
    resetTaskForm();
  }

  recalculate();
  showMessage(task.calendarEventId
    ? '任务已跳过并重排。下次同步时会删除对应的日历事件。'
    : '任务已删除并重排。');
}

function uncompleteTask(key) {
  const task = findEditableTaskByKey(key);

  if (!task) {
    showMessage('找不到要恢复的任务。', true);
    return;
  }

  state.tasks = uncompleteTaskInList(state.tasks, task);
  recalculate();
  showMessage('已恢复为未完成，已重新排入计划。');
}

function handleScheduleClick(event) {
  const timelineItemId = event.target.dataset.timelineItemId
    ?? event.target.closest?.('[data-timeline-item-id]')?.dataset.timelineItemId;

  if (timelineItemId) {
    state.selectedTimelineItemId = timelineItemId;
    renderSchedule();
    return;
  }

  const editKey = event.target.dataset.editTaskKey;

  if (editKey) {
    editTask(editKey);
    return;
  }

  const removeKey = event.target.dataset.removeTaskKey;

  if (removeKey) {
    removeTask(removeKey);
    return;
  }

  const uncompleteKey = event.target.dataset.uncompleteTaskKey;

  if (uncompleteKey) {
    uncompleteTask(uncompleteKey);
    return;
  }

  const taskId = event.target.dataset.completeTaskId;

  if (!taskId) {
    return;
  }

  completeTask(taskId, event.target.dataset.segmentStart, {
    segmentEnd: event.target.dataset.segmentEnd || null,
    segmentId: event.target.dataset.segmentId || null,
    calendarEventId: event.target.dataset.calendarEventId || null
  });
}

function wireEvents() {
  element('saveClientIdButton')?.addEventListener('click', saveClientId);
  element('connectButton')?.addEventListener('click', connectGoogleCalendar);
  element('loadCalendarButton')?.addEventListener('click', loadCalendar);
  element('addDefaultBlocksButton')?.addEventListener('click', fillDefaultBlocks);
  element('rescheduleButton')?.addEventListener('click', recalculate);
  element('copyDebugButton')?.addEventListener('click', copyDebugReport);
  element('syncButton')?.addEventListener('click', syncSchedule);
  element('addBlockButton')?.addEventListener('click', addAvailableBlock);
  element('availableBlocks')?.addEventListener('input', handleAvailableBlockInput);
  element('availableBlocks')?.addEventListener('change', handleAvailableBlockInput);
  element('availableBlocks')?.addEventListener('click', handleAvailableBlockClick);
  element('taskForm')?.addEventListener('submit', submitTaskForm);
  element('deadlineTodayButton')?.addEventListener('click', fillDeadlineToday);
  firstElement('select[name="taskType"]')?.addEventListener('change', (event) => {
    applyTaskTypePreset(event.target.value);
  });
  element('cancelEditTaskButton')?.addEventListener('click', resetTaskForm);
  element('scheduleList')?.addEventListener('click', handleScheduleClick);
  element('planDateInput')?.addEventListener('change', (event) => {
    state = resetCalendarStateForDateChange(
      state,
      event.target.value || localDateString()
    );
    resetTaskForm();
    recalculate();
  });
}

function populateInitialValues() {
  const clientIdInput = element('clientIdInput');
  const planDateInput = element('planDateInput');

  if (clientIdInput) {
    clientIdInput.value = state.settings.clientId;
  }

  if (planDateInput) {
    planDateInput.value = state.planDate;
  }
}

export function initApp() {
  state = createState();
  populateInitialValues();
  renderTaskTypeOptions();
  renderExecutionContextOptions();
  renderTaskPresetFieldOptions();
  renderDependencyOptions();
  applyTaskTypePreset(firstElement('select[name="taskType"]')?.value);
  setTaskFormMode(null);
  renderAvailableBlocks();
  wireEvents();
  renderSchedule();
}
