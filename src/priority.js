import { CONTEXTS } from './models.js';

const HOURS = 60 * 60 * 1000;

const ENERGY_FIT = Object.freeze({
  high: Object.freeze({
    high: 3,
    medium: 1,
    low: -2
  }),
  mediumHigh: Object.freeze({
    high: 2,
    medium: 2,
    low: -1
  }),
  medium: Object.freeze({
    high: 1,
    medium: 3,
    low: 1
  }),
  mediumLow: Object.freeze({
    high: 0,
    medium: 2,
    low: 3
  }),
  low: Object.freeze({
    high: 0,
    medium: 2,
    low: 3
  })
});

function timestamp(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

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

  const remainingHours = (timestamp(deadline) - timestamp(now)) / HOURS;

  if (remainingHours <= 0) {
    return 6;
  }
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

export function scorePlacement(task, interval) {
  const energyLevel = energyLevelForHour(intervalStartHour(interval));
  const energyFit = ENERGY_FIT[task.energyDemand]?.[energyLevel] ?? 0;
  const contextFit = task.executionContext === CONTEXTS.ANY || task.executionContext === interval.context
    ? 5
    : -20;
  const gapFit = task.splittable ? 2 : 0;

  return energyFit * 4 + contextFit + gapFit;
}
