#!/usr/bin/env node
// THE LIVE WALK for dt session send (cr-modules-010, line 8; rnd/tests cr-modules-010-t8-live). Not in
// `npm test`: it starts a real Claude Code session (claude on PATH, logged in), so it costs a few cents
// and needs the network. It proves on this machine what no fixture can:
//   1. a session told a code word answers it through `dt session send`, addressed by the stored id;
//   2. the session's own transcript is byte-identical afterwards (the reply came from a fork);
//   3. asked to write a file, the fork writes nothing, adds no sessions record, and git status is unchanged;
//   4. the fork's system/init event lists no tools and no MCP servers.
// Exit 0 when all four hold; 1 naming the first that does not.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { coreWorkspace, dt, sessionFiles } from '../helpers-sessions.mjs';
import { cleanup } from '../../../../tests/helpers/workspace.mjs';
import { sendArgv, transcriptOf } from '../../src/sessions/send.js';

const fail = (m) => { console.error(`✖ ${m}`); cleanup(); process.exit(1); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const env = { ...process.env };
delete env.CLAUDE_CODE_SESSION_ID;

const sid = randomUUID();
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-walk-session-')));
const word = `HERON-${Math.floor(Math.random() * 900 + 100)}`;
const made = spawnSync('claude', ['-p', '--session-id', sid, '--model', 'haiku', `Remember the code word ${word}. Reply with OK only.`], { cwd: scratch, encoding: 'utf8', env, timeout: 300_000 });
if (made.status !== 0) fail(`could not start a session: ${made.stderr || made.stdout}`);
const transcript = transcriptOf(sid, env);
if (!transcript) fail(`no transcript for ${sid}`);
const before = sha(transcript);
console.log(`· session ${sid} told ${word}; transcript sha256 ${before.slice(0, 12)}`);

const root = coreWorkspace();
const add = dt(root, ['add', 'sessions', '--id', sid, '--name', 'walk: a session told a code word', '--started', new Date().toISOString(), '--session_id', sid, '--harness', 'claude-code']);
if (add.code !== 0) fail(`add: ${add.err}`);
execFileSync('git', ['add', '-A'], { cwd: root });
execFileSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'walk fixture'], { cwd: root });

const asked = dt(root, ['session', 'send', sid, 'What is the code word? Answer with the word only.']);
if (asked.code !== 0) fail(`send: ${asked.err}`);
console.log(`1 · reply: ${asked.out.trim()}`);
if (!asked.out.includes(word)) fail(`the reply does not name ${word}`);
if (sha(transcript) !== before) fail('the original transcript changed');
console.log('2 · original transcript unchanged');

const filesBefore = sessionFiles(root).join(',');
const write = dt(root, ['session', 'send', sid, 'Use the Write tool to create a file named walk-x.txt containing hi in the current directory, then say DONE.']);
console.log(`3 · reply to the write request: ${(write.out || write.err).trim().split('\n')[0]}`);
const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
if (status) fail(`git status changed:\n${status}`);
if (fs.existsSync(path.join(root, 'walk-x.txt')) || fs.existsSync(path.join(scratch, 'walk-x.txt'))) fail('the fork wrote a file');
if (sessionFiles(root).join(',') !== filesBefore) fail('a sessions record was added');
if (sha(transcript) !== before) fail('the original transcript changed');
console.log('3 · no file, git status clean, no new sessions record, transcript unchanged');

const argv = sendArgv(sid).map((a) => (a === 'json' ? 'stream-json' : a));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-walk-init-'));
const stream = spawnSync('claude', [...argv, '--verbose'], { cwd: tmp, input: 'Say OK.', encoding: 'utf8', env, timeout: 300_000 });
const init = stream.stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o?.type === 'system' && o?.subtype === 'init');
if (!init) fail(`no system/init event: ${stream.stderr}`);
console.log(`4 · init: tools=${JSON.stringify(init.tools)} mcp_servers=${JSON.stringify(init.mcp_servers)}`);
if ((init.tools ?? []).length || (init.mcp_servers ?? []).length) fail('the fork has tools or MCP servers');
if (sha(transcript) !== before) fail('the original transcript changed');
cleanup();
fs.rmSync(scratch, { recursive: true, force: true });
console.log('✔ walk: send answered from the session\'s memory through a tool-less fork and changed nothing');
