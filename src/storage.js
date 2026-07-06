const SETTINGS_KEY = 'adaptivePlanner.settings.v1';

const DEFAULT_BLOCKS = Object.freeze([
  Object.freeze({ start: '09:00', end: '18:00', context: 'work', enabled: true }),
  Object.freeze({ start: '19:30', end: '23:00', context: 'home', enabled: true })
]);

export const DEFAULT_SETTINGS = Object.freeze({
  clientId: '',
  writeBuffersToCalendar: false,
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

export function loadSettings() {
  const raw = globalThis.localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return defaultSettings();
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      defaultBlocks: Array.isArray(parsed?.defaultBlocks)
        ? cloneBlocks(parsed.defaultBlocks)
        : cloneBlocks(DEFAULT_SETTINGS.defaultBlocks)
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings) {
  globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
