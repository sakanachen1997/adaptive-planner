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

test('loadSettings returns defaults when no settings are stored', () => {
  installFakeLocalStorage();

  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('loadSettings returns defaults when stored settings are invalid JSON', () => {
  installFakeLocalStorage();
  globalThis.localStorage.setItem(SETTINGS_KEY, '{bad json');

  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('saveSettings stores JSON that loadSettings can read back', () => {
  installFakeLocalStorage();
  const settings = {
    clientId: 'client-123',
    writeBuffersToCalendar: true,
    defaultBlocks: [
      { start: '08:30', end: '12:00', context: 'work', enabled: true },
      { start: '20:00', end: '22:00', context: 'home', enabled: false }
    ]
  };

  saveSettings(settings);

  assert.equal(globalThis.localStorage.getItem(SETTINGS_KEY), JSON.stringify(settings));
  assert.deepEqual(loadSettings(), settings);
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
