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
    '截止时间',
    '执行场景',
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
