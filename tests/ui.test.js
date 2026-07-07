import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_ID, TASK_STATUSES } from '../src/models.js';
import { buildDescription } from '../src/metadata.js';
import {
  buildSyncOperations,
  calendarEventToPlanTask,
  calendarEventToProtectedBlock
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
    calendarEventId: 'event-1'
  });
});

test('sync operations create or update only scheduled non-completed plan segments', () => {
  const tasks = [
    { taskId: 'new-task', taskName: 'New task' },
    { taskId: 'existing-task', taskName: 'Existing task', calendarEventId: 'event-2' },
    { taskId: 'done-task', taskName: 'Done task', calendarEventId: 'event-3' }
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
  assert.match(operations.updates[0].description, /PLAN_META/);
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
