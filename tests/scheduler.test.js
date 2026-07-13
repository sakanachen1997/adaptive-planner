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

  // 编码 is work-only; its work window is 60 min, so it is allocated and fully
  // placed at 60. The unmet desired time is compression, not an unplaced
  // remainder, so the day is 'ok' rather than 'partial'.
  assert.equal(result.status, 'ok');
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
        importance: 4,
        executionContext: CONTEXTS.ANY
      })
    ]
  });

  const segments = scheduledSegments(result);

  assert.equal(result.status, 'ok');
  assert.equal(segments.length, 2);
  assertNoOverlaps(segments);
});

test('home-only tasks never use an any-context block during work hours', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('10:00', '12:10', CONTEXTS.ANY),
      block('17:10', '23:20', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [task({
      taskId: 'home-only-evening',
      taskName: '莉莉安娜',
      desiredMinutes: 60,
      minimumMinutes: 30,
      executionContext: CONTEXTS.HOME
    })]
  });

  assert.equal(result.status, 'ok');
  assert.ok(scheduledSegments(result).every((segment) => segment.start >= `${PLAN_DATE}T17:10:00`));
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

  // Single home window that fits at minimums (170 of 180). The 10 min of spare
  // goes mostly to the higher-protection task, and the incompressible task is
  // fully placed. Protection order is what matters, not an exact 50/50 split.
  const highExtra = minutesByTask.get('高保护') - 40;
  const lowExtra = minutesByTask.get('低保护小弹性') - 50;

  assert.notEqual(result.status, 'conflict');
  assert.equal(minutesByTask.get('被挤压者'), 80);
  assert.ok(highExtra > lowExtra, `high extra ${highExtra} should exceed low extra ${lowExtra}`);
  assert.equal(minutesByTask.get('高保护') + minutesByTask.get('低保护小弹性') + minutesByTask.get('被挤压者'), 180);
});

function fullDayScenario(now) {
  return {
    planDate: PLAN_DATE,
    now,
    availableBlocks: [block('10:15', '16:30', CONTEXTS.WORK), block('17:20', '23:00', CONTEXTS.HOME)],
    protectedBlocks: [],
    tasks: [
      task({ taskName: '晨读1', taskType: '复杂教程和学习', desiredMinutes: 80, minimumMinutes: 50, importance: 3, executionContext: CONTEXTS.ANY }),
      task({ taskName: '晨读2', taskType: '复杂教程和学习', desiredMinutes: 60, minimumMinutes: 40, importance: 3, executionContext: CONTEXTS.ANY }),
      task({ taskName: '晨读3', taskType: '复杂教程和学习', desiredMinutes: 60, minimumMinutes: 40, importance: 3, executionContext: CONTEXTS.ANY }),
      task({ taskName: '背单词', taskType: '背单词', desiredMinutes: 30, minimumMinutes: 30, importance: 3, executionContext: CONTEXTS.ANY }),
      task({ taskName: '吃饭', taskType: '生活杂务', desiredMinutes: 60, minimumMinutes: 60, importance: 3, executionContext: CONTEXTS.HOME }),
      task({ taskName: '莉莉安娜', taskType: '绘画委托副业', desiredMinutes: 90, minimumMinutes: 60, importance: 5, executionContext: CONTEXTS.HOME }),
      task({ taskName: '健身', taskType: '运动健身', desiredMinutes: 140, minimumMinutes: 140, importance: 3, executionContext: CONTEXTS.HOME }),
      task({ taskName: '卷子', taskType: '复杂教程和学习', desiredMinutes: 40, minimumMinutes: 40, importance: 3, executionContext: CONTEXTS.HOME }),
      task({ taskName: 'supermemo', taskType: '复杂教程和学习', desiredMinutes: 10, minimumMinutes: 5, importance: 3, executionContext: CONTEXTS.HOME }),
      task({ taskName: '家务', taskType: '生活杂务', desiredMinutes: 20, minimumMinutes: 10, importance: 3, executionContext: CONTEXTS.HOME }),
      task({ taskName: '开车', taskType: '打游戏', desiredMinutes: 30, minimumMinutes: 15, importance: 2, executionContext: CONTEXTS.HOME })
    ]
  };
}

function minutesByTask(result) {
  const mins = new Map();
  for (const segment of scheduledSegments(result)) {
    mins.set(segment.taskName, (mins.get(segment.taskName) ?? 0) + segment.allocatedMinutes);
  }
  return mins;
}

test('per-context windows: a full evening fits without false conflict when work is roomy', () => {
  const result = scheduleDay(fullDayScenario(`${PLAN_DATE}T09:00:00`));
  const mins = minutesByTask(result);

  assert.notEqual(result.status, 'conflict');
  assert.ok(mins.get('开车') >= 15, `开车 got ${mins.get('开车')}`);
  assert.equal(mins.get('健身'), 140);
  assertNoOverlaps(scheduledSegments(result));
});

test('per-context windows: work-time task extension does not starve evening (evening allocations unchanged)', () => {
  const early = scheduleDay(fullDayScenario(`${PLAN_DATE}T09:00:00`));
  const late = scheduleDay(fullDayScenario(`${PLAN_DATE}T11:44:52`));
  const earlyMins = minutesByTask(early);
  const lateMins = minutesByTask(late);

  assert.notEqual(late.status, 'conflict');
  for (const name of ['吃饭', '莉莉安娜', '健身', '卷子', 'supermemo', '家务', '开车']) {
    assert.equal(
      lateMins.get(name),
      earlyMins.get(name),
      `${name} evening allocation changed when work window shrank: ${earlyMins.get(name)} -> ${lateMins.get(name)}`
    );
  }
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

test('task dependencies force successors to start after every predecessor segment', () => {
  const predecessor = task({
    taskId: 'research',
    taskName: '调研',
    desiredMinutes: 60,
    minimumMinutes: 60,
    splittable: true,
    minSegmentMinutes: 30
  });
  const successor = task({
    taskId: 'write',
    taskName: '写作',
    desiredMinutes: 30,
    minimumMinutes: 30,
    dependencyTaskIds: ['research']
  });
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '09:30'),
      block('10:00', '10:30'),
      block('11:00', '11:30')
    ],
    protectedBlocks: [],
    tasks: [successor, predecessor]
  });
  const predecessorSegments = scheduledSegments(result).filter((segment) => segment.taskId === 'research');
  const successorSegment = scheduledSegments(result).find((segment) => segment.taskId === 'write');

  assert.equal(result.status, 'ok');
  assert.equal(predecessorSegments.length, 2);
  assert.ok(successorSegment.start >= predecessorSegments.at(-1).end);
});

test('dependency cycles crash scheduling with an explicit conflict', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '12:00')],
    protectedBlocks: [],
    tasks: [
      task({ taskId: 'a', taskName: 'A', dependencyTaskIds: ['b'] }),
      task({ taskId: 'b', taskName: 'B', dependencyTaskIds: ['a'] })
    ]
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.kind, 'dependency_cycle');
  assert.deepEqual(result.conflict.dependencyIssues.map((item) => item.taskId).sort(), ['a', 'b']);
});

test('missing dependencies crash scheduling instead of being silently ignored', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [block('09:00', '12:00')],
    protectedBlocks: [],
    tasks: [task({ taskId: 'write', taskName: '写作', dependencyTaskIds: ['deleted-task'] })]
  });

  assert.equal(result.status, 'conflict');
  assert.equal(result.conflict.kind, 'missing_dependency');
  assert.equal(result.conflict.dependencyIssues[0].dependencyTaskId, 'deleted-task');
});

test('dependencies are enforced across work and home scheduling windows', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '10:00', CONTEXTS.WORK),
      block('19:00', '20:00', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskId: 'work-first',
        taskName: '工作任务',
        desiredMinutes: 60,
        minimumMinutes: 60,
        executionContext: CONTEXTS.WORK
      }),
      task({
        taskId: 'home-second',
        taskName: '居家任务',
        desiredMinutes: 60,
        minimumMinutes: 60,
        executionContext: CONTEXTS.HOME,
        dependencyTaskIds: ['work-first']
      })
    ]
  });
  const segments = scheduledSegments(result);

  assert.equal(result.status, 'ok');
  assert.ok(
    segments.find((segment) => segment.taskId === 'home-second').start
      >= segments.find((segment) => segment.taskId === 'work-first').end
  );
});

test('named custom execution contexts only use their matching named block', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      { ...block('09:00', '10:00'), context: 'custom:a' },
      { ...block('15:00', '16:00'), context: 'custom:b' }
    ],
    protectedBlocks: [],
    tasks: [
      task({
        taskId: 'only-b',
        taskName: '只在 B 执行',
        desiredMinutes: 60,
        minimumMinutes: 60,
        executionContext: 'custom:b'
      })
    ]
  });

  assert.equal(result.status, 'ok');
  assert.equal(scheduledSegments(result)[0].start, `${PLAN_DATE}T15:00:00`);
});

test('legacy custom tasks migrate to a named custom block but not an any block', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      { ...block('10:00', '11:00'), context: CONTEXTS.ANY },
      { ...block('14:00', '15:00'), context: 'custom:a' }
    ],
    protectedBlocks: [],
    tasks: [task({
      taskId: 'legacy-custom',
      taskName: '旧版自定义任务',
      desiredMinutes: 60,
      minimumMinutes: 60,
      executionContext: CONTEXTS.CUSTOM
    })]
  });

  assert.equal(result.status, 'ok');
  assert.equal(scheduledSegments(result)[0].start, `${PLAN_DATE}T14:00:00`);
});
