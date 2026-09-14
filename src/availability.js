import { addMinutes, normalizeDateTime, sortIntervals, subtractIntervals, toMillis, totalMinutes } from './time.js';

function unionIntervals(intervals) {
  const merged = [];
  for (const interval of sortIntervals(intervals)) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) {
      if (interval.end > previous.end) previous.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function availableCapacityMinutes(blocks) {
  return totalMinutes(unionIntervals(blocks));
}

export function buildDayAvailability({ planDate, scheduleStart, availableBlocks = [], blockedIntervals = [] }) {
  const dayStart = `${planDate}T00:00:00`;
  const dayEnd = addMinutes(dayStart, 1440);
  const start = normalizeDateTime(scheduleStart);
  const lowerBound = start > dayStart ? start : dayStart;
  const byContext = new Map();

  for (const block of availableBlocks) {
    if (block.enabled === false) continue;
    const blockStart = normalizeDateTime(block.start);
    const blockEnd = normalizeDateTime(block.end);
    if (!Number.isFinite(toMillis(blockStart)) || !Number.isFinite(toMillis(blockEnd))) continue;
    const clipped = {
      ...block,
      start: blockStart < lowerBound ? lowerBound : blockStart,
      end: blockEnd > dayEnd ? dayEnd : blockEnd
    };
    if (clipped.end <= clipped.start) continue;
    const group = byContext.get(block.context) ?? [];
    group.push(clipped);
    byContext.set(block.context, group);
  }

  // Contexts retain their eligibility, but share one physical clock capacity.
  const blocks = subtractIntervals(
    [...byContext.values()].flatMap(unionIntervals),
    blockedIntervals
  );
  return { blocks, availableMinutes: availableCapacityMinutes(blocks) };
}
