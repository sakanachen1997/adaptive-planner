const MINUTE_MS = 60_000;

function formatLocalDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function parseLocalDateTime(value) {
  const normalized = normalizeDateTime(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);

  if (!match) {
    return new Date(Number.NaN);
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds)
  );
}

function positiveInterval(interval) {
  return toMillis(interval.end) > toMillis(interval.start);
}

function normalizeInterval(interval) {
  return {
    ...interval,
    start: normalizeDateTime(interval.start),
    end: normalizeDateTime(interval.end)
  };
}

export function combineDateAndTime(date, time) {
  return `${date}T${time}:00`;
}

export function normalizeDateTime(value) {
  if (value instanceof Date) {
    return formatLocalDateTime(value);
  }

  const text = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return `${text}:00`;
  }

  return text.slice(0, 19);
}

export function toMillis(value) {
  return parseLocalDateTime(value).getTime();
}

export function minutesBetween(start, end) {
  const minutes = Math.floor((toMillis(end) - toMillis(start)) / MINUTE_MS);
  return Math.max(0, minutes);
}

export function addMinutes(start, minutes) {
  return formatLocalDateTime(new Date(toMillis(start) + minutes * MINUTE_MS));
}

export function totalMinutes(intervals) {
  return intervals.reduce((total, interval) => (
    total + minutesBetween(interval.start, interval.end)
  ), 0);
}

export function sortIntervals(intervals) {
  return [...intervals].sort((left, right) => (
    toMillis(left.start) - toMillis(right.start)
      || toMillis(left.end) - toMillis(right.end)
  ));
}

export function subtractIntervals(available, blocked) {
  const blockedIntervals = sortIntervals(blocked.map(normalizeInterval)).filter(positiveInterval);
  const result = [];

  for (const block of sortIntervals(available.map(normalizeInterval)).filter(positiveInterval)) {
    let currentStart = block.start;
    const blockEndMs = toMillis(block.end);

    for (const protectedInterval of blockedIntervals) {
      const protectedStartMs = toMillis(protectedInterval.start);
      const protectedEndMs = toMillis(protectedInterval.end);
      const currentStartMs = toMillis(currentStart);

      if (protectedEndMs <= currentStartMs || protectedStartMs >= blockEndMs) {
        continue;
      }

      if (protectedStartMs > currentStartMs) {
        result.push({
          ...block,
          start: currentStart,
          end: protectedInterval.start
        });
      }

      if (protectedEndMs > currentStartMs) {
        currentStart = protectedInterval.end;
      }

      if (toMillis(currentStart) >= blockEndMs) {
        break;
      }
    }

    result.push({
      ...block,
      start: currentStart,
      end: block.end
    });
  }

  return result.filter(positiveInterval);
}
