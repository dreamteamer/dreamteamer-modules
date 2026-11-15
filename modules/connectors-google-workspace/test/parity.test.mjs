import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listTools, call } from '../lib/access.mjs';
import { storedAccounts, authorize } from '../lib/auth.mjs';
import { connect } from '../lib/client.mjs';
import { calendarReader } from '../lib/calendar.mjs';
import { createGoogleRequest } from '../lib/direct.mjs';
const account = 'dana@northwind.example';
const env = { GOOGLE_CLIENT_SECRET_PATH: '/tmp/client.json', WORKSPACE_MCP_CREDENTIALS_DIR: '/tmp/accounts' };
const consent = { content: [{ type: 'text', text: 'Authentication Needed: https://accounts.google.com/o/oauth2/auth?state=synthetic&response_type=code&client_id=synthetic-client&redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Foauth2callback' }] };
test('whoami lists decoded account filenames and does not claim authorization', () => {
  const result = storedAccounts({ env, list: () => ['oauth_states.json', 'dana%2Bnotes@northwind.example.json', 'invalid.json'] });
  assert.deepEqual(result, [{ account: 'dana+notes@northwind.example', state: 'stored_not_verified' }]);
});
test('auth makes one consent attempt, waits, verifies once and closes', async () => {
  let exists = false, calls = 0, closed = false, printed = 0;
  const result = await authorize({ account, env, fileExists: p => p === env.GOOGLE_CLIENT_SECRET_PATH || exists,
    connectionFactory: () => ({ ready: async () => {}, send: async () => ++calls === 1 ? consent : { content: [{ type: 'text', text: 'No files found.' }] }, close: () => { closed = true; } }),
    onConsentUrl: async url => { assert.equal(new URL(url).hostname, 'accounts.google.com'); printed++; exists = true; },
  });
  assert.equal(calls, 2); assert.equal(printed, 1); assert.equal(closed, true); assert.equal(result.state, 'verified_read');
});
test('existing credentials are not deleted or renewed implicitly', async () => {
  const result = await authorize({ account, env, fileExists: () => true, connectionFactory: () => { throw new Error('must not start'); } });
  assert.equal(result.state, 'stored_not_verified');
});
test('auth timeout does not poll the server or leave process alive', async () => {
  let time = 0, calls = 0, closed = false;
  await assert.rejects(authorize({ account, env, waitMs: 10, now: () => time, sleep: async ms => { time += ms; }, fileExists: p => p === env.GOOGLE_CLIENT_SECRET_PATH,
    connectionFactory: () => ({ ready: async () => {}, send: async () => { calls++; return consent; }, close: () => { closed = true; } }),
  }), /timed out/);
  assert.equal(calls, 1); assert.equal(closed, true);
});
test('auth refuses non-Google consent links and failed verification', async () => {
  for (const response of [{ content: [{ type: 'text', text: 'https://remote.example/consent' }] }, { isError: true, content: [] }]) {
    await assert.rejects(authorize({ account, env, fileExists: p => p === env.GOOGLE_CLIENT_SECRET_PATH,
      connectionFactory: () => ({ ready: async () => {}, send: async () => response, close: () => {} }),
    }), /valid Google consent URL/);
  }
});
test('calendar retains raw fields, all pages and explicit range settings', async () => {
  const calls = [];
  const reader = calendarReader(async (resource, options) => {
    calls.push({ resource, options });
    return calls.length === 1 ? { items: [{ id: 'one', status: 'cancelled', attendees: [{ resource: true }] }], nextPageToken: 'next' } : { items: [{ id: 'two', accessRole: 'freeBusyReader' }] };
  });
  const events = await reader.events('primary', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', { showDeleted: true, timeZone: 'UTC' });
  assert.equal(events.length, 2); assert.equal(events[0].status, 'cancelled'); assert.equal(events[0].attendees[0].resource, true);
  assert.equal(calls[1].options.params.pageToken, 'next'); assert.equal(calls[0].options.params.showDeleted, true);
  assert.equal(calls[0].options.params.timeZone, 'UTC');
});
test('calendar validates dates and timezone before API calls; pagination loops fail', async () => {
  let calls = 0;
  const reader = calendarReader(async () => { calls++; return { items: [], nextPageToken: 'repeat' }; });
  assert.throws(() => reader.events('primary', 'invalid', 'invalid'), /date range/);
  assert.throws(() => reader.events('primary', '2026-01-01', '2026-01-02', { timeZone: 'invalid' }), /time zone/);
  assert.equal(calls, 0); await assert.rejects(reader.calendars(), /repeated/);
});
test('direct API refresh uses fixed endpoint, preserves raw fields and never writes credentials', async () => {
  const calls = [];
  const request = await createGoogleRequest(account, 'calendar', { env,
    readFile: p => JSON.stringify(p === env.GOOGLE_CLIENT_SECRET_PATH ? { installed: { client_id: 'synthetic-client', client_secret: 'synthetic-secret' } } : { refresh_token: 'synthetic-refresh', scopes: ['https://www.googleapis.com/auth/calendar.readonly'] }),
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return calls.length === 1 ? { ok: true, json: async () => ({ access_token: 'synthetic-access' }) } : { ok: true, status: 200, json: async () => ({ accessRole: 'freeBusyReader', status: 'cancelled' }) }; },
  });
  assert.deepEqual(await request('users/me/calendarList'), { accessRole: 'freeBusyReader', status: 'cancelled' });
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-access');
  await assert.rejects(request('https://remote.example'), /relative/);
  assert.equal(calls.length, 2);
});
test('token refresh errors are redacted and wrong scope prevents refresh', async () => {
  const readFile = p => JSON.stringify(p === env.GOOGLE_CLIENT_SECRET_PATH ? { installed: { client_id: 'synthetic-client', client_secret: 'synthetic-secret' } } : { refresh_token: 'synthetic-refresh', scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  await assert.rejects(createGoogleRequest(account, 'calendar', { env, readFile, fetchImpl: () => { throw new Error('must not call'); } }), /lacks/);
  await assert.rejects(createGoogleRequest(account, 'drive', { env, readFile, fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'synthetic-sensitive-error' }) }) }), error => !error.message.includes('synthetic-sensitive-error') && /refresh failed/.test(error.message));
});

test('cancelled consent closes the server without another probe', async () => {
  const controller = new AbortController(); let calls = 0, closed = false;
  await assert.rejects(authorize({ account, env, signal: controller.signal, fileExists: p => p === env.GOOGLE_CLIENT_SECRET_PATH,
    onConsentUrl: () => controller.abort(), connectionFactory: () => ({ ready: async () => {}, send: async () => { calls++; return consent; }, close: () => { closed = true; } }),
  }), /cancelled/);
  assert.equal(calls, 1); assert.equal(closed, true);
});

test('tool discovery paginates and filters to the bridge read allowlist by default', async () => {
  let calls = 0, closed = false;
  const tools = await listTools({ env, connectionFactory: () => ({ ready: async () => {}, close: () => { closed = true; }, send: async (method, params) => {
    assert.equal(method, 'tools/list'); calls++;
    if (calls === 1) return { tools: [{ name: 'search_gmail_messages' }, { name: 'send_gmail_message' }], nextCursor: 'next' };
    assert.equal(params.cursor, 'next'); return { tools: [{ name: 'get_events' }] };
  } }) });
  assert.deepEqual(tools.map(t => t.name), ['search_gmail_messages', 'get_events']); assert.equal(closed, true);
});


test('calendar page sizes respect calendar-list and event API limits on every page', async () => {
  const calls = [];
  const reader = calendarReader(async (resource, { params }) => {
    calls.push({ resource, params });
    return { items: [], ...(params.pageToken ? {} : { nextPageToken: 'next' }) };
  });
  await reader.calendars();
  await reader.events('primary', '2026-01-01', '2026-01-02');
  assert.deepEqual(calls.map(c => c.params.maxResults), [250, 250, 2500, 2500]);
});

test('auth does not falsely promise broader scopes for existing credentials', async () => {
  await assert.rejects(authorize({ account, env, allowWrite: true, fileExists: () => true,
    connectionFactory: () => { throw new Error('must not start'); },
  }), /cannot broaden its scopes/);
});

test('new-account write consent omits read-only but cannot inherit scope overrides', async () => {
  let exists = false, calls = 0;
  await authorize({ account, env: { ...env, GOOGLE_OAUTH_SCOPES: 'hostile-scope' }, allowWrite: true,
    fileExists: p => p === env.GOOGLE_CLIENT_SECRET_PATH || exists,
    connectionFactory: options => {
      assert.equal(options.args.includes('--read-only'), false);
      assert.equal(options.env.GOOGLE_OAUTH_SCOPES, undefined);
      return { ready: async () => {}, send: async () => ++calls === 1 ? consent : { content: [] }, close: () => {} };
    }, onConsentUrl: () => { exists = true; },
  });
  assert.equal(calls, 2);
});


test('consent URLs require a single local callback and complete authorization-code parameters', async () => {
  const base = new URL(consent.content[0].text.split('Authentication Needed: ')[1]);
  const invalid = [];
  for (const redirect of ['https://remote.example/oauth2callback', 'http://localhost/other', 'http://user@localhost/oauth2callback', 'http://localhost/oauth2callback#fragment']) {
    const url = new URL(base); url.searchParams.set('redirect_uri', redirect); invalid.push(url);
  }
  for (const key of ['redirect_uri', 'state', 'client_id', 'response_type']) {
    const url = new URL(base); url.searchParams.delete(key); invalid.push(url);
    const duplicate = new URL(base); duplicate.searchParams.append(key, duplicate.searchParams.get(key)); invalid.push(duplicate);
  }
  const token = new URL(base); token.searchParams.set('response_type', 'token'); invalid.push(token);
  for (const url of invalid) {
    let shown = false, closed = false;
    await assert.rejects(authorize({ account, env, fileExists: p => p === env.GOOGLE_CLIENT_SECRET_PATH,
      onConsentUrl: () => { shown = true; },
      connectionFactory: () => ({ ready: async () => {}, send: async () => ({ content: [{ type: 'text', text: url.href }] }), close: () => { closed = true; } }),
    }), /valid Google consent URL/);
    assert.equal(shown, false); assert.equal(closed, true);
  }
});


test('Windows authorization fails before credential access or process creation', async () => {
  await assert.rejects(authorize({ account, platform: 'win32', env,
    fileExists: () => { throw new Error('must not access'); },
    connectionFactory: () => { throw new Error('must not spawn'); },
  }), /not supported on Windows/);
});


test('every real MCP launch fails closed on Windows including reads and discovery', () => {
  assert.throws(() => connect({ platform: 'win32', spawnProcess: () => { throw new Error('must not spawn'); } }), /not supported on Windows/);
});


test('call discovery and auth always select only the three pilot services', async () => {
  const observed = [];
  const factory = options => {
    observed.push(options.args);
    return { ready: async () => {}, close: () => {}, send: async method => method === 'tools/list' ? { tools: [] } : consent };
  };
  for (const allowWrite of [false, true]) {
    await call({ account, tool: 'search_drive_files', env, allowWrite, fileExists: () => true,
      connectionFactory: options => { observed.push(options.args); return { ready: async () => {}, close: () => {}, send: async () => ({ content: [] }) }; },
    });
    await listTools({ env, allowWrite, connectionFactory: factory });
    await assert.rejects(authorize({ account, env, allowWrite, connectionFactory: factory,
      fileExists: p => p === env.GOOGLE_CLIENT_SECRET_PATH, onConsentUrl: () => { throw new Error('synthetic stop'); },
    }), /synthetic stop/);
  }
  assert.equal(observed.length, 6);
  for (const args of observed) {
    const start = args.indexOf('--tools'); assert.ok(start > 0);
    assert.deepEqual(args.slice(start + 1).filter(v => !v.startsWith('--')), ['gmail', 'drive', 'calendar']);
  }
});
