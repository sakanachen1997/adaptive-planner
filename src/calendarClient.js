const CALENDAR_API_BASE = 'https://www.googleapis.com';
const CALENDAR_EVENTS_PATH = '/calendar/v3/calendars/primary/events';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

let accessToken = '';
let tokenClient = null;

export function hasAccessToken() {
  return accessToken !== '';
}

export function clearAccessToken() {
  accessToken = '';
}

function getOAuth2() {
  return globalThis.google?.accounts?.oauth2 ?? null;
}

export function initGoogleAuth(clientId, onToken) {
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
        throw new Error(response.error);
      }

      accessToken = response?.access_token ?? '';
      if (typeof onToken === 'function') {
        onToken(response);
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
  return {
    summary: `[Plan] ${segment.taskName}`,
    description,
    start: { dateTime: segment.start },
    end: { dateTime: segment.end }
  };
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
  if (!accessToken) {
    throw new Error('Google calendar access token is missing');
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
