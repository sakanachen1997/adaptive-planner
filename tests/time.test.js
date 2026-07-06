import test from 'node:test';
import assert from 'node:assert/strict';
import * as time from '../src/time.js';

test('combineDateAndTime joins date and HH:MM time with seconds', () => {
  assert.equal(time.combineDateAndTime('2026-07-06', '09:30'), '2026-07-06T09:30:00');
});

test('minutesBetween returns whole non-negative minutes between timestamps', () => {
  assert.equal(time.minutesBetween('2026-07-06T09:00:00', '2026-07-06T10:45:00'), 105);
});

test('minutesBetween compares offset-aware timestamps by visible local wall-clock time', () => {
  assert.equal(time.minutesBetween('2026-07-06T09:00:00+05:00', '2026-07-06T10:00:00'), 60);
});

test('minutesBetween ignores DST start gaps for wall-clock planning', () => {
  assert.equal(time.minutesBetween('2026-03-29T01:30:00', '2026-03-29T03:30:00'), 120);
});

test('minutesBetween ignores DST end repeats for wall-clock planning', () => {
  assert.equal(time.minutesBetween('2026-10-25T01:30:00', '2026-10-25T03:30:00'), 120);
});

test('subtractIntervals removes protected time from available blocks and preserves context', () => {
  const available = [{
    start: '2026-07-06T09:00:00',
    end: '2026-07-06T12:00:00',
    context: 'work'
  }];
  const blocked = [{
    start: '2026-07-06T10:00:00',
    end: '2026-07-06T10:30:00',
    summary: 'protected event'
  }];

  const intervals = time.subtractIntervals(available, blocked);

  assert.deepEqual(intervals, [
    {
      start: '2026-07-06T09:00:00',
      end: '2026-07-06T10:00:00',
      context: 'work'
    },
    {
      start: '2026-07-06T10:30:00',
      end: '2026-07-06T12:00:00',
      context: 'work'
    }
  ]);
  assert.equal(time.totalMinutes(intervals), 150);
});

test('normalizeDateTime strips timezone suffixes and formats Date objects as local wall-clock time', () => {
  assert.equal(time.normalizeDateTime('2026-07-06T10:00:00+02:00'), '2026-07-06T10:00:00');
  assert.equal(time.normalizeDateTime('2026-07-06T10:00:00Z'), '2026-07-06T10:00:00');
  assert.equal(time.normalizeDateTime(new Date(2026, 6, 6, 10, 0, 0)), '2026-07-06T10:00:00');
});

test('addMinutes ignores offset suffixes and returns a local wall-clock string', () => {
  assert.equal(time.addMinutes('2026-07-06T09:00:00+02:00', 30), '2026-07-06T09:30:00');
});

test('addMinutes ignores DST start gaps for wall-clock planning', () => {
  assert.equal(time.addMinutes('2026-03-29T01:30:00', 60), '2026-03-29T02:30:00');
});

test('addMinutes uses timezone-independent calendar rollover', () => {
  assert.equal(time.addMinutes('2026-12-31T23:45:00', 30), '2027-01-01T00:15:00');
  assert.equal(time.addMinutes('2026-01-31T23:45:00', 30), '2026-02-01T00:15:00');
  assert.equal(time.addMinutes('2026-07-06T23:45:00', 30), '2026-07-07T00:15:00');
});

test('subtractIntervals normalizes offset-aware blocked boundaries in output', () => {
  const intervals = time.subtractIntervals(
    [{
      start: '2026-07-06T09:00:00',
      end: '2026-07-06T12:00:00',
      context: 'work'
    }],
    [{
      start: '2026-07-06T10:00:00+02:00',
      end: '2026-07-06T10:30:00+02:00'
    }]
  );

  assert.deepEqual(intervals, [
    {
      start: '2026-07-06T09:00:00',
      end: '2026-07-06T10:00:00',
      context: 'work'
    },
    {
      start: '2026-07-06T10:30:00',
      end: '2026-07-06T12:00:00',
      context: 'work'
    }
  ]);
});

test('subtractIntervals merges overlapping blocked intervals without duplicate gaps', () => {
  const intervals = time.subtractIntervals(
    [{
      start: '2026-07-06T09:00:00',
      end: '2026-07-06T12:00:00',
      context: 'work'
    }],
    [
      { start: '2026-07-06T10:00:00', end: '2026-07-06T11:00:00' },
      { start: '2026-07-06T10:30:00', end: '2026-07-06T11:30:00' }
    ]
  );

  assert.deepEqual(intervals, [
    {
      start: '2026-07-06T09:00:00',
      end: '2026-07-06T10:00:00',
      context: 'work'
    },
    {
      start: '2026-07-06T11:30:00',
      end: '2026-07-06T12:00:00',
      context: 'work'
    }
  ]);
});

test('subtractIntervals returns an empty array when blocked intervals fully cover availability', () => {
  const intervals = time.subtractIntervals(
    [{
      start: '2026-07-06T09:00:00',
      end: '2026-07-06T12:00:00',
      context: 'work'
    }],
    [
      { start: '2026-07-06T08:00:00', end: '2026-07-06T13:00:00' }
    ]
  );

  assert.deepEqual(intervals, []);
});

test('subtractIntervals sorts unsorted inputs and clips blocked intervals at available boundaries', () => {
  const intervals = time.subtractIntervals(
    [
      {
        start: '2026-07-06T13:00:00',
        end: '2026-07-06T15:00:00',
        context: 'home'
      },
      {
        start: '2026-07-06T09:00:00',
        end: '2026-07-06T12:00:00',
        context: 'work'
      }
    ],
    [
      { start: '2026-07-06T14:00:00', end: '2026-07-06T16:00:00' },
      { start: '2026-07-06T08:00:00', end: '2026-07-06T09:30:00' },
      { start: '2026-07-06T12:00:00', end: '2026-07-06T13:00:00' }
    ]
  );

  assert.deepEqual(intervals, [
    {
      start: '2026-07-06T09:30:00',
      end: '2026-07-06T12:00:00',
      context: 'work'
    },
    {
      start: '2026-07-06T13:00:00',
      end: '2026-07-06T14:00:00',
      context: 'home'
    }
  ]);
});
