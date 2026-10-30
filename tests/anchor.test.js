import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../src/models.js';
import { scheduleDay } from '../src/scheduler.js';

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

function run(tasks, blocks = [['09:00', '18:00']], extra = {}) {
  return scheduleDay({
    planDate: '2026-10-30',
    now: '2026-10-30T07:00:00',
    availableBlocks: blocks.map(([start, end]) => ({
      start: `2026-10-30T${start}:00`,
      end: `2026-10-30T${end}:00`,
      context: 'any'
    })),
    protectedBlocks: [],
    tasks,
    ...extra
  });
}

const startOf = (schedule, taskId) => schedule.segments.find((segment) => segment.taskId === taskId)?.start.slice(11, 16);

test('createTask keeps a valid preferredStart and drops invalid ones', () => {
  assert.equal(task('a', { preferredStart: '14:30' }).preferredStart, '14:30');
  assert.equal(task('a', { preferredStart: 'later' }).preferredStart, null);
  assert.equal(task('a').preferredStart, null);
});

test('an anchored task starts at its anchor in the middle of a free block', () => {
  const schedule = run([task('a', { preferredStart: '14:30' })]);
  assert.equal(schedule.status !== 'conflict', true);
  assert.equal(startOf(schedule, 'a'), '14:30');
});

test('other tasks steer around an anchored slot when they can', () => {
  const schedule = run([
    task('anchored', { preferredStart: '09:00', importance: 1 }),
    task('other', { importance: 5 })
  ]);
  assert.equal(startOf(schedule, 'anchored'), '09:00');
  assert.notEqual(startOf(schedule, 'other'), '09:00');
});

test('anchor outside available time lands at the nearest feasible start', () => {
  const lunchGap = run([task('a', { preferredStart: '12:30' })], [['09:00', '12:00'], ['13:00', '18:00']]);
  assert.equal(startOf(lunchGap, 'a'), '13:00');

  const nearEnd = run([task('a', { preferredStart: '17:30' })]);
  assert.equal(startOf(nearEnd, 'a'), '17:00');
});

test('anchor never breaks a deadline', () => {
  const schedule = run([task('a', { preferredStart: '16:00', deadline: '2026-10-30T12:00' })]);
  assert.equal(startOf(schedule, 'a'), '11:00');
});

test('anchor yields instead of causing a conflict when time is tight', () => {
  const schedule = run([
    task('anchored', { preferredStart: '09:30' }),
    task('b'),
    task('c')
  ], [['09:00', '12:00']]);
  assert.notEqual(schedule.status, 'conflict');
  const starts = ['anchored', 'b', 'c'].map((id) => startOf(schedule, id)).sort();
  assert.deepEqual(starts, ['09:00', '10:00', '11:00']);
});

test('user-fixed tasks ignore preferredStart', () => {
  const schedule = run([task('a', { fixed: true, fixedStart: '10:00', fixedEnd: '11:00', preferredStart: '15:00' })]);
  assert.equal(startOf(schedule, 'a'), '10:00');
});
