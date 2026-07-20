import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayAvailabilityDescription,
  buildDayAvailabilityMetadata,
  dayAvailabilityCalendarBody,
  dayAvailabilityFromEvent,
  extractDayAvailabilityMetadata,
  findDayAvailability,
  isDayAvailabilityEvent
} from '../src/dayAvailability.js';

function blocks() {
  return [
    {
      start: '09:00',
      end: '16:30',
      context: 'work',
      enabled: true,
      customName: '',
      customContextId: null
    },
    {
      start: '17:20',
      end: '23:00',
      context: 'custom',
      enabled: true,
      customName: '家中电脑',
      customContextId: 'custom:home-pc'
    }
  ];
}

function availabilityEvent(overrides = {}) {
  const metadata = buildDayAvailabilityMetadata('2026-07-20', blocks());
  return {
    ...dayAvailabilityCalendarBody(metadata),
    id: 'availability-1',
    etag: '"revision-1"',
    ...overrides
  };
}

test('day availability metadata round trips without changing local block identity', () => {
  const metadata = buildDayAvailabilityMetadata('2026-07-20', blocks());
  const description = buildDayAvailabilityDescription(metadata);

  assert.match(description, /^<!-- PLAN_AVAILABILITY\n/);
  assert.deepEqual(extractDayAvailabilityMetadata(description), metadata);
});

test('day availability uses one private transparent all-day Calendar event', () => {
  const body = dayAvailabilityCalendarBody(
    buildDayAvailabilityMetadata('2026-07-20', blocks())
  );

  assert.equal(body.summary, '[Plan Config] 当日可用时间');
  assert.equal(body.id, 'apavail20260720');
  assert.deepEqual(body.start, { date: '2026-07-20' });
  assert.deepEqual(body.end, { date: '2026-07-21' });
  assert.equal(body.transparency, 'transparent');
  assert.equal(body.visibility, 'private');
  assert.deepEqual(body.reminders, { useDefault: false });
  assert.deepEqual(body.extendedProperties.private, {
    apEntity: 'dayAvailability',
    apPlanDate: '2026-07-20',
    apSchema: '1'
  });
});

test('day availability event parses blocks and concurrency identity', () => {
  const event = availabilityEvent();

  assert.equal(isDayAvailabilityEvent(event), true);
  assert.deepEqual(dayAvailabilityFromEvent(event, '2026-07-20'), {
    eventId: 'availability-1',
    etag: '"revision-1"',
    planDate: '2026-07-20',
    blocks: blocks()
  });
});

test('duplicate day availability records crash instead of being merged', () => {
  assert.throws(
    () => findDayAvailability([
      availabilityEvent({ id: 'availability-1' }),
      availabilityEvent({ id: 'availability-2' })
    ], '2026-07-20'),
    /duplicate_day_availability/
  );
});

test('a mismatched all-day date crashes instead of silently loading the payload', () => {
  assert.throws(
    () => dayAvailabilityFromEvent(availabilityEvent({
      start: { date: '2026-07-19' },
      end: { date: '2026-07-20' }
    }), '2026-07-20'),
    /all-day event/
  );
});

test('invalid and duplicate custom contexts crash before Calendar writes', () => {
  assert.throws(
    () => buildDayAvailabilityMetadata('2026-07-20', [
      blocks()[1],
      { ...blocks()[1], start: '18:00', end: '19:00' }
    ]),
    /duplicate.*customContextId/
  );
  assert.throws(
    () => buildDayAvailabilityMetadata('2026-07-20', [{
      ...blocks()[0],
      start: '16:30',
      end: '09:00'
    }]),
    /end must be later/
  );
});
