// Shared support for the cr-dt-006 held-out tests (rnd/tests/cr-dt-006-hm1 … hm7) — written by the test
// stage from the held-out records, never by the builder. Every workspace is the engine under test's own
// `init` (DT_CANDIDATES: the hash-verified candidate tarball), modules come from one folder of tarballs,
// HOME is a temp dir, and nothing of the operator's environment reaches the engine but PATH and git.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { BIN, virginWorkspace, packedInto, closure, moduleIds, pkgOf, packed, cleanup as cleanupWorkspaces, ENGINE_VERSION, engineMeets, editPkg } from '../helpers/workspace.mjs';

export { BIN, virginWorkspace, packedInto, closure, moduleIds, pkgOf, packed, ENGINE_VERSION, engineMeets, editPkg };
const made = [];
export const tmp = (prefix = 'dtm-heldout-') => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); made.push(d); return d; };
export const cleanup = () => { cleanupWorkspaces(); if (!process.env.DT_KEEP_FIXTURES) for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); };
export const skipUnless = (m) => (!engineMeets(m) && `needs engine ${pkgOf(m).dreamteamer.engine}, this is ${ENGINE_VERSION}`);

/** A clean environment: node's folder, the system folders and nothing else on PATH, a temp HOME, a
 *  synthetic git identity. `extra` lays variables over it (a PATH of stand-ins, a unit's keys). */
export function cleanEnv(extra = {}) {
	return {
		PATH: [path.dirname(process.execPath), '/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'].join(path.delimiter), HOME: tmp('dtm-HOME-'),
		GIT_AUTHOR_NAME: 'held-out', GIT_AUTHOR_EMAIL: 'held-out@example.invalid', GIT_COMMITTER_NAME: 'held-out', GIT_COMMITTER_EMAIL: 'held-out@example.invalid',
		npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false',
		...extra,
	};
}
/** The engine under test, no TTY, in a clean environment. Never throws on a non-zero exit. */
export function dt(cwd, args, env = cleanEnv()) {
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' });
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
export const git = (cwd, args) => execFileSync('git', args, { cwd, env: cleanEnv({ HOME: os.homedir() }), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A hash of every file under root (path, mode, bytes; .git excluded; links by target). */
export function treeHash(root) {
	const h = createHash('sha256');
	const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { if (e.name === '.git') continue; const p = path.join(dir, e.name); if (e.isSymbolicLink()) { h.update(`L ${path.relative(root, p)} ${fs.readlinkSync(p)}\n`); continue; } if (e.isDirectory()) { walk(p); continue; } h.update(`F ${path.relative(root, p)} ${fs.statSync(p).mode}\n`); h.update(fs.readFileSync(p)); } };
	walk(root); return h.digest('hex');
}
/** A copy of a workspace (links kept as links), so one expensive install is paid once. */
export function cloneWorkspace(src) {
	const dest = tmp('dtm-clone-');
	fs.cpSync(src, dest, { recursive: true, dereference: false, verbatimSymlinks: true });
	return dest;
}
/** A PATH folder of stand-ins: `uv` and `ffmpeg` that create what the recordings checks look for (the
 *  module's own test double), or any name with the body given. `mode` for a deliberately non-executable file. */
export function fakeBins(names, { bodies = {}, mode = 0o755 } = {}) {
	const dir = tmp('dtm-bin-');
	const UV = '#!/bin/sh\ncase "$1" in sync) mkdir -p "$UV_PROJECT_ENVIRONMENT/bin" && : > "$UV_PROJECT_ENVIRONMENT/bin/python" && chmod +x "$UV_PROJECT_ENVIRONMENT/bin/python";; run) case "$*" in *setup*) mkdir -p "$TRANSCRIPTION_HOME/models/whisper-ct2" "$TRANSCRIPTION_HOME/models/diarization" && : > "$TRANSCRIPTION_HOME/models/whisper-ct2/model.bin" && : > "$TRANSCRIPTION_HOME/models/diarization/segmentation.onnx" && : > "$TRANSCRIPTION_HOME/models/diarization/embedding.onnx";; esac;; esac; exit 0\n';
	for (const n of names) fs.writeFileSync(path.join(dir, n), bodies[n] ?? (n === 'uv' ? UV : '#!/bin/sh\nexit 0\n'), { mode });
	return dir;
}
/** Drive the engine through a pseudo-terminal (python3 pty): stdin and stdout are TTYs. `answers` is a list
 *  of { when: <substring of the output so far>, send: <text> | 'EOF' }. Returns { code, out }. */
export function pty(cwd, args, { answers = [], env = cleanEnv() } = {}) {
	const driver = path.join(tmp('dtm-pty-'), 'driver.py');
	fs.writeFileSync(driver, `
import os, pty, sys, select, time, json
cmd = json.loads(sys.argv[1]); answers = json.loads(sys.argv[2]); cwd = sys.argv[3]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(cmd[0], cmd, os.environ)
out = b''; i = 0; deadline = time.time() + 120
while True:
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try: data = os.read(fd, 65536)
        except OSError: break
        if not data: break
        out += data
    if i < len(answers) and answers[i]['when'].encode() in out:
        os.write(fd, b'\\x04' if answers[i]['send'] == 'EOF' else answers[i]['send'].encode()); i += 1
    if time.time() > deadline:
        os.kill(pid, 9); break
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
`);
	const r = spawnSync('python3', [driver, JSON.stringify([process.execPath, BIN, ...args]), JSON.stringify(answers), cwd], { env, encoding: 'utf8', timeout: 150_000, killSignal: 'SIGKILL' });
	return { code: r.status, out: (r.stdout ?? '').replace(/\r/g, ''), err: r.stderr ?? '' };
}
/** The setup section of `dt status --json`. */
export const statusLines = (root, env) => { const r = dt(root, ['status', '--json'], env); if (r.status !== 0 && r.code !== 0) throw new Error(`status --json: ${r.stderr}`); return JSON.parse(r.stdout).setup; };
/** Unpack a module's tarball straight into node_modules and declare it — bypassing `dt install`. */
export function bypassInstall(root, m) {
	const dir = path.join(root, 'node_modules', '@dreamteamer', m);
	fs.mkdirSync(dir, { recursive: true });
	execFileSync('tar', ['-xzf', packed(m), '-C', dir, '--strip-components', '1']);
	editPkg(root, (pkg) => { pkg.dependencies[`@dreamteamer/${m}`] = pkgOf(m).version; });
}
