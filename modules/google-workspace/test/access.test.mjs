import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { call, validateCall, credentialPath, configuration } from '../lib/access.mjs';
import { connect } from '../lib/client.mjs';
import { doctor } from '../lib/doctor.mjs';

const env = { GOOGLE_CLIENT_SECRET_PATH: '/tmp/synthetic-client.json', WORKSPACE_MCP_CREDENTIALS_DIR: '/tmp/synthetic-credentials' };
const account = 'dana@northwind.example';
const tool = 'search_gmail_messages';
const success = { content: [{ type: 'text', text: 'synthetic message' }] };
function fake(result = success) {
  const observed = { closed: false, calls: [] };
  return { observed, factory: options => (observed.options = options, { ready: async () => {}, send: async (...args) => { observed.calls.push(args); return result; }, close: () => { observed.closed = true; } }) };
}
test('explicit account is mandatory and cannot be overridden', () => {
  assert.throws(() => validateCall('', tool), /explicit/);
  assert.throws(() => validateCall('../escape', tool), /explicit/);
  assert.throws(() => validateCall(account, tool, { user_google_email: 'sam@northwind.example' }), /does not match/);
  assert.equal(validateCall(account, tool, { query: 'in:inbox' }).user_google_email, account);
});
test('write and unknown tools fail closed; explicit opt-in dispatch remains possible', () => {
  for (const name of ['send_gmail_message', 'get_and_delete_everything']) assert.throws(() => validateCall(account, name), /allowlist/);
  assert.equal(validateCall(account, 'send_gmail_message', {}, true).user_google_email, account);
});
test('missing account credentials make no connection and do not initiate consent', async () => {
  let starts = 0;
  await assert.rejects(call({ account, tool, env, fileExists: p => p === env.GOOGLE_CLIENT_SECRET_PATH, connectionFactory: () => { starts++; } }), /No stored credential/);
  assert.equal(starts, 0);
});
test('successful call binds account last and closes process', async () => {
  const f = fake();
  assert.deepEqual(await call({ account, tool, env, args: { query: 'in:inbox' }, fileExists: () => true, connectionFactory: f.factory }), success);
  assert.equal(f.observed.calls[0][1].arguments.user_google_email, account);
  assert.equal(f.observed.closed, true);
  assert.ok(f.observed.options.args.includes('--read-only'));
  assert.deepEqual(f.observed.options.args.slice(0, 3), ['--with', 'python-dotenv==1.2.3', 'workspace-mcp==2.4.2']);
  assert.equal(f.observed.options.env.PYTHON_DOTENV_DISABLED, '1');
  assert.match(f.observed.options.env.BROWSER, /no-browser/);
});
test('tool error and renewed consent are not success and always close process', async () => {
  for (const result of [{ isError: true, content: [] }, { content: [{ type: 'text', text: 'Authentication Needed' }] }]) {
    const f = fake(result);
    await assert.rejects(call({ account, tool, env, fileExists: () => true, connectionFactory: f.factory }));
    assert.equal(f.observed.closed, true);
  }
});
test('doctor exposes no configured path, email or credential value', () => {
  const report = doctor({ env: { ...env, PATH: '' }, accessible: () => true });
  assert.equal(report.checks.length, 4);
  assert.equal(report.checks.find(c => c.label === 'Account authorization').state, 'warn');
  assert.ok(!JSON.stringify(report).includes('/tmp/'));
  assert.ok(!JSON.stringify(report).includes(account));
});
test('credential filename uses safe encoding including unusual valid local parts', () => {
  assert.equal(credentialPath('/tmp/store', 'dana+notes@northwind.example'), '/tmp/store/dana%2Bnotes@northwind.example.json');
  assert.equal(credentialPath('/tmp/store', "dana'notes@northwind.example"), '/tmp/store/dana%27notes@northwind.example.json');
});
test('real stdio mock handles initialize, notifications and call without credentials or network', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'google-mcp-test-'));
  try {
    const mock = path.join(dir, 'server.mjs');
    fs.writeFileSync(mock, `import readline from 'node:readline';
      for await (const line of readline.createInterface({input:process.stdin})) {
        const m=JSON.parse(line); if(!m.id) continue;
        if (process.env.UNRELATED_SECRET || process.env.UV_ENV_FILE || process.env.WORKSPACE_MCP_CREDENTIAL_STORE_BACKEND !== 'local_directory') process.exit(2);
        const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'mock',version:'1'}}:{content:[{type:'text',text:m.params.arguments.user_google_email}]};
        console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
      }`);
    const factory = options => connect({ ...options, command: process.execPath, args: [mock], timeoutMs: 2000 });
    const result = await call({ account, tool, fileExists: () => true, connectionFactory: factory, env: { ...env, PATH: process.env.PATH, HOME: process.env.HOME, UNRELATED_SECRET: 'synthetic-value', UV_ENV_FILE: '/tmp/hostile.env', WORKSPACE_MCP_CREDENTIAL_STORE_BACKEND: 'gcs' } });
    assert.equal(result.content[0].text, account);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('stdio timeout rejects and terminates a hung server', async () => {
  const client = connect({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 40 });
  try { await assert.rejects(client.ready(), /timed out/); } finally { client.close(); }
});
test('missing executable fails promptly, without echoing server diagnostics', async () => {
  const client = connect({ command: '/nonexistent-synthetic-program', timeoutMs: 500 });
  try { await assert.rejects(client.ready(), /could not start|input stream/); } finally { client.close(); }
});
test('CLI help works via symlink and doctor has nonzero unavailable exit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'google-cli-test-'));
  try {
    const link = path.join(dir, 'google.mjs');
    fs.symlinkSync(fileURLToPath(new URL('../bin/google.mjs', import.meta.url)), link);
    const help = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0); assert.match(help.stdout, /dt-google call/);
    const checked = spawnSync(process.execPath, [link, 'doctor', '--json'], { encoding: 'utf8', env: { PATH: '' } });
    assert.equal(checked.status, 1); assert.equal(JSON.parse(checked.stdout).checks.length, 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an empty credential directory cannot yield a fully ready doctor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'google-empty-store-'));
  try {
    const client = path.join(dir, 'client.json');
    fs.writeFileSync(client, '{}');
    const bin = path.join(dir, process.platform === 'win32' ? 'uvx.exe' : 'uvx');
    fs.writeFileSync(bin, ''); fs.chmodSync(bin, 0o700);
    const credentials = path.join(dir, 'credentials'); fs.mkdirSync(credentials);
    const report = doctor({ env: { PATH: dir, GOOGLE_CLIENT_SECRET_PATH: client, WORKSPACE_MCP_CREDENTIALS_DIR: credentials } });
    assert.equal(report.checks.filter(c => c.state === 'bad').length, 0);
    assert.equal(report.checks.find(c => c.label === 'Account authorization').state, 'warn');
    assert.equal(report.checks.every(c => c.state === 'ok'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hostile inherited configuration cannot change local transport, auth or credential storage', () => {
  const hostile = {
    ...env, PATH: '/usr/bin', HOME: '/tmp/synthetic-home',
    WORKSPACE_MCP_CREDENTIAL_STORE_BACKEND: 'gcs', WORKSPACE_MCP_GCS_BUCKET: 'synthetic-bucket',
    MCP_ENABLE_OAUTH21: 'true', EXTERNAL_OAUTH21_PROVIDER: 'true', TRUST_GATEWAY_IDENTITY: 'true',
    WORKSPACE_MCP_STATELESS_MODE: 'true', MCP_SINGLE_USER_MODE: '1',
    WORKSPACE_MCP_BASE_URI: 'https://remote.example', WORKSPACE_EXTERNAL_URL: 'https://remote.example',
    GOOGLE_OAUTH_REDIRECT_URI: 'https://remote.example/callback', OAUTH_CUSTOM_REDIRECT_URIS: 'https://remote.example',
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/tmp/other-account.json', GOOGLE_SERVICE_ACCOUNT_KEY_JSON: '{}',
    GOOGLE_OAUTH_CLIENT_ID: 'synthetic-id', GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret',
    PYTHON_DOTENV_DISABLED: '0', UV_NO_CONFIG: '0', UV_INDEX_URL: 'https://remote.example', UV_ENV_FILE: '/tmp/hostile.env',
    BROWSER: 'hostile-browser', NODE_OPTIONS: '--require hostile', PYTHONPATH: '/tmp/injected',
    HTTP_PROXY: 'https://remote.example', GOOGLE_APPLICATION_CREDENTIALS: '/tmp/other.json',
    USER_GOOGLE_EMAIL: 'sam@northwind.example', UNRELATED_SECRET: 'synthetic-value',
  };
  const actual = configuration(hostile);
  assert.equal(actual.PATH, hostile.PATH); assert.equal(actual.HOME, hostile.HOME);
  assert.equal(actual.GOOGLE_CLIENT_SECRET_PATH, env.GOOGLE_CLIENT_SECRET_PATH);
  assert.equal(actual.WORKSPACE_MCP_CREDENTIALS_DIR, env.WORKSPACE_MCP_CREDENTIALS_DIR);
  assert.equal(actual.WORKSPACE_MCP_CREDENTIAL_STORE_BACKEND, 'local_directory');
  assert.equal(actual.WORKSPACE_MCP_BASE_URI, 'http://localhost');
  assert.equal(actual.WORKSPACE_MCP_TRANSPORT, 'stdio');
  for (const key of ['MCP_ENABLE_OAUTH21', 'EXTERNAL_OAUTH21_PROVIDER', 'TRUST_GATEWAY_IDENTITY', 'WORKSPACE_MCP_STATELESS_MODE']) assert.equal(actual[key], 'false');
  for (const key of ['GOOGLE_SERVICE_ACCOUNT_KEY_FILE', 'GOOGLE_SERVICE_ACCOUNT_KEY_JSON', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'WORKSPACE_EXTERNAL_URL', 'OAUTH_CUSTOM_REDIRECT_URIS']) assert.equal(actual[key], '');
  for (const key of ['WORKSPACE_MCP_GCS_BUCKET', 'UV_INDEX_URL', 'UV_ENV_FILE', 'NODE_OPTIONS', 'PYTHONPATH', 'HTTP_PROXY', 'GOOGLE_APPLICATION_CREDENTIALS', 'USER_GOOGLE_EMAIL', 'UNRELATED_SECRET']) assert.equal(Object.hasOwn(actual, key), false);
  assert.equal(actual.PYTHON_DOTENV_DISABLED, '1'); assert.equal(actual.UV_NO_CONFIG, '1');
  assert.match(actual.BROWSER, /no-browser\.mjs$/);
});
