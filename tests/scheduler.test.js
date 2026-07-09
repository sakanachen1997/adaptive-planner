import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXTS, TASK_DEPTHS, TASK_STATUSES, createTask } from '../src/models.js';
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

test('schedules a short splittable task even when type min segment exceeds actual duration', () => {
  const result = scheduleDay({
    planDate: '2026-07-08',
    now: '2026-07-08T12:09:12',
    availableBlocks: [
      {
        start: '2026-07-08T08:00:00',
        end: '2026-07-08T16:57:00',
        context: CONTEXTS.WORK
      },
      {
        start: '2026-07-08T17:20:00',
        end: '2026-07-08T23:00:00',
        context: CONTEXTS.HOME
      }
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: 'supermemo',
        taskType: '复杂教程和学习',
        desiredMinutes: 20,
        minimumMinutes: 5,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 25,
        importance: 1
      })
    ]
  });

  const segments = scheduledSegments(result);
  const actualDuration = result.durationPlan.allocations.find((item) => item.taskName === 'supermemo');

  assert.equal(result.status, 'ok');
  assert.equal(segments.length, 1);
  assert.equal(segments[0].allocatedMinutes, 20);
  assert.equal(actualDuration.actualMinutes, 20);
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

test('buffer ratio reserves slack from desired time without violating minimums', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    bufferRatio: 0.2,
    availableBlocks: [block('09:00', '10:40', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: 'deep work',
        desiredMinutes: 100,
        minimumMinutes: 60,
        importance: 5,
        executionContext: CONTEXTS.WORK,
        depth: TASK_DEPTHS.DEEP
      })
    ]
  });

  const segment = scheduledSegments(result)[0];

  assert.equal(result.status, 'ok');
  assert.equal(segment.allocatedMinutes, 80);
  assert.equal(result.durationPlan.availableMinutes, 100);
});

test('buffer ratio is ignored before it can push tasks below their minimums', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    bufferRatio: 0.2,
    availableBlocks: [block('09:00', '10:40', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: 'minimum protected',
        desiredMinutes: 100,
        minimumMinutes: 90,
        importance: 5,
        executionContext: CONTEXTS.WORK,
        depth: TASK_DEPTHS.DEEP
      })
    ]
  });

  const segment = scheduledSegments(result)[0];

  assert.equal(result.status, 'ok');
  assert.equal(segment.allocatedMinutes, 90);
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

test('deep tasks choose high-energy windows before shallow tasks', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '10:00', CONTEXTS.WORK),
      block('15:00', '16:00', CONTEXTS.WORK)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: 'email batch',
        desiredMinutes: 60,
        minimumMinutes: 60,
        importance: 3,
        executionContext: CONTEXTS.WORK,
        energyDemand: 'low',
        depth: TASK_DEPTHS.SHALLOW
      }),
      task({
        taskName: 'architecture',
        desiredMinutes: 60,
        minimumMinutes: 60,
        importance: 3,
        executionContext: CONTEXTS.WORK,
        energyDemand: 'high',
        depth: TASK_DEPTHS.DEEP
      })
    ]
  });

  const byTask = new Map(scheduledSegments(result).map((segment) => [segment.taskName, segment]));

  assert.equal(result.status, 'ok');
  assert.equal(byTask.get('architecture').start, `${PLAN_DATE}T09:00:00`);
  assert.equal(byTask.get('email batch').start, `${PLAN_DATE}T15:00:00`);
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

test('scheduleStart can keep a started fixed task anchored instead of clipping to now', () => {
  const fixedTask = task({
    taskName: 'anchored fixed task',
    taskType: 'ç¼–ç å·¥ä½œ',
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
    scheduleStart: `${PLAN_DATE}T00:00:00`,
    availableBlocks: [block('09:00', '10:00', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [fixedTask]
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(scheduledSegments(result), [{
    taskId: fixedTask.taskId,
    taskName: 'anchored fixed task',
    status: TASK_STATUSES.SCHEDULED,
    start: `${PLAN_DATE}T09:00:00`,
    end: `${PLAN_DATE}T10:00:00`,
    allocatedMinutes: 60
  }]);
});

test('completed actual time is unavailable when scheduleStart preserves earlier blocks', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T10:00:00`,
    scheduleStart: `${PLAN_DATE}T00:00:00`,
    availableBlocks: [block('09:00', '11:00', CONTEXTS.WORK)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: 'completed coding',
        desiredMinutes: 30,
        minimumMinutes: 30,
        status: TASK_STATUSES.COMPLETED,
        actualStart: `${PLAN_DATE}T09:00:00`,
        actualEnd: `${PLAN_DATE}T09:30:00`
      }),
      task({
        taskName: 'next coding',
        desiredMinutes: 60,
        minimumMinutes: 60,
        executionContext: CONTEXTS.WORK
      })
    ]
  });

  const nextSegment = scheduledSegments(result).find((segment) => segment.taskName === 'next coding');

  assert.equal(result.status, 'ok');
  assert.equal(nextSegment.start, `${PLAN_DATE}T09:30:00`);
  assert.equal(nextSegment.end, `${PLAN_DATE}T10:30:00`);
  assertNoOverlaps(result.segments);
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
  assert.deepEqual(result.unscheduled, [{
    taskId: result.unscheduled[0].taskId,
    taskName: '短尾学习',
    plannedMinutes: 50,
    scheduledMinutes: 30,
    minimumMinutes: 30,
    remainingMinutes: 20,
    candidateBlocks: [{
      start: `${PLAN_DATE}T09:00:00`,
      end: `${PLAN_DATE}T09:30:00`,
      context: CONTEXTS.WORK,
      usableMinutes: 30
    }, {
      start: `${PLAN_DATE}T10:00:00`,
      end: `${PLAN_DATE}T10:20:00`,
      context: CONTEXTS.WORK,
      usableMinutes: 20
    }]
  }]);
});

test('splittable task shorter than its minimum segment length can be scheduled as one full segment', () => {
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

  assert.equal(result.status, 'ok');
  assert.deepEqual(shortTaskSegments, [{
    taskId: shortTask.taskId,
    taskName: shortTask.taskName,
    status: TASK_STATUSES.SCHEDULED,
    start: `${PLAN_DATE}T09:00:00`,
    end: `${PLAN_DATE}T09:20:00`,
    allocatedMinutes: 20
  }]);
});

test('fixed task splitting an evening block does not starve other tasks below their minimums', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T09:52:00`,
    availableBlocks: [
      block('09:00', '18:00', CONTEXTS.WORK),
      block('17:20', '19:30', CONTEXTS.HOME),
      block('19:30', '23:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: 'A',
        taskType: '背单词',
        desiredMinutes: 70,
        minimumMinutes: 70,
        importance: 3,
        executionContext: CONTEXTS.HOME
      }),
      task({
        taskName: 'B',
        taskType: '打游戏',
        desiredMinutes: 40,
        minimumMinutes: 40,
        importance: 3
      }),
      task({
        taskName: 'C',
        desiredMinutes: 110,
        minimumMinutes: 110,
        importance: 3,
        fixed: true,
        fixedStart: '19:30',
        fixedEnd: '21:20'
      })
    ]
  });

  const minutesByTask = new Map();
  for (const segment of scheduledSegments(result)) {
    minutesByTask.set(
      segment.taskName,
      (minutesByTask.get(segment.taskName) ?? 0) + segment.allocatedMinutes
    );
  }

  assert.equal(result.status, 'ok');
  assert.equal(minutesByTask.get('A'), 70);
  assert.equal(minutesByTask.get('B'), 40);
  assert.equal(minutesByTask.get('C'), 110);
  assertNoOverlaps(scheduledSegments(result));
});

test('splittable task prefers a block that fits the whole duration over splitting into an unusable tail', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('17:20', '19:30', CONTEXTS.HOME),
      block('22:30', '23:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '打游戏',
        taskType: '打游戏',
        desiredMinutes: 40,
        minimumMinutes: 40,
        importance: 3
      })
    ]
  });

  const segments = scheduledSegments(result);

  assert.equal(result.status, 'ok');
  assert.equal(segments.length, 1);
  assert.equal(segments[0].allocatedMinutes, 40);
  assert.ok(segments[0].end <= `${PLAN_DATE}T19:30:00`);
});

test('placement failure conflict identifies the failing task instead of reporting minimum overflow', () => {
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
  assert.equal(result.conflict.kind, 'placement_failure');
  assert.equal(result.conflict.belowMinimum.length, 1);
  assert.equal(result.conflict.belowMinimum[0].taskName, '运动健身');
  assert.equal(result.conflict.belowMinimum[0].minimumMinutes, 30);
  assert.equal(result.conflict.belowMinimum[0].scheduledMinutes, 0);
  assert.deepEqual(result.conflict.belowMinimum[0].candidateBlocks, []);
});

test('task with a same-day deadline finishes before the deadline even when a later block scores higher', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '12:00', CONTEXTS.ANY),
      block('21:00', '23:00', CONTEXTS.ANY)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '买菜',
        taskType: '生活杂务',
        desiredMinutes: 60,
        minimumMinutes: 30,
        importance: 3,
        deadline: `${PLAN_DATE}T12:00:00`
      })
    ]
  });

  const segments = scheduledSegments(result);

  assert.equal(result.status, 'ok');
  assert.ok(segments.length > 0);
  assert.ok(segments.every((segment) => segment.end <= `${PLAN_DATE}T12:00:00`));
});

test('deadline that cannot be met reports a placement failure naming the task', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('14:00', '18:00', CONTEXTS.ANY)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '买菜',
        taskType: '生活杂务',
        desiredMinutes: 60,
        minimumMinutes: 30,
        importance: 3,
        deadline: `${PLAN_DATE}T12:00:00`
      })
    ]
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.kind, 'placement_failure');
  assert.equal(result.conflict.belowMinimum[0].taskName, '买菜');
});

test('deadline inside a block truncates placement instead of running past the deadline', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '18:00', CONTEXTS.ANY)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '买菜',
        taskType: '生活杂务',
        desiredMinutes: 120,
        minimumMinutes: 30,
        importance: 3,
        deadline: `${PLAN_DATE}T10:00:00`
      })
    ]
  });

  const segments = scheduledSegments(result);
  const placedMinutes = segments.reduce((sum, segment) => sum + segment.allocatedMinutes, 0);

  assert.ok(segments.every((segment) => segment.end <= `${PLAN_DATE}T10:00:00`));
  assert.equal(placedMinutes, 60);
});

test('auto-locked calendar task violating its deadline is unlocked and rescheduled before the deadline', () => {
  const eat = {
    ...task({
      taskName: '吃饭',
      taskType: '生活杂务',
      desiredMinutes: 70,
      minimumMinutes: 70,
      importance: 3,
      deadline: `${PLAN_DATE}T19:30:00`
    }),
    fixed: true,
    autoFixed: true,
    fixedStart: '21:20',
    fixedEnd: '22:30'
  };

  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T10:00:00`,
    availableBlocks: [block('17:20', '23:00', CONTEXTS.HOME)],
    protectedBlocks: [],
    tasks: [
      eat,
      task({
        taskName: '芭蕾',
        taskType: '运动健身',
        desiredMinutes: 110,
        minimumMinutes: 110,
        importance: 3,
        fixed: true,
        fixedStart: '19:30',
        fixedEnd: '21:20'
      })
    ]
  });

  const eatSegments = scheduledSegments(result).filter((segment) => segment.taskName === '吃饭');

  assert.equal(result.status, 'ok');
  assert.ok(eatSegments.length > 0);
  assert.ok(eatSegments.every((segment) => segment.end <= `${PLAN_DATE}T19:30:00`));
});

test('user-fixed task whose fixed time violates its deadline reports a deadline violation conflict', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T10:00:00`,
    availableBlocks: [block('17:20', '23:00', CONTEXTS.HOME)],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '吃饭',
        taskType: '生活杂务',
        desiredMinutes: 70,
        minimumMinutes: 70,
        importance: 3,
        deadline: `${PLAN_DATE}T19:30:00`,
        fixed: true,
        fixedStart: '21:20',
        fixedEnd: '22:30'
      })
    ]
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.kind, 'deadline_violation');
  assert.equal(result.conflict.deadlineViolations.length, 1);
  assert.equal(result.conflict.deadlineViolations[0].taskName, '吃饭');
  assert.equal(result.conflict.deadlineViolations[0].deadline, `${PLAN_DATE}T19:30:00`);
});

test('deadline-constrained tasks get their windows before higher-priority unconstrained tasks', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T12:23:00`,
    availableBlocks: [
      block('09:00', '18:00', CONTEXTS.WORK),
      block('17:20', '23:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '家务',
        taskType: '生活杂务',
        desiredMinutes: 40,
        minimumMinutes: 10,
        importance: 3
      }),
      task({
        taskName: '芭蕾',
        taskType: '运动健身',
        desiredMinutes: 110,
        minimumMinutes: 110,
        importance: 3,
        fixed: true,
        fixedStart: '19:30',
        fixedEnd: '21:20'
      }),
      task({
        taskName: '买菜',
        taskType: '生活杂务',
        desiredMinutes: 40,
        minimumMinutes: 40,
        importance: 3,
        executionContext: CONTEXTS.HOME,
        deadline: `${PLAN_DATE}T21:00:00`
      }),
      task({
        taskName: '吃饭',
        taskType: '生活杂务',
        desiredMinutes: 70,
        minimumMinutes: 70,
        importance: 3,
        executionContext: CONTEXTS.HOME,
        deadline: `${PLAN_DATE}T19:30:00`
      }),
      task({
        taskName: '莉莉安娜',
        taskType: '绘画委托副业',
        desiredMinutes: 50,
        minimumMinutes: 30,
        importance: 5
      })
    ]
  });

  const minutesByTask = new Map();
  for (const segment of scheduledSegments(result)) {
    minutesByTask.set(
      segment.taskName,
      (minutesByTask.get(segment.taskName) ?? 0) + segment.allocatedMinutes
    );
  }
  const eatSegments = scheduledSegments(result).filter((segment) => segment.taskName === '吃饭');
  const shopSegments = scheduledSegments(result).filter((segment) => segment.taskName === '买菜');

  assert.notEqual(result.status, 'conflict');
  assert.ok(minutesByTask.get('吃饭') >= 70);
  assert.ok(minutesByTask.get('买菜') >= 40);
  assert.ok(minutesByTask.get('芭蕾') >= 110);
  assert.ok(minutesByTask.get('莉莉安娜') >= 30);
  assert.ok(minutesByTask.get('家务') >= 10);
  assert.ok(eatSegments.every((segment) => segment.end <= `${PLAN_DATE}T19:30:00`));
  assert.ok(shopSegments.every((segment) => segment.end <= `${PLAN_DATE}T21:00:00`));
  assertNoOverlaps(scheduledSegments(result));
});

test('placement failure triggers proportional compression instead of a conflict', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '12:00', CONTEXTS.WORK),
      block('18:00', '20:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '高优先弹性',
        desiredMinutes: 100,
        minimumMinutes: 40,
        importance: 5,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 20
      }),
      task({
        taskName: '低优先弹性',
        desiredMinutes: 60,
        minimumMinutes: 30,
        importance: 1,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 20
      })
    ]
  });

  const minutesByTask = new Map();
  for (const segment of scheduledSegments(result)) {
    minutesByTask.set(
      segment.taskName,
      (minutesByTask.get(segment.taskName) ?? 0) + segment.allocatedMinutes
    );
  }

  assert.notEqual(result.status, 'conflict');
  assert.ok(minutesByTask.get('高优先弹性') >= 40);
  assert.ok(minutesByTask.get('低优先弹性') >= 30);
  assert.ok(minutesByTask.get('高优先弹性') > minutesByTask.get('低优先弹性'));
  assertNoOverlaps(scheduledSegments(result));
});

test('compression only takes time from tasks competing for the same window', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '12:00', CONTEXTS.WORK),
      block('18:00', '20:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '住家弹性',
        desiredMinutes: 100,
        minimumMinutes: 40,
        importance: 5,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 20
      }),
      task({
        taskName: '工作任务',
        desiredMinutes: 120,
        minimumMinutes: 60,
        importance: 4,
        executionContext: CONTEXTS.WORK,
        splittable: true,
        minSegmentMinutes: 20
      }),
      task({
        taskName: '被挤压者',
        desiredMinutes: 60,
        minimumMinutes: 60,
        importance: 3,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 20
      })
    ]
  });

  const minutesByTask = new Map();
  for (const segment of scheduledSegments(result)) {
    minutesByTask.set(
      segment.taskName,
      (minutesByTask.get(segment.taskName) ?? 0) + segment.allocatedMinutes
    );
  }

  assert.notEqual(result.status, 'conflict');
  assert.equal(minutesByTask.get('被挤压者'), 60);
  assert.equal(minutesByTask.get('住家弹性'), 60);
  assert.equal(minutesByTask.get('工作任务'), 120);
});

test('home compression does not shorten any-context tasks already placed at work', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: `${PLAN_DATE}T09:21:00`,
    availableBlocks: [
      block('08:00', '16:30', CONTEXTS.WORK),
      block('17:20', '23:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: 'lunch',
        desiredMinutes: 45,
        minimumMinutes: 45,
        fixed: true,
        fixedStart: '12:00',
        fixedEnd: '12:45',
        executionContext: CONTEXTS.ANY
      }),
      task({
        taskName: 'dinner',
        desiredMinutes: 60,
        minimumMinutes: 60,
        executionContext: CONTEXTS.HOME,
        deadline: `${PLAN_DATE}T19:00:00`
      }),
      task({
        taskName: 'drawing',
        desiredMinutes: 80,
        minimumMinutes: 50,
        importance: 5,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 30
      }),
      task({
        taskName: 'fitness',
        desiredMinutes: 140,
        minimumMinutes: 140,
        executionContext: CONTEXTS.HOME,
        splittable: false
      }),
      task({
        taskName: 'exam',
        desiredMinutes: 40,
        minimumMinutes: 40,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 25
      }),
      task({
        taskName: 'chores',
        desiredMinutes: 20,
        minimumMinutes: 10,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 10
      }),
      task({
        taskName: 'driving',
        desiredMinutes: 30,
        minimumMinutes: 15,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 15
      }),
      task({
        taskName: 'coding',
        desiredMinutes: 80,
        minimumMinutes: 60,
        importance: 4,
        executionContext: CONTEXTS.WORK,
        splittable: false,
        orderPreference: 'morning'
      }),
      task({
        taskName: 'initramfs reading',
        desiredMinutes: 60,
        minimumMinutes: 40,
        executionContext: CONTEXTS.ANY,
        splittable: true,
        minSegmentMinutes: 25,
        orderPreference: 'morning',
        energyDemand: 'high'
      }),
      task({
        taskName: 'script reading',
        desiredMinutes: 60,
        minimumMinutes: 40,
        executionContext: CONTEXTS.ANY,
        splittable: true,
        minSegmentMinutes: 30,
        orderPreference: 'morning',
        energyDemand: 'high'
      }),
      task({
        taskName: 'incremental reading',
        desiredMinutes: 80,
        minimumMinutes: 50,
        executionContext: CONTEXTS.ANY,
        splittable: true,
        minSegmentMinutes: 25,
        orderPreference: 'morning',
        energyDemand: 'high'
      }),
      task({
        taskName: 'vocabulary',
        desiredMinutes: 30,
        minimumMinutes: 30,
        executionContext: CONTEXTS.ANY,
        splittable: true,
        minSegmentMinutes: 10
      })
    ]
  });

  const minutesByTask = new Map();
  for (const segment of scheduledSegments(result)) {
    minutesByTask.set(
      segment.taskName,
      (minutesByTask.get(segment.taskName) ?? 0) + segment.allocatedMinutes
    );
  }

  assert.notEqual(result.status, 'conflict');
  assert.equal(minutesByTask.get('incremental reading'), 80);
  assert.equal(minutesByTask.get('initramfs reading'), 60);
  assert.equal(minutesByTask.get('script reading'), 60);
  assert.equal(minutesByTask.get('vocabulary'), 30);
  assert.ok(minutesByTask.get('driving') >= 15);
  assert.ok(minutesByTask.get('driving') <= 30);
  assertNoOverlaps(scheduledSegments(result));
});

test('compression waterfalls to higher-protected tasks when a donor hits its minimum', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '11:00', CONTEXTS.WORK),
      block('18:00', '21:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskName: '高保护',
        desiredMinutes: 100,
        minimumMinutes: 40,
        importance: 5,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 20
      }),
      task({
        taskName: '低保护小弹性',
        desiredMinutes: 60,
        minimumMinutes: 50,
        importance: 2,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 10
      }),
      task({
        taskName: '被挤压者',
        desiredMinutes: 80,
        minimumMinutes: 80,
        importance: 1,
        executionContext: CONTEXTS.HOME,
        splittable: true,
        minSegmentMinutes: 20
      })
    ]
  });

  const minutesByTask = new Map();
  for (const segment of scheduledSegments(result)) {
    minutesByTask.set(
      segment.taskName,
      (minutesByTask.get(segment.taskName) ?? 0) + segment.allocatedMinutes
    );
  }

  assert.notEqual(result.status, 'conflict');
  assert.equal(minutesByTask.get('被挤压者'), 80);
  assert.equal(minutesByTask.get('低保护小弹性'), 50);
  assert.equal(minutesByTask.get('高保护'), 50);
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
