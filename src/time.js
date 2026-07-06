const MINUTE_MS = 60_000;

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDateTime(date) {
  return formatDateTimeParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  );
}

function formatDateTimeParts(year, month, day, hours, minutes, seconds) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}T${padDatePart(hours)}:${padDatePart(minutes)}:${padDatePart(seconds)}`;
}

function formatWallClockDateTime(index) {
  const date = new Date(index);
  return formatDateTimeParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  );
}

function parseDateTimeParts(value) {
  const normalized = normalizeDateTime(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  return {
    year: Number(year),
    monthIndex: Number(month) - 1,
    day: Number(day),
    hours: Number(hours),
    minutes: Number(minutes),
    seconds: Number(seconds)
  };
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
  const parts = parseDateTimeParts(value);
  if (!parts) {
    return Number.NaN;
  }

  return Date.UTC(
    parts.year,
    parts.monthIndex,
    parts.day,
    parts.hours,
    parts.minutes,
    parts.seconds
  );
}

export function minutesBetween(start, end) {
  const minutes = Math.floor((toMillis(end) - toMillis(start)) / MINUTE_MS);
  return Math.max(0, minutes);
}

export function addMinutes(start, minutes) {
  return formatWallClockDateTime(toMillis(start) + minutes * MINUTE_MS);
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
