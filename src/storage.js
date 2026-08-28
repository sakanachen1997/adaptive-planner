const SETTINGS_KEY = 'adaptivePlanner.settings.v1';
const TASK_PRESETS_KEY = 'adaptivePlanner.taskPresets.v1';
export const MAX_TASK_PRESETS = 10;

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

function isValidTaskPresetInput(input) {
  const stringFields = [
    'taskName',
    'taskType',
    'desiredMinutes',
    'minimumMinutes',
    'importance',
    'urgency',
    'deadline',
    'executionContext',
    'energyDemand',
    'physicalDemand',
    'orderPreference',
    'minSegmentMinutes',
    'externalCommitment',
    'fixedStart',
    'fixedEnd'
  ];

  return isPlainObject(input)
    && stringFields.every((field) => typeof input[field] === 'string')
    && typeof input.splittable === 'boolean'
    && typeof input.fixed === 'boolean'
    && Array.isArray(input.dependencyTaskIds)
    && input.dependencyTaskIds.every((taskId) => typeof taskId === 'string');
}

function isValidTaskPreset(preset) {
  return isPlainObject(preset)
    && typeof preset.id === 'string'
    && preset.id.trim() !== ''
    && typeof preset.name === 'string'
    && preset.name.trim() !== ''
    && isValidTaskPresetInput(preset.taskInput);
}

function cloneTaskPreset(preset) {
  return {
    ...preset,
    taskInput: {
      ...preset.taskInput,
      dependencyTaskIds: [...preset.taskInput.dependencyTaskIds]
    }
  };
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

export function loadTaskPresets() {
  const storage = getLocalStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(TASK_PRESETS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidTaskPreset)
      .slice(0, MAX_TASK_PRESETS)
      .map(cloneTaskPreset);
  } catch {
    return [];
  }
}

export function saveTaskPresets(presets) {
  const storage = getLocalStorage();
  if (
    !storage
      || !Array.isArray(presets)
      || presets.length > MAX_TASK_PRESETS
      || !presets.every(isValidTaskPreset)
  ) {
    return false;
  }

  try {
    storage.setItem(TASK_PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}
