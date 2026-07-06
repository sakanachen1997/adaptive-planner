import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXTS, createTask } from '../src/models.js';
import { calculatePriority, scorePlacement } from '../src/priority.js';

test('high-importance near-deadline drawing commission outranks relaxed gaming', () => {
  const now = '2026-07-06T09:00:00';
  const drawingCommission = createTask({
    taskName: '绘画委托副业交付',
    taskType: '绘画委托副业',
    desiredMinutes: 90,
    minimumMinutes: 30,
    importance: 5,
    deadline: '2026-07-06T13:00:00'
  });
  const relaxedGaming = createTask({
    taskName: '放松打游戏',
    taskType: '打游戏',
    desiredMinutes: 30,
    minimumMinutes: 30,
    importance: 1
  });

  assert.ok(calculatePriority(drawingCommission, now) > calculatePriority(relaxedGaming, now));
});

test('placement score prefers morning work slot for high-cognitive coding work over evening home slot', () => {
  const codingWork = createTask({
    taskName: '编码工作深度块',
    taskType: '编码工作',
    desiredMinutes: 90,
    minimumMinutes: 45,
    importance: 5
  });
  const morningWork = {
    start: '2026-07-06T09:00:00',
    end: '2026-07-06T10:30:00',
    context: CONTEXTS.WORK
  };
  const eveningHome = {
    start: '2026-07-06T18:00:00',
    end: '2026-07-06T19:30:00',
    context: CONTEXTS.HOME
  };

  assert.ok(scorePlacement(codingWork, morningWork) > scorePlacement(codingWork, eveningHome));
});
