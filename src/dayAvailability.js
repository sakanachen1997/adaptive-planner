import { APP_ID, CONTEXTS } from './models.js';

export const DAY_AVAILABILITY_ENTITY = 'dayAvailability';
export const DAY_AVAILABILITY_SCHEMA_VERSION = 1;

const START = '<!-- PLAN_AVAILABILITY';
const END = 'PLAN_AVAILABILITY -->';
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const STANDARD_CONTEXTS = new Set([CONTEXTS.ANY, CONTEXTS.WORK, CONTEXTS.HOME]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nextDate(planDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(planDate);
  if (!match) {
    throw new RangeError('planDate must use YYYY-MM-DD');
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
      || date.getUTCMonth() !== Number(match[2]) - 1
      || date.getUTCDate() !== Number(match[3])
  ) {
    throw new RangeError('planDate must be a real calendar date');
  }

  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function validateBlock(block, index, customContextIds) {
  if (!isPlainObject(block)) {
    throw new TypeError(`day availability block ${index} must be an object`);
  }
  if (!TIME_PATTERN.test(block.start) || !TIME_PATTERN.test(block.end)) {
    throw new RangeError(`day availability block ${index} must use HH:MM times`);
  }
  if (block.end <= block.start) {
    throw new RangeError(`day availability block ${index} end must be later than start`);
  }
  if (block.enabled !== true && block.enabled !== false) {
    throw new TypeError(`day availability block ${index} enabled must be boolean`);
  }

  if (block.context === CONTEXTS.CUSTOM) {
    if (typeof block.customContextId !== 'string' || !block.customContextId.trim()) {
      throw new TypeError(`day availability block ${index} customContextId is required`);
    }
    if (customContextIds.has(block.customContextId)) {
      throw new Error(`duplicate day availability customContextId: ${block.customContextId}`);
    }
    customContextIds.add(block.customContextId);
    if (typeof block.customName !== 'string') {
      throw new TypeError(`day availability block ${index} customName must be a string`);
    }
    return;
  }

  if (!STANDARD_CONTEXTS.has(block.context)) {
    throw new RangeError(`day availability block ${index} has an invalid context`);
  }
}

export function validateDayAvailability(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('day availability metadata must be an object');
  }
  if (value.app !== APP_ID) {
    throw new Error('day availability app is invalid');
  }
  if (value.entityType !== DAY_AVAILABILITY_ENTITY) {
    throw new Error('day availability entityType is invalid');
  }
  if (value.schemaVersion !== DAY_AVAILABILITY_SCHEMA_VERSION) {
    throw new Error('day availability schemaVersion is unsupported');
  }

  nextDate(value.planDate);
  if (!Array.isArray(value.blocks)) {
    throw new TypeError('day availability blocks must be an array');
  }

  const customContextIds = new Set();
  value.blocks.forEach((block, index) => validateBlock(block, index, customContextIds));
  return value;
}

export function buildDayAvailabilityMetadata(planDate, blocks) {
  const metadata = {
    app: APP_ID,
    entityType: DAY_AVAILABILITY_ENTITY,
    schemaVersion: DAY_AVAILABILITY_SCHEMA_VERSION,
    planDate,
    blocks: blocks.map((block) => ({
      start: block.start,
      end: block.end,
      context: block.context,
      enabled: block.enabled !== false,
      customName: String(block.customName ?? ''),
      customContextId: block.customContextId ?? null
    }))
  };

  return validateDayAvailability(metadata);
}

export function buildDayAvailabilityDescription(metadata) {
  validateDayAvailability(metadata);
  return `${START}\n${JSON.stringify(metadata, null, 2)}\n${END}`;
}

export function extractDayAvailabilityMetadata(description = '') {
  const text = String(description ?? '');
  const startIndex = text.indexOf(START);
  if (startIndex === -1) {
    throw new Error('day availability metadata block is missing');
  }
  const contentStart = startIndex + START.length;
  const endIndex = text.indexOf(END, contentStart);
  if (endIndex === -1) {
    throw new Error('day availability metadata block is incomplete');
  }

  let metadata;
  try {
    metadata = JSON.parse(text.slice(contentStart, endIndex).trim());
  } catch (error) {
    throw new Error(`day availability metadata is invalid JSON: ${error.message}`);
  }
  return validateDayAvailability(metadata);
}

export function isDayAvailabilityEvent(event) {
  return event?.extendedProperties?.private?.apEntity === DAY_AVAILABILITY_ENTITY;
}

export function dayAvailabilityFromEvent(event, planDate) {
  if (!isDayAvailabilityEvent(event)) {
    return null;
  }

  const properties = event.extendedProperties.private;
  if (properties.apSchema !== String(DAY_AVAILABILITY_SCHEMA_VERSION)) {
    throw new Error('day availability event schema marker is unsupported');
  }
  if (properties.apPlanDate !== planDate) {
    throw new Error('day availability event property date does not match the requested date');
  }
  if (event?.start?.date !== planDate || event?.end?.date !== nextDate(planDate)) {
    throw new Error('day availability event must be an all-day event for the requested date');
  }

  const metadata = extractDayAvailabilityMetadata(event.description);
  if (metadata.planDate !== planDate) {
    throw new Error('day availability metadata date does not match the requested date');
  }

  return {
    eventId: event.id ?? null,
    etag: event.etag ?? null,
    planDate,
    blocks: metadata.blocks.map((block) => ({ ...block }))
  };
}

export function findDayAvailability(calendarEvents, planDate) {
  const matches = calendarEvents.filter(isDayAvailabilityEvent);
  if (matches.length > 1) {
    throw new Error(`duplicate_day_availability: found ${matches.length} records for ${planDate}`);
  }
  return matches.length === 0 ? null : dayAvailabilityFromEvent(matches[0], planDate);
}

export function dayAvailabilityCalendarBody(metadata) {
  validateDayAvailability(metadata);
  return {
    id: `apavail${metadata.planDate.replaceAll('-', '')}`,
    summary: '[Plan Config] 当日可用时间',
    description: buildDayAvailabilityDescription(metadata),
    start: { date: metadata.planDate },
    end: { date: nextDate(metadata.planDate) },
    transparency: 'transparent',
    visibility: 'private',
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        apEntity: DAY_AVAILABILITY_ENTITY,
        apPlanDate: metadata.planDate,
        apSchema: String(DAY_AVAILABILITY_SCHEMA_VERSION)
      }
    }
  };
}
