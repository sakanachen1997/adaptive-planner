import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_ID } from '../src/models.js';
import {
  buildDescription,
  extractPlanMetadata,
  isPlanManagedEvent,
  stripPlanMetadata
} from '../src/metadata.js';

test('buildDescription and extractPlanMetadata round trip valid metadata', () => {
  const metadata = {
    schemaVersion: 1,
    app: APP_ID,
    taskId: 'task-123',
    segmentId: 'segment-456'
  };

  const description = buildDescription('Focus block', metadata);

  assert.match(description, /^Focus block\n\n<!-- PLAN_META\n/);
  assert.match(description, /  "taskId": "task-123"/);
  assert.equal(description.endsWith('\nPLAN_META -->'), true);
  assert.deepEqual(extractPlanMetadata(description), metadata);
});

test('ordinary calendar events are not plan managed', () => {
  const event = {
    summary: 'Dentist',
    description: 'Bring insurance card'
  };

  assert.equal(extractPlanMetadata(event.description), null);
  assert.equal(isPlanManagedEvent(event), false);
});

test('foreign metadata with app other than APP_ID is rejected', () => {
  const description = buildDescription('Other planner block', {
    schemaVersion: 1,
    app: 'other-planner',
    taskId: 'task-123'
  });

  assert.equal(extractPlanMetadata(description), null);
  assert.equal(isPlanManagedEvent({ description }), false);
});

test('stripPlanMetadata removes plan metadata and trims human text', () => {
  const description = buildDescription('  Focus block  ', {
    schemaVersion: 1,
    app: APP_ID,
    taskId: 'task-123'
  });

  assert.equal(stripPlanMetadata(description), 'Focus block');
});

test('extractPlanMetadata ignores marker-like invalid blocks before valid metadata', () => {
  const metadata = {
    schemaVersion: 1,
    app: APP_ID,
    taskId: 'task-123'
  };
  const invalidBlock = '<!-- PLAN_META\nnot json\nPLAN_META -->';
  const description = `${invalidBlock}\n\n${buildDescription('Focus block', metadata)}`;

  assert.deepEqual(extractPlanMetadata(description), metadata);
});

test('stripPlanMetadata does not remove invalid or foreign metadata from ordinary descriptions', () => {
  const invalidDescription = 'Agenda notes\n\n<!-- PLAN_META\nnot json\nPLAN_META -->';
  const foreignDescription = buildDescription('Other planner block', {
    schemaVersion: 1,
    app: 'other-planner',
    taskId: 'task-123'
  });

  assert.equal(stripPlanMetadata(invalidDescription), invalidDescription);
  assert.equal(stripPlanMetadata(foreignDescription), foreignDescription);
});

test('stripPlanMetadata preserves invalid and foreign blocks before removing valid metadata', () => {
  const invalidBlock = '<!-- PLAN_META\nnot json\nPLAN_META -->';
  const foreignBlock = '<!-- PLAN_META\n{\n  "schemaVersion": 1,\n  "app": "other-planner",\n  "taskId": "foreign-task"\n}\nPLAN_META -->';
  const validBlock = '<!-- PLAN_META\n{\n  "schemaVersion": 1,\n  "app": "adaptive-planner",\n  "taskId": "task-123"\n}\nPLAN_META -->';
  const description = `Agenda notes\n\n${invalidBlock}\n\n${foreignBlock}\n\n${validBlock}`;
  const expected = `Agenda notes\n\n${invalidBlock}\n\n${foreignBlock}`;

  assert.equal(stripPlanMetadata(description), expected);
});
