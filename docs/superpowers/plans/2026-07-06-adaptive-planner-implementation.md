# Adaptive Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Pages-compatible Chinese daily planner that stores Plan task metadata in Google Calendar events and reschedules unfinished tasks around protected ordinary calendar events.

**Architecture:** Use a static vanilla JavaScript app with ES modules. Keep Google Calendar access isolated from pure scheduling logic so priority, metadata parsing, and time allocation can be tested with Node's built-in test runner.

**Tech Stack:** HTML, CSS, JavaScript ES modules, Google Identity Services, Google Calendar API v3, Node.js `node:test`, GitHub Pages static hosting.

---

## File Structure

- Create `package.json`: declares ESM mode and test scripts.
- Create `README.md`: local usage, Google OAuth setup, GitHub Pages deployment.
- Create `index.html`: Chinese app shell and Google script includes.
- Create `src/styles.css`: functional layout and conflict/status colors.
- Create `src/models.js`: constants, defaults, and small constructors.
- Create `src/time.js`: date/time parsing, interval math, event subtraction.
- Create `src/metadata.js`: `PLAN_META` extraction, validation, serialization.
- Create `src/priority.js`: task priority and placement scoring.
- Create `src/scheduler.js`: pure schedule generation and conflict detection.
- Create `src/storage.js`: local settings persistence.
- Create `src/calendarClient.js`: Google Identity Services and Calendar API calls.
- Create `src/ui.js`: DOM rendering, forms, sync preview, completion controls.
- Create `src/main.js`: app bootstrap and wiring.
- Create `tests/metadata.test.js`: metadata parser and protection tests.
- Create `tests/time.test.js`: interval subtraction tests.
- Create `tests/priority.test.js`: scoring tests.
- Create `tests/scheduler.test.js`: allocation, conflict, context, completion, and in-progress tests.

## Task 1: Static App Scaffold

**Files:**
- Create: `package.json`
- Create: `README.md`
- Create: `index.html`
- Create: `src/styles.css`
- Create: `src/main.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "adaptive-planner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.js",
    "serve": "python -m http.server 5173"
  }
}
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Adaptive Planner</title>
    <link rel="stylesheet" href="./src/styles.css" />
    <script src="https://accounts.google.com/gsi/client" async defer></script>
  </head>
  <body>
    <header class="topbar">
      <div>
        <h1>Adaptive Planner</h1>
        <p>按权重、精力、日历固定行程自动重排当天计划</p>
      </div>
      <div class="auth-panel">
        <input id="clientIdInput" type="text" aria-label="Google OAuth Client ID" />
        <button id="saveClientIdButton">保存 Client ID</button>
        <button id="connectButton">连接 Google Calendar</button>
      </div>
    </header>

    <main class="layout">
      <section class="panel">
        <h2>日期与可用时间</h2>
        <label>计划日期 <input id="planDateInput" type="date" /></label>
        <div class="row">
          <button id="loadCalendarButton">读取日历</button>
          <button id="addDefaultBlocksButton">生成默认时间块</button>
          <button id="rescheduleButton">重新计算</button>
        </div>
        <div id="availableBlocks"></div>
        <button id="addBlockButton">添加可用时间块</button>
      </section>

      <section class="panel">
        <h2>添加任务</h2>
        <form id="taskForm" class="form-grid">
          <input name="taskName" required aria-label="任务名" />
          <select name="taskType"></select>
          <input name="desiredMinutes" required type="number" min="1" aria-label="想要时长 min" />
          <input name="minimumMinutes" required type="number" min="1" aria-label="最小时长 min" />
          <input name="importance" required type="number" min="1" max="5" value="3" />
          <input name="deadline" type="datetime-local" />
          <select name="executionContext"></select>
          <label class="checkbox"><input name="fixed" type="checkbox" /> 固定时间</label>
          <input name="fixedStart" type="time" />
          <input name="fixedEnd" type="time" />
          <button type="submit">添加任务</button>
        </form>
      </section>

      <section class="panel wide">
        <h2>当天计划</h2>
        <div id="conflictPanel" class="hidden"></div>
        <div id="scheduleList"></div>
        <h3>同步预览</h3>
        <div id="syncPreview"></div>
        <button id="syncButton">写入 Google Calendar</button>
      </section>
    </main>

    <script type="module" src="./src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/styles.css`**

```css
:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --border: #d7dce2;
  --panel: #ffffff;
  --bg: #f5f7fa;
  --text: #1b1f24;
  --muted: #5d6875;
  --danger: #b42318;
  --danger-bg: #fff1f0;
  --ok: #16703a;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  background: #ffffff;
  border-bottom: 1px solid var(--border);
}

h1, h2, h3, p {
  margin-top: 0;
}

.auth-panel,
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.layout {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(280px, 420px) 1fr;
  gap: 16px;
  padding: 16px;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
}

.wide {
  min-width: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

input,
select,
button,
textarea {
  font: inherit;
  padding: 8px;
}

button {
  cursor: pointer;
}

.checkbox {
  display: flex;
  gap: 8px;
  align-items: center;
}

.hidden {
  display: none;
}

.conflict {
  border: 1px solid var(--danger);
  background: var(--danger-bg);
  color: var(--danger);
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 12px;
}

.schedule-item {
  border-bottom: 1px solid var(--border);
  padding: 10px 0;
}

.schedule-item.completed {
  color: var(--ok);
}

.schedule-item.error {
  color: var(--danger);
}

.muted {
  color: var(--muted);
}

@media (max-width: 1000px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .topbar {
    flex-direction: column;
  }
}
```

- [ ] **Step 4: Create `src/main.js`**

```js
import { initApp } from './ui.js';

initApp();
```

- [ ] **Step 5: Run a static smoke test**

Run: `python -m http.server 5173`

Expected: browser can open `http://localhost:5173` and show the Chinese app shell. Stop the server with `Ctrl+C`.

- [ ] **Step 6: Commit scaffold**

```bash
git add package.json README.md index.html src/styles.css src/main.js
git commit -m "feat: add static planner scaffold"
```

## Task 2: Models and Defaults

**Files:**
- Create: `src/models.js`
- Test: `tests/models.test.js`

- [ ] **Step 1: Create `tests/models.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXTS, TASK_TYPE_DEFAULTS, createTask } from '../src/models.js';

test('task type defaults include core user task types', () => {
  assert.equal(TASK_TYPE_DEFAULTS['编码工作'].energyDemand, 'high');
  assert.equal(TASK_TYPE_DEFAULTS['背单词'].splittable, true);
  assert.equal(TASK_TYPE_DEFAULTS['运动健身'].executionContext, CONTEXTS.HOME);
  assert.equal(TASK_TYPE_DEFAULTS['绘画委托副业'].externalCommitment, 4);
});

test('createTask applies defaults and explicit overrides', () => {
  const task = createTask({
    taskName: '晚间背单词',
    taskType: '背单词',
    desiredMinutes: 60,
    minimumMinutes: 10,
    importance: 3,
    executionContext: CONTEXTS.ANY
  });

  assert.equal(task.energyDemand, 'mediumLow');
  assert.equal(task.minSegmentMinutes, 10);
  assert.equal(task.executionContext, CONTEXTS.ANY);
  assert.equal(task.status, 'pending');
});
```

- [ ] **Step 2: Run the failing model test**

Run: `node --test tests/models.test.js`

Expected: FAIL with module not found for `src/models.js`.

- [ ] **Step 3: Create `src/models.js`**

```js
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

export const TASK_TYPE_DEFAULTS = Object.freeze({
  '编码工作': {
    energyDemand: 'high',
    physicalDemand: 'low',
    splittable: false,
    minSegmentMinutes: 45,
    executionContext: CONTEXTS.WORK,
    externalCommitment: 4
  },
  '复杂教程和学习': {
    energyDemand: 'high',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 25,
    executionContext: CONTEXTS.ANY,
    externalCommitment: 2
  },
  '背单词': {
    energyDemand: 'mediumLow',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 10,
    executionContext: CONTEXTS.ANY,
    externalCommitment: 1
  },
  '打游戏': {
    energyDemand: 'low',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 30,
    executionContext: CONTEXTS.HOME,
    externalCommitment: 0
  },
  '运动健身': {
    energyDemand: 'medium',
    physicalDemand: 'high',
    splittable: false,
    minSegmentMinutes: 30,
    executionContext: CONTEXTS.HOME,
    externalCommitment: 2
  },
  '绘画委托副业': {
    energyDemand: 'mediumHigh',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 30,
    executionContext: CONTEXTS.HOME,
    externalCommitment: 4
  },
  '生活杂务': {
    energyDemand: 'low',
    physicalDemand: 'variable',
    splittable: true,
    minSegmentMinutes: 15,
    executionContext: CONTEXTS.ANY,
    externalCommitment: 1
  },
  '自定义': {
    energyDemand: 'medium',
    physicalDemand: 'low',
    splittable: true,
    minSegmentMinutes: 20,
    executionContext: CONTEXTS.ANY,
    externalCommitment: 1
  }
});

export function createTask(input) {
  const defaults = TASK_TYPE_DEFAULTS[input.taskType] ?? TASK_TYPE_DEFAULTS['自定义'];
  const nowId = globalThis.crypto?.randomUUID?.() ?? `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return {
    taskId: input.taskId ?? nowId,
    taskName: input.taskName.trim(),
    taskType: input.taskType || '自定义',
    desiredMinutes: Number(input.desiredMinutes),
    minimumMinutes: Number(input.minimumMinutes),
    importance: Number(input.importance),
    deadline: input.deadline || null,
    executionContext: input.executionContext ?? defaults.executionContext,
    fixed: Boolean(input.fixed),
    fixedStart: input.fixedStart || null,
    fixedEnd: input.fixedEnd || null,
    energyDemand: input.energyDemand ?? defaults.energyDemand,
    physicalDemand: input.physicalDemand ?? defaults.physicalDemand,
    splittable: input.splittable ?? defaults.splittable,
    minSegmentMinutes: Number(input.minSegmentMinutes ?? defaults.minSegmentMinutes),
    externalCommitment: Number(input.externalCommitment ?? defaults.externalCommitment),
    status: input.status ?? TASK_STATUSES.PENDING,
    actualStart: input.actualStart ?? null,
    actualEnd: input.actualEnd ?? null,
    weekPlanId: input.weekPlanId ?? null
  };
}
```

- [ ] **Step 4: Run model tests**

Run: `node --test tests/models.test.js`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit models**

```bash
git add src/models.js tests/models.test.js
git commit -m "feat: add planner task models"
```

## Task 3: Plan Metadata Parser

**Files:**
- Create: `src/metadata.js`
- Test: `tests/metadata.test.js`

- [ ] **Step 1: Create `tests/metadata.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_ID } from '../src/models.js';
import { buildDescription, extractPlanMetadata, isPlanManagedEvent } from '../src/metadata.js';

test('buildDescription and extractPlanMetadata round trip valid metadata', () => {
  const meta = {
    schemaVersion: 1,
    app: APP_ID,
    planDate: '2026-07-06',
    taskId: 'task_1',
    segmentId: 'segment_1',
    status: 'scheduled',
    taskName: '学英语',
    taskType: '复杂教程和学习',
    desiredMinutes: 200,
    minimumMinutes: 60,
    importance: 4
  };

  const description = buildDescription('由 Adaptive Planner 创建。', meta);
  assert.deepEqual(extractPlanMetadata(description), meta);
});

test('ordinary calendar events are not plan managed', () => {
  const event = { id: 'ordinary', summary: '普通会议', description: '没有元数据' };
  assert.equal(isPlanManagedEvent(event), false);
  assert.equal(extractPlanMetadata(event.description), null);
});

test('foreign metadata is rejected', () => {
  const description = buildDescription('foreign', {
    schemaVersion: 1,
    app: 'other-app',
    taskId: 'task_2'
  });

  assert.equal(extractPlanMetadata(description), null);
});
```

- [ ] **Step 2: Run the failing metadata test**

Run: `node --test tests/metadata.test.js`

Expected: FAIL with module not found for `src/metadata.js`.

- [ ] **Step 3: Create `src/metadata.js`**

```js
import { APP_ID } from './models.js';

const START = '<!-- PLAN_META';
const END = 'PLAN_META -->';

export function buildDescription(humanText, metadata) {
  const json = JSON.stringify(metadata, null, 2);
  return `${humanText.trim()}\n\n${START}\n${json}\n${END}`;
}

export function extractPlanMetadata(description = '') {
  const startIndex = description.indexOf(START);
  const endIndex = description.indexOf(END);

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  const jsonStart = startIndex + START.length;
  const rawJson = description.slice(jsonStart, endIndex).trim();

  try {
    const parsed = JSON.parse(rawJson);
    if (parsed.schemaVersion !== 1 || parsed.app !== APP_ID || typeof parsed.taskId !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isPlanManagedEvent(event) {
  return Boolean(extractPlanMetadata(event?.description ?? ''));
}

export function stripPlanMetadata(description = '') {
  const startIndex = description.indexOf(START);
  const endIndex = description.indexOf(END);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return description;
  }
  return `${description.slice(0, startIndex)}${description.slice(endIndex + END.length)}`.trim();
}
```

- [ ] **Step 4: Run metadata tests**

Run: `node --test tests/metadata.test.js`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit metadata**

```bash
git add src/metadata.js tests/metadata.test.js
git commit -m "feat: add plan metadata parsing"
```

## Task 4: Time Interval Utilities

**Files:**
- Create: `src/time.js`
- Test: `tests/time.test.js`

- [ ] **Step 1: Create `tests/time.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { combineDateAndTime, minutesBetween, subtractIntervals, totalMinutes } from '../src/time.js';

test('combineDateAndTime creates local ISO-like timestamp', () => {
  assert.equal(combineDateAndTime('2026-07-06', '09:30'), '2026-07-06T09:30:00');
});

test('minutesBetween returns integer minutes', () => {
  assert.equal(minutesBetween('2026-07-06T09:00:00', '2026-07-06T10:45:00'), 105);
});

test('subtractIntervals removes protected event from available block', () => {
  const available = [{ start: '2026-07-06T09:00:00', end: '2026-07-06T12:00:00', context: 'work' }];
  const blocked = [{ start: '2026-07-06T10:00:00', end: '2026-07-06T10:30:00' }];
  const result = subtractIntervals(available, blocked);

  assert.deepEqual(result, [
    { start: '2026-07-06T09:00:00', end: '2026-07-06T10:00:00', context: 'work' },
    { start: '2026-07-06T10:30:00', end: '2026-07-06T12:00:00', context: 'work' }
  ]);
  assert.equal(totalMinutes(result), 150);
});
```

- [ ] **Step 2: Run the failing time test**

Run: `node --test tests/time.test.js`

Expected: FAIL with module not found for `src/time.js`.

- [ ] **Step 3: Create `src/time.js`**

```js
export function combineDateAndTime(date, time) {
  return `${date}T${time}:00`;
}

export function toMillis(value) {
  return new Date(value).getTime();
}

export function minutesBetween(start, end) {
  return Math.max(0, Math.round((toMillis(end) - toMillis(start)) / 60000));
}

export function addMinutes(start, minutes) {
  return new Date(toMillis(start) + minutes * 60000).toISOString().slice(0, 19);
}

export function totalMinutes(intervals) {
  return intervals.reduce((sum, interval) => sum + minutesBetween(interval.start, interval.end), 0);
}

export function sortIntervals(intervals) {
  return [...intervals].sort((a, b) => toMillis(a.start) - toMillis(b.start));
}

export function subtractIntervals(available, blocked) {
  let result = sortIntervals(available);

  for (const block of sortIntervals(blocked)) {
    const next = [];
    for (const interval of result) {
      const intervalStart = toMillis(interval.start);
      const intervalEnd = toMillis(interval.end);
      const blockStart = toMillis(block.start);
      const blockEnd = toMillis(block.end);

      if (blockEnd <= intervalStart || blockStart >= intervalEnd) {
        next.push(interval);
        continue;
      }

      if (blockStart > intervalStart) {
        next.push({ ...interval, end: block.start });
      }

      if (blockEnd < intervalEnd) {
        next.push({ ...interval, start: block.end });
      }
    }
    result = next;
  }

  return result.filter((interval) => minutesBetween(interval.start, interval.end) > 0);
}
```

- [ ] **Step 4: Run time tests**

Run: `node --test tests/time.test.js`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit time utilities**

```bash
git add src/time.js tests/time.test.js
git commit -m "feat: add time interval utilities"
```

## Task 5: Priority Scoring

**Files:**
- Create: `src/priority.js`
- Test: `tests/priority.test.js`

- [ ] **Step 1: Create `tests/priority.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../src/models.js';
import { calculatePriority, scorePlacement } from '../src/priority.js';

test('deadline and importance increase priority', () => {
  const now = '2026-07-06T09:00:00';
  const urgent = createTask({
    taskName: '委托交付',
    taskType: '绘画委托副业',
    desiredMinutes: 120,
    minimumMinutes: 60,
    importance: 5,
    deadline: '2026-07-06T18:00:00'
  });
  const relaxed = createTask({
    taskName: '游戏',
    taskType: '打游戏',
    desiredMinutes: 120,
    minimumMinutes: 30,
    importance: 2,
    deadline: null
  });

  assert.ok(calculatePriority(urgent, now) > calculatePriority(relaxed, now));
});

test('placement score prefers high energy slot for high cognitive task', () => {
  const task = createTask({
    taskName: '编码',
    taskType: '编码工作',
    desiredMinutes: 120,
    minimumMinutes: 60,
    importance: 4
  });

  const morning = scorePlacement(task, { start: '2026-07-06T09:00:00', end: '2026-07-06T10:00:00', context: 'work' });
  const evening = scorePlacement(task, { start: '2026-07-06T21:00:00', end: '2026-07-06T22:00:00', context: 'home' });
  assert.ok(morning > evening);
});
```

- [ ] **Step 2: Run the failing priority test**

Run: `node --test tests/priority.test.js`

Expected: FAIL with module not found for `src/priority.js`.

- [ ] **Step 3: Create `src/priority.js`**

```js
const ENERGY_SCORE = Object.freeze({
  high: { high: 5, mediumHigh: 4, medium: 3, mediumLow: 2, low: 1 },
  medium: { high: 3, mediumHigh: 4, medium: 5, mediumLow: 4, low: 3 },
  low: { high: 1, mediumHigh: 2, medium: 3, mediumLow: 5, low: 5 }
});

export function calculateUrgency(deadline, now) {
  if (!deadline) return 0;
  const hours = (new Date(deadline).getTime() - new Date(now).getTime()) / 3600000;
  if (hours <= 0) return 6;
  if (hours <= 6) return 5;
  if (hours <= 24) return 4;
  if (hours <= 72) return 2;
  return 1;
}

export function calculatePriority(task, now) {
  const importanceScore = task.importance * 10;
  const urgencyScore = calculateUrgency(task.deadline, now) * 6;
  const durationWeight = Math.sqrt(Math.max(1, task.desiredMinutes));
  const commitmentScore = task.externalCommitment * 4;
  return importanceScore + urgencyScore + durationWeight + commitmentScore;
}

export function energyLevelForHour(hour) {
  if (hour >= 8 && hour < 12) return 'high';
  if (hour >= 12 && hour < 14) return 'medium';
  if (hour >= 14 && hour < 17) return 'low';
  if (hour >= 17 && hour < 21) return 'medium';
  return 'low';
}

export function scorePlacement(task, interval) {
  const hour = new Date(interval.start).getHours();
  const slotEnergy = energyLevelForHour(hour);
  const energyFit = ENERGY_SCORE[slotEnergy][task.energyDemand] ?? 3;
  const contextFit = task.executionContext === 'any' || task.executionContext === interval.context ? 5 : -20;
  const gapFit = task.splittable ? 2 : 0;
  return energyFit * 4 + contextFit + gapFit;
}
```

- [ ] **Step 4: Run priority tests**

Run: `node --test tests/priority.test.js`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit priority scoring**

```bash
git add src/priority.js tests/priority.test.js
git commit -m "feat: add task priority scoring"
```

## Task 6: Core Scheduler

**Files:**
- Create: `src/scheduler.js`
- Test: `tests/scheduler.test.js`

- [ ] **Step 1: Create `tests/scheduler.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, CONTEXTS, TASK_STATUSES } from '../src/models.js';
import { scheduleDay } from '../src/scheduler.js';

test('detects hard minimum duration conflict', () => {
  const result = scheduleDay({
    planDate: '2026-07-06',
    now: '2026-07-06T09:00:00',
    availableBlocks: [{ start: '2026-07-06T09:00:00', end: '2026-07-06T10:00:00', context: CONTEXTS.WORK }],
    protectedBlocks: [],
    tasks: [
      createTask({ taskName: '编码', taskType: '编码工作', desiredMinutes: 120, minimumMinutes: 45, importance: 5 }),
      createTask({ taskName: '学习', taskType: '复杂教程和学习', desiredMinutes: 120, minimumMinutes: 30, importance: 4 })
    ]
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.requiredMinimumMinutes, 75);
  assert.equal(result.conflict.availableMinutes, 60);
});

test('protects ordinary calendar blocks by scheduling around them', () => {
  const result = scheduleDay({
    planDate: '2026-07-06',
    now: '2026-07-06T09:00:00',
    availableBlocks: [{ start: '2026-07-06T09:00:00', end: '2026-07-06T12:00:00', context: CONTEXTS.WORK }],
    protectedBlocks: [{ start: '2026-07-06T10:00:00', end: '2026-07-06T10:30:00' }],
    tasks: [createTask({ taskName: '编码', taskType: '编码工作', desiredMinutes: 120, minimumMinutes: 60, importance: 5 })]
  });

  assert.equal(result.status, 'ok');
  assert.ok(result.segments.every((segment) => segment.end <= '2026-07-06T10:00:00' || segment.start >= '2026-07-06T10:30:00'));
});

test('home-only tasks are not placed in work blocks', () => {
  const result = scheduleDay({
    planDate: '2026-07-06',
    now: '2026-07-06T09:00:00',
    availableBlocks: [
      { start: '2026-07-06T09:00:00', end: '2026-07-06T11:00:00', context: CONTEXTS.WORK },
      { start: '2026-07-06T20:00:00', end: '2026-07-06T22:00:00', context: CONTEXTS.HOME }
    ],
    protectedBlocks: [],
    tasks: [createTask({ taskName: '运动', taskType: '运动健身', desiredMinutes: 60, minimumMinutes: 30, importance: 4 })]
  });

  assert.equal(result.status, 'ok');
  assert.ok(result.segments.every((segment) => segment.start >= '2026-07-06T20:00:00'));
});

test('completed tasks are preserved and not rescheduled', () => {
  const completed = createTask({
    taskId: 'done',
    taskName: '背单词',
    taskType: '背单词',
    desiredMinutes: 30,
    minimumMinutes: 10,
    importance: 3,
    status: TASK_STATUSES.COMPLETED,
    actualStart: '2026-07-06T08:00:00',
    actualEnd: '2026-07-06T08:30:00'
  });

  const result = scheduleDay({
    planDate: '2026-07-06',
    now: '2026-07-06T09:00:00',
    availableBlocks: [{ start: '2026-07-06T09:00:00', end: '2026-07-06T10:00:00', context: CONTEXTS.ANY }],
    protectedBlocks: [],
    tasks: [completed]
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.segments[0].status, TASK_STATUSES.COMPLETED);
  assert.equal(result.segments[0].start, '2026-07-06T08:00:00');
});
```

- [ ] **Step 2: Run the failing scheduler test**

Run: `node --test tests/scheduler.test.js`

Expected: FAIL with module not found for `src/scheduler.js`.

- [ ] **Step 3: Create `src/scheduler.js`**

```js
import { TASK_STATUSES } from './models.js';
import { calculatePriority, scorePlacement } from './priority.js';
import { addMinutes, minutesBetween, subtractIntervals, totalMinutes } from './time.js';

function contextCompatible(task, block) {
  return task.executionContext === 'any' || task.executionContext === block.context;
}

function futurePartOfBlocks(blocks, now) {
  return blocks
    .map((block) => {
      if (block.end <= now) return null;
      if (block.start < now) return { ...block, start: now };
      return block;
    })
    .filter(Boolean);
}

function allocateDurations(tasks, capacityMinutes, now) {
  const minimumTotal = tasks.reduce((sum, task) => sum + task.minimumMinutes, 0);
  const flexibleCapacity = Math.max(0, capacityMinutes - minimumTotal);
  const weights = tasks.map((task) => ({
    task,
    weight: calculatePriority(task, now) * Math.max(1, task.desiredMinutes)
  }));
  const weightTotal = weights.reduce((sum, item) => sum + item.weight, 0) || 1;

  return new Map(weights.map(({ task, weight }) => {
    const desiredExtra = Math.max(0, task.desiredMinutes - task.minimumMinutes);
    const proportionalExtra = Math.floor((weight / weightTotal) * flexibleCapacity);
    return [task.taskId, task.minimumMinutes + Math.min(desiredExtra, proportionalExtra)];
  }));
}

function placeTask(task, minutes, blocks) {
  const compatible = blocks
    .map((block, index) => ({ block, index, score: scorePlacement(task, block) }))
    .filter((item) => contextCompatible(task, item.block))
    .sort((a, b) => b.score - a.score);

  const segments = [];
  let remaining = minutes;

  for (const item of compatible) {
    if (remaining <= 0) break;
    const block = blocks[item.index];
    const capacity = minutesBetween(block.start, block.end);
    const minNeeded = task.splittable ? task.minSegmentMinutes : remaining;
    if (capacity < minNeeded) continue;

    const used = Math.min(remaining, capacity);
    const segment = {
      taskId: task.taskId,
      taskName: task.taskName,
      status: TASK_STATUSES.SCHEDULED,
      start: block.start,
      end: addMinutes(block.start, used),
      allocatedMinutes: used
    };
    segments.push(segment);
    block.start = segment.end;
    remaining -= used;

    if (!task.splittable) break;
  }

  return { segments, remaining };
}

export function scheduleDay({ planDate, now, availableBlocks, protectedBlocks, tasks }) {
  const completedSegments = tasks
    .filter((task) => task.status === TASK_STATUSES.COMPLETED)
    .map((task) => ({
      taskId: task.taskId,
      taskName: task.taskName,
      status: TASK_STATUSES.COMPLETED,
      start: task.actualStart,
      end: task.actualEnd,
      allocatedMinutes: minutesBetween(task.actualStart, task.actualEnd)
    }));

  const activeTasks = tasks.filter((task) => task.status !== TASK_STATUSES.COMPLETED && task.status !== TASK_STATUSES.SKIPPED);
  const futureAvailable = futurePartOfBlocks(subtractIntervals(availableBlocks, protectedBlocks), now);
  const capacity = totalMinutes(futureAvailable);
  const requiredMinimum = activeTasks.reduce((sum, task) => sum + task.minimumMinutes, 0);

  if (requiredMinimum > capacity) {
    return {
      status: 'conflict',
      planDate,
      segments: completedSegments,
      conflict: {
        availableMinutes: capacity,
        requiredMinimumMinutes: requiredMinimum,
        actions: ['增加可用时间后重排', '降低部分任务最小时长后重排', '删除/跳过低优先级任务后重排']
      }
    };
  }

  const blocks = futureAvailable.map((block) => ({ ...block }));
  const allocations = allocateDurations(activeTasks, capacity, now);
  const orderedTasks = [...activeTasks].sort((a, b) => calculatePriority(b, now) - calculatePriority(a, now));
  const scheduledSegments = [];
  const unscheduled = [];

  for (const task of orderedTasks) {
    const fixedBlock = task.fixed && task.fixedStart && task.fixedEnd
      ? [{ start: `${planDate}T${task.fixedStart}:00`, end: `${planDate}T${task.fixedEnd}:00`, context: task.executionContext }]
      : blocks;
    const { segments, remaining } = placeTask(task, allocations.get(task.taskId), fixedBlock);
    scheduledSegments.push(...segments);
    if (remaining > 0) {
      unscheduled.push({ taskId: task.taskId, taskName: task.taskName, remainingMinutes: remaining });
    }
  }

  return {
    status: unscheduled.length > 0 ? 'partial' : 'ok',
    planDate,
    segments: [...completedSegments, ...scheduledSegments].sort((a, b) => a.start.localeCompare(b.start)),
    unscheduled
  };
}
```

- [ ] **Step 4: Run scheduler tests**

Run: `node --test tests/scheduler.test.js`

Expected: PASS, 4 tests.

- [ ] **Step 5: Run all pure tests**

Run: `npm test`

Expected: PASS for all tests created so far.

- [ ] **Step 6: Commit scheduler**

```bash
git add src/scheduler.js tests/scheduler.test.js
git commit -m "feat: add day scheduler"
```

## Task 7: Local Settings Storage

**Files:**
- Create: `src/storage.js`

- [ ] **Step 1: Create `src/storage.js`**

```js
const SETTINGS_KEY = 'adaptivePlanner.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  clientId: '',
  writeBuffersToCalendar: false,
  defaultBlocks: [
    { start: '09:00', end: '18:00', context: 'work', enabled: true },
    { start: '19:30', end: '23:00', context: 'home', enabled: true }
  ]
});

export function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS, defaultBlocks: DEFAULT_SETTINGS.defaultBlocks.map((block) => ({ ...block })) };

  try {
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      defaultBlocks: Array.isArray(parsed.defaultBlocks) ? parsed.defaultBlocks : DEFAULT_SETTINGS.defaultBlocks
    };
  } catch {
    return { ...DEFAULT_SETTINGS, defaultBlocks: DEFAULT_SETTINGS.defaultBlocks.map((block) => ({ ...block })) };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
```

- [ ] **Step 2: Commit settings storage**

```bash
git add src/storage.js
git commit -m "feat: add local settings storage"
```

## Task 8: Google Calendar Client

**Files:**
- Create: `src/calendarClient.js`

- [ ] **Step 1: Create `src/calendarClient.js`**

```js
import { PLAN_TITLE_PREFIX } from './models.js';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

let tokenClient = null;
let accessToken = null;

export function hasAccessToken() {
  return Boolean(accessToken);
}

export function initGoogleAuth(clientId, onToken) {
  if (!clientId) {
    throw new Error('请先填写 Google OAuth Client ID');
  }
  if (!globalThis.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services 尚未加载完成');
  }

  tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: CALENDAR_SCOPE,
    callback: (response) => {
      if (response.error) {
        throw new Error(response.error);
      }
      accessToken = response.access_token;
      onToken?.(response);
    }
  });

  return tokenClient;
}

export function requestAccessToken() {
  if (!tokenClient) {
    throw new Error('Google 授权尚未初始化');
  }
  tokenClient.requestAccessToken({ prompt: '' });
}

export function revokeAccessToken() {
  if (accessToken && globalThis.google?.accounts?.oauth2) {
    globalThis.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
}

async function calendarFetch(path, options = {}) {
  if (!accessToken) {
    throw new Error('尚未连接 Google Calendar');
  }

  const response = await fetch(`${CALENDAR_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar 请求失败：${response.status} ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function listPrimaryEvents(timeMin, timeMax) {
  const query = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime'
  });
  const data = await calendarFetch(`/calendars/primary/events?${query.toString()}`);
  return data.items ?? [];
}

export async function createPlanEvent(segment, description) {
  return calendarFetch('/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: `${PLAN_TITLE_PREFIX} ${segment.taskName}`,
      description,
      start: { dateTime: segment.start },
      end: { dateTime: segment.end }
    })
  });
}

export async function updatePlanEvent(eventId, segment, description) {
  return calendarFetch(`/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      summary: `${PLAN_TITLE_PREFIX} ${segment.taskName}`,
      description,
      start: { dateTime: segment.start },
      end: { dateTime: segment.end }
    })
  });
}

export async function deletePlanEvent(eventId) {
  return calendarFetch(`/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE'
  });
}
```

- [ ] **Step 2: Commit calendar client**

```bash
git add src/calendarClient.js
git commit -m "feat: add google calendar client"
```

## Task 9: UI Wiring

**Files:**
- Create: `src/ui.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/ui.js`**

```js
import { createTask, CONTEXTS, TASK_TYPE_DEFAULTS, TASK_STATUSES, APP_ID } from './models.js';
import { buildDescription, extractPlanMetadata, isPlanManagedEvent } from './metadata.js';
import { scheduleDay } from './scheduler.js';
import { combineDateAndTime } from './time.js';
import { loadSettings, saveSettings } from './storage.js';
import { initGoogleAuth, requestAccessToken, listPrimaryEvents, createPlanEvent, updatePlanEvent } from './calendarClient.js';

const state = {
  settings: loadSettings(),
  planDate: new Date().toISOString().slice(0, 10),
  calendarEvents: [],
  tasks: [],
  availableBlocks: [],
  schedule: null
};

function $(id) {
  return document.getElementById(id);
}

function option(value, label) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function renderTaskTypeOptions() {
  const select = document.querySelector('select[name="taskType"]');
  select.replaceChildren(...Object.keys(TASK_TYPE_DEFAULTS).map((type) => option(type, type)));
}

function renderContextOptions() {
  const select = document.querySelector('select[name="executionContext"]');
  select.replaceChildren(
    option(CONTEXTS.ANY, '任意时间'),
    option(CONTEXTS.WORK, '仅工作时间'),
    option(CONTEXTS.HOME, '仅下班后'),
    option(CONTEXTS.CUSTOM, '自定义时间窗')
  );
}

function renderAvailableBlocks() {
  const root = $('availableBlocks');
  root.replaceChildren(...state.availableBlocks.map((block, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'row';
    wrapper.innerHTML = `
      <input type="time" value="${block.startTime}" data-block="${index}" data-field="startTime" />
      <input type="time" value="${block.endTime}" data-block="${index}" data-field="endTime" />
      <select data-block="${index}" data-field="context">
        <option value="work">工作时间</option>
        <option value="home">下班后</option>
        <option value="any">任意时间</option>
      </select>
      <button type="button" data-remove-block="${index}">删除</button>
    `;
    wrapper.querySelector('select').value = block.context;
    return wrapper;
  }));
}

function ordinaryCalendarBlocks() {
  return state.calendarEvents
    .filter((event) => !isPlanManagedEvent(event))
    .filter((event) => event.start?.dateTime && event.end?.dateTime)
    .map((event) => ({ start: event.start.dateTime.slice(0, 19), end: event.end.dateTime.slice(0, 19), title: event.summary ?? '普通日程' }));
}

function planTasksFromCalendar() {
  return state.calendarEvents
    .map((event) => ({ event, meta: extractPlanMetadata(event.description ?? '') }))
    .filter((item) => item.meta)
    .map(({ event, meta }) => ({
      ...meta,
      calendarEventId: event.id,
      status: meta.status ?? TASK_STATUSES.SCHEDULED
    }));
}

function concreteAvailableBlocks() {
  return state.availableBlocks.map((block) => ({
    start: combineDateAndTime(state.planDate, block.startTime),
    end: combineDateAndTime(state.planDate, block.endTime),
    context: block.context
  }));
}

function renderConflict() {
  const panel = $('conflictPanel');
  if (!state.schedule || state.schedule.status !== 'conflict') {
    panel.className = 'hidden';
    panel.textContent = '';
    return;
  }

  panel.className = 'conflict';
  panel.innerHTML = `
    <strong>计划冲突</strong>
    <p>可用时间：${state.schedule.conflict.availableMinutes} min；最小时长总和：${state.schedule.conflict.requiredMinimumMinutes} min。</p>
    <ol>
      ${state.schedule.conflict.actions.map((action) => `<li>${action}</li>`).join('')}
    </ol>
  `;
}

function renderSchedule() {
  renderConflict();
  const root = $('scheduleList');
  if (!state.schedule) {
    root.textContent = '尚未计算计划。';
    return;
  }

  root.replaceChildren(...state.schedule.segments.map((segment) => {
    const item = document.createElement('div');
    item.className = `schedule-item ${segment.status === TASK_STATUSES.COMPLETED ? 'completed' : ''}`;
    item.innerHTML = `
      <strong>${segment.taskName}</strong>
      <div class="muted">${segment.start.slice(11, 16)} - ${segment.end.slice(11, 16)}，${segment.allocatedMinutes} min</div>
      <button type="button" data-complete-task="${segment.taskId}">完成</button>
    `;
    return item;
  }));

  $('syncPreview').textContent = state.schedule.status === 'conflict'
    ? '解决冲突后才能同步。'
    : `准备同步 ${state.schedule.segments.filter((segment) => segment.status !== TASK_STATUSES.COMPLETED).length} 个计划块。`;
}

function recalculate() {
  const calendarTasks = planTasksFromCalendar();
  const taskMap = new Map([...calendarTasks, ...state.tasks].map((task) => [task.taskId, task]));
  const tasks = [...taskMap.values()];
  state.schedule = scheduleDay({
    planDate: state.planDate,
    now: new Date().toISOString().slice(0, 19),
    availableBlocks: concreteAvailableBlocks(),
    protectedBlocks: ordinaryCalendarBlocks(),
    tasks
  });
  renderSchedule();
}

async function loadCalendar() {
  const timeMin = `${state.planDate}T00:00:00`;
  const timeMax = `${state.planDate}T23:59:59`;
  state.calendarEvents = await listPrimaryEvents(timeMin, timeMax);
  state.tasks = planTasksFromCalendar();
  recalculate();
}

async function syncSchedule() {
  if (!state.schedule || state.schedule.status === 'conflict') return;

  for (const segment of state.schedule.segments) {
    if (segment.status === TASK_STATUSES.COMPLETED) continue;
    const task = [...state.tasks, ...planTasksFromCalendar()].find((item) => item.taskId === segment.taskId);
    const metadata = {
      schemaVersion: 1,
      app: APP_ID,
      planDate: state.planDate,
      segmentId: `${segment.taskId}_${segment.start}`,
      status: TASK_STATUSES.SCHEDULED,
      ...task
    };
    const description = buildDescription('由 Adaptive Planner 创建。', metadata);
    if (task?.calendarEventId) {
      await updatePlanEvent(task.calendarEventId, segment, description);
    } else {
      await createPlanEvent(segment, description);
    }
  }

  await loadCalendar();
}

function addDefaultBlocks() {
  state.availableBlocks = state.settings.defaultBlocks
    .filter((block) => block.enabled)
    .map((block) => ({ startTime: block.start, endTime: block.end, context: block.context }));
  renderAvailableBlocks();
}

function wireEvents() {
  $('clientIdInput').value = state.settings.clientId;
  $('planDateInput').value = state.planDate;

  $('saveClientIdButton').addEventListener('click', () => {
    state.settings.clientId = $('clientIdInput').value.trim();
    saveSettings(state.settings);
  });

  $('connectButton').addEventListener('click', () => {
    initGoogleAuth(state.settings.clientId, () => $('connectButton').textContent = '已连接');
    requestAccessToken();
  });

  $('planDateInput').addEventListener('change', (event) => {
    state.planDate = event.target.value;
  });

  $('loadCalendarButton').addEventListener('click', () => loadCalendar().catch((error) => alert(error.message)));
  $('addDefaultBlocksButton').addEventListener('click', addDefaultBlocks);
  $('rescheduleButton').addEventListener('click', recalculate);
  $('syncButton').addEventListener('click', () => syncSchedule().catch((error) => alert(error.message)));

  $('addBlockButton').addEventListener('click', () => {
    state.availableBlocks.push({ startTime: '09:00', endTime: '10:00', context: CONTEXTS.ANY });
    renderAvailableBlocks();
  });

  $('availableBlocks').addEventListener('input', (event) => {
    const index = Number(event.target.dataset.block);
    const field = event.target.dataset.field;
    if (Number.isInteger(index) && field) {
      state.availableBlocks[index][field] = event.target.value;
    }
  });

  $('availableBlocks').addEventListener('click', (event) => {
    const index = Number(event.target.dataset.removeBlock);
    if (Number.isInteger(index)) {
      state.availableBlocks.splice(index, 1);
      renderAvailableBlocks();
    }
  });

  $('taskForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.tasks.push(createTask({
      taskName: form.get('taskName'),
      taskType: form.get('taskType'),
      desiredMinutes: form.get('desiredMinutes'),
      minimumMinutes: form.get('minimumMinutes'),
      importance: form.get('importance'),
      deadline: form.get('deadline'),
      executionContext: form.get('executionContext'),
      fixed: form.get('fixed') === 'on',
      fixedStart: form.get('fixedStart'),
      fixedEnd: form.get('fixedEnd')
    }));
    event.currentTarget.reset();
    recalculate();
  });

  $('scheduleList').addEventListener('click', (event) => {
    const taskId = event.target.dataset.completeTask;
    if (!taskId) return;
    const task = state.tasks.find((item) => item.taskId === taskId);
    if (task) {
      task.status = TASK_STATUSES.COMPLETED;
      task.actualEnd = new Date().toISOString().slice(0, 19);
      task.actualStart = task.actualStart ?? state.schedule.segments.find((segment) => segment.taskId === taskId)?.start;
      recalculate();
    }
  });
}

export function initApp() {
  renderTaskTypeOptions();
  renderContextOptions();
  addDefaultBlocks();
  wireEvents();
  renderSchedule();
}
```

- [ ] **Step 2: Confirm `src/main.js` imports the UI bootstrap**

```js
import { initApp } from './ui.js';

initApp();
```

- [ ] **Step 3: Run all tests**

Run: `npm test`

Expected: PASS for all pure logic tests.

- [ ] **Step 4: Run browser smoke test**

Run: `python -m http.server 5173`

Expected: `http://localhost:5173` lets the user add a task, generate default blocks, recalculate, and see schedule rows without Google login. Stop the server with `Ctrl+C`.

- [ ] **Step 5: Commit UI wiring**

```bash
git add src/ui.js src/main.js
git commit -m "feat: wire planner ui"
```

## Task 10: README and Deployment Notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Adaptive Planner

一个中文当天计划工具。它根据可用时间、任务权重、最小时长、deadline、任务类型、精力需求、上班/下班场景和 Google Calendar 固定行程自动重排当天任务。

## 本地运行

```bash
python -m http.server 5173
```

打开 `http://localhost:5173`。

## 测试

```bash
npm test
```

## Google OAuth 配置

1. 打开 Google Cloud Console。
2. 创建或选择一个项目。
3. 启用 Google Calendar API。
4. 创建 OAuth Client，类型选择 Web application。
5. Authorized JavaScript origins 添加 GitHub Pages 站点来源，例如 `https://<user>.github.io`。
6. 本地测试时添加 `http://localhost:5173`。
7. 将 OAuth Client ID 填入应用顶部输入框并保存。

应用使用 scope：`https://www.googleapis.com/auth/calendar.events`。

## Calendar 数据规则

- 普通 Google Calendar 事件没有 `PLAN_META`，应用只把它们当作固定不可用时间。
- 应用只创建、更新、删除包含合法 `PLAN_META` 的 `[Plan]` 事件。
- Plan 任务的完整属性保存在事件描述字段中的 JSON。
- access token 只保存在浏览器内存，不写入 localStorage。

## GitHub Pages 部署

1. 将本仓库推送到 GitHub。
2. 在仓库 Settings -> Pages 中选择部署分支。
3. 确认 Google OAuth Client 的 Authorized JavaScript origins 包含 Pages 域名。
4. 打开 Pages URL，填入 Client ID 后连接 Google Calendar。
```

- [ ] **Step 2: Commit README**

```bash
git add README.md
git commit -m "docs: add setup and deployment notes"
```

## Task 11: Final Verification

**Files:**
- Read: all files created above

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run browser smoke test**

Run: `python -m http.server 5173`

Expected:
- App loads at `http://localhost:5173`.
- UI text is Chinese.
- Default time blocks render.
- Adding an example task and pressing `重新计算` shows a schedule row.
- A minimum-duration conflict shows the three agreed recovery actions.

- [ ] **Step 3: Review Git status**

Run: `git status --short`

Expected: no uncommitted implementation files.

- [ ] **Step 4: Commit any verification-only documentation correction**

If verification reveals a README command typo, fix that exact typo and commit:

```bash
git add README.md
git commit -m "docs: fix verification notes"
```

## Self-Review

Spec coverage:

- Dedicated folder and GitHub Pages static frontend: Task 1 and Task 10.
- Chinese UI: Task 1 and Task 9.
- Google OAuth Client ID and Calendar sync: Task 8 and Task 9.
- Plan metadata in Google Calendar descriptions: Task 3 and Task 9.
- Ordinary events protected as fixed unavailable time: Task 3, Task 6, Task 9.
- Same-day planning with weekly extension fields: Task 2 and Task 3.
- Task fields, task type defaults, execution context: Task 2 and Task 9.
- Priority, urgency, energy fit: Task 5 and Task 6.
- Minimum-duration hard conflicts and three recovery actions: Task 6 and Task 9.
- Completion state and actual time preservation: Task 6 and Task 9.
- Tests for pure logic: Tasks 2 through 6.

Red-flag scan:

- The plan contains no banned marker tokens and no unspecified implementation steps.

Type consistency:

- `taskId`, `taskName`, `taskType`, `desiredMinutes`, `minimumMinutes`, `importance`, `deadline`, `executionContext`, `fixed`, `fixedStart`, `fixedEnd`, `status`, `actualStart`, `actualEnd`, and `weekPlanId` are defined in `src/models.js` and reused consistently.
- `PLAN_META`, `schemaVersion`, and `app` metadata fields are parsed in `src/metadata.js` and written in `src/ui.js`.
- `scheduleDay` receives `planDate`, `now`, `availableBlocks`, `protectedBlocks`, and `tasks` in tests and UI.
