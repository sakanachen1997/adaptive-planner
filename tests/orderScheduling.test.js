import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../src/models.js';
import { scheduleDay } from '../src/scheduler.js';

const DAY = '2026-11-04';

function task(taskId, overrides = {}) {
  return createTask({
    taskId,
    taskName: taskId,
    taskType: '自定义',
    desiredMinutes: 60,
    minimumMinutes: 60,
    importance: 3,
    executionContext: 'any',
    splittable: false,
    ...overrides
  });
}

function run(tasks, blocks) {
  return scheduleDay({
    planDate: DAY,
    now: `${DAY}T07:00:00`,
    availableBlocks: blocks.map(([start, end, context = 'any']) => ({
      start: `${DAY}T${start}:00`,
      end: `${DAY}T${end}:00`,
      context
    })),
    protectedBlocks: [],
    tasks
  });
}

function ranges(schedule, taskId) {
  return schedule.segments
    .filter((segment) => segment.taskId === taskId)
    .map((segment) => `${segment.start.slice(11, 16)}-${segment.end.slice(11, 16)}`);
}

function assertOrder(schedule, before, after) {
  const end = schedule.segments.filter((s) => s.taskId === before).map((s) => s.end).sort().at(-1);
  const start = schedule.segments.filter((s) => s.taskId === after).map((s) => s.start).sort()[0];
  assert.ok(end && start && end <= start, `${before} (ends ${end}) should finish before ${after} (starts ${start})`);
}

test('a splittable predecessor is split across early blocks so its successor still fits', () => {
  const schedule = run([
    task('first', { desiredMinutes: 90, minimumMinutes: 90, splittable: true, minSegmentMinutes: 30 }),
    task('then', { dependencyTaskIds: ['first'] })
  ], [['09:00', '10:00'], ['10:30', '12:00']]);

  assert.equal(schedule.status, 'ok');
  assert.deepEqual(ranges(schedule, 'first'), ['09:00-10:00', '10:30-11:00']);
  assert.deepEqual(ranges(schedule, 'then'), ['11:00-12:00']);
});

test('earliest packing never leaves a split tail shorter than the minimum segment', () => {
  const schedule = run([
    task('first', { desiredMinutes: 80, minimumMinutes: 80, splittable: true, minSegmentMinutes: 30 }),
    task('then', { minimumMinutes: 30, desiredMinutes: 30, dependencyTaskIds: ['first'] })
  ], [['09:00', '10:05'], ['10:30', '11:30']]);

  assert.notEqual(schedule.status, 'conflict');
  for (const segment of schedule.segments.filter((s) => s.taskId === 'first')) {
    assert.ok(segment.allocatedMinutes >= 30, `segment ${segment.start} is ${segment.allocatedMinutes} min`);
  }
  assertOrder(schedule, 'first', 'then');
});

test('an order chain that alternates contexts is honored over the shared day', () => {
  const schedule = run([
    task('work-a', { executionContext: 'work', energyDemand: 'low' }),
    task('home-b', { executionContext: 'home', dependencyTaskIds: ['work-a'] }),
    task('work-c', { executionContext: 'work', energyDemand: 'high', dependencyTaskIds: ['home-b'] })
  ], [['09:00', '12:00', 'work'], ['12:00', '14:00', 'home'], ['14:00', '17:00', 'work']]);

  assert.notEqual(schedule.status, 'conflict');
  assertOrder(schedule, 'work-a', 'home-b');
  assertOrder(schedule, 'home-b', 'work-c');
});

test('a predecessor of a fixed task is kept before the fixed start', () => {
  const schedule = run([
    task('meeting', { fixed: true, fixedStart: '14:00', fixedEnd: '15:00', dependencyTaskIds: ['prep'] }),
    task('prep', { energyDemand: 'low' })
  ], [['09:00', '18:00']]);

  assert.notEqual(schedule.status, 'conflict');
  assertOrder(schedule, 'prep', 'meeting');
});

test('an impossible order before a fixed task reports the fixed successor', () => {
  const schedule = run([
    task('meeting', { fixed: true, fixedStart: '09:30', fixedEnd: '10:30', dependencyTaskIds: ['prep'] }),
    task('prep')
  ], [['09:00', '18:00']]);

  assert.equal(schedule.status, 'conflict');
  const [failure] = schedule.conflict.belowMinimum;
  assert.equal(failure.taskId, 'prep');
  assert.equal(failure.reason, 'order_too_tight');
  assert.equal(failure.successorName, 'meeting');
});


test('a predecessor is placed ahead of unrelated tasks of equal priority', () => {
  const schedule = run([
    task('alpha', { dependencyTaskIds: ['gamma'] }),
    task('beta'),
    task('gamma')
  ], [['09:00', '12:00']]);

  assert.deepEqual(ranges(schedule, 'gamma'), ['09:00-10:00']);
  assert.deepEqual(ranges(schedule, 'alpha'), ['10:00-11:00']);
  assert.deepEqual(ranges(schedule, 'beta'), ['11:00-12:00']);
});

test('a predecessor inherits the priority of the important task waiting for it', () => {
  const schedule = run([
    task('important', { importance: 5, dependencyTaskIds: ['enabler'] }),
    task('medium', { importance: 3 }),
    task('enabler', { importance: 1 })
  ], [['09:00', '12:00']]);

  assert.deepEqual(ranges(schedule, 'enabler'), ['09:00-10:00']);
  assert.deepEqual(ranges(schedule, 'important'), ['10:00-11:00']);
});

test('a splittable task is split across context windows when no single window has room', () => {
  const schedule = run([
    task('long', { desiredMinutes: 120, minimumMinutes: 120, splittable: true, minSegmentMinutes: 30 })
  ], [['09:00', '10:00', 'work'], ['19:00', '20:00', 'home']]);

  assert.notEqual(schedule.status, 'conflict');
  assert.deepEqual(ranges(schedule, 'long'), ['09:00-10:00', '19:00-20:00']);
});
