// `dt session send` — ask a past session a question by the harness id its record stores, and read the
// reply. The message goes to a FORK (`--fork-session`), so the session's own transcript is untouched;
// the fork runs with no tools, no MCP servers and no hooks, from a fresh temporary folder, so it can only
// answer — it cannot carry on the session's last instruction, write a file or a record, or have a Stop
// hook save a new session. The text goes on stdin, never in argv, so a message starting with `-` is a
// message. A session is resumable only on the machine whose disk holds its transcript.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** The exact `claude` argv for a send: a json fork of the session with every tool, server and hook off. */
export const sendArgv = (sessionId) => ['-p', '--resume', sessionId, '--fork-session', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}'];

const configDir = (env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/** The harness's transcript of a session on this machine, or null: `<config dir>/projects/<any>/<id>.jsonl`. */
export function transcriptOf(sessionId, env = process.env) {
	const projects = path.join(configDir(env), 'projects');
	let dirs = [];
	try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return null; }
	for (const d of dirs) {
		const f = path.join(projects, d.name, `${sessionId}.jsonl`);
		if (fs.existsSync(f)) return f;
	}
	return null;
}

/** Send `text` to the session whose record fields are `fields`; returns { reply, raw }. Throws, naming the
 *  reason, when it cannot: no session_id, a harness other than claude-code, no transcript on this
 *  machine, claude missing, or claude failing. */
export function sendTo(fields, text, { spawn = spawnSync, env = process.env } = {}) {
	if (!fields.session_id) throw new Error('this session has no session_id — only a session bound or saved by its harness can be sent a message');
	if ((fields.harness ?? 'claude-code') !== 'claude-code') throw new Error(`this session ran on ${fields.harness}; dt session send speaks to claude-code sessions only`);
	if (!transcriptOf(fields.session_id, env)) throw new Error(`no transcript for ${fields.session_id} on this machine (looked in ${path.join(configDir(env), 'projects', '*', `${fields.session_id}.jsonl`)}) — a session resumes only where it ran`);
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-session-send-'));
	try {
		const r = spawn('claude', sendArgv(fields.session_id), { cwd, input: text, encoding: 'utf8', env, timeout: 600_000 });
		if (r.error) throw new Error(r.error.code === 'ENOENT' ? 'claude is not on PATH — dt session send runs the Claude Code CLI' : `claude: ${r.error.message}`);
		if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${String(r.stderr || r.stdout).trim().split('\n')[0]}`);
		let reply;
		try { reply = JSON.parse(r.stdout); } catch { throw new Error(`claude answered something other than JSON: ${String(r.stdout).slice(0, 200)}`); }
		return { reply, raw: r.stdout };
	} finally {
		try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* a temp folder left behind is harmless */ }
	}
}
