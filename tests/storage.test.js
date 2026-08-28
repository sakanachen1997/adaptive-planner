import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  MAX_TASK_PRESETS,
  loadSettings,
  loadTaskPresets,
  saveSettings,
  saveTaskPresets
} from '../src/storage.js';

const SETTINGS_KEY = 'adaptivePlanner.settings.v1';
const TASK_PRESETS_KEY = 'adaptivePlanner.taskPresets.v1';

function taskPreset(overrides = {}) {
  return {
    id: 'preset-1',
    name: '晨间复盘',
    ...overrides,
    taskInput: {
      taskName: '晨间复盘',
      taskType: '自定义',
      desiredMinutes: '30',
      minimumMinutes: '20',
      importance: '3',
      urgency: '1',
      deadline: '',
      executionContext: 'any',
      energyDemand: 'medium',
      physicalDemand: 'low',
      orderPreference: 'morning',
      splittable: false,
      minSegmentMinutes: '20',
      externalCommitment: '1',
      fixed: false,
      fixedStart: '',
      fixedEnd: '',
      dependencyTaskIds: [],
      ...overrides.taskInput
    }
  };
}

function installFakeLocalStorage() {
  const items = new Map();

  globalThis.localStorage = {
    getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    setItem(key, value) {
      items.set(key, String(value));
    },
    removeItem(key) {
      items.delete(key);
    },
    clear() {
      items.clear();
    }
  };
}

function removeLocalStorage() {
  Reflect.deleteProperty(globalThis, 'localStorage');
}

function installThrowingLocalStorage({ getItem, setItem }) {
  globalThis.localStorage = {
    getItem() {
      if (getItem) throw new Error('getItem failed');
      return null;
    },
    setItem() {
      if (setItem) throw new Error('setItem failed');
    },
    removeItem() {},
    clear() {}
  };
}

test('loadSettings returns defaults when no settings are stored', () => {
  installFakeLocalStorage();

  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('loadSettings returns defaults when localStorage is missing', () => {
  removeLocalStorage();

  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('loadSettings returns defaults when localStorage getItem throws', () => {
  installThrowingLocalStorage({ getItem: true });

  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('loadSettings returns defaults when stored settings are invalid JSON', () => {
  installFakeLocalStorage();
  globalThis.localStorage.setItem(SETTINGS_KEY, '{bad json');

  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('loadSettings returns defaults when stored settings have an invalid shape', () => {
  installFakeLocalStorage();
  const invalidSettings = [
    null,
    [],
    'settings',
    {
      clientId: 123,
      writeBuffersToCalendar: false,
      defaultBlocks: DEFAULT_SETTINGS.defaultBlocks
    },
    {
      clientId: '',
      writeBuffersToCalendar: 'false',
      defaultBlocks: DEFAULT_SETTINGS.defaultBlocks
    },
    {
      clientId: '',
      writeBuffersToCalendar: false,
      defaultBlocks: [{ start: '09:00', end: '18:00', context: 'work' }]
    },
    {
      clientId: '',
      writeBuffersToCalendar: false,
      defaultBlocks: [{ start: '09:00', end: '18:00', context: 'work', enabled: 'yes' }]
    }
  ];

  for (const settings of invalidSettings) {
    globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  }
});

test('saveSettings stores JSON that loadSettings can read back', () => {
  installFakeLocalStorage();
  const settings = {
    clientId: 'client-123',
    writeBuffersToCalendar: true,
    scheduleFromNow: false,
    defaultBlocks: [
      { start: '08:30', end: '12:00', context: 'work', enabled: true },
      { start: '20:00', end: '22:00', context: 'home', enabled: false }
    ]
  };

  assert.equal(saveSettings(settings), true);

  assert.equal(globalThis.localStorage.getItem(SETTINGS_KEY), JSON.stringify(settings));
  assert.deepEqual(loadSettings(), settings);
});

test('saveSettings returns false and does not throw when localStorage is missing', () => {
  removeLocalStorage();

  assert.doesNotThrow(() => {
    assert.equal(saveSettings(DEFAULT_SETTINGS), false);
  });
});

test('saveSettings returns false and does not throw when localStorage setItem throws', () => {
  installThrowingLocalStorage({ setItem: true });

  assert.doesNotThrow(() => {
    assert.equal(saveSettings(DEFAULT_SETTINGS), false);
  });
});

test('loadSettings clones default blocks when returning defaults', () => {
  installFakeLocalStorage();

  const firstLoad = loadSettings();
  firstLoad.defaultBlocks[0].start = '00:00';
  firstLoad.defaultBlocks.push({ start: '23:00', end: '23:30', context: 'home', enabled: true });
  const secondLoad = loadSettings();

  assert.notEqual(firstLoad.defaultBlocks, DEFAULT_SETTINGS.defaultBlocks);
  assert.notEqual(firstLoad.defaultBlocks[0], DEFAULT_SETTINGS.defaultBlocks[0]);
  assert.deepEqual(secondLoad.defaultBlocks, DEFAULT_SETTINGS.defaultBlocks);
});

test('loadSettings clones custom blocks from valid stored JSON on each load', () => {
  installFakeLocalStorage();
  const settings = {
    clientId: 'client-123',
    writeBuffersToCalendar: true,
    defaultBlocks: [
      { start: '08:00', end: '10:00', context: 'work', enabled: true }
    ]
  };
  globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  const firstLoad = loadSettings();
  firstLoad.defaultBlocks[0].start = '00:00';
  const secondLoad = loadSettings();

  assert.notEqual(firstLoad.defaultBlocks, secondLoad.defaultBlocks);
  assert.notEqual(firstLoad.defaultBlocks[0], secondLoad.defaultBlocks[0]);
  assert.deepEqual(secondLoad.defaultBlocks, settings.defaultBlocks);
});

test('scheduleFromNow round-trips and defaults to false for legacy settings', () => {
  installFakeLocalStorage();

  const withFlag = {
    clientId: '',
    writeBuffersToCalendar: false,
    scheduleFromNow: true,
    defaultBlocks: [{ start: '09:00', end: '10:00', context: 'work', enabled: true }]
  };
  assert.equal(saveSettings(withFlag), true);
  assert.equal(loadSettings().scheduleFromNow, true);

  // Legacy settings saved before the field existed load as false.
  globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    clientId: '',
    writeBuffersToCalendar: false,
    defaultBlocks: [{ start: '09:00', end: '10:00', context: 'work', enabled: true }]
  }));
  assert.equal(loadSettings().scheduleFromNow, false);
});

test('named custom block identity and label survive settings round trip', () => {
  installFakeLocalStorage();
  const settings = {
    clientId: '',
    writeBuffersToCalendar: false,
    scheduleFromNow: false,
    defaultBlocks: [{
      start: '14:00',
      end: '16:00',
      context: 'custom',
      enabled: true,
      customName: 'A',
      customContextId: 'custom:a'
    }]
  };

  assert.equal(saveSettings(settings), true);
  assert.deepEqual(loadSettings(), settings);
});

test('task presets round-trip independently from settings and are cloned', () => {
  installFakeLocalStorage();
  const presets = [taskPreset({ taskInput: { dependencyTaskIds: ['research'] } })];

  assert.equal(saveTaskPresets(presets), true);
  assert.deepEqual(loadTaskPresets(), presets);
  assert.equal(globalThis.localStorage.getItem(SETTINGS_KEY), null);

  const firstLoad = loadTaskPresets();
  firstLoad[0].taskInput.taskName = 'changed';
  firstLoad[0].taskInput.dependencyTaskIds.push('review');
  assert.deepEqual(loadTaskPresets(), presets);
});

test('task preset storage rejects more than ten presets', () => {
  installFakeLocalStorage();
  const presets = Array.from({ length: MAX_TASK_PRESETS + 1 }, (_, index) => taskPreset({
    id: `preset-${index}`,
    name: `预设 ${index}`
  }));

  assert.equal(MAX_TASK_PRESETS, 10);
  assert.equal(saveTaskPresets(presets), false);
  assert.equal(globalThis.localStorage.getItem(TASK_PRESETS_KEY), null);
});

test('task preset loading drops malformed entries without losing valid presets', () => {
  installFakeLocalStorage();
  const valid = taskPreset();
  globalThis.localStorage.setItem(TASK_PRESETS_KEY, JSON.stringify([
    valid,
    { id: 'broken', name: 'Broken', taskInput: { taskName: 'Broken' } }
  ]));

  assert.deepEqual(loadTaskPresets(), [valid]);
});
