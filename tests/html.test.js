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
    '截止时间（任务须在此之前完成）',
    '执行场景',
    '精力需求',
    '体力需求',
    '顺序偏好',
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

test('page exposes a persistent scheduling button instead of a compression action', () => {
  assert.match(html, /id="rescheduleButton"[^>]*>调度<\/button>/);
  assert.doesNotMatch(html, />一键按比例压缩<\/button>/);
});

test('page exposes a debug report copy button', () => {
  assert.match(html, /id="copyDebugButton"[^>]*>复制调试信息<\/button>/);
});
