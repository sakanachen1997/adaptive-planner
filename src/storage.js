const SETTINGS_KEY = 'adaptivePlanner.settings.v1';

const DEFAULT_BLOCKS = Object.freeze([
  Object.freeze({ start: '09:00', end: '18:00', context: 'work', enabled: true }),
  Object.freeze({ start: '19:30', end: '23:00', context: 'home', enabled: true })
]);

export const DEFAULT_SETTINGS = Object.freeze({
  clientId: '',
  writeBuffersToCalendar: false,
  scheduleFromNow: false,
  defaultBlocks: DEFAULT_BLOCKS
});

function cloneBlocks(blocks) {
  return blocks.map((block) => ({ ...block }));
}

function defaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    defaultBlocks: cloneBlocks(DEFAULT_SETTINGS.defaultBlocks)
  };
}

function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDefaultBlock(block) {
  return isPlainObject(block)
    && typeof block.start === 'string'
    && typeof block.end === 'string'
    && typeof block.context === 'string'
    && typeof block.enabled === 'boolean'
    && (block.customName == null || typeof block.customName === 'string')
    && (block.customContextId == null || typeof block.customContextId === 'string');
}

function isValidSettings(settings) {
  return isPlainObject(settings)
    && typeof settings.clientId === 'string'
    && typeof settings.writeBuffersToCalendar === 'boolean'
    && (settings.scheduleFromNow == null || typeof settings.scheduleFromNow === 'boolean')
    && Array.isArray(settings.defaultBlocks)
    && settings.defaultBlocks.every(isValidDefaultBlock);
}

export function loadSettings() {
  const storage = getLocalStorage();
  if (!storage) {
    return defaultSettings();
  }

  let raw;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    return defaultSettings();
  }

  if (!raw) {
    return defaultSettings();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isValidSettings(parsed)) {
      return defaultSettings();
    }

    return {
      clientId: parsed.clientId,
      writeBuffersToCalendar: parsed.writeBuffersToCalendar,
      scheduleFromNow: parsed.scheduleFromNow === true,
      defaultBlocks: cloneBlocks(parsed.defaultBlocks)
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings) {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
