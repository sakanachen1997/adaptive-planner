import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as calendarClient from '../src/calendarClient.js';

const {
  clearAccessToken,
  createDayAvailabilityEvent,
  createPlanEvent,
  deletePlanEvent,
  getLastAuthError,
  hasAccessToken,
  initGoogleAuth,
  listPrimaryEvents,
  requestAccessToken,
  revokeAccessToken,
  updateDayAvailabilityEvent,
  updatePlanEvent
} = calendarClient;

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const realDateNow = Date.now;

afterEach(() => {
  Date.now = realDateNow;
  clearAccessToken();
  Reflect.deleteProperty(globalThis, 'fetch');
  Reflect.deleteProperty(globalThis, 'google');
});

function installFakeGoogle() {
  const state = {
    tokenConfig: null,
    requestCalls: [],
    revokedTokens: []
  };

  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          state.tokenConfig = config;
          return {
            requestAccessToken(options) {
              state.requestCalls.push(options);
            }
          };
        },
        revoke(token) {
          state.revokedTokens.push(token);
        }
      }
    }
  };

  return state;
}

function authorize(token = 'access-token') {
  const googleState = installFakeGoogle();
  initGoogleAuth('client-123', () => {});
  googleState.tokenConfig.callback({ access_token: token, expires_in: 3600 });
  return googleState;
}

function setNow(value) {
  Date.now = () => value;
}

function resolvedTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function textResponse(text, status = 500) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    }
  };
}

function installFakeFetch(...responses) {
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return responses.shift() ?? jsonResponse({});
  };

  return calls;
}

function planSegment(overrides = {}) {
  return {
    taskName: 'Deep work',
    start: '2026-07-06T09:00:00',
    end: '2026-07-06T10:30:00',
    ...overrides
  };
}

test('initGoogleAuth throws when client ID is missing', () => {
  installFakeGoogle();

  assert.throws(() => initGoogleAuth('', () => {}), /client id/i);
});

test('initGoogleAuth throws when Google identity services are unavailable', () => {
  assert.throws(() => initGoogleAuth('client-123', () => {}), /google identity/i);
});

test('requestAccessToken throws before auth is initialized', () => {
  assert.throws(() => requestAccessToken(), /not initialized/i);
});

test('token callback stores access token and notifies caller', () => {
  const googleState = installFakeGoogle();
  let tokenResponse = null;

  initGoogleAuth('client-123', (response) => {
    tokenResponse = response;
  });
  googleState.tokenConfig.callback({ access_token: 'token-123', expires_in: 3600 });

  assert.equal(googleState.tokenConfig.client_id, 'client-123');
  assert.equal(googleState.tokenConfig.scope, CALENDAR_SCOPE);
  assert.equal('client_secret' in googleState.tokenConfig, false);
  assert.equal(hasAccessToken(), true);
  assert.deepEqual(tokenResponse, { access_token: 'token-123', expires_in: 3600 });

  requestAccessToken();

  assert.deepEqual(googleState.requestCalls, [{ prompt: '' }]);
});

test('token callback records OAuth response errors without throwing', () => {
  const googleState = installFakeGoogle();
  let tokenResponse = null;

  initGoogleAuth('client-123', (response) => {
    tokenResponse = response;
  });

  assert.doesNotThrow(() => {
    googleState.tokenConfig.callback({ error: 'access_denied' });
  });

  assert.equal(hasAccessToken(), false);
  assert.equal(getLastAuthError().message, 'access_denied');
  assert.deepEqual(tokenResponse, { error: 'access_denied' });
});

test('GIS error_callback records auth error without throwing', () => {
  const googleState = authorize('token-before-popup-error');
  let tokenResponse = null;

  initGoogleAuth('client-123', (response) => {
    tokenResponse = response;
  });
  googleState.tokenConfig.callback({ access_token: 'token-before-popup-error', expires_in: 3600 });

  assert.doesNotThrow(() => {
    googleState.tokenConfig.error_callback({ type: 'popup_closed' });
  });

  assert.equal(hasAccessToken(), false);
  assert.equal(getLastAuthError().message, 'popup_closed');
  assert.deepEqual(tokenResponse, { error: 'popup_closed' });
});

test('hasAccessToken becomes false after an expired token response', () => {
  const googleState = installFakeGoogle();
  setNow(1_000_000);

  initGoogleAuth('client-123', () => {});
  googleState.tokenConfig.callback({ access_token: 'already-expired', expires_in: 30 });

  assert.equal(hasAccessToken(), false);
});

test('listPrimaryEvents rejects after token expiry and clears stale token', async () => {
  const googleState = installFakeGoogle();
  setNow(1_000_000);
  initGoogleAuth('client-123', () => {});
  googleState.tokenConfig.callback({ access_token: 'short-lived', expires_in: 61 });
  setNow(1_002_000);
  const calls = installFakeFetch(jsonResponse({ items: [] }));

  await assert.rejects(
    () => listPrimaryEvents('2026-07-06', '2026-07-07'),
    /access token/i
  );
  assert.equal(hasAccessToken(), false);
  assert.equal(calls.length, 0);
});

test('initGoogleAuth clears previous token and auth error state', () => {
  const googleState = installFakeGoogle();
  initGoogleAuth('client-123', () => {});
  googleState.tokenConfig.callback({ access_token: 'old-token', expires_in: 3600 });
  googleState.tokenConfig.callback({ error: 'temporary_error' });

  assert.equal(getLastAuthError().message, 'temporary_error');

  initGoogleAuth('client-456', () => {});

  assert.equal(hasAccessToken(), false);
  assert.equal(getLastAuthError(), null);
});

test('initGoogleAuth with missing client ID clears previous token and token client before throwing', () => {
  const googleState = authorize('token-before-missing-client-id');

  assert.equal(hasAccessToken(), true);
  requestAccessToken();
  assert.deepEqual(googleState.requestCalls, [{ prompt: '' }]);

  assert.throws(() => initGoogleAuth('', () => {}), /client id/i);

  assert.equal(hasAccessToken(), false);
  assert.throws(() => requestAccessToken(), /not initialized/i);
});

test('initGoogleAuth with unavailable GIS clears previous token and token client before throwing', () => {
  const googleState = authorize('token-before-missing-gis');

  assert.equal(hasAccessToken(), true);
  requestAccessToken();
  assert.deepEqual(googleState.requestCalls, [{ prompt: '' }]);

  Reflect.deleteProperty(globalThis, 'google');

  assert.throws(() => initGoogleAuth('client-123', () => {}), /google identity/i);

  assert.equal(hasAccessToken(), false);
  assert.throws(() => requestAccessToken(), /not initialized/i);
});

test('stale token client success callback after failed reinit does not restore access token', () => {
  const googleState = installFakeGoogle();
  initGoogleAuth('client-1', () => {});
  const oldTokenConfig = googleState.tokenConfig;

  assert.throws(() => initGoogleAuth('', () => {}), /client id/i);

  oldTokenConfig.callback({ access_token: 'stale', expires_in: 3600 });

  assert.equal(hasAccessToken(), false);
});

test('stale token client error callback after failed reinit does not record auth error', () => {
  const googleState = installFakeGoogle();
  initGoogleAuth('client-1', () => {});
  const oldTokenConfig = googleState.tokenConfig;

  assert.throws(() => initGoogleAuth('', () => {}), /client id/i);

  oldTokenConfig.callback({ error: 'stale_error' });

  assert.equal(getLastAuthError(), null);
});

test('stale GIS error_callback after successful reinit does not record auth error', () => {
  const googleState = installFakeGoogle();
  initGoogleAuth('client-1', () => {});
  const oldTokenConfig = googleState.tokenConfig;

  initGoogleAuth('client-2', () => {});

  oldTokenConfig.error_callback({ type: 'popup_closed' });

  assert.equal(getLastAuthError(), null);
});

test('revokeAccessToken revokes and clears the current access token', () => {
  const googleState = authorize('token-to-revoke');

  revokeAccessToken();

  assert.deepEqual(googleState.revokedTokens, ['token-to-revoke']);
  assert.equal(hasAccessToken(), false);
});

test('listPrimaryEvents sends query parameters and bearer token', async () => {
  authorize('calendar-token');
  const calls = installFakeFetch(jsonResponse({
    items: [{ id: 'event-1' }]
  }));

  const events = await listPrimaryEvents(
    '2026-07-06T00:00:00Z',
    '2026-07-07T00:00:00Z'
  );

  assert.deepEqual(events, [{ id: 'event-1' }]);
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin, 'https://www.googleapis.com');
  assert.equal(requestUrl.pathname, '/calendar/v3/calendars/primary/events');
  assert.equal(requestUrl.searchParams.get('timeMin'), '2026-07-06T00:00:00Z');
  assert.equal(requestUrl.searchParams.get('timeMax'), '2026-07-07T00:00:00Z');
  assert.equal(requestUrl.searchParams.get('singleEvents'), 'true');
  assert.equal(requestUrl.searchParams.get('orderBy'), 'startTime');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer calendar-token');
});

test('listPrimaryEvents returns an empty array when the response has no items', async () => {
  authorize();
  installFakeFetch(jsonResponse({}));

  assert.deepEqual(await listPrimaryEvents('2026-07-06', '2026-07-07'), []);
});

test('createPlanEvent posts a plan event body', async () => {
  authorize('create-token');
  const calls = installFakeFetch(jsonResponse({ id: 'created-event' }));

  const event = await createPlanEvent(planSegment(), 'Focus session');

  assert.deepEqual(event, { id: 'created-event' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer create-token');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    summary: '[Plan] Deep work',
    description: 'Focus session',
    start: { dateTime: '2026-07-06T09:00:00', timeZone: resolvedTimeZone() },
    end: { dateTime: '2026-07-06T10:30:00', timeZone: resolvedTimeZone() }
  });
});

test('updatePlanEvent patches an encoded event id', async () => {
  authorize('update-token');
  const calls = installFakeFetch(jsonResponse({ id: 'event/1' }));

  const event = await updatePlanEvent('event/1', planSegment({ taskName: 'Review' }), 'Updated');

  assert.deepEqual(event, { id: 'event/1' });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://www.googleapis.com/calendar/v3/calendars/primary/events/event%2F1'
  );
  assert.equal(calls[0].options.method, 'PATCH');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer update-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    summary: '[Plan] Review',
    description: 'Updated',
    start: { dateTime: '2026-07-06T09:00:00', timeZone: resolvedTimeZone() },
    end: { dateTime: '2026-07-06T10:30:00', timeZone: resolvedTimeZone() }
  });
});

test('deletePlanEvent deletes an encoded event id and handles no content', async () => {
  authorize('delete-token');
  const calls = installFakeFetch({
    ok: true,
    status: 204,
    async text() {
      return '';
    }
  });

  const result = await deletePlanEvent('event/2');

  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://www.googleapis.com/calendar/v3/calendars/primary/events/event%2F2'
  );
  assert.equal(calls[0].options.method, 'DELETE');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer delete-token');
});

test('calendar API failures throw status and response text', async () => {
  authorize();
  installFakeFetch(textResponse('rate limit exceeded', 429));

  await assert.rejects(
    () => listPrimaryEvents('2026-07-06', '2026-07-07'),
    /429.*rate limit exceeded/
  );
});

test('createDayAvailabilityEvent posts a transparent all-day configuration event', async () => {
  authorize('availability-create-token');
  const calls = installFakeFetch(jsonResponse({ id: 'availability-1' }));
  const metadata = {
    app: 'adaptive-planner',
    entityType: 'dayAvailability',
    schemaVersion: 1,
    planDate: '2026-07-20',
    blocks: [{
      start: '09:00',
      end: '18:00',
      context: 'work',
      enabled: true,
      customName: '',
      customContextId: null
    }]
  };

  await createDayAvailabilityEvent(metadata);

  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(body.transparency, 'transparent');
  assert.deepEqual(body.start, { date: '2026-07-20' });
  assert.deepEqual(body.end, { date: '2026-07-21' });
  assert.equal(body.extendedProperties.private.apEntity, 'dayAvailability');
  assert.match(body.description, /PLAN_AVAILABILITY/);
});

test('updateDayAvailabilityEvent requires and sends the last read etag', async () => {
  authorize('availability-update-token');
  const calls = installFakeFetch(jsonResponse({ id: 'availability/1' }));
  const metadata = {
    app: 'adaptive-planner',
    entityType: 'dayAvailability',
    schemaVersion: 1,
    planDate: '2026-07-20',
    blocks: []
  };

  await assert.rejects(
    () => updateDayAvailabilityEvent('availability/1', '', metadata),
    /etag is required/
  );
  await updateDayAvailabilityEvent('availability/1', '"revision-2"', metadata);

  assert.equal(calls[0].options.method, 'PATCH');
  assert.equal(calls[0].options.headers['If-Match'], '"revision-2"');
  assert.match(calls[0].url, /availability%2F1$/);
  assert.equal('id' in JSON.parse(calls[0].options.body), false);
});
