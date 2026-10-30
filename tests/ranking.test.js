import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../src/models.js';
import { calculatePriority } from '../src/priority.js';
import { applyRanking, moveInOrder, rankPriorityOverrides, rankedTaskOrder } from '../src/ranking.js';
import { scheduleDay } from '../src/scheduler.js';

function task(taskId, overrides = {}) {
  return createTask({
    taskId,
    taskName: taskId,
    taskType: '自定义',
    desiredMinutes: 60,
    minimumMinutes: 30,
    importance: 3,
    ...overrides
  });
}

test('without a saved ranking, tasks are unchanged', () => {
  const tasks = [task('a'), task('b')];
  assert.equal(applyRanking(tasks, null), tasks);
});

test('initial order follows numeric priority; unranked tasks are inserted by score', () => {
  const tasks = [task('low', { importance: 1 }), task('high', { importance: 5 }), task('mid')];
  assert.deepEqual(rankedTaskOrder(tasks, []), ['high', 'mid', 'low']);
  // user moved low to the top; a new mid-scoring task lands above "low"-scoring ones only
  assert.deepEqual(rankedTaskOrder(tasks, ['low', 'high']), ['low', 'high', 'mid']);
});

test('completed, skipped and stale ids are ignored', () => {
  const tasks = [task('a'), task('done', { status: 'completed' }), task('skip', { status: 'skipped' })];
  assert.deepEqual(rankedTaskOrder(tasks, ['gone', 'done', 'a']), ['a']);
});

test('rank overrides are strictly decreasing even when numeric fields are equal', () => {
  const tasks = [task('a'), task('b'), task('c')];
  const overrides = rankPriorityOverrides(tasks, ['c', 'a', 'b']);
  assert.ok(overrides.get('c') > overrides.get('a'));
  assert.ok(overrides.get('a') > overrides.get('b'));
  assert.ok(overrides.get('b') >= 1);
});

test('ranking overrides the numeric priority', () => {
  const tasks = [task('important', { importance: 5, urgency: 6 }), task('minor', { importance: 1 })];
  const ranked = applyRanking(tasks, ['minor', 'important']);
  const byId = Object.fromEntries(ranked.map((item) => [item.taskId, item]));
  assert.ok(calculatePriority(byId.minor) > calculatePriority(byId.important));
  assert.equal(byId.important.importance, 5, 'numeric fields are kept');
});

test('scheduler protects the top-ranked task when time is short', () => {
  const tasks = [
    task('important', { importance: 5, desiredMinutes: 120, minimumMinutes: 30 }),
    task('minor', { importance: 1, desiredMinutes: 120, minimumMinutes: 30 })
  ];
  const input = {
    planDate: '2026-10-30',
    now: '2026-10-30T07:00:00',
    availableBlocks: [{ start: '2026-10-30T09:00:00', end: '2026-10-30T11:00:00', context: 'any' }],
    protectedBlocks: []
  };
  const minutesFor = (schedule, taskId) => schedule.segments
    .filter((segment) => segment.taskId === taskId)
    .reduce((sum, segment) => sum + (Date.parse(segment.end) - Date.parse(segment.start)) / 60000, 0);

  const numeric = scheduleDay({ ...input, tasks });
  const ranked = scheduleDay({ ...input, tasks: applyRanking(tasks, ['minor', 'important']) });

  assert.ok(minutesFor(numeric, 'important') > minutesFor(numeric, 'minor'));
  assert.ok(minutesFor(ranked, 'minor') > minutesFor(ranked, 'important'));
});

test('moveInOrder moves within bounds', () => {
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
});
