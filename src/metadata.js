import { APP_ID } from './models.js';

const START = '<!-- PLAN_META';
const END = 'PLAN_META -->';

function isValidMetadata(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.schemaVersion === 1
    && value.app === APP_ID
    && typeof value.taskId === 'string';
}

function parseBlock(description, block) {
  try {
    const metadata = JSON.parse(textForBlock(description, block));
    return isValidMetadata(metadata) ? metadata : null;
  } catch {
    return null;
  }
}

function textForBlock(description, block) {
  return description.slice(block.contentStart, block.endIndex).trim();
}

function findValidMetadataBlock(description) {
  let searchIndex = 0;

  while (searchIndex < description.length) {
    const startIndex = description.indexOf(START, searchIndex);
    if (startIndex === -1) {
      return null;
    }

    const contentStart = startIndex + START.length;
    const endIndex = description.indexOf(END, contentStart);
    if (endIndex !== -1) {
      const block = {
        startIndex,
        contentStart,
        endIndex,
        endBlockIndex: endIndex + END.length
      };
      const metadata = parseBlock(description, block);

      if (metadata) {
        return { block, metadata };
      }
    }

    searchIndex = startIndex + START.length;
  }

  return null;
}

export function buildDescription(humanText, metadata) {
  const text = String(humanText ?? '').trim();
  const block = `${START}\n${JSON.stringify(metadata, null, 2)}\n${END}`;

  return text ? `${text}\n\n${block}` : block;
}

export function extractPlanMetadata(description = '') {
  const text = String(description ?? '');
  return findValidMetadataBlock(text)?.metadata ?? null;
}

export function isPlanManagedEvent(event) {
  return extractPlanMetadata(event?.description) !== null;
}

export function stripPlanMetadata(description = '') {
  const text = String(description ?? '');
  const result = findValidMetadataBlock(text);
  if (!result) {
    return text;
  }

  const { block } = result;
  return `${text.slice(0, block.startIndex)}${text.slice(block.endBlockIndex)}`.trim();
}
