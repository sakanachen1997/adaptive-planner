import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXTS, TASK_TYPE_DEFAULTS, createTask } from '../src/models.js';

test('task type defaults include core user task types', () => {
  assert.equal(TASK_TYPE_DEFAULTS['编码工作'].energyDemand, 'high');
  assert.equal(TASK_TYPE_DEFAULTS['背单词'].splittable, true);
  assert.equal(TASK_TYPE_DEFAULTS['运动健身'].executionContext, CONTEXTS.HOME);
  assert.equal(TASK_TYPE_DEFAULTS['绘画委托副业'].externalCommitment, 4);
});

test('createTask applies defaults and explicit overrides for vocabulary tasks', () => {
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
