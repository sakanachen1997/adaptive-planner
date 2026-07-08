import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_ID, TASK_STATUSES } from '../src/models.js';
import { buildDescription, extractPlanMetadata } from '../src/metadata.js';
import {
  buildSyncOperations,
  calendarEventToPlanTask,
  calendarEventToProtectedBlock,
  actualDurationForTask,
  conflictSummaryLines,
  editableTasksForSchedule,
  removeTaskForReschedule,
  formInputForTask,
  shouldShowRecoveryActions,
  mergePlanTasks,
  resetCalendarStateForDateChange,
  selectTaskForCompletion,
  upsertLocalTask
} from '../src/ui.js';

test('ordinary calendar events become protected blocks with local wall-clock timestamps', () => {
  const event = {
    id: 'ordinary-1',
    summary: 'Doctor',
    start: { dateTime: '2026-07-06T10:00:00+02:00' },
    end: { dateTime: '2026-07-06T10:30:00+02:00' }
  };

  assert.deepEqual(calendarEventToProtectedBlock(event), {
    start: '2026-07-06T10:00:00',
    end: '2026-07-06T10:30:00',
    summary: 'Doctor',
    calendarEventId: 'ordinary-1'
  });
});

test('conflict schedules expose active tasks for editing', () => {
  const editable = editableTasksForSchedule(
    { status: 'conflict', segments: [] },
    [
      { taskId: 'pending', taskName: 'Pending', status: TASK_STATUSES.PENDING },
      { taskId: 'scheduled', taskName: 'Scheduled', status: TASK_STATUSES.SCHEDULED },
      { taskId: 'done', taskName: 'Done', status: TASK_STATUSES.COMPLETED },
      { taskId: 'skipped', taskName: 'Skipped', status: TASK_STATUSES.SKIPPED }
    ]
  );

  assert.deepEqual(editable.map((task) => task.taskId), ['pending', 'scheduled']);
});

test('conflict panel lists lowest priority tasks first as skip candidates', () => {
  const editable = editableTasksForSchedule(
    { status: 'conflict', segments: [] },
    [
      {
        taskId: 'high',
        taskName: 'High',
        status: TASK_STATUSES.PENDING,
        importance: 5,
        desiredMinutes: 60
      },
      {
        taskId: 'low',
        taskName: 'Low',
        status: TASK_STATUSES.PENDING,
        importance: 1,
        desiredMinutes: 60
      }
    ]
  );

  assert.deepEqual(editable.map((task) => task.taskId), ['low', 'high']);
});

test('removeTaskForReschedule drops a local-only task from the local task list', () => {
  const localTasks = [
    { taskId: 'task-1', taskName: 'Keep' },
    { taskId: 'task-2', taskName: 'Remove' }
  ];

  const updated = removeTaskForReschedule(localTasks, { taskId: 'task-2', taskName: 'Remove' });

  assert.deepEqual(updated.map((task) => task.taskId), ['task-1']);
});

test('removeTaskForReschedule marks a calendar-backed task skipped so sync deletes its event', () => {
  const calendarTask = {
    taskId: 'task-1',
    taskName: 'Synced',
    calendarEventId: 'event-1',
    status: TASK_STATUSES.SCHEDULED
  };

  const updated = removeTaskForReschedule([], calendarTask);

  assert.equal(updated.length, 1);
  assert.equal(updated[0].status, TASK_STATUSES.SKIPPED);
  assert.equal(updated[0].localOverride, true);
  assert.equal(updated[0].calendarEventId, 'event-1');
});

test('formInputForTask preserves task fields as form-ready values', () => {
  assert.deepEqual(formInputForTask({
    taskName: 'Math',
    taskType: '自定义',
    desiredMinutes: 120,
    minimumMinutes: 45,
    importance: 4,
    deadline: '2026-07-07T18:30:00',
    executionContext: 'home',
    fixed: true,
    fixedStart: '19:00',
    fixedEnd: '20:00'
  }), {
    taskName: 'Math',
    taskType: '自定义',
    desiredMinutes: '120',
    minimumMinutes: '45',
    importance: '4',
    deadline: '2026-07-07T18:30',
    executionContext: 'home',
    fixed: true,
    fixedStart: '19:00',
    fixedEnd: '20:00'
  });
});

test('upsertLocalTask replaces the matching local task instead of duplicating it', () => {
  const existing = [
    { taskId: 'task-1', taskName: 'Old local' },
    { taskId: 'task-2', taskName: 'Other local' }
  ];

  const updated = upsertLocalTask(existing, { taskId: 'task-1', taskName: 'Updated local' });

  assert.deepEqual(updated, [
    { taskId: 'task-1', taskName: 'Updated local' },
    { taskId: 'task-2', taskName: 'Other local' }
  ]);
});

test('mergePlanTasks prefers edited local copy of a Calendar plan task', () => {
  const merged = mergePlanTasks({
    calendarTasks: [
      {
        taskId: 'calendar-task',
        taskName: 'Calendar version',
        calendarEventId: 'event-1',
        status: TASK_STATUSES.SCHEDULED
      }
    ],
    localTasks: [
      {
        taskId: 'calendar-task',
        taskName: 'Edited version',
        calendarEventId: 'event-1',
        status: TASK_STATUSES.SCHEDULED,
        localOverride: true
      }
    ]
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].taskName, 'Edited version');
});

test('minimum overflow conflict presentation shows recovery actions', () => {
  const schedule = {
    status: 'conflict',
    conflict: {
      kind: 'minimum_overflow',
      actions: ['增加可用时间后重排']
    }
  };

  assert.equal(shouldShowRecoveryActions(schedule), true);
});

test('placement failure conflict summary names the task that could not be placed', () => {
  const lines = conflictSummaryLines({
    kind: 'placement_failure',
    availableMinutes: 828,
    requiredMinimumMinutes: 220,
    belowMinimum: [{
      taskId: 'task-b',
      taskName: 'B',
      minimumMinutes: 40,
      scheduledMinutes: 30
    }]
  });

  assert.deepEqual(lines, [
    '任务「B」无法放入兼容的时间块：最小需要 40 分钟，只能安排 30 分钟。',
    '总可用时间 828 分钟，全部任务最小共需 220 分钟。'
  ]);
});

test('minimum overflow conflict summary reports total available versus required minutes', () => {
  const lines = conflictSummaryLines({
    kind: 'minimum_overflow',
    availableMinutes: 60,
    requiredMinimumMinutes: 75,
    belowMinimum: []
  });

  assert.deepEqual(lines, [
    '可用时间 60 分钟，任务最小需要 75 分钟。'
  ]);
});

test('actualDurationForTask reads computed actual duration by task id', () => {
  const schedule = {
    status: 'ok',
    durationPlan: {
      allocations: [
        { taskId: 'task-1', desiredMinutes: 120, minimumMinutes: 30, actualMinutes: 80 },
        { taskId: 'task-2', desiredMinutes: 60, minimumMinutes: 20, actualMinutes: 40 }
      ]
    }
  };

  assert.deepEqual(actualDurationForTask(schedule, 'task-2'), {
    taskId: 'task-2',
    desiredMinutes: 60,
    minimumMinutes: 20,
    actualMinutes: 40
  });
  assert.equal(actualDurationForTask(schedule, 'missing'), null);
});

test('plan calendar events become tasks and retain their calendar event id', () => {
  const metadata = {
    schemaVersion: 1,
    app: APP_ID,
    taskId: 'task-1',
    taskName: 'Focus',
    taskType: 'custom',
    desiredMinutes: 60,
    minimumMinutes: 30,
    importance: 4,
    status: TASK_STATUSES.SCHEDULED
  };
  const event = {
    id: 'event-1',
    description: buildDescription('Created by planner', metadata),
    start: { dateTime: '2026-07-06T09:00:00+02:00' },
    end: { dateTime: '2026-07-06T10:00:00+02:00' }
  };

  assert.deepEqual(calendarEventToPlanTask(event), {
    ...metadata,
    plannedStart: '2026-07-06T09:00:00',
    plannedEnd: '2026-07-06T10:00:00',
    fixed: true,
    fixedStart: '09:00',
    fixedEnd: '10:00',
    calendarEventId: 'event-1'
  });
});

test('calendarEventToPlanTask uses Calendar event time as fixed planned time for scheduled metadata', () => {
  const metadata = {
    schemaVersion: 1,
    app: APP_ID,
    taskId: 'dragged-task',
    segmentId: 'dragged-task_segment_1',
    taskName: 'Dragged task',
    taskType: 'custom',
    desiredMinutes: 60,
    minimumMinutes: 30,
    importance: 4,
    status: TASK_STATUSES.SCHEDULED
  };
  const task = calendarEventToPlanTask({
    id: 'event-dragged',
    description: buildDescription('Dragged in Calendar', metadata),
    start: { dateTime: '2026-07-06T14:15:00+02:00' },
    end: { dateTime: '2026-07-06T15:45:00+02:00' }
  });

  assert.equal(task.plannedStart, '2026-07-06T14:15:00');
  assert.equal(task.plannedEnd, '2026-07-06T15:45:00');
  assert.equal(task.fixed, true);
  assert.equal(task.fixedStart, '14:15');
  assert.equal(task.fixedEnd, '15:45');
  assert.equal(task.segmentId, 'dragged-task_segment_1');
  assert.equal(task.calendarEventId, 'event-dragged');
});

test('sync operations create or update only scheduled non-completed plan segments', () => {
  const tasks = [
    { taskId: 'new-task', taskName: 'New task' },
    { taskId: 'existing-task', taskName: 'Existing task', calendarEventId: 'event-2' },
    { taskId: 'done-task', taskName: 'Done task' }
  ];
  const schedule = {
    status: 'ok',
    segments: [
      {
        taskId: 'new-task',
        taskName: 'New task',
        status: TASK_STATUSES.SCHEDULED,
        start: '2026-07-06T09:00:00',
        end: '2026-07-06T09:30:00'
      },
      {
        taskId: 'existing-task',
        taskName: 'Existing task',
        status: TASK_STATUSES.SCHEDULED,
        start: '2026-07-06T10:00:00',
        end: '2026-07-06T10:30:00'
      },
      {
        taskId: 'done-task',
        taskName: 'Done task',
        status: TASK_STATUSES.COMPLETED,
        start: '2026-07-06T08:00:00',
        end: '2026-07-06T08:15:00'
      }
    ]
  };

  const operations = buildSyncOperations({
    schedule,
    tasks,
    planDate: '2026-07-06'
  });

  assert.equal(operations.creates.length, 1);
  assert.equal(operations.creates[0].segment.taskId, 'new-task');
  assert.equal(operations.updates.length, 1);
  assert.equal(operations.updates[0].eventId, 'event-2');
  assert.deepEqual(operations.deletes, []);
  assert.match(operations.updates[0].description, /PLAN_META/);
});

test('sync operations include completed update and do not create completed events', () => {
  const schedule = {
    status: 'ok',
    segments: [
      {
        taskId: 'done-existing',
        taskName: 'Done existing',
        status: TASK_STATUSES.COMPLETED,
        start: '2026-07-06T08:05:00',
        end: '2026-07-06T08:42:00'
      },
      {
        taskId: 'done-local',
        taskName: 'Done local',
        status: TASK_STATUSES.COMPLETED,
        start: '2026-07-06T09:00:00',
        end: '2026-07-06T09:15:00'
      }
    ]
  };

  const operations = buildSyncOperations({
    schedule,
    tasks: [
      {
        taskId: 'done-existing',
        taskName: 'Done existing',
        calendarEventId: 'event-done',
        actualStart: '2026-07-06T08:05:00',
        actualEnd: '2026-07-06T08:42:00'
      },
      {
        taskId: 'done-local',
        taskName: 'Done local',
        actualStart: '2026-07-06T09:00:00',
        actualEnd: '2026-07-06T09:15:00'
      }
    ],
    existingPlanTasks: [
      {
        taskId: 'done-existing',
        taskName: 'Done existing',
        calendarEventId: 'event-done',
        segmentId: 'done-existing_segment_1'
      }
    ],
    planDate: '2026-07-06'
  });

  assert.deepEqual(operations.creates, []);
  assert.equal(operations.updates.length, 1);
  assert.equal(operations.updates[0].eventId, 'event-done');
  assert.deepEqual(operations.updates[0].segment, {
    taskId: 'done-existing',
    taskName: 'Done existing',
    status: TASK_STATUSES.COMPLETED,
    start: '2026-07-06T08:05:00',
    end: '2026-07-06T08:42:00'
  });
  assert.deepEqual(extractPlanMetadata(operations.updates[0].description), {
    taskId: 'done-existing',
    taskName: 'Done existing',
    calendarEventId: 'event-done',
    actualStart: '2026-07-06T08:05:00',
    actualEnd: '2026-07-06T08:42:00',
    schemaVersion: 1,
    app: APP_ID,
    planDate: '2026-07-06',
    segmentId: 'done-existing_segment_1',
    status: TASK_STATUSES.COMPLETED
  });
});

test('sync operations ignore skipped and pending segments', () => {
  const schedule = {
    status: 'ok',
    segments: [
      {
        taskId: 'scheduled-task',
        taskName: 'Scheduled task',
        status: TASK_STATUSES.SCHEDULED,
        start: '2026-07-06T09:00:00',
        end: '2026-07-06T09:30:00'
      },
      {
        taskId: 'pending-task',
        taskName: 'Pending task',
        status: TASK_STATUSES.PENDING,
        start: '2026-07-06T10:00:00',
        end: '2026-07-06T10:30:00'
      },
      {
        taskId: 'skipped-task',
        taskName: 'Skipped task',
        status: TASK_STATUSES.SKIPPED,
        start: '2026-07-06T11:00:00',
        end: '2026-07-06T11:30:00'
      }
    ]
  };

  const operations = buildSyncOperations({
    schedule,
    tasks: [
      { taskId: 'scheduled-task', taskName: 'Scheduled task' },
      { taskId: 'pending-task', taskName: 'Pending task', calendarEventId: 'pending-event' },
      { taskId: 'skipped-task', taskName: 'Skipped task', calendarEventId: 'skipped-event' }
    ],
    planDate: '2026-07-06'
  });

  assert.deepEqual(operations.creates.map((operation) => operation.segment.taskId), ['scheduled-task']);
  assert.deepEqual(operations.updates, []);
});

test('sync operations update split existing segments by segment id for the same task', () => {
  const task = {
    taskId: 'split-task',
    taskName: 'Split task'
  };
  const firstSegment = {
    taskId: 'split-task',
    taskName: 'Split task',
    status: TASK_STATUSES.SCHEDULED,
    start: '2026-07-06T09:00:00',
    end: '2026-07-06T09:30:00'
  };
  const secondSegment = {
    taskId: 'split-task',
    taskName: 'Split task',
    status: TASK_STATUSES.SCHEDULED,
    start: '2026-07-06T15:00:00',
    end: '2026-07-06T15:30:00'
  };

  const operations = buildSyncOperations({
    schedule: {
      status: 'ok',
      segments: [firstSegment, secondSegment]
    },
    tasks: [task],
    existingPlanTasks: [
      {
        ...task,
        segmentId: 'split-task_2026-07-06T09:00:00_2026-07-06T09:30:00',
        calendarEventId: 'event-morning'
      },
      {
        ...task,
        segmentId: 'split-task_2026-07-06T15:00:00_2026-07-06T15:30:00',
        calendarEventId: 'event-afternoon'
      }
    ],
    planDate: '2026-07-06'
  });

  assert.deepEqual(operations.creates, []);
  assert.deepEqual(
    operations.updates.map((operation) => operation.eventId),
    ['event-morning', 'event-afternoon']
  );
});

test('split reschedule with changed times updates existing same-task Plan events instead of creating duplicates', () => {
  const task = {
    taskId: 'split-reschedule',
    taskName: 'Split reschedule'
  };
  const operations = buildSyncOperations({
    schedule: {
      status: 'ok',
      segments: [
        {
          taskId: 'split-reschedule',
          taskName: 'Split reschedule',
          status: TASK_STATUSES.SCHEDULED,
          start: '2026-07-06T10:00:00',
          end: '2026-07-06T10:30:00'
        },
        {
          taskId: 'split-reschedule',
          taskName: 'Split reschedule',
          status: TASK_STATUSES.SCHEDULED,
          start: '2026-07-06T16:00:00',
          end: '2026-07-06T16:30:00'
        }
      ]
    },
    tasks: [task],
    existingPlanTasks: [
      {
        ...task,
        segmentId: 'split-reschedule_2026-07-06T09:00:00_2026-07-06T09:30:00',
        plannedStart: '2026-07-06T09:00:00',
        calendarEventId: 'event-old-morning'
      },
      {
        ...task,
        segmentId: 'split-reschedule_2026-07-06T15:00:00_2026-07-06T15:30:00',
        plannedStart: '2026-07-06T15:00:00',
        calendarEventId: 'event-old-afternoon'
      }
    ],
    planDate: '2026-07-06'
  });

  assert.deepEqual(operations.creates, []);
  assert.deepEqual(
    operations.updates.map((operation) => operation.eventId),
    ['event-old-morning', 'event-old-afternoon']
  );
  assert.deepEqual(operations.deletes, []);
});

test('stale unmatched existing Plan event appears in deletes', () => {
  const operations = buildSyncOperations({
    schedule: {
      status: 'ok',
      segments: [
        {
          taskId: 'current-task',
          taskName: 'Current task',
          status: TASK_STATUSES.SCHEDULED,
          start: '2026-07-06T09:00:00',
          end: '2026-07-06T09:30:00'
        }
      ]
    },
    tasks: [
      { taskId: 'current-task', taskName: 'Current task' }
    ],
    existingPlanTasks: [
      {
        taskId: 'stale-task',
        taskName: 'Stale task',
        status: TASK_STATUSES.SCHEDULED,
        segmentId: 'stale-task_segment_1',
        plannedStart: '2026-07-06T12:00:00',
        calendarEventId: 'event-stale'
      }
    ],
    planDate: '2026-07-06'
  });

  assert.deepEqual(operations.deletes, [{
    eventId: 'event-stale',
    task: {
      taskId: 'stale-task',
      taskName: 'Stale task',
      status: TASK_STATUSES.SCHEDULED,
      segmentId: 'stale-task_segment_1',
      plannedStart: '2026-07-06T12:00:00',
      calendarEventId: 'event-stale'
    }
  }]);
});

test('mergePlanTasks prefers calendar state except unsynced local completion awaiting sync', () => {
  const merged = mergePlanTasks({
    calendarTasks: [
      {
        taskId: 'stale-scheduled',
        taskName: 'Calendar scheduled',
        status: TASK_STATUSES.SCHEDULED,
        calendarEventId: 'event-scheduled',
        plannedStart: '2026-07-06T10:00:00'
      },
      {
        taskId: 'completed-waiting',
        taskName: 'Calendar old scheduled',
        status: TASK_STATUSES.SCHEDULED,
        calendarEventId: 'event-completed',
        plannedStart: '2026-07-06T11:00:00'
      }
    ],
    localTasks: [
      {
        taskId: 'stale-scheduled',
        taskName: 'Local stale scheduled',
        status: TASK_STATUSES.SCHEDULED,
        calendarEventId: 'event-scheduled',
        plannedStart: '2026-07-06T09:00:00'
      },
      {
        taskId: 'completed-waiting',
        taskName: 'Local completed',
        status: TASK_STATUSES.COMPLETED,
        calendarEventId: 'event-completed',
        actualStart: '2026-07-06T11:00:00',
        actualEnd: '2026-07-06T11:20:00'
      },
      {
        taskId: 'local-new',
        taskName: 'Local new',
        status: TASK_STATUSES.PENDING
      }
    ]
  });

  assert.deepEqual(merged, [
    {
      taskId: 'stale-scheduled',
      taskName: 'Calendar scheduled',
      status: TASK_STATUSES.SCHEDULED,
      calendarEventId: 'event-scheduled',
      plannedStart: '2026-07-06T10:00:00'
    },
    {
      taskId: 'completed-waiting',
      taskName: 'Local completed',
      status: TASK_STATUSES.COMPLETED,
      calendarEventId: 'event-completed',
      actualStart: '2026-07-06T11:00:00',
      actualEnd: '2026-07-06T11:20:00'
    },
    {
      taskId: 'local-new',
      taskName: 'Local new',
      status: TASK_STATUSES.PENDING
    }
  ]);
});

test('mergePlanTasks preserves split Calendar segments with the same task id', () => {
  const merged = mergePlanTasks({
    calendarTasks: [
      {
        taskId: 'split-calendar',
        taskName: 'Split calendar',
        status: TASK_STATUSES.SCHEDULED,
        segmentId: 'split-calendar_segment_1',
        calendarEventId: 'event-one',
        plannedStart: '2026-07-06T09:00:00'
      },
      {
        taskId: 'split-calendar',
        taskName: 'Split calendar',
        status: TASK_STATUSES.SCHEDULED,
        segmentId: 'split-calendar_segment_2',
        calendarEventId: 'event-two',
        plannedStart: '2026-07-06T15:00:00'
      }
    ],
    localTasks: [
      {
        taskId: 'split-calendar',
        taskName: 'Unsynced duplicate local',
        status: TASK_STATUSES.PENDING
      }
    ]
  });

  assert.deepEqual(
    merged.map((task) => task.calendarEventId),
    ['event-one', 'event-two']
  );
  assert.equal(merged.length, 2);
});

test('date change clears loaded calendar events but keeps local tasks', () => {
  const currentState = {
    planDate: '2026-07-06',
    calendarEvents: [{ id: 'old-date-event' }],
    tasks: [{ taskId: 'local-task', taskName: 'Local task' }],
    schedule: { status: 'ok', segments: [] },
    lastSyncOperations: {
      creates: [{ eventId: 'create' }],
      updates: [{ eventId: 'update' }],
      deletes: [{ eventId: 'delete' }]
    }
  };

  assert.deepEqual(resetCalendarStateForDateChange(currentState, '2026-07-07'), {
    ...currentState,
    planDate: '2026-07-07',
    calendarEvents: [],
    schedule: null,
    lastSyncOperations: {
      creates: [],
      updates: [],
      deletes: []
    }
  });
  assert.deepEqual(currentState.calendarEvents, [{ id: 'old-date-event' }]);
});

test('sync operations ignore existing Plan tasks from a different plan date', () => {
  const operations = buildSyncOperations({
    schedule: {
      status: 'ok',
      segments: [
        {
          taskId: 'today-task',
          taskName: 'Today task',
          status: TASK_STATUSES.SCHEDULED,
          start: '2026-07-07T09:00:00',
          end: '2026-07-07T09:30:00'
        }
      ]
    },
    tasks: [
      { taskId: 'today-task', taskName: 'Today task' }
    ],
    existingPlanTasks: [
      {
        taskId: 'today-task',
        taskName: 'Yesterday task',
        status: TASK_STATUSES.SCHEDULED,
        planDate: '2026-07-06',
        segmentId: 'today-task_segment_1',
        plannedStart: '2026-07-06T09:00:00',
        calendarEventId: 'event-yesterday'
      }
    ],
    planDate: '2026-07-07'
  });

  assert.deepEqual(operations.updates, []);
  assert.deepEqual(operations.deletes, []);
  assert.equal(operations.creates.length, 1);
  assert.equal(operations.creates[0].segment.taskId, 'today-task');
});

test('sync operations update completed split segment by segment identity', () => {
  const operations = buildSyncOperations({
    schedule: {
      status: 'ok',
      segments: [
        {
          taskId: 'split-complete',
          taskName: 'Split complete',
          status: TASK_STATUSES.COMPLETED,
          segmentId: 'split-complete_segment_1',
          start: '2026-07-07T09:00:00',
          end: '2026-07-07T09:25:00'
        },
        {
          taskId: 'split-complete',
          taskName: 'Split complete',
          status: TASK_STATUSES.SCHEDULED,
          segmentId: 'split-complete_segment_2',
          start: '2026-07-07T15:00:00',
          end: '2026-07-07T15:30:00'
        }
      ]
    },
    tasks: [
      {
        taskId: 'split-complete',
        taskName: 'Split complete',
        status: TASK_STATUSES.COMPLETED,
        segmentId: 'split-complete_segment_1',
        calendarEventId: 'event-a',
        actualStart: '2026-07-07T09:00:00',
        actualEnd: '2026-07-07T09:25:00'
      },
      {
        taskId: 'split-complete',
        taskName: 'Split complete',
        status: TASK_STATUSES.SCHEDULED,
        segmentId: 'split-complete_segment_2',
        calendarEventId: 'event-b',
        plannedStart: '2026-07-07T15:00:00',
        plannedEnd: '2026-07-07T15:30:00'
      }
    ],
    existingPlanTasks: [
      {
        taskId: 'split-complete',
        taskName: 'Split complete',
        status: TASK_STATUSES.SCHEDULED,
        planDate: '2026-07-07',
        segmentId: 'split-complete_segment_1',
        calendarEventId: 'event-a',
        plannedStart: '2026-07-07T09:00:00'
      },
      {
        taskId: 'split-complete',
        taskName: 'Split complete',
        status: TASK_STATUSES.SCHEDULED,
        planDate: '2026-07-07',
        segmentId: 'split-complete_segment_2',
        calendarEventId: 'event-b',
        plannedStart: '2026-07-07T15:00:00'
      }
    ],
    planDate: '2026-07-07'
  });

  assert.deepEqual(operations.creates, []);
  assert.deepEqual(operations.deletes, []);
  assert.deepEqual(
    operations.updates.map((operation) => ({
      eventId: operation.eventId,
      status: extractPlanMetadata(operation.description).status,
      segmentId: extractPlanMetadata(operation.description).segmentId
    })),
    [
      {
        eventId: 'event-a',
        status: TASK_STATUSES.COMPLETED,
        segmentId: 'split-complete_segment_1'
      },
      {
        eventId: 'event-b',
        status: TASK_STATUSES.SCHEDULED,
        segmentId: 'split-complete_segment_2'
      }
    ]
  );
});

test('selectTaskForCompletion rejects ambiguous split task fallback', () => {
  const selected = selectTaskForCompletion([
    {
      taskId: 'ambiguous-split',
      taskName: 'Ambiguous split',
      segmentId: 'ambiguous-split_segment_1',
      calendarEventId: 'event-one',
      plannedStart: '2026-07-07T09:00:00',
      plannedEnd: '2026-07-07T09:30:00'
    },
    {
      taskId: 'ambiguous-split',
      taskName: 'Ambiguous split',
      segmentId: 'ambiguous-split_segment_2',
      calendarEventId: 'event-two',
      plannedStart: '2026-07-07T15:00:00',
      plannedEnd: '2026-07-07T15:30:00'
    }
  ], {
    taskId: 'ambiguous-split',
    segmentStart: '2026-07-07T12:00:00',
    segmentEnd: '2026-07-07T12:10:00'
  });

  assert.equal(selected, null);
});

test('selectTaskForCompletion allows task id fallback for a single candidate', () => {
  const task = {
    taskId: 'single-task',
    taskName: 'Single task',
    calendarEventId: 'event-single',
    plannedStart: '2026-07-07T09:00:00',
    plannedEnd: '2026-07-07T09:30:00'
  };

  assert.equal(selectTaskForCompletion([task], {
    taskId: 'single-task',
    segmentStart: '2026-07-07T12:00:00',
    segmentEnd: '2026-07-07T12:10:00'
  }), task);
});
