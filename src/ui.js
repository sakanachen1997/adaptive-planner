import {
  APP_ID,
  CONTEXTS,
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
import { combineDateAndTime, normalizeDateTime } from './time.js';
import { loadSettings, saveSettings } from './storage.js';
import {
  createPlanEvent,
  deletePlanEvent,
  initGoogleAuth,
  listPrimaryEvents,
  requestAccessToken,
  updatePlanEvent
} from './calendarClient.js';

const CONTEXT_OPTIONS = Object.freeze([
  { value: CONTEXTS.ANY, label: '任意时间' },
  { value: CONTEXTS.WORK, label: '仅工作时间' },
  { value: CONTEXTS.HOME, label: '仅下班后' },
  { value: CONTEXTS.CUSTOM, label: '自定义时间窗' }
]);

const BLOCK_CONTEXT_OPTIONS = Object.freeze([
  { value: CONTEXTS.ANY, label: '任意时间' },
  { value: CONTEXTS.WORK, label: '工作时间' },
  { value: CONTEXTS.HOME, label: '下班后' },
  { value: CONTEXTS.CUSTOM, label: '自定义' }
]);

const DEFAULT_MESSAGE = '先生成可用时间块并添加任务，然后重新计算。';

function localDateString(date = new Date()) {
  return normalizeDateTime(date).slice(0, 10);
}

function localNowString() {
  return normalizeDateTime(new Date());
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
    enabled: block.enabled !== false
  };
}

function blockToSetting(block) {
  return {
    start: block.start,
    end: block.end,
    context: block.context,
    enabled: block.enabled !== false
  };
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
    task.fixed = true;
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
  return {
    ...(task ?? {}),
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
  const seenByTask = new Map();
  const indexes = new Map();

  for (const segment of segments) {
    const index = seenByTask.get(segment.taskId) ?? 0;
    seenByTask.set(segment.taskId, index + 1);
    indexes.set(segment, index);
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
  allowTaskIdFallback = true
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

  return null;
}

export function mergePlanTasks({ calendarTasks = [], localTasks = [] }) {
  const merged = [];
  const calendarTaskIds = new Set();

  for (const task of calendarTasks) {
    merged.push(task);
    calendarTaskIds.add(task.taskId);
  }

  for (const task of localTasks) {
    const calendarIndex = merged.findIndex((candidate) => (
      candidate.calendarEventId && candidate.calendarEventId === task.calendarEventId
    ));
    const calendarTask = calendarIndex === -1 ? null : merged[calendarIndex];

    if (!task.calendarEventId && !calendarTaskIds.has(task.taskId)) {
      merged.push(task);
      continue;
    }

    if (
      task.status === TASK_STATUSES.COMPLETED
        && calendarTask?.calendarEventId === task.calendarEventId
    ) {
      merged[calendarIndex] = task;
    }
  }

  return merged;
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
    const task = findTaskForSegment(segment, candidatesByTaskId) ?? {
      taskId: segment.taskId,
      taskName: segment.taskName
    };
    const segmentIndex = scheduledSegmentIndexes.get(segment) ?? 0;
    const segmentId = segment.segmentId
      ?? task.segmentId
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
    lastSyncOperations: emptySyncOperations()
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

function concreteAvailableBlocks() {
  return state.availableBlocks
    .filter((block) => block.enabled !== false)
    .map((block) => ({
      start: combineDateAndTime(state.planDate, block.start),
      end: combineDateAndTime(state.planDate, block.end),
      context: block.context
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

  select.replaceChildren(
    ...CONTEXT_OPTIONS.map(({ value, label }) => option(value, label))
  );
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

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除';
    remove.dataset.removeBlockIndex = String(index);

    row.append(start, end, context, remove);
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
  appendText(
    panel,
    `可用时间 ${state.schedule.conflict.availableMinutes} 分钟，任务最小需要 ${state.schedule.conflict.requiredMinimumMinutes} 分钟。`,
    'p'
  );

  const list = document.createElement('ol');
  for (const action of state.schedule.conflict.actions) {
    appendText(list, action, 'li');
  }
  panel.append(list);
}

function renderSchedule() {
  const root = element('scheduleList');
  const currentTasks = allTasks();
  const candidatesByTaskId = taskCandidatesByTaskId(currentTasks);

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

  if ((state.schedule.segments ?? []).length === 0) {
    appendText(root, '当前没有可显示的计划块。', 'p');
  }

  for (const segment of state.schedule.segments ?? []) {
    const item = document.createElement('div');
    item.className = `schedule-item ${segment.status === TASK_STATUSES.COMPLETED ? 'completed' : ''}`;
    const matchedTask = findTaskForSegment(segment, candidatesByTaskId);

    appendText(item, segment.taskName, 'strong');
    appendText(
      item,
      `${segment.start.slice(11, 16)} - ${segment.end.slice(11, 16)}`
        + (segment.allocatedMinutes ? `，${segment.allocatedMinutes} 分钟` : ''),
      'div'
    ).className = 'muted';

    if (segment.status !== TASK_STATUSES.COMPLETED) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '完成';
      button.dataset.completeTaskId = segment.taskId;
      button.dataset.segmentStart = segment.start;
      button.dataset.segmentEnd = segment.end;
      if (matchedTask?.segmentId) {
        button.dataset.segmentId = matchedTask.segmentId;
      }
      if (matchedTask?.calendarEventId) {
        button.dataset.calendarEventId = matchedTask.calendarEventId;
      }
      item.append(button);
    }

    root.append(item);
  }

  if (state.schedule.status === 'partial' && state.schedule.unscheduled?.length) {
    const partial = document.createElement('div');
    partial.className = 'schedule-item error';
    appendText(partial, '部分任务未完全安排：', 'strong');
    const list = document.createElement('ul');
    for (const item of state.schedule.unscheduled) {
      appendText(list, `${item.taskName} 剩余 ${item.remainingMinutes} 分钟`, 'li');
    }
    partial.append(list);
    root.append(partial);
  }

  renderSyncPreview();
}

function renderSyncPreview() {
  const target = element('syncPreview');

  if (!target) {
    return;
  }

  if (!state.schedule) {
    target.textContent = '还没有同步内容。';
    target.className = 'muted';
    return;
  }

  if (state.schedule.status === 'conflict') {
    target.textContent = '解决冲突后才能同步。';
    target.className = 'schedule-item error';
    return;
  }

  state.lastSyncOperations = buildSyncOperations({
    schedule: state.schedule,
    tasks: allTasks(),
    existingPlanTasks: planTasksFromCalendar(),
    planDate: state.planDate
  });

  target.textContent = `同步预览：将创建 ${state.lastSyncOperations.creates.length} 个，更新 ${state.lastSyncOperations.updates.length} 个，删除 ${state.lastSyncOperations.deletes.length} 个。`;
  target.className = 'muted';
}

function recalculate() {
  state.schedule = scheduleDay({
    planDate: state.planDate,
    now: localNowString(),
    availableBlocks: concreteAvailableBlocks(),
    protectedBlocks: protectedBlocksFromCalendar(),
    tasks: allTasks()
  });
  renderSchedule();
}

function fillDefaultBlocks() {
  state.availableBlocks = state.settings.defaultBlocks
    .filter((block) => block.enabled)
    .map(blockFromSetting);
  renderAvailableBlocks();
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
    showMessage(`已读取 ${state.calendarEvents.length} 个日历事件。`);
    recalculate();
  } catch (error) {
    showMessage(`读取日历失败：${error.message}`, true);
  }
}

async function syncSchedule() {
  if (!state.schedule || state.schedule.status === 'conflict') {
    showMessage('没有可同步的计划，或当前计划仍有冲突。', true);
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

    showMessage(`同步完成：创建 ${operations.creates.length} 个，更新 ${operations.updates.length} 个，删除 ${operations.deletes.length} 个。`);
    await loadCalendar();
  } catch (error) {
    showMessage(`同步失败：${error.message}`, true);
  }
}

function taskInputFromForm(form) {
  const data = new FormData(form);

  return {
    taskName: data.get('taskName'),
    taskType: data.get('taskType'),
    desiredMinutes: data.get('desiredMinutes'),
    minimumMinutes: data.get('minimumMinutes'),
    importance: data.get('importance'),
    deadline: data.get('deadline'),
    executionContext: data.get('executionContext'),
    fixed: data.get('fixed') === 'on',
    fixedStart: data.get('fixedStart'),
    fixedEnd: data.get('fixedEnd')
  };
}

function addTaskFromForm(event) {
  event.preventDefault();

  try {
    const task = createTask(taskInputFromForm(event.currentTarget));
    state.tasks.push(task);
    event.currentTarget.reset();
    renderTaskTypeOptions();
    renderExecutionContextOptions();
    recalculate();
    showMessage('任务已添加。');
  } catch (error) {
    showMessage(`添加任务失败：${error.message}`, true);
  }
}

function completeTask(taskId, segmentStart, {
  segmentEnd = null,
  segmentId = null,
  calendarEventId = null
} = {}) {
  const currentTasks = allTasks();
  const existing = findTaskForSegment(
    {
      taskId,
      start: segmentStart,
      end: segmentEnd ?? segmentStart,
      status: TASK_STATUSES.SCHEDULED,
      segmentId,
      calendarEventId
    },
    taskCandidatesByTaskId(currentTasks),
    { segmentId, calendarEventId }
  ) ?? currentTasks.find((task) => task.taskId === taskId);

  if (!existing) {
    showMessage('找不到要完成的任务。', true);
    return;
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
}

function handleAvailableBlockInput(event) {
  const index = Number(event.target.dataset.blockIndex);
  const field = event.target.dataset.blockField;

  if (!Number.isInteger(index) || !field || !state.availableBlocks[index]) {
    return;
  }

  state.availableBlocks[index][field] = event.target.value;
  saveCurrentBlocksAsDefaults();
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
  recalculate();
}

function addAvailableBlock() {
  state.availableBlocks.push({
    start: '09:00',
    end: '10:00',
    context: CONTEXTS.ANY,
    enabled: true
  });
  saveCurrentBlocksAsDefaults();
  renderAvailableBlocks();
  recalculate();
}

function handleScheduleClick(event) {
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
  element('syncButton')?.addEventListener('click', syncSchedule);
  element('addBlockButton')?.addEventListener('click', addAvailableBlock);
  element('availableBlocks')?.addEventListener('input', handleAvailableBlockInput);
  element('availableBlocks')?.addEventListener('change', handleAvailableBlockInput);
  element('availableBlocks')?.addEventListener('click', handleAvailableBlockClick);
  element('taskForm')?.addEventListener('submit', addTaskFromForm);
  element('scheduleList')?.addEventListener('click', handleScheduleClick);
  element('planDateInput')?.addEventListener('change', (event) => {
    state = resetCalendarStateForDateChange(
      state,
      event.target.value || localDateString()
    );
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
  renderAvailableBlocks();
  wireEvents();
  renderSchedule();
}
