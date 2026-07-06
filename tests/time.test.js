import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combineDateAndTime,
  minutesBetween,
  subtractIntervals,
  totalMinutes
} from '../src/time.js';

test('combineDateAndTime joins date and HH:MM time with seconds', () => {
  assert.equal(combineDateAndTime('2026-07-06', '09:30'), '2026-07-06T09:30:00');
});

test('minutesBetween returns whole non-negative minutes between timestamps', () => {
  assert.equal(minutesBetween('2026-07-06T09:00:00', '2026-07-06T10:45:00'), 105);
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

  const intervals = subtractIntervals(available, blocked);

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
  assert.equal(totalMinutes(intervals), 150);
});
