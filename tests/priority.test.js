import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXTS, createTask } from '../src/models.js';
import { calculatePriority, calculateUrgency, scorePlacement } from '../src/priority.js';

function scoreTestTask(energyDemand) {
  return {
    energyDemand,
    executionContext: CONTEXTS.WORK,
    splittable: false
  };
}

function scoreTestInterval(start) {
  return {
    start,
    end: '2026-07-06T23:00:00',
    context: CONTEXTS.WORK
  };
}

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

test('placement score gives exact energy contribution for high slot and high task', () => {
  assert.equal(scorePlacement(
    scoreTestTask('high'),
    scoreTestInterval('2026-07-06T09:00:00')
  ), 25);
});

test('placement score gives exact energy contribution for medium slot and medium task', () => {
  assert.equal(scorePlacement(
    scoreTestTask('medium'),
    scoreTestInterval('2026-07-06T12:00:00')
  ), 25);
});

test('placement score gives exact energy contribution for low slot and low task', () => {
  assert.equal(scorePlacement(
    scoreTestTask('low'),
    scoreTestInterval('2026-07-06T15:00:00')
  ), 25);
});

test('placement score prefers low slot over high slot for low-energy tasks with same context', () => {
  const lowEnergyTask = scoreTestTask('low');

  assert.ok(
    scorePlacement(lowEnergyTask, scoreTestInterval('2026-07-06T09:00:00'))
      < scorePlacement(lowEnergyTask, scoreTestInterval('2026-07-06T15:00:00'))
  );
});

test('placement score covers every required slot energy and task energy matrix cell', () => {
  const cases = [
    { slotEnergy: 'high', start: '2026-07-06T09:00:00', taskEnergy: 'high', energyScore: 5 },
    { slotEnergy: 'high', start: '2026-07-06T09:00:00', taskEnergy: 'mediumHigh', energyScore: 4 },
    { slotEnergy: 'high', start: '2026-07-06T09:00:00', taskEnergy: 'medium', energyScore: 3 },
    { slotEnergy: 'high', start: '2026-07-06T09:00:00', taskEnergy: 'mediumLow', energyScore: 2 },
    { slotEnergy: 'high', start: '2026-07-06T09:00:00', taskEnergy: 'low', energyScore: 1 },
    { slotEnergy: 'medium', start: '2026-07-06T12:30:00', taskEnergy: 'high', energyScore: 3 },
    { slotEnergy: 'medium', start: '2026-07-06T12:30:00', taskEnergy: 'mediumHigh', energyScore: 4 },
    { slotEnergy: 'medium', start: '2026-07-06T12:30:00', taskEnergy: 'medium', energyScore: 5 },
    { slotEnergy: 'medium', start: '2026-07-06T12:30:00', taskEnergy: 'mediumLow', energyScore: 4 },
    { slotEnergy: 'medium', start: '2026-07-06T12:30:00', taskEnergy: 'low', energyScore: 3 },
    { slotEnergy: 'low', start: '2026-07-06T15:00:00', taskEnergy: 'high', energyScore: 1 },
    { slotEnergy: 'low', start: '2026-07-06T15:00:00', taskEnergy: 'mediumHigh', energyScore: 2 },
    { slotEnergy: 'low', start: '2026-07-06T15:00:00', taskEnergy: 'medium', energyScore: 3 },
    { slotEnergy: 'low', start: '2026-07-06T15:00:00', taskEnergy: 'mediumLow', energyScore: 5 },
    { slotEnergy: 'low', start: '2026-07-06T15:00:00', taskEnergy: 'low', energyScore: 5 }
  ];

  for (const { slotEnergy, start, taskEnergy, energyScore } of cases) {
    assert.equal(
      scorePlacement(scoreTestTask(taskEnergy), scoreTestInterval(start)),
      energyScore * 4 + 5,
      `${slotEnergy} slot with ${taskEnergy} task`
    );
  }
});

test('urgency uses wall-clock minutes across DST start', () => {
  assert.equal(calculateUrgency('2026-03-29T07:00:00', '2026-03-29T01:30:00'), 5);
});

test('urgency ignores offset suffixes for wall-clock bucket boundaries', () => {
  assert.equal(calculateUrgency('2026-07-06T15:00:00', '2026-07-06T09:00:00+05:00'), 5);
});
