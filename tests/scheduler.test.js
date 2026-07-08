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

function scheduledSegments(result) {
  return result.segments.filter((segment) => segment.status === TASK_STATUSES.SCHEDULED);
}

function assertNoOverlaps(segments) {
  const orderedSegments = [...segments].sort((left, right) => (
    left.start.localeCompare(right.start)
      || left.end.localeCompare(right.end)
  ));

  for (let index = 1; index < orderedSegments.length; index += 1) {
    assert.ok(
      orderedSegments[index - 1].end <= orderedSegments[index].start,
      `${orderedSegments[index - 1].taskName} overlaps ${orderedSegments[index].taskName}`
    );
  }
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

test('schedules desired overflow by computing actual durations instead of reporting conflict', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '10:30')],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '英语',
        desiredMinutes: 120,
        minimumMinutes: 20,
        importance: 4
      }),
      task({
        taskName: '数学',
        desiredMinutes: 60,
        minimumMinutes: 20,
        importance: 4
      })
    ]
  });

  const allocations = new Map(result.durationPlan.allocations.map((item) => [
    item.taskName,
    item.actualMinutes
  ]));

  assert.equal(result.status, 'ok');
  assert.equal(result.durationPlan.desiredMinutes, 180);
  assert.equal(result.durationPlan.availableMinutes, 90);
  assert.equal(allocations.get('英语') + allocations.get('数学'), 90);
});

test('actual duration model preserves incompressible tasks and distributes remaining time to flexible tasks', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('18:00', '23:00', CONTEXTS.HOME)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: 'A',
        desiredMinutes: 70,
        minimumMinutes: 70,
        executionContext: CONTEXTS.HOME,
        importance: 3
      }),
      task({
        taskName: 'B',
        desiredMinutes: 180,
        minimumMinutes: 120,
        minSegmentMinutes: 10,
        executionContext: CONTEXTS.HOME,
        importance: 3
      }),
      task({
        taskName: 'C',
        desiredMinutes: 30,
        minimumMinutes: 10,
        minSegmentMinutes: 10,
        executionContext: CONTEXTS.HOME,
        importance: 3
      }),
      task({
        taskName: 'D',
        desiredMinutes: 40,
        minimumMinutes: 20,
        minSegmentMinutes: 10,
        executionContext: CONTEXTS.HOME,
        importance: 3
      }),
      task({
        taskName: 'E',
        desiredMinutes: 30,
        minimumMinutes: 30,
        executionContext: CONTEXTS.HOME,
        importance: 3
      })
    ]
  });

  const allocations = new Map(result.durationPlan.allocations.map((item) => [
    item.taskName,
    item.actualMinutes
  ]));

  assert.equal(result.status, 'ok');
  assert.equal(result.durationPlan.desiredMinutes, 350);
  assert.equal(result.durationPlan.availableMinutes, 300);
  assert.equal(allocations.get('A'), 70);
  assert.equal(allocations.get('B'), 152);
  assert.equal(allocations.get('C'), 19);
  assert.equal(allocations.get('D'), 29);
  assert.equal(allocations.get('E'), 30);
});

test('actual duration model protects minimum durations before distributing flexible time', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '10:00')],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '英语',
        desiredMinutes: 80,
        minimumMinutes: 45,
        minSegmentMinutes: 10,
        importance: 4
      }),
      task({
        taskName: '数学',
        desiredMinutes: 20,
        minimumMinutes: 15,
        minSegmentMinutes: 10,
        importance: 4
      })
    ]
  });

  const allocations = new Map(result.durationPlan.allocations.map((item) => [
    item.taskName,
    item.actualMinutes
  ]));

  assert.equal(result.status, 'ok');
  assert.equal(allocations.get('英语'), 45);
  assert.equal(allocations.get('数学'), 15);
});

test('actual duration model takes extra time mostly from flexible tasks', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '10:20')],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '弹性大任务',
        desiredMinutes: 75,
        minimumMinutes: 45,
        importance: 4
      }),
      task({
        taskName: '弹性小任务',
        desiredMinutes: 25,
        minimumMinutes: 15,
        importance: 4
      })
    ]
  });

  const allocations = new Map(result.durationPlan.allocations.map((item) => [
    item.taskName,
    item.actualMinutes
  ]));

  assert.equal(result.status, 'ok');
  assert.equal(allocations.get('弹性大任务'), 60);
  assert.equal(allocations.get('弹性小任务'), 20);
});

test('actual duration model reduces non-splittable actual duration to fit an available block', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '10:00', CONTEXTS.WORK),
      block('10:00', '15:15', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '编码',
        taskType: '编码工作',
        desiredMinutes: 300,
        minimumMinutes: 45,
        importance: 5
      }),
      task({
        taskName: '阅读',
        taskType: '复杂教程和学习',
        desiredMinutes: 300,
        minimumMinutes: 44,
        minSegmentMinutes: 10,
        executionContext: CONTEXTS.HOME,
        importance: 4
      })
    ]
  });

  const codingSegments = scheduledSegments(result).filter((segment) => segment.taskName === '编码');
  const codingDuration = result.durationPlan.allocations.find((item) => item.taskName === '编码');

  assert.equal(result.status, 'partial');
  assert.equal(result.durationPlan.availableMinutes, 375);
  assert.equal(codingSegments.length, 1);
  assert.equal(codingSegments[0].allocatedMinutes, 60);
  assert.equal(codingDuration.actualMinutes, 60);
});

test('actual duration model reports conflict only when minimums cannot fit', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '09:50')],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '英语',
        desiredMinutes: 80,
        minimumMinutes: 45,
        importance: 4
      }),
      task({
        taskName: '数学',
        desiredMinutes: 20,
        minimumMinutes: 15,
        importance: 4
      })
    ]
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.kind, 'minimum_overflow');
  assert.equal(result.conflict.requiredMinimumMinutes, 60);
  assert.equal(result.conflict.availableMinutes, 50);
  assert.deepEqual(result.conflict.actions, [
    '增加可用时间后重排',
    '降低部分任务最小时长后重排',
    '删除/跳过低优先级任务后重排'
  ]);
});

test('does not overlap scheduled segments when available blocks overlap across contexts', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '10:00', CONTEXTS.WORK),
      block('09:00', '10:00', CONTEXTS.ANY)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '编码',
        taskType: '编码工作',
        desiredMinutes: 30,
        minimumMinutes: 30,
        importance: 5
      }),
      task({
        taskName: '运动健身',
        taskType: '运动健身',
        desiredMinutes: 30,
        minimumMinutes: 30,
        importance: 4
      })
    ]
  });

  const segments = scheduledSegments(result);

  assert.equal(result.status, 'ok');
  assert.equal(segments.length, 2);
  assertNoOverlaps(segments);
});

test('returns conflict when a task has no compatible capacity for its minimum', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '10:00', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '运动健身',
        taskType: '运动健身',
        desiredMinutes: 30,
        minimumMinutes: 30,
        importance: 4
      })
    ]
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.requiredMinimumMinutes, 30);
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

test('fixed tasks occupy their interval even when context differs from availability', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '11:00', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '固定运动',
        taskType: '运动健身',
        desiredMinutes: 30,
        minimumMinutes: 30,
        importance: 4,
        fixed: true,
        fixedStart: '09:30',
        fixedEnd: '10:00'
      }),
      task({
        taskName: '编码',
        taskType: '编码工作',
        desiredMinutes: 60,
        minimumMinutes: 45,
        importance: 5
      })
    ]
  });

  const codingSegments = scheduledSegments(result).filter((segment) => segment.taskName === '编码');

  assert.equal(result.status, 'ok');
  assert.ok(codingSegments.length > 0);
  assert.ok(codingSegments.every((segment) => (
    segment.end <= `${PLAN_DATE}T09:30:00`
      || segment.start >= `${PLAN_DATE}T10:00:00`
  )));
});

test('fixed task started before now schedules only remaining work without conflict', () => {
  const fixedTask = task({
    taskName: '固定编码',
    taskType: '编码工作',
    desiredMinutes: 60,
    minimumMinutes: 60,
    importance: 5,
    fixed: true,
    fixedStart: '09:00',
    fixedEnd: '10:00'
  });

  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T09:30:00`,
    availableBlocks: [block('09:00', '10:00', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [fixedTask]
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(scheduledSegments(result), [{
    taskId: fixedTask.taskId,
    taskName: '固定编码',
    status: TASK_STATUSES.SCHEDULED,
    start: `${PLAN_DATE}T09:30:00`,
    end: `${PLAN_DATE}T10:00:00`,
    allocatedMinutes: 30
  }]);
});

test('redistributes rounded allocation leftovers until available desired capacity is used', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '10:03', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '学习一',
        desiredMinutes: 60,
        minimumMinutes: 30,
        importance: 3,
        executionContext: CONTEXTS.WORK,
        splittable: true,
        minSegmentMinutes: 30
      }),
      task({
        taskName: '学习二',
        desiredMinutes: 60,
        minimumMinutes: 30,
        importance: 3,
        executionContext: CONTEXTS.WORK,
        splittable: true,
        minSegmentMinutes: 30
      })
    ]
  });
  const allocatedMinutes = scheduledSegments(result).reduce((total, segment) => (
    total + segment.allocatedMinutes
  ), 0);

  assert.equal(result.status, 'ok');
  assert.equal(allocatedMinutes, 63);
});

test('splittable tasks do not emit follow-up segments shorter than their minimum segment length', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '09:30', CONTEXTS.WORK),
      block('10:00', '10:20', CONTEXTS.WORK)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '短尾学习',
        desiredMinutes: 50,
        minimumMinutes: 30,
        importance: 4,
        executionContext: CONTEXTS.WORK,
        splittable: true,
        minSegmentMinutes: 30
      })
    ]
  });
  const learningSegments = scheduledSegments(result).filter((segment) => (
    segment.taskName === '短尾学习'
  ));

  assert.equal(result.status, 'partial');
  assert.ok(learningSegments.length > 0);
  assert.ok(learningSegments.every((segment) => segment.allocatedMinutes >= 30));
});

test('splittable tasks do not emit first segment shorter than their minimum segment length', () => {
  const shortTask = task({
    taskName: '短任务学习',
    desiredMinutes: 20,
    minimumMinutes: 20,
    importance: 4,
    executionContext: CONTEXTS.WORK,
    splittable: true,
    minSegmentMinutes: 30
  });
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '09:20', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [shortTask]
  });
  const shortTaskSegments = scheduledSegments(result).filter((segment) => (
    segment.taskId === shortTask.taskId
  ));

  assert.equal(result.status, 'conflict');
  assert.deepEqual(shortTaskSegments, []);
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

test('completed tasks with invalid actual times are omitted from result segments', () => {
  const completedTask = task({
    taskName: '缺少实际时间',
    taskType: '背单词',
    desiredMinutes: 30,
    minimumMinutes: 10,
    importance: 3,
    status: TASK_STATUSES.COMPLETED,
    actualStart: null,
    actualEnd: null
  });

  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T09:00:00`,
    availableBlocks: [block('09:00', '10:00')],
    protectedBlocks: [],
    tasks: [completedTask]
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.segments, []);
});
