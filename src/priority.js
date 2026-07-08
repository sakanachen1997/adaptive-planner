import { CONTEXTS } from './models.js';
import { minutesBetween, normalizeDateTime } from './time.js';

const ENERGY_SCORE = Object.freeze({
  high: Object.freeze({
    high: 5,
    mediumHigh: 4,
    medium: 3,
    mediumLow: 2,
    low: 1
  }),
  medium: Object.freeze({
    high: 3,
    mediumHigh: 4,
    medium: 5,
    mediumLow: 4,
    low: 3
  }),
  low: Object.freeze({
    high: 1,
    mediumHigh: 2,
    medium: 3,
    mediumLow: 5,
    low: 5
  })
});

function intervalStartHour(interval) {
  if (interval.start instanceof Date) {
    return interval.start.getHours();
  }

  const match = String(interval.start).match(/T(\d{2})/);
  return match ? Number(match[1]) : new Date(interval.start).getHours();
}

export function calculateUrgency(deadline, now = new Date()) {
  if (!deadline) {
    return 0;
  }

  const normalizedDeadline = normalizeDateTime(deadline);
  const normalizedNow = normalizeDateTime(now);

  if (normalizedDeadline <= normalizedNow) {
    return 6;
  }

  const remainingHours = minutesBetween(normalizedNow, normalizedDeadline) / 60;

  if (remainingHours <= 6) {
    return 5;
  }
  if (remainingHours <= 24) {
    return 4;
  }
  if (remainingHours <= 72) {
    return 2;
  }
  return 1;
}

export function calculatePriority(task, now = new Date()) {
  const importance = Number(task.importance ?? 0);
  const urgency = calculateUrgency(task.deadline, now);
  const desiredMinutes = Math.max(1, Number(task.desiredMinutes ?? 1));
  const externalCommitment = Number(task.externalCommitment ?? 0);

  return importance * 10
    + urgency * 6
    + Math.sqrt(desiredMinutes)
    + externalCommitment * 4;
}

export function energyLevelForHour(hour) {
  const normalizedHour = Number(hour);

  if (normalizedHour >= 8 && normalizedHour < 12) {
    return 'high';
  }
  if (normalizedHour >= 12 && normalizedHour < 14) {
    return 'medium';
  }
  if (normalizedHour >= 17 && normalizedHour < 21) {
    return 'medium';
  }
  return 'low';
}

export function periodForHour(hour) {
  const normalizedHour = Number(hour);

  if (normalizedHour >= 5 && normalizedHour < 12) {
    return 'morning';
  }
  if (normalizedHour >= 12 && normalizedHour < 17) {
    return 'afternoon';
  }
  return 'evening';
}

export function scorePlacement(task, interval) {
  const startHour = intervalStartHour(interval);
  const slotEnergy = energyLevelForHour(startHour);
  const energyFit = ENERGY_SCORE[slotEnergy]?.[task.energyDemand] ?? 3;
  const contextFit = task.executionContext === CONTEXTS.ANY || task.executionContext === interval.context
    ? 5
    : -20;
  const gapFit = task.splittable ? 2 : 0;
  const preference = task.orderPreference ?? 'any';
  const preferenceFit = preference !== 'any' && periodForHour(startHour) === preference
    ? 6
    : 0;

  return energyFit * 4 + contextFit + gapFit + preferenceFit;
}
