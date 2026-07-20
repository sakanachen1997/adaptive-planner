import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('task form fields have visible labels', () => {
  const requiredLabels = [
    '任务名',
    '任务类型',
    '想要时长',
    '最小时长',
    '重要性',
    '紧迫度（0–6，手动填写，与截止时间无关）',
    '截止时间（任务须在此之前完成）',
    '执行场景',
    '精力需求',
    '体力需求',
    '顺序偏好',
    '前置任务（可多选）',
    '是否可拆分',
    '最小分段时长',
    '外部承诺',
    '固定开始时间',
    '固定结束时间'
  ];

  for (const label of requiredLabels) {
    assert.match(
      html,
      new RegExp(`<span[^>]*>${label}</span>`),
      `missing visible label: ${label}`
    );
  }
});

test('task form exposes every task type preset field as editable controls', () => {
  for (const fieldName of [
    'energyDemand',
    'physicalDemand',
    'orderPreference',
    'splittable',
    'minSegmentMinutes',
    'externalCommitment'
  ]) {
    assert.match(html, new RegExp(`name="${fieldName}"`), `missing editable field: ${fieldName}`);
  }
});

test('task form exposes a manual urgency input bounded to 0-6', () => {
  assert.match(html, /name="urgency"[^>]*type="number"/);
  assert.match(html, /name="urgency"[^>]*min="0"/);
  assert.match(html, /name="urgency"[^>]*max="6"/);
});

test('deadline field exposes a today shortcut button', () => {
  assert.match(html, /id="deadlineTodayButton"[^>]*>今日<\/button>/);
});

test('dependency choices use a direct checkbox container instead of a native multi-select', () => {
  assert.match(html, /id="dependencyTaskChoices"/);
  assert.doesNotMatch(html, /select name="dependencyTaskIds"[^>]*multiple/);
  assert.match(html, /直接勾选一个或多个任务/);
});

test('page exposes a persistent scheduling button instead of a compression action', () => {
  assert.match(html, /id="rescheduleButton"[^>]*>调度<\/button>/);
  assert.doesNotMatch(html, />一键按比例压缩<\/button>/);
});

test('page exposes a debug report copy button', () => {
  assert.match(html, /id="copyDebugButton"[^>]*>复制调试信息<\/button>/);
});

test('day plan exposes timeline and detail containers', () => {
  assert.match(html, /id="timelineView"/);
  assert.match(html, /id="timelineDetail"/);
});

test('calendar controls distinguish read-only import from calendar publishing', () => {
  assert.match(html, /id="loadCalendarButton"[^>]*>读取并显示日历<\/button>/);
  assert.match(html, /只显示 Google Calendar 已发布状态，不会重新调度/);
  assert.match(html, /点击“调度”才会生成待发布草案/);
  assert.match(html, /id="syncButton"[^>]*>发布计划到 Google Calendar<\/button>/);
  assert.match(html, /只有点击下方按钮才会创建、更新或删除 Plan 事件。/);
});

test('page exposes one-click day availability synchronization and its state', () => {
  assert.match(html, /id="syncAvailabilityButton"[^>]*>同步本日可用时间<\/button>/);
  assert.match(html, /id="availabilitySyncStatus"/);
  assert.match(html, /当前使用本机已有的可用时间，尚未同步。/);
});

test('page cache-busts static assets after behavior changes', () => {
  assert.match(html, /href="\.\/src\/styles\.css\?v=\d{8}-[a-z0-9-]+"/);
  assert.match(html, /src="\.\/src\/main\.js\?v=\d{8}-[a-z0-9-]+"/);
});
