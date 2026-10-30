#!/usr/bin/env node
/**
 * li.mjs — drive linkedin-mcp-server for ONE batch, in ONE ephemeral container, then exit.
 *
 * Why this exists instead of an `.mcp.json` entry: the LinkedIn session is a SINGLETON. A stdio MCP
 * entry spawns one container per agent session, and two containers on the one ~/.linkedin-mcp
 * profile make LinkedIn invalidate the cookie — which costs a host re-login, not a retry. A stdio
 * server cannot be shared between clients (one stdin/stdout pair), and a long-lived HTTP server would
 * be a daemon holding a live session. So: no registered server, no idle container. The lock below is
 * what makes "exactly one" true.
 *
 * Usage
 *   node li.mjs <tool> '<jsonArgs>'                     one call
 *   echo '[{"tool":..,"args":{..}}, ...]' | node li.mjs --stdin      a batch, one container
 *   node li.mjs --doctor                                is the session alive? (no LinkedIn request)
 *
 * Always prints a JSON array of {tool, args, ok, result|error} to stdout; logs go to stderr.
 * close_session is called for you at the end of every batch.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IMAGE = 'stickerdaniel/linkedin-mcp-server:latest';
const PROFILE = path.join(os.homedir(), '.linkedin-mcp');
const LOCK = path.join(PROFILE, 'linkedin-batch.lock');   // ours; the server owns profile.lock
const STALE_MS = 30 * 60 * 1000;
const CALL_TIMEOUT_MS = 300_000;

// ---------- the lock: a directory, because mkdir is atomic on every filesystem -------------------
function acquire() {
	try {
		fs.mkdirSync(LOCK);
	} catch (e) {
		if (e.code !== 'EEXIST') throw e;
		const info = readLock();
		if (info && Date.now() - info.at < STALE_MS && alive(info.pid)) {
			throw new Error(
				`another LinkedIn batch is running (pid ${info.pid}, started ${new Date(info.at).toISOString()}).\n`
				+ 'Wait for it. Two containers on one profile invalidate the LinkedIn session — that costs a\n'
				+ `host re-login, not a retry. If you are certain it is dead: rm -rf ${LOCK}`,
			);
		}
		console.error(`[li] clearing a stale lock (${info ? `pid ${info.pid}` : 'unreadable'})`);
		fs.rmSync(LOCK, { recursive: true, force: true });
		fs.mkdirSync(LOCK);
	}
	fs.writeFileSync(path.join(LOCK, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now() }));
}
const readLock = () => {
	try { return JSON.parse(fs.readFileSync(path.join(LOCK, 'owner.json'), 'utf8')); } catch { return null; }
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const release = () => { try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch { /* gone */ } };

/** read one key from the nearest ancestor .env — the workspace convention for machine config */
function readEnvFile(key) {
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		const f = path.join(dir, '.env');
		if (fs.existsSync(f)) {
			const m = fs.readFileSync(f, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
			if (m) return m[1].trim().replace(/^["']|["']$/g, '');
		}
		const up = path.dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return null;
}

// ---------- doctor: answer "is the session alive" from disk, spending no LinkedIn request --------
function doctor() {
	const out = { profile_dir: PROFILE, exists: fs.existsSync(PROFILE) };
	if (!out.exists) {
		out.verdict = 'no profile — run: uvx mcp-server-linkedin@latest --import-from-browser';
		return out;
	}
	out.cookies = fs.existsSync(path.join(PROFILE, 'cookies.json'));
	try {
		const st = JSON.parse(fs.readFileSync(path.join(PROFILE, 'source-state.json'), 'utf8'));
		out.login_at = st.created_at;
		out.age_days = +((Date.now() - Date.parse(st.created_at)) / 864e5).toFixed(1);
	} catch { out.login_at = null; }

	// the newest trace run's post-import screenshot is the ground truth: a real page is ~36KB,
	// a bounce to the sign-in wall leaves it blank at ~4KB.
	const loginMs = out.login_at ? Date.parse(out.login_at) : 0;
	const runs = path.join(PROFILE, 'trace-runs');
	if (fs.existsSync(runs)) {
		// newest FIRST, but skip runs with no screenshot — a container killed before it scraped
		// leaves an empty trace dir, and letting that mask the real evidence is how you conclude
		// "no information" while the answer sits one directory down.
		const ordered = fs.readdirSync(runs)
			.map((d) => ({ d, m: fs.statSync(path.join(runs, d)).mtimeMs }))
			.sort((a, b) => b.m - a.m);
		out.newest_trace = ordered[0]?.d ?? null;
		const withShot = ordered.find((r) => fs.existsSync(path.join(runs, r.d, 'screens', '004-feed-after-goto.png')));
		if (withShot) {
			const dir = path.join(runs, withShot.d, 'screens');
			const bytes = fs.statSync(path.join(dir, '004-feed-after-goto.png')).size;
			out.evidence_from = withShot.d;
			out.last_feed_screenshot_bytes = bytes;
			// A verdict from a run that PREDATES the current login is about the previous session, so it
			// must not be reported as the current one.
			if (loginMs && withShot.m < loginMs) {
				out.evidence_is_stale = `trace is ${Math.round((loginMs - withShot.m) / 1000)}s older than the login`;
				out.verdict = 'login is NEWER than any scraping evidence — session untested. Just run the batch.';
			} else {
				out.verdict = bytes < 10_000
					? 'session looks DEAD (blank feed after cookie import). Fix: uvx mcp-server-linkedin@latest '
					+ `--import-from-browser. Confirm by eye: ${path.join(dir, '003-bridge-after-cookie-import.png')}`
					: 'last scraping run reached a real feed page — session was healthy then';
			}
		}
	}
	out.verdict ??= 'no trace evidence yet; the first call will tell you';
	const held = fs.existsSync(LOCK) ? readLock() : null;
	out.batch_lock = !held ? 'free'
		: alive(held.pid) && Date.now() - held.at < STALE_MS ? `HELD by pid ${held.pid}`
		: `stale (pid ${held.pid} is gone) — the next batch clears it automatically`;
	out.containers_running = execFileSync('docker',
		['ps', '--filter', `ancestor=${IMAGE}`, '--format', '{{.ID}}']).toString().trim().split('\n').filter(Boolean).length;
	Object.assign(out, strandedClients());
	return out;
}

/**
 * Stranded HOST-side clients. A `mcp-server-linkedin` process that never exited keeps the flock on
 * `~/.linkedin-mcp/profile.lock`, and while it lives every `--import-from-browser` and `--login`
 * refuses with `BrowserBusyError` — so a dead-session verdict must not send you to re-login.
 *
 * This greps `ps` rather than reading the lock: macOS `lsof` shows an empty lock field even for a
 * held flock, and Docker Desktop's VM always has the file open because `~/.linkedin-mcp` is
 * bind-mounted into the container.
 *
 * flock is released by the KERNEL when its holder dies, so anything found here is alive and `kill`
 * is the whole fix.
 */
function strandedClients() {
	let lines = [];
	try {
		lines = execFileSync('ps', ['-axo', 'pid=,lstart=,command='], { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString().split('\n')
			.filter((l) => /mcp-server-linkedin|patchright-browsers/.test(l) && !/\bgrep\b/.test(l));
	} catch { return { host_clients: 'unknown (ps failed)' }; }
	if (!lines.length) return { host_clients: 'none' };
	// The chromium tree is noise once its parent is named; report the SERVER processes, and count
	// the browsers so a half-dead tree is still visible.
	const servers = lines.filter((l) => /mcp-server-linkedin/.test(l)).map((l) => {
		const m = /^\s*(\d+)\s+(.{24})\s+(.*)$/.exec(l);
		return m ? { pid: Number(m[1]), started: m[2].trim() } : null;
	}).filter(Boolean);
	const browsers = lines.filter((l) => /patchright-browsers/.test(l)).length;
	if (!servers.length) return { host_clients: `${browsers} orphaned patchright browser process(es), no server — kill them before logging in` };
	return {
		host_clients: `HELD by ${servers.map((sv) => `pid ${sv.pid} (started ${sv.started})`).join(', ')}, ${browsers} browser process(es)`,
		verdict_override: `a LinkedIn MCP process still holds the browser lease, so --login and --import-from-browser BOTH refuse with BrowserBusyError. Fix: kill ${servers.map((sv) => sv.pid).join(' ')}`,
	};
}

// ---------- one container, N calls ---------------------------------------------------------------
async function runBatch(calls) {
	// USER_AGENT exists to reduce anti-scraping detection: the session is minted on the host and used
	// from a Linux container. Set LINKEDIN_USER_AGENT in .env to the browser the session came from.
	const ua = process.env.LINKEDIN_USER_AGENT || readEnvFile('LINKEDIN_USER_AGENT');
	if (!ua) console.error('[li] no LINKEDIN_USER_AGENT set — see the skill; this may raise detection');
	const args = [
		'run', '--rm', '-i', '--init', '--security-opt', 'no-new-privileges',
		'-v', `${PROFILE}:/home/pwuser/.linkedin-mcp`,
		'-e', 'TIMEOUT=10000', '-e', 'TOOL_TIMEOUT=300',
		...(ua ? ['-e', `USER_AGENT=${ua}`] : []),
		IMAGE,
	];
	const p = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
	const pending = new Map();
	let buf = '';
	let nextId = 1;

	p.stdout.on('data', (d) => {
		buf += d;
		let i;
		while ((i = buf.indexOf('\n')) !== -1) {
			const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
			if (!line) continue;
			let m; try { m = JSON.parse(line); } catch { continue; }
			const r = pending.get(m.id);
			if (r) { pending.delete(m.id); r(m); }
		}
	});
	p.stderr.on('data', (d) => {
		const s = String(d);
		if (/ERROR|WARNING|Traceback|session/i.test(s)) process.stderr.write('[server] ' + s);
	});

	const rpc = (method, params) => new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, resolve);
		const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout after ${CALL_TIMEOUT_MS}ms`)); }, CALL_TIMEOUT_MS);
		const done = (v) => { clearTimeout(t); resolve(v); };
		pending.set(id, done);
		p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
	});

	const init = await rpc('initialize', {
		protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dt-li', version: '1' },
	});
	console.error(`[li] ${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version} — ${calls.length} call(s)`);

	const out = [];
	for (const [n, c] of calls.entries()) {
		console.error(`[li] ${n + 1}/${calls.length} ${c.tool} ${JSON.stringify(c.args ?? {})}`);
		let row = { tool: c.tool, args: c.args ?? {} };
		try {
			const m = await rpc('tools/call', { name: c.tool, arguments: c.args ?? {} });
			if (m.error) row = { ...row, ok: false, error: m.error };
			else {
				const text = (m.result?.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
				let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
				// a non-error response can still carry per-section failures — surface them
				const partial = parsed?.section_errors ? Object.keys(parsed.section_errors) : [];
				row = { ...row, ok: !m.result?.isError, result: parsed, ...(partial.length ? { failed_sections: partial } : {}) };
			}
		} catch (e) {
			row = { ...row, ok: false, error: e.message };
		}
		out.push(row);
	}

	try { await rpc('tools/call', { name: 'close_session', arguments: {} }); console.error('[li] session closed'); }
	catch { console.error('[li] close_session did not answer (container is exiting anyway)'); }
	p.kill();
	return out;
}

// ---------- main --------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === '--doctor') { console.log(JSON.stringify(doctor(), null, 2)); process.exit(0); }

let calls;
if (argv[0] === '--stdin') {
	calls = JSON.parse(fs.readFileSync(0, 'utf8'));
	if (!Array.isArray(calls)) { console.error('--stdin wants a JSON array of {tool, args}'); process.exit(2); }
} else if (argv[0]) {
	calls = [{ tool: argv[0], args: argv[1] ? JSON.parse(argv[1]) : {} }];
} else {
	console.error(`usage:
  li.mjs <tool> '<jsonArgs>'
  echo '[{"tool":"get_person_profile","args":{"linkedin_username":"dana-oren"}}]' | li.mjs --stdin
  li.mjs --doctor

NEVER call connect_with_person or send_message — they act publicly as you.`);
	process.exit(2);
}

const BANNED = new Set(['connect_with_person', 'send_message']);
const bad = calls.filter((c) => BANNED.has(c.tool));
if (bad.length) {
	console.error(`refusing ${bad.map((b) => b.tool).join(', ')} — these act publicly and irreversibly as`
		+ ' you. If it is genuinely wanted, do it by hand, not through a scraper.');
	process.exit(3);
}

try {
	acquire();
} catch (e) {
	// a contended lock is an expected outcome, not a crash — say so without a stack trace
	console.error(`[li] ${e.message}`);
	process.exit(4);
}
let code = 0;
try {
	const results = await runBatch(calls);
	console.log(JSON.stringify(results, null, 2));
	code = results.every((r) => r.ok) ? 0 : 1;
} catch (e) {
	console.error(`[li] batch failed: ${e.message}`);
	code = 1;
} finally {
	// MUST release before exiting: process.exit() does NOT run finally blocks, so an exit inside
	// the try would leave the lock held after the batch is gone.
	release();
}
process.exit(code);
