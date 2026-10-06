import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { gateway } from '../src/gateway.mjs';
import { parseArgs } from '../src/cli.mjs';
import { callUi } from '../src/control.mjs';

test('the launcher refuses network bind overrides and malformed ports', () => {
  assert.throws(() => parseArgs(['--host', '0.0.0.0']), /Unknown option/);
  for (const port of ['-1', '65536', '1abc']) assert.throws(() => parseArgs(['--port', port]), /port/);
  assert.equal(parseArgs(['message', '.', '--text', 'Show the board']).text, 'Show the board');
});

test('HTTP and WebSocket gateway require credentials, exact Host and same origin', async () => {
  const dir = await fs.mkdtemp('/tmp/dt-gateway-test-');
  const socketPath = dir + '/upstream.sock';
  let reached = 0;
  const backend = http.createServer((req, res) => { reached++; res.end(JSON.stringify(req.headers)); });
  backend.on('upgrade', (req, socket) => { reached++; socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); });
  await new Promise(resolve => backend.listen(socketPath, resolve));
  const proxy = await gateway({ socketPath, workspace: '/workspace with spaces' });
  try {
    assert.equal(new URL(proxy.origin).hostname, '127.0.0.1');
    assert.equal((await fetch(proxy.origin)).status, 401);
    assert.equal((await fetch(proxy.origin + '/_dt/open?token=wrong')).status, 401);
    assert.equal((await fetch(proxy.link(), { headers: { Origin: 'https://other.example' } })).status, 403);
    const rebinding = await new Promise(resolve => {
      http.get(proxy.origin, { headers: { Host: 'other.example', Authorization: `Bearer ${proxy.token}` } }, res => { res.resume(); resolve(res.statusCode); });
    });
    assert.equal(rebinding, 403);
    assert.equal(reached, 0);
    const login = await fetch(proxy.link(), { redirect: 'manual' });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(new URL(login.headers.get('location'), proxy.origin).searchParams.get('folder'), '/workspace with spaces');
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const response = await fetch(proxy.origin, { headers: { Cookie: cookie.split(';')[0], 'x-forwarded-host': 'other.example' } });
    const forwarded = await response.json();
    assert.equal(forwarded.authorization, undefined);
    assert.equal(forwarded['x-forwarded-host'], undefined);
    assert.equal(forwarded.cookie, '');
    const upgrade = headers => new Promise((resolve, reject) => {
      const url = new URL(proxy.origin); const socket = net.connect(+url.port, url.hostname);
      let data = ''; socket.on('error', reject); socket.on('data', b => data += b);
      socket.on('end', () => resolve(data));
      socket.on('connect', () => socket.write(`GET /socket HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${headers}\r\n`));
    });
    assert.match(await upgrade(''), /403 Forbidden/);
    assert.match(await upgrade(`Cookie: ${cookie.split(';')[0]}\r\nOrigin: https://other.example\r\n`), /403 Forbidden/);
    assert.match(await upgrade(`Cookie: ${cookie.split(';')[0]}\r\nOrigin: ${proxy.origin}\r\n`), /101 Switching Protocols/);
  } finally {
    await proxy.close(); await new Promise(resolve => backend.close(resolve)); await fs.rm(dir, { recursive: true });
  }
});

test('MCP translates tools into bounded UI actions and reports UI failures as tool errors', async () => {
  const dir = await fs.mkdtemp('/tmp/dt-mcp-test-'); const socketPath = dir + '/ui.sock';
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const value = JSON.parse(text); requests.push(value);
    if (value.action === 'file') res.writeHead(400).end(JSON.stringify({ error: 'File must be inside the workspace' }));
    else res.end(JSON.stringify({ route: value.route ?? '/tasks/board' }));
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  try {
    const child = spawn(process.execPath, [new URL('../bin/ui-mcp.mjs', import.meta.url).pathname], { env: { ...process.env, DT_EDITOR_CONTROL_SOCKET: socketPath } });
    let output = ''; child.stdout.on('data', b => output += b);
    const done = new Promise(resolve => child.on('exit', resolve));
    for (const request of [
      { id: 1, method: 'initialize' },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'open_view', arguments: { route: '/tasks/board', action: 'arbitrary-command' } } },
      { id: 4, method: 'tools/call', params: { name: 'open_file', arguments: { path: '../outside' } } },
    ]) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...request }) + '\n');
    child.stdin.end(); assert.equal(await done, 0);
    const messages = output.trim().split('\n').map(JSON.parse);
    assert.equal(messages[1].result.tools.length, 4);
    assert.equal(requests[0].action, 'open');
    assert.equal(messages[3].result.isError, true);
    await assert.rejects(callUi(socketPath, { action: 'file', path: '../outside' }), /inside the workspace/);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true }); }
});
