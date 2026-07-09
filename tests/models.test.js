import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXTS, TASK_DEPTHS, TASK_TYPE_DEFAULTS, createTask } from '../src/models.js';

test('task type defaults include core user task types', () => {
  assert.equal(TASK_TYPE_DEFAULTS['编码工作'].energyDemand, 'high');
  assert.equal(TASK_TYPE_DEFAULTS['编码工作'].depth, TASK_DEPTHS.DEEP);
  assert.equal(TASK_TYPE_DEFAULTS['背单词'].splittable, true);
  assert.equal(TASK_TYPE_DEFAULTS['背单词'].depth, TASK_DEPTHS.SHALLOW);
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
  assert.equal(task.depth, TASK_DEPTHS.SHALLOW);
});

test('createTask accepts explicit depth overrides', () => {
  const task = createTask({
    taskName: '战略复盘',
    taskType: '自定义',
    desiredMinutes: 60,
    minimumMinutes: 30,
    importance: 4,
    depth: TASK_DEPTHS.DEEP
  });

  assert.equal(task.depth, TASK_DEPTHS.DEEP);
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

test('createTask throws RangeError when minimumMinutes exceeds desiredMinutes', () => {
  assert.throws(() => createTask({
    taskName: '晚间背单词',
    taskType: '背单词',
    desiredMinutes: 30,
    minimumMinutes: 45,
    importance: 3
  }), RangeError);
});

test('createTask rejects boolean numeric input', () => {
  const validInput = {
    taskName: '晚间背单词',
    taskType: '背单词',
    desiredMinutes: 60,
    minimumMinutes: 10,
    importance: 3,
    minSegmentMinutes: 10,
    externalCommitment: 1
  };

  for (const field of ['desiredMinutes', 'minimumMinutes', 'importance', 'minSegmentMinutes', 'externalCommitment']) {
    assert.throws(() => createTask({ ...validInput, [field]: true }), RangeError);
  }
});

test('createTask rejects blank string numeric input', () => {
  const validInput = {
    taskName: '晚间背单词',
    taskType: '背单词',
    desiredMinutes: 60,
    minimumMinutes: 10,
    importance: 3,
    minSegmentMinutes: 10,
    externalCommitment: 1
  };

  for (const field of ['desiredMinutes', 'minimumMinutes', 'importance', 'minSegmentMinutes', 'externalCommitment']) {
    assert.throws(() => createTask({ ...validInput, [field]: '   ' }), RangeError);
  }
});

test('createTask rejects non-number and non-string numeric input', () => {
  const validInput = {
    taskName: '晚间背单词',
    taskType: '背单词',
    desiredMinutes: 60,
    minimumMinutes: 10,
    importance: 3,
    minSegmentMinutes: 10,
    externalCommitment: 1
  };

  for (const value of [null, undefined, [], {}]) {
    for (const field of ['desiredMinutes', 'minimumMinutes', 'importance', 'minSegmentMinutes', 'externalCommitment']) {
      assert.throws(() => createTask({ ...validInput, [field]: value }), RangeError);
    }
  }
});

test('createTask accepts non-blank numeric strings from form data', () => {
  const task = createTask({
    taskName: '晚间背单词',
    taskType: '背单词',
    desiredMinutes: '60',
    minimumMinutes: '10',
    importance: '3',
    minSegmentMinutes: '15',
    externalCommitment: '2'
  });

  assert.equal(task.desiredMinutes, 60);
  assert.equal(task.minimumMinutes, 10);
  assert.equal(task.importance, 3);
  assert.equal(task.minSegmentMinutes, 15);
  assert.equal(task.externalCommitment, 2);
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
  for (const defaults of Object.values(TASK_TYPE_DEFAULTS)) {
    assert.equal(Object.isFrozen(defaults), true);
  }
});

test('createTask derives order preference from task type circadian defaults', () => {
  const gaming = createTask({
    taskName: '打游戏',
    taskType: '打游戏',
    desiredMinutes: 60,
    minimumMinutes: 30,
    importance: 2
  });
  const coding = createTask({
    taskName: '编码',
    taskType: '编码工作',
    desiredMinutes: 60,
    minimumMinutes: 45,
    importance: 5
  });

  assert.equal(gaming.orderPreference, 'evening');
  assert.equal(coding.orderPreference, 'morning');
});

test('createTask accepts an explicit order preference override', () => {
  const task = createTask({
    taskName: '晨间游戏',
    taskType: '打游戏',
    desiredMinutes: 60,
    minimumMinutes: 30,
    importance: 2,
    orderPreference: 'morning'
  });

  assert.equal(task.orderPreference, 'morning');
});
