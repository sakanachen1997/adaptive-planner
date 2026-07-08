# Timeline Calendar Readback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-column timeline plan view, visible Google Calendar readback blocks, fixed-time duration derivation, and a deadline "今日" helper.

**Architecture:** Keep scheduling logic intact and add small pure UI helpers in `src/ui.js` so timeline data, fixed-duration form normalization, and deadline shortcut behavior can be tested without a browser. `renderSchedule()` will render the new timeline/detail layout while reusing existing edit/complete/delete action handlers.

**Tech Stack:** Static HTML, vanilla JavaScript modules, CSS, Node's built-in test runner.

---

## File Structure

- Modify `index.html`: add a deadline shortcut button, make desired/minimum duration inputs optional at HTML level, and keep existing IDs/field names stable.
- Modify `src/ui.js`: add pure helpers for fixed-time form input, deadline shortcut value, timeline item construction, and timeline rendering.
- Modify `src/styles.css`: add timeline layout and block styles for Plan tasks, protected events, completed tasks, and conflict states.
- Modify `tests/html.test.js`: assert new visible controls and timeline containers.
- Modify `tests/ui.test.js`: cover fixed-duration derivation, deadline shortcut behavior, Calendar readback timeline item creation, and protected item rendering assumptions.
- Modify `README.md` and existing design docs only if implementation behavior differs from current docs.

---

### Task 1: Fixed-Time Tasks Derive Desired and Minimum Duration

**Files:**
- Modify: `src/ui.js`
- Test: `tests/ui.test.js`
- Modify: `index.html`

- [ ] **Step 1: Write failing tests**

Add tests in `tests/ui.test.js` for a new exported helper:

```js
import { taskInputFromFormData } from '../src/ui.js';

test('fixed task form input derives desired and minimum duration from fixed time range', () => {
  const input = taskInputFromFormData(new Map([
    ['taskName', '晚间运动'],
    ['taskType', '运动健身'],
    ['desiredMinutes', '999'],
    ['minimumMinutes', '1'],
    ['importance', '3'],
    ['deadline', ''],
    ['executionContext', 'home'],
    ['energyDemand', 'medium'],
    ['physicalDemand', 'high'],
    ['orderPreference', 'evening'],
    ['splittable', null],
    ['minSegmentMinutes', '30'],
    ['externalCommitment', '2'],
    ['fixed', 'on'],
    ['fixedStart', '19:30'],
    ['fixedEnd', '21:20']
  ]));

  assert.equal(input.desiredMinutes, '110');
  assert.equal(input.minimumMinutes, '110');
});

test('fixed task form input rejects non-positive fixed time range', () => {
  assert.throws(() => taskInputFromFormData(new Map([
    ['taskName', '错误固定任务'],
    ['taskType', '自定义'],
    ['desiredMinutes', ''],
    ['minimumMinutes', ''],
    ['importance', '3'],
    ['deadline', ''],
    ['executionContext', 'any'],
    ['energyDemand', 'medium'],
    ['physicalDemand', 'low'],
    ['orderPreference', 'any'],
    ['splittable', 'on'],
    ['minSegmentMinutes', '20'],
    ['externalCommitment', '1'],
    ['fixed', 'on'],
    ['fixedStart', '21:20'],
    ['fixedEnd', '19:30']
  ])), RangeError);
});

test('non-fixed task form input still requires desired and minimum duration', () => {
  assert.throws(() => taskInputFromFormData(new Map([
    ['taskName', '普通任务'],
    ['taskType', '自定义'],
    ['desiredMinutes', ''],
    ['minimumMinutes', ''],
    ['importance', '3'],
    ['deadline', ''],
    ['executionContext', 'any'],
    ['energyDemand', 'medium'],
    ['physicalDemand', 'low'],
    ['orderPreference', 'any'],
    ['splittable', 'on'],
    ['minSegmentMinutes', '20'],
    ['externalCommitment', '1'],
    ['fixed', null],
    ['fixedStart', ''],
    ['fixedEnd', '']
  ])), RangeError);
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests\ui.test.js`

Expected: FAIL because `taskInputFromFormData` is not exported.

- [ ] **Step 3: Implement minimal helper and wire existing form submit**

In `src/ui.js`, add:

```js
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
    splittable: data.get('splittable') === 'on',
    minSegmentMinutes: data.get('minSegmentMinutes'),
    externalCommitment: data.get('externalCommitment'),
    fixed,
    fixedStart,
    fixedEnd
  };
}
```

Change `taskInputFromForm(form)` to:

```js
function taskInputFromForm(form) {
  return taskInputFromFormData(new FormData(form));
}
```

In `index.html`, remove `required` from `desiredMinutes` and `minimumMinutes` so fixed tasks can submit without those fields.

- [ ] **Step 4: Verify Task 1**

Run: `node --test tests\ui.test.js tests\models.test.js`

Expected: PASS.

---

### Task 2: Deadline Today Shortcut

**Files:**
- Modify: `index.html`
- Modify: `src/ui.js`
- Test: `tests/html.test.js`
- Test: `tests/ui.test.js`

- [ ] **Step 1: Write failing tests**

In `tests/html.test.js`, assert the button exists:

```js
test('deadline field exposes a today shortcut button', () => {
  assert.match(html, /id="deadlineTodayButton"[^>]*>今日<\/button>/);
});
```

In `tests/ui.test.js`, add:

```js
import { deadlineTodayValue } from '../src/ui.js';

test('deadlineTodayValue preserves existing time and replaces date', () => {
  assert.equal(
    deadlineTodayValue('2026-07-08T12:34:56', '2026-08-01T18:30'),
    '2026-07-08T18:30'
  );
});

test('deadlineTodayValue uses 23:59 when deadline is empty', () => {
  assert.equal(deadlineTodayValue('2026-07-08T12:34:56', ''), '2026-07-08T23:59');
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests\html.test.js tests\ui.test.js`

Expected: FAIL because button/helper do not exist.

- [ ] **Step 3: Implement shortcut**

In `index.html`, place a button next to the deadline input:

```html
<div class="input-row">
  <input name="deadline" type="datetime-local" />
  <button id="deadlineTodayButton" type="button">今日</button>
</div>
```

In `src/ui.js`, add:

```js
export function deadlineTodayValue(now, currentValue) {
  const today = normalizeDateTime(now).slice(0, 10);
  const time = String(currentValue ?? '').slice(11, 16) || '23:59';
  return `${today}T${time}`;
}

function fillDeadlineToday() {
  const form = element('taskForm');
  const input = form?.elements.deadline;
  if (!input) {
    return;
  }
  input.value = deadlineTodayValue(new Date(), input.value);
}
```

Wire in `wireEvents()`:

```js
element('deadlineTodayButton')?.addEventListener('click', fillDeadlineToday);
```

- [ ] **Step 4: Verify Task 2**

Run: `node --test tests\html.test.js tests\ui.test.js`

Expected: PASS.

---

### Task 3: Build Timeline Items from Schedule and Calendar Readback

**Files:**
- Modify: `src/ui.js`
- Test: `tests/ui.test.js`

- [ ] **Step 1: Write failing tests**

Add exported helper tests:

```js
import { buildTimelineItems } from '../src/ui.js';

test('buildTimelineItems includes scheduled Plan segments and protected calendar blocks', () => {
  const items = buildTimelineItems({
    schedule: {
      status: 'ok',
      segments: [{
        taskId: 'task-1',
        taskName: '编码',
        status: 'scheduled',
        start: '2026-07-08T09:00:00',
        end: '2026-07-08T10:00:00',
        allocatedMinutes: 60
      }]
    },
    protectedBlocks: [{
      summary: '会议',
      start: '2026-07-08T10:30:00',
      end: '2026-07-08T11:00:00',
      calendarEventId: 'event-1'
    }],
    tasks: [{ taskId: 'task-1', taskName: '编码' }]
  });

  assert.deepEqual(items.map((item) => item.kind), ['task', 'protected']);
  assert.equal(items[0].editable, true);
  assert.equal(items[1].editable, false);
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests\ui.test.js`

Expected: FAIL because `buildTimelineItems` is missing.

- [ ] **Step 3: Implement timeline item builder**

In `src/ui.js`, add:

```js
function timelineMinutes(value) {
  const time = normalizeDateTime(value).slice(11, 16);
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function buildTimelineItems({ schedule = null, protectedBlocks = [], tasks = [] }) {
  const candidatesByTaskId = taskCandidatesByTaskId(tasks);
  const taskItems = (schedule?.segments ?? []).map((segment) => {
    const task = findTaskForSegment(segment, candidatesByTaskId);
    return {
      kind: 'task',
      id: segment.segmentId ?? `${segment.taskId}:${segment.start}:${segment.end}`,
      task,
      segment,
      title: segment.taskName,
      start: segment.start,
      end: segment.end,
      startMinute: timelineMinutes(segment.start),
      endMinute: timelineMinutes(segment.end),
      status: segment.status,
      editable: Boolean(task)
    };
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

  return [...taskItems, ...protectedItems].sort((left, right) => (
    left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
  ));
}
```

- [ ] **Step 4: Verify Task 3**

Run: `node --test tests\ui.test.js`

Expected: PASS.

---

### Task 4: Render Two-Column Timeline View

**Files:**
- Modify: `index.html`
- Modify: `src/ui.js`
- Modify: `src/styles.css`
- Test: `tests/html.test.js`
- Test: `tests/ui.test.js`

- [ ] **Step 1: Write failing tests**

In `tests/html.test.js`, assert:

```js
test('day plan exposes timeline and detail containers', () => {
  assert.match(html, /id="timelineView"/);
  assert.match(html, /id="timelineDetail"/);
});
```

In `tests/ui.test.js`, add a pure render metadata test:

```js
import { timelineBounds } from '../src/ui.js';

test('timelineBounds spans visible schedule and protected blocks', () => {
  assert.deepEqual(timelineBounds([
    { startMinute: 570, endMinute: 630 },
    { startMinute: 1200, endMinute: 1260 }
  ]), { startMinute: 540, endMinute: 1320, totalMinutes: 780 });
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests\html.test.js tests\ui.test.js`

Expected: FAIL because containers/helper are missing.

- [ ] **Step 3: Add containers**

In `index.html`, change the day plan section to keep `scheduleList` while adding timeline containers:

```html
<div id="scheduleList">
  <div id="timelineView"></div>
  <div id="timelineDetail"></div>
</div>
```

- [ ] **Step 4: Implement bounds and rendering**

In `src/ui.js`, add:

```js
export function timelineBounds(items) {
  if (items.length === 0) {
    return { startMinute: 480, endMinute: 1320, totalMinutes: 840 };
  }
  const startMinute = Math.max(0, Math.floor(Math.min(...items.map((item) => item.startMinute)) / 60) * 60);
  const endMinute = Math.min(1440, Math.ceil(Math.max(...items.map((item) => item.endMinute)) / 60) * 60);
  return { startMinute, endMinute, totalMinutes: Math.max(60, endMinute - startMinute) };
}
```

Refactor `renderSchedule()` so it:

- clears `scheduleList`
- creates a `timeline-layout` wrapper
- renders `timelineView` with positioned items from `buildTimelineItems({ schedule: state.schedule, protectedBlocks: protectedBlocksFromCalendar(), tasks: currentTasks })`
- renders `timelineDetail` with schedule summary by default
- preserves existing edit/complete/delete buttons using `appendEditButton()` and existing `data-*` attributes
- calls `renderConflictEditableTasks(root, currentTasks)` and `renderSyncPreview()` after timeline rendering

Add rendering classes:

```js
function renderTimelineItem(parent, item, bounds) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `timeline-block timeline-${item.kind} timeline-${item.status}`;
  node.style.top = `${((item.startMinute - bounds.startMinute) / bounds.totalMinutes) * 100}%`;
  node.style.height = `${Math.max(24, ((item.endMinute - item.startMinute) / bounds.totalMinutes) * 100)}%`;
  node.dataset.timelineItemId = item.id;
  node.textContent = `${item.start.slice(11, 16)} ${item.title}`;
  parent.append(node);
}
```

- [ ] **Step 5: Add CSS**

In `src/styles.css`, add:

```css
.timeline-layout {
  display: grid;
  grid-template-columns: minmax(260px, 1.3fr) minmax(240px, 0.9fr);
  gap: 16px;
}

.timeline-view {
  position: relative;
  min-height: 720px;
  border-left: 2px solid var(--border);
  background: linear-gradient(#edf1f5 1px, transparent 1px) 0 0 / 100% 48px;
}

.timeline-block {
  position: absolute;
  left: 16px;
  right: 8px;
  overflow: hidden;
  text-align: left;
  border: 1px solid var(--border);
  border-left-width: 4px;
  background: #fff;
}

.timeline-task { border-left-color: #2563eb; }
.timeline-protected { border-left-color: #64748b; background: #f1f5f9; color: var(--muted); }
.timeline-completed { border-left-color: var(--ok); opacity: 0.75; }
.timeline-conflict { border-left-color: var(--danger); background: var(--danger-bg); }
.timeline-detail { border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
```

- [ ] **Step 6: Verify Task 4**

Run: `node --test tests\html.test.js tests\ui.test.js`

Expected: PASS.

---

### Task 5: Ensure Calendar Readback Appears in the Page

**Files:**
- Modify: `src/ui.js`
- Test: `tests/ui.test.js`

- [ ] **Step 1: Write failing or strengthening test**

Add a test that a Calendar Plan event converted by `calendarEventToPlanTask()` becomes a timeline item when passed through `buildTimelineItems()`:

```js
test('calendar readback Plan task can be rendered as timeline task item', () => {
  const task = calendarEventToPlanTask({
    id: 'event-plan',
    summary: '[Plan] 编码',
    description: buildDescription('Created by planner', {
      schemaVersion: 1,
      app: APP_ID,
      taskId: 'task-plan',
      taskName: '编码',
      taskType: '编码工作',
      desiredMinutes: 60,
      minimumMinutes: 60,
      importance: 5,
      status: TASK_STATUSES.SCHEDULED
    }),
    start: { dateTime: '2026-07-08T09:00:00+02:00' },
    end: { dateTime: '2026-07-08T10:00:00+02:00' }
  });
  const items = buildTimelineItems({
    schedule: { status: 'ok', segments: [{ taskId: 'task-plan', taskName: '编码', status: 'scheduled', start: task.plannedStart, end: task.plannedEnd, allocatedMinutes: 60 }] },
    protectedBlocks: [],
    tasks: [task]
  });

  assert.equal(items[0].kind, 'task');
  assert.equal(items[0].task.calendarEventId, 'event-plan');
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests\ui.test.js`

Expected: PASS after Task 3. If it fails, fix `findTaskForSegment()` or timeline item task matching without changing Calendar protection rules.

---

### Task 6: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-08-timeline-calendar-readback-design.md` only if implementation differs.

- [ ] **Step 1: Update README**

Add a concise section describing:

- timeline left/right layout
- gray protected Calendar blocks
- fixed-time tasks deriving duration
- deadline `今日` shortcut

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm test
node --input-type=module -e "await import('./src/ui.js'); console.log('ui import ok')"
git diff --check
git status --short
```

Expected:

- `npm test` exits 0 with all tests passing.
- UI import prints `ui import ok`.
- `git diff --check` exits 0.
- `git status --short` shows only intended modified files before commit and clean after commit.

- [ ] **Step 3: Commit**

```powershell
git add index.html src\ui.js src\styles.css tests\html.test.js tests\ui.test.js README.md
git commit -m "Add timeline calendar readback features"
```

Expected: commit succeeds on `feature/adaptive-planner`.

---

## Self-Review

- Spec coverage: timeline view is Task 3/4, fixed-time duration is Task 1, Calendar readback display is Task 3/5, deadline shortcut is Task 2, documentation/verification is Task 6.
- Completeness scan: the plan contains no unfinished sections.
- Type consistency: helpers use existing `taskId`, `segmentId`, `calendarEventId`, `fixedStart`, `fixedEnd`, `desiredMinutes`, `minimumMinutes`, `protectedBlocks`, and `schedule.segments` shapes already present in `src/ui.js`.
