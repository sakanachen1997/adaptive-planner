import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXTS, TASK_STATUSES, createTask } from '../src/models.js';
import { scheduleDay } from '../src/scheduler.js';

const PLAN_DATE = '2026-07-06';
const NOW = '2026-07-06T08:00:00';

function block(start, end, context = CONTEXTS.WORK) {
  return {
    start: `${PLAN_DATE}T${start}:00`,
    end: `${PLAN_DATE}T${end}:00`,
    context
  };
}

function task(overrides) {
  return createTask({
    taskName: '测试任务',
    taskType: '自定义',
    desiredMinutes: 60,
    minimumMinutes: 20,
    importance: 3,
    ...overrides
  });
}

test('detects hard minimum duration conflict', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '10:00')],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '编码',
        taskType: '编码工作',
        desiredMinutes: 120,
        minimumMinutes: 45,
        importance: 5
      }),
      task({
        taskName: '学习',
        taskType: '复杂教程和学习',
        desiredMinutes: 120,
        minimumMinutes: 30,
        importance: 4
      })
    ]
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.requiredMinimumMinutes, 75);
  assert.equal(result.conflict.availableMinutes, 60);
  assert.deepEqual(result.conflict.actions, [
    '增加可用时间后重排',
    '降低部分任务最小时长后重排',
    '删除/跳过低优先级任务后重排'
  ]);
});

test('protects ordinary calendar blocks', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '12:00')],
    protectedBlocks: [{
      start: `${PLAN_DATE}T10:00:00`,
      end: `${PLAN_DATE}T10:30:00`,
      summary: 'standup'
    }],
    tasks: [
      task({
        taskName: '编码',
        taskType: '编码工作',
        desiredMinutes: 45,
        minimumMinutes: 45,
        importance: 5
      })
    ]
  });

  assert.equal(result.status, 'ok');
  assert.ok(result.segments.length > 0);
  assert.ok(result.segments.every((segment) => (
    segment.end <= `${PLAN_DATE}T10:00:00`
      || segment.start >= `${PLAN_DATE}T10:30:00`
  )));
});

test('splits work around protected calendar blocks when full allocation requires both sides', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '11:00')],
    protectedBlocks: [{
      start: `${PLAN_DATE}T09:45:00`,
      end: `${PLAN_DATE}T10:15:00`,
      summary: 'protected meeting'
    }],
    tasks: [
      task({
        taskName: '深度学习',
        desiredMinutes: 90,
        minimumMinutes: 30,
        importance: 4,
        executionContext: CONTEXTS.WORK,
        splittable: true,
        minSegmentMinutes: 30
      })
    ]
  });

  const scheduledSegments = result.segments.filter((segment) => (
    segment.status === TASK_STATUSES.SCHEDULED
  ));
  const allocatedMinutes = scheduledSegments.reduce((total, segment) => (
    total + segment.allocatedMinutes
  ), 0);

  assert.equal(result.status, 'ok');
  assert.equal(scheduledSegments.length, 2);
  assert.ok(scheduledSegments.some((segment) => segment.end <= `${PLAN_DATE}T09:45:00`));
  assert.ok(scheduledSegments.some((segment) => segment.start >= `${PLAN_DATE}T10:15:00`));
  assert.equal(allocatedMinutes, 90);
});

test('home-only tasks are not placed in work blocks', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '11:00', CONTEXTS.WORK),
      block('20:00', '22:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '运动健身',
        taskType: '运动健身',
        desiredMinutes: 60,
        minimumMinutes: 30,
        importance: 4
      })
    ]
  });

  assert.equal(result.status, 'ok');
  assert.ok(result.segments.length > 0);
  assert.ok(result.segments.every((segment) => segment.start >= `${PLAN_DATE}T20:00:00`));
});

test('completed tasks are preserved and not rescheduled', () => {
  const completedTask = task({
    taskName: '背单词',
    taskType: '背单词',
    desiredMinutes: 30,
    minimumMinutes: 10,
    importance: 3,
    status: TASK_STATUSES.COMPLETED,
    actualStart: `${PLAN_DATE}T08:00:00`,
    actualEnd: `${PLAN_DATE}T08:30:00`
  });

  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T09:00:00`,
    availableBlocks: [block('09:00', '10:00')],
    protectedBlocks: [],
    tasks: [completedTask]
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.segments, [{
    taskId: completedTask.taskId,
    taskName: '背单词',
    start: `${PLAN_DATE}T08:00:00`,
    end: `${PLAN_DATE}T08:30:00`,
    status: TASK_STATUSES.COMPLETED
  }]);
  assert.deepEqual(result.unscheduled, []);
});
