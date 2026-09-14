import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayAvailability } from '../src/availability.js';

const date = '2026-07-06';
const block = (start, end, context = 'work') => ({
  start: `${date}T${start}:00`, end: `${date}T${end}:00`, context
});

test('availability merges adjacent windows before removing protected time and elapsed time', () => {
  const availableBlocks = [block('09:00', '10:00'), block('10:00', '12:00')];
  const before = structuredClone(availableBlocks);
  const result = buildDayAvailability({
    planDate: date, scheduleStart: `${date}T09:30:00`, availableBlocks,
    blockedIntervals: [block('10:15', '10:45')]
  });
  assert.deepEqual(result.blocks, [block('09:30', '10:15'), block('10:45', '12:00')]);
  assert.equal(result.availableMinutes, 120);
  assert.deepEqual(availableBlocks, before);
});

test('availability preserves overlapping contexts without duplicating physical capacity', () => {
  const result = buildDayAvailability({
    planDate: date, scheduleStart: `${date}T00:00:00`,
    availableBlocks: [block('09:00', '11:00'), block('10:00', '12:00', 'home')],
    blockedIntervals: [block('10:30', '11:00')]
  });
  assert.equal(result.availableMinutes, 150);
  assert.deepEqual(new Set(result.blocks.map((item) => item.context)), new Set(['work', 'home']));
});

test('disabled, invalid and outside-day availability cannot create capacity', () => {
  const result = buildDayAvailability({
    planDate: date, scheduleStart: `${date}T00:00:00`, blockedIntervals: [],
    availableBlocks: [
      { ...block('09:00', '12:00'), enabled: false },
      { start: 'invalid', end: 'invalid', context: 'work' },
      { start: '2026-07-07T09:00:00', end: '2026-07-07T12:00:00', context: 'work' }
    ]
  });
  assert.deepEqual(result, { blocks: [], availableMinutes: 0 });
});
