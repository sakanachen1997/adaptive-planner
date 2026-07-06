import { APP_ID } from './models.js';

const START = '<!-- PLAN_META';
const END = 'PLAN_META -->';

function findMetadataBlock(description) {
  const startIndex = description.indexOf(START);
  if (startIndex === -1) {
    return null;
  }

  const contentStart = startIndex + START.length;
  const endIndex = description.indexOf(END, contentStart);
  if (endIndex === -1) {
    return null;
  }

  return {
    startIndex,
    contentStart,
    endIndex,
    endBlockIndex: endIndex + END.length
  };
}

function isValidMetadata(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.schemaVersion === 1
    && value.app === APP_ID
    && typeof value.taskId === 'string';
}

export function buildDescription(humanText, metadata) {
  const text = String(humanText ?? '').trim();
  const block = `${START}\n${JSON.stringify(metadata, null, 2)}\n${END}`;

  return text ? `${text}\n\n${block}` : block;
}

export function extractPlanMetadata(description = '') {
  const text = String(description ?? '');
  const block = findMetadataBlock(text);
  if (!block) {
    return null;
  }

  try {
    const metadata = JSON.parse(text.slice(block.contentStart, block.endIndex).trim());
    return isValidMetadata(metadata) ? metadata : null;
  } catch {
    return null;
  }
}

export function isPlanManagedEvent(event) {
  return extractPlanMetadata(event?.description) !== null;
}

export function stripPlanMetadata(description = '') {
  const text = String(description ?? '');
  const block = findMetadataBlock(text);
  if (!block) {
    return text.trim();
  }

  return `${text.slice(0, block.startIndex)}${text.slice(block.endBlockIndex)}`.trim();
}
