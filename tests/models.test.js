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

test('createTask throws RangeError for invalid numeric fields', () => {
  const validInput = {
    taskName: '晚间背单词',
    taskType: '背单词',
    desiredMinutes: 60,
    minimumMinutes: 10,
    importance: 3,
    minSegmentMinutes: 10,
    externalCommitment: 1
  };

  const invalidInputs = [
    { desiredMinutes: 'later' },
    { desiredMinutes: 0 },
    { minimumMinutes: -1 },
    { importance: Number.POSITIVE_INFINITY },
    { importance: 6 },
    { minSegmentMinutes: 0 },
    { externalCommitment: -1 }
  ];

  for (const override of invalidInputs) {
    assert.throws(() => createTask({ ...validInput, ...override }), RangeError);
  }
});

test('createTask normalizes unknown task types to custom defaults', () => {
  const task = createTask({
    taskName: '临时任务',
    taskType: '不存在的类型',
    desiredMinutes: 30,
    minimumMinutes: 10,
    importance: 3
  });

  assert.equal(task.taskType, '自定义');
  assert.equal(task.energyDemand, TASK_TYPE_DEFAULTS['自定义'].energyDemand);
  assert.equal(task.minSegmentMinutes, TASK_TYPE_DEFAULTS['自定义'].minSegmentMinutes);
});

test('createTask trims taskName and rejects blank taskName', () => {
  const task = createTask({
    taskName: '  晚间背单词  ',
    taskType: '背单词',
    desiredMinutes: 60,
    minimumMinutes: 10,
    importance: 3
  });

  assert.equal(task.taskName, '晚间背单词');
  assert.throws(() => createTask({
    taskName: '   ',
    taskType: '背单词',
    desiredMinutes: 60,
    minimumMinutes: 10,
    importance: 3
  }), RangeError);
});

test('task type defaults and nested defaults are frozen', () => {
  assert.equal(Object.isFrozen(TASK_TYPE_DEFAULTS), true);
  assert.equal(Object.isFrozen(TASK_TYPE_DEFAULTS['编码工作']), true);
});
