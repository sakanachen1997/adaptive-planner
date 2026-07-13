import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/storage.js';

const SETTINGS_KEY = 'adaptivePlanner.settings.v1';

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
