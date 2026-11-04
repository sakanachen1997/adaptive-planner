import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_STATUSES, createTask } from '../src/models.js';
import { extractPlanMetadata } from '../src/metadata.js';
import { scheduleDay } from '../src/scheduler.js';
import {
  buildSyncOperations,
  completeSegmentInList,
  completeTaskInList,
  completionScope,
  logicalTasksForSchedule,
  mergePlanTasks,
  segmentActualTimes,
  selectTaskForCompletion
} from '../src/ui.js';

const DAY = '2026-11-04';

function splitTask(overrides = {}) {
  return createTask({
    taskId: 'essay',
    taskName: 'Essay',
    taskType: '自定义',
    desiredMinutes: 120,
    minimumMinutes: 120,
    importance: 3,
    executionContext: 'any',
    splittable: true,
    minSegmentMinutes: 30,
    ...overrides
  });
}

function plan(tasks, now = `${DAY}T07:00:00`) {
  return scheduleDay({
    planDate: DAY,
    now,
    availableBlocks: [
      { start: `${DAY}T09:00:00`, end: `${DAY}T10:00:00`, context: 'any' },
      { start: `${DAY}T11:00:00`, end: `${DAY}T12:00:00`, context: 'any' }
    ],
    protectedBlocks: [],
    tasks: logicalTasksForSchedule(tasks)
  });
}

const scheduledOf = (schedule) => schedule.segments.filter((s) => s.status === TASK_STATUSES.SCHEDULED);

test('segment completion credits only that segment', () => {
  assert.deepEqual(
    segmentActualTimes({ segmentStart: `${DAY}T09:00:00`, segmentEnd: `${DAY}T10:00:00`, now: `${DAY}T16:00:00` }),
    { actualStart: `${DAY}T09:00:00`, actualEnd: `${DAY}T10:00:00` }
  );
  assert.deepEqual(
    segmentActualTimes({ segmentStart: `${DAY}T09:00:00`, segmentEnd: `${DAY}T10:00:00`, now: `${DAY}T09:40:00` }),
    { actualStart: `${DAY}T09:00:00`, actualEnd: `${DAY}T09:40:00` }
  );
  assert.deepEqual(
    segmentActualTimes({ segmentStart: `${DAY}T11:00:00`, segmentEnd: `${DAY}T12:00:00`, now: `${DAY}T08:30:00` }),
    { actualStart: `${DAY}T07:30:00`, actualEnd: `${DAY}T08:30:00` }
  );
});

test('completing one piece of a local split task keeps the other piece scheduled', () => {
  const tasks = [splitTask()];
  const before = plan(tasks);
  const [first, second] = scheduledOf(before);
  assert.equal(scheduledOf(before).length, 2);

  const scope = completionScope({
    tasks,
    schedule: before,
    taskId: 'essay',
    segmentStart: first.start,
    segmentEnd: first.end
  });
  assert.equal(scope, 'segment');

  const record = selectTaskForCompletion(tasks, { taskId: 'essay', segmentStart: first.start, segmentEnd: first.end });
  const afterTasks = completeSegmentInList(tasks, record, {
    actualStart: first.start,
    actualEnd: first.end
  });

  assert.equal(afterTasks.length, 2);
  assert.equal(afterTasks[0].status, TASK_STATUSES.PENDING);
  assert.equal(afterTasks[1].status, TASK_STATUSES.COMPLETED);
  assert.equal(afterTasks[1].partialCompletion, true);

  const after = plan(afterTasks, `${DAY}T10:00:00`);
  assert.deepEqual(scheduledOf(after).map((s) => [s.start, s.end]), [[second.start, second.end]]);
});

test('the last remaining piece completes the whole task', () => {
  const tasks = [splitTask()];
  const before = plan(tasks);
  const [first, second] = scheduledOf(before);
  const afterFirst = completeSegmentInList(tasks, tasks[0], { actualStart: first.start, actualEnd: first.end });
  const middle = plan(afterFirst, `${DAY}T10:00:00`);

  assert.equal(completionScope({
    tasks: afterFirst,
    schedule: middle,
    taskId: 'essay',
    segmentStart: second.start,
    segmentEnd: second.end
  }), 'task');

  const record = selectTaskForCompletion(afterFirst, { taskId: 'essay', segmentStart: second.start, segmentEnd: second.end });
  assert.equal(record.status, TASK_STATUSES.PENDING);
  const done = completeTaskInList(afterFirst, record, { actualStart: second.start, actualEnd: second.end });
  assert.equal(scheduledOf(plan(done, `${DAY}T12:00:00`)).length, 0);
});

test('one Calendar record per segment completes just that record', () => {
  const tasks = [
    { ...splitTask(), segmentId: 'essay_segment_1', calendarEventId: 'e1', status: TASK_STATUSES.SCHEDULED },
    { ...splitTask(), segmentId: 'essay_segment_2', calendarEventId: 'e2', status: TASK_STATUSES.SCHEDULED }
  ];
  const schedule = plan(tasks);
  const [first] = scheduledOf(schedule);
  assert.equal(completionScope({ tasks, schedule, taskId: 'essay', segmentStart: first.start, segmentEnd: first.end }), 'record');
});

test('a finished piece of a Calendar-backed task survives readback and is published', () => {
  const calendarTask = {
    ...splitTask(),
    status: TASK_STATUSES.SCHEDULED,
    calendarEventId: 'event-essay',
    segmentId: 'essay_segment_1',
    plannedStart: `${DAY}T09:00:00`,
    plannedEnd: `${DAY}T11:00:00`
  };
  const local = completeSegmentInList([], calendarTask, {
    actualStart: `${DAY}T09:00:00`,
    actualEnd: `${DAY}T10:00:00`,
    allTasks: [calendarTask]
  });
  const merged = mergePlanTasks({ calendarTasks: [calendarTask], localTasks: local });
  assert.equal(merged.length, 2);
  assert.equal(merged[1].segmentId, 'essay_done_1');

  const schedule = plan(merged, `${DAY}T10:00:00`);
  assert.deepEqual(scheduledOf(schedule).map((s) => s.allocatedMinutes), [60]);

  const operations = buildSyncOperations({
    schedule,
    tasks: merged,
    existingPlanTasks: [calendarTask],
    planDate: DAY
  });
  const completedCreate = operations.creates.find((op) => op.segment.status === TASK_STATUSES.COMPLETED);
  assert.ok(completedCreate, 'finished piece is created as a completed event');
  assert.equal(extractPlanMetadata(completedCreate.description).segmentId, 'essay_done_1');
  assert.equal(operations.updates.length, 1);
  assert.equal(operations.updates[0].eventId, 'event-essay');

  const readBack = { ...local[0], calendarEventId: 'event-done' };
  assert.equal(
    mergePlanTasks({ calendarTasks: [calendarTask, readBack], localTasks: local }).length,
    2,
    'the local copy is dropped once the published event is read back'
  );
});
