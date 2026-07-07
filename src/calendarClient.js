const CALENDAR_API_BASE = 'https://www.googleapis.com';
const CALENDAR_EVENTS_PATH = '/calendar/v3/calendars/primary/events';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_EXPIRY_SAFETY_SECONDS = 60;

let accessToken = '';
let accessTokenExpiresAt = 0;
let lastAuthError = null;
let tokenClient = null;

export function hasAccessToken() {
  if (!accessToken) {
    return false;
  }

  if (Date.now() >= accessTokenExpiresAt) {
    clearAccessToken();
    return false;
  }

  return true;
}

export function clearAccessToken() {
  accessToken = '';
  accessTokenExpiresAt = 0;
}

export function getLastAuthError() {
  return lastAuthError;
}

function getOAuth2() {
  return globalThis.google?.accounts?.oauth2 ?? null;
}

function clearAuthState() {
  clearAccessToken();
  lastAuthError = null;
  tokenClient = null;
}

function recordAuthError(message) {
  clearAccessToken();
  lastAuthError = new Error(message);
}

function authErrorMessage(error) {
  if (typeof error === 'string') {
    return error;
  }

  if (error?.message) {
    return error.message;
  }

  if (error?.type) {
    return error.type;
  }

  if (error?.error) {
    return error.error;
  }

  return 'Google identity error';
}

function storeAccessToken(response) {
  const expiresIn = Number(response?.expires_in);
  const safeExpiresIn = Number.isFinite(expiresIn)
    ? Math.max(0, expiresIn - TOKEN_EXPIRY_SAFETY_SECONDS)
    : 0;

  accessToken = response?.access_token ?? '';
  accessTokenExpiresAt = Date.now() + (safeExpiresIn * 1000);
  lastAuthError = null;
}

export function initGoogleAuth(clientId, onToken) {
  clearAuthState();

  if (!clientId) {
    throw new Error('Google OAuth client ID is required');
  }

  const oauth2 = getOAuth2();
  if (!oauth2?.initTokenClient) {
    throw new Error('Google identity services are unavailable');
  }

  tokenClient = oauth2.initTokenClient({
    client_id: clientId,
    scope: CALENDAR_SCOPE,
    callback(response) {
      if (response?.error) {
        recordAuthError(response.error);
        if (typeof onToken === 'function') {
          onToken(response);
        }
        return;
      }

      storeAccessToken(response);
      if (typeof onToken === 'function') {
        onToken(response);
      }
    },
    error_callback(error) {
      const message = authErrorMessage(error);
      recordAuthError(message);
      if (typeof onToken === 'function') {
        onToken({ error: message });
      }
    }
  });

  return tokenClient;
}

export function requestAccessToken() {
  if (!tokenClient) {
    throw new Error('Google auth is not initialized');
  }

  tokenClient.requestAccessToken({ prompt: '' });
}

export function revokeAccessToken() {
  if (!accessToken) {
    return;
  }

  const tokenToRevoke = accessToken;
  accessToken = '';

  const oauth2 = getOAuth2();
  if (oauth2?.revoke) {
    oauth2.revoke(tokenToRevoke);
  }
}

function eventBody(segment, description) {
  const timeZone = resolvedTimeZone();

  return {
    summary: `[Plan] ${segment.taskName}`,
    description,
    start: { dateTime: segment.start, timeZone },
    end: { dateTime: segment.end, timeZone }
  };
}

function resolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function calendarUrl(path, params = {}) {
  const url = new URL(path, CALENDAR_API_BASE);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function readCalendarResponse(response) {
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Calendar API failed with status ${response.status}: ${responseText}`);
  }

  if (response.status === 204) {
    return true;
  }

  return response.json();
}

async function calendarRequest(path, options = {}, params) {
  if (!hasAccessToken()) {
    throw new Error('Google calendar access token is missing or expired');
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    ...options.headers
  };

  const response = await fetch(calendarUrl(path, params), {
    ...options,
    headers
  });

  return readCalendarResponse(response);
}

export async function listPrimaryEvents(timeMin, timeMax) {
  const response = await calendarRequest(
    CALENDAR_EVENTS_PATH,
    { method: 'GET' },
    {
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    }
  );

  return response.items ?? [];
}

export async function createPlanEvent(segment, description) {
  return calendarRequest(CALENDAR_EVENTS_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventBody(segment, description))
  });
}

export async function updatePlanEvent(eventId, segment, description) {
  return calendarRequest(`${CALENDAR_EVENTS_PATH}/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventBody(segment, description))
  });
}

export async function deletePlanEvent(eventId) {
  return calendarRequest(`${CALENDAR_EVENTS_PATH}/${encodeURIComponent(eventId)}`, {
    method: 'DELETE'
  });
}
