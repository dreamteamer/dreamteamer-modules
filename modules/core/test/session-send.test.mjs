// dt session send (cr-modules-010, line 8, the fixture half; rnd/tests cr-modules-010-t8): the message
// goes to a FORK of the session by its stored harness id, with no tools, no MCP servers and no hooks,
// from a fresh temporary folder, the text on stdin and never in argv; send refuses, naming the reason,
// when the transcript is not on this machine, when the harness is not claude-code, and when claude is
// missing. The live half (a real session answering) is test/walk/session-send-walk.mjs.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendArgv, transcriptOf, sendTo } from '../src/sessions/send.js';

const SID = '3e880550-0000-4000-8000-0000000000d1';
function configWith(sid) {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-claude-')));
	after(() => fs.rmSync(dir, { recursive: true, force: true }));
	if (sid) { fs.mkdirSync(path.join(dir, 'projects', '-x-northwind'), { recursive: true }); fs.writeFileSync(path.join(dir, 'projects', '-x-northwind', `${sid}.jsonl`), '{}\n'); }
	return dir;
}

describe('dt session send', () => {
	test('argv: a fork, json, no tools, no MCP servers, hooks off — and no message text', () => {
		assert.deepEqual(sendArgv(SID), ['-p', '--resume', SID, '--fork-session', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}']);
	});

	test('runs claude from a temp folder with the text on stdin, and returns the reply', () => {
		const env = { CLAUDE_CONFIG_DIR: configWith(SID) };
		const calls = [];
		const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0, stdout: JSON.stringify({ result: 'The code word is HERON-9', session_id: 'fork-1' }), stderr: '' }; };
		const r = sendTo({ session_id: SID, harness: 'claude-code' }, '--what is the code word?', { spawn, env });
		assert.equal(r.reply.result, 'The code word is HERON-9');
		assert.equal(calls.length, 1);
		assert.equal(calls[0].cmd, 'claude');
		assert.deepEqual(calls[0].args, sendArgv(SID));
		assert.equal(calls[0].opts.input, '--what is the code word?');
		assert.ok(calls[0].opts.cwd.startsWith(fs.realpathSync(os.tmpdir())) || calls[0].opts.cwd.startsWith(os.tmpdir()), calls[0].opts.cwd);
	});

	test('the message is everything after the session id — a leading -- ends the options, and an unknown --word is text', async () => {
		const { messageOf } = await import('../src/sessions/cli.js');
		assert.deepEqual(messageOf([SID, '--', '--help me']), { sid: SID, text: '--help me', json: false });
		assert.deepEqual(messageOf([SID, '--verbose', 'please']), { sid: SID, text: '--verbose please', json: false });
		assert.deepEqual(messageOf(['--json', SID, 'what', 'next?']), { sid: SID, text: 'what next?', json: true });
		assert.deepEqual(messageOf([SID, '--', '--json']), { sid: SID, text: '--json', json: false });
	});

	test('refusals name the reason: no transcript here, another harness, claude missing', () => {
		const spawn = () => { throw new Error('must not run'); };
		const empty = { CLAUDE_CONFIG_DIR: configWith(null) };
		assert.throws(() => sendTo({ session_id: SID, harness: 'claude-code' }, 'hi', { spawn, env: empty }), (e) => e.message.includes(SID) && e.message.includes('projects'));
		assert.throws(() => sendTo({ session_id: SID, harness: 'codex' }, 'hi', { spawn, env: empty }), /codex/);
		assert.throws(() => sendTo({ harness: 'claude-code' }, 'hi', { spawn, env: empty }), /session_id/);
		const env = { CLAUDE_CONFIG_DIR: configWith(SID) };
		const missing = () => ({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
		assert.throws(() => sendTo({ session_id: SID, harness: 'claude-code' }, 'hi', { spawn: missing, env }), /claude.*PATH|PATH.*claude/);
		assert.equal(transcriptOf(SID, env), path.join(env.CLAUDE_CONFIG_DIR, 'projects', '-x-northwind', `${SID}.jsonl`));
	});
});
