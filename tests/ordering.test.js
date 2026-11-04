import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeRemovedTask, dropNeighbors, reorderDependencies } from '../src/ordering.js';

const seg = (taskId, start, end) => ({ taskId, startMinute: start, endMinute: end });
const deps = (entries) => new Map(Object.entries(entries));
const plain = (changes) => Object.fromEntries(changes);

test('dropping between two blocks names the block above and below', () => {
  const segments = [seg('a', 540, 600), seg('b', 600, 660), seg('x', 720, 780)];
  assert.deepEqual(
    dropNeighbors(segments, { taskId: 'x', dropStartMinute: 570, durationMinutes: 60, originalStartMinute: 720 }),
    { predecessorId: 'a', successorId: 'b', beforeIds: ['a'], afterIds: ['b'] }
  );
});

test('dropping at the top or bottom only sets one neighbour', () => {
  const segments = [seg('a', 540, 600), seg('x', 600, 660), seg('b', 660, 720)];
  assert.equal(dropNeighbors(segments, { taskId: 'x', dropStartMinute: 480, durationMinutes: 60 }).predecessorId, null);
  assert.equal(dropNeighbors(segments, { taskId: 'x', dropStartMinute: 480, durationMinutes: 60 }).successorId, 'a');
  assert.equal(dropNeighbors(segments, { taskId: 'x', dropStartMinute: 800, durationMinutes: 60 }).successorId, null);
});

test('dropping into the gap of a split task picks the side the block moved towards', () => {
  const segments = [seg('p', 480, 540), seg('t', 540, 600), seg('t', 660, 720), seg('x', 780, 840)];
  const up = dropNeighbors(segments, { taskId: 'x', dropStartMinute: 600, durationMinutes: 60, originalStartMinute: 780 });
  assert.equal(up.predecessorId, 'p');
  assert.equal(up.successorId, 't');

  const fromTop = [seg('x', 420, 480), ...segments.slice(0, 3), seg('q', 780, 840)];
  const down = dropNeighbors(fromTop, { taskId: 'x', dropStartMinute: 600, durationMinutes: 60, originalStartMinute: 420 });
  assert.equal(down.predecessorId, 't');
  assert.equal(down.successorId, 'q');
});

test('reordering adds predecessor and successor relations', () => {
  const { changes, error } = reorderDependencies(deps({ a: [], b: [], x: [] }), {
    taskId: 'x', predecessorId: 'a', successorId: 'b'
  });
  assert.equal(error, null);
  assert.deepEqual(plain(changes), { x: ['a'], b: ['x'] });
});

test('moving a task in front of its old predecessor reverses the relation', () => {
  const { changes, error } = reorderDependencies(deps({ q: [], x: ['q'] }), {
    taskId: 'x', successorId: 'q', afterIds: ['q']
  });
  assert.equal(error, null);
  assert.deepEqual(plain(changes), { x: [], q: ['x'] });
});

test('transitive relations that would form a cycle are removed', () => {
  // Old chain: x -> a -> p. Moving x after p must drop "a waits for x".
  const { changes, error } = reorderDependencies(deps({ x: [], a: ['x'], p: ['a'] }), {
    taskId: 'x', predecessorId: 'p'
  });
  assert.equal(error, null);
  assert.deepEqual(plain(changes), { x: ['p'], a: [] });
});

test('unrelated predecessors are kept', () => {
  const { changes } = reorderDependencies(deps({ early: [], a: [], b: [], x: ['early'] }), {
    taskId: 'x', predecessorId: 'a', successorId: 'b', beforeIds: ['early', 'a'], afterIds: ['b']
  });
  assert.deepEqual(plain(changes), { x: ['early', 'a'], b: ['x'] });
});

test('reordering without neighbours reports it', () => {
  assert.equal(reorderDependencies(deps({ x: [] }), { taskId: 'x' }).error, 'no_neighbors');
});

test('removing a task bridges its dependents to its predecessors', () => {
  const changes = bridgeRemovedTask(deps({ a: [], b: ['a'], c: ['b', 'other'], other: [] }), 'b');
  assert.deepEqual(plain(changes), { c: ['a', 'other'] });
});
