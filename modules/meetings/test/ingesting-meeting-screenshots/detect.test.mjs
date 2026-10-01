// CLI-level tests for detect.mjs. Subprocess rather than import: the module executes its verb
// dispatch at load time, so importing it would run a scan as a side effect. Same shape as
// ingesting-recordings/tests/detect.test.mjs — this skill is deliberately the same pattern.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The workspace this module is installed in — the same walk the script does (a clone directly inside
// `git_modules/` is never the workspace). Standalone, in the module's own repo, there is no workspace
// above: fall back to the module root so the cwd-independence test still runs (both cwds then die
// identically, which is the same proof).
const MODULE_ROOT = path.resolve(HERE, '..', '..', '..');
const VAULT = (() => {
	for (let d = HERE; ; d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) return MODULE_ROOT;
	}
})();
const SCRIPT = path.join(HERE, '..', '..', 'skills', 'ingesting-meeting-screenshots', 'bin', 'detect.mjs');

// `scan` is read-only, so it is safe to run for real against whatever `INBOX_FOLDERS` resolves to on
// THIS machine. Mid migration `INBOX_FOLDERS` has no value at all (Task 7 sets it), so `scan`
// correctly DIES today — dying identically from every cwd is exactly as much a cwd-independence
// proof as matching JSON would be. Once Task 7 sets `INBOX_FOLDERS`, this same test starts
// exercising the success path instead, with no change needed here.
const scanFrom = (cwd) => {
	try { return { ok: true, out: JSON.parse(execFileSync('node', [SCRIPT, 'scan'], { cwd, encoding: 'utf8' })) }; }
	catch (e) { return { ok: false, stderr: (e.stderr ?? '').toString() }; }
};

test('scan is identical from any working directory — the vault root is walked, not cwd', () => {
	const fromRoot = scanFrom(VAULT);
	const fromModule = scanFrom(path.join(HERE, '..'));
	const fromSlash = scanFrom('/');
	assert.deepEqual(fromModule, fromRoot);
	assert.deepEqual(fromSlash, fromRoot);
});

test('the `ingested/` two-step is gone', () => {
	const src = fs.readFileSync(SCRIPT, 'utf8');
	assert.ok(!src.includes("'ingested'"), 'no more archiving into an inbox-local ingested/ folder');
	assert.ok(!/HQ_DRIVE_FOLDER|SCREENSHOTS_LOCAL_DIR/.test(src), 'the two retired env vars are gone');
});

// The `gdrive://` guard: a cloud session's `.env.web` FILES_FOLDER is a remote address, not a local
// path. Without this guard, `archive`'s `mkdirSync(dest, { recursive: true })` would treat it as
// RELATIVE and silently create real directories inside the repo rather than failing loudly.
test('refuses a non-local (gdrive://) FILES_FOLDER rather than creating directories inside the repo', () => {
	const bogusDir = path.join(VAULT, 'gdrive:');   // what path.join('gdrive://x', …) would create, relative to VAULT
	try {
		let threw = false;
		try {
			execFileSync('node', [SCRIPT, 'scan', '--files-folder', 'gdrive://some-folder-id', '--inbox-folders', VAULT],
				{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (e) {
			threw = true;
			assert.match((e.stderr ?? '').toString(), /not a local path/);
		}
		assert.ok(threw, 'must refuse a gdrive:// FILES_FOLDER rather than proceeding');
		assert.ok(!fs.existsSync(bogusDir), 'must never have created a stray directory inside the repo');
	} finally {
		fs.rmSync(bogusDir, { recursive: true, force: true });
	}
});

// `archive` files a shot under meetings/<meeting id>/screenshots/ — a real move under
// `${env:FILES_FOLDER}`, which is machine-specific. `--files-folder` is the same explicit-override
// shape `drive.mjs check-mount` already takes for its local-dir argument, pointed at a throwaway
// fixture dir instead of the real value — so this is a genuinely pinnable path derivation (never a
// live write to a real synced folder).
//
// ⚠ Rewritten 2026-08-31 (capture→recording terminology pass): this used to file under the meeting's
// BASENAME only (`meetings/<basename>/`), which meant two meetings sharing a title collided on the
// same folder. The destination is now nested under the FULL meeting id, with a `screenshots/` leaf —
// mirroring meeting-recordings' own "the archive path IS the record id" rule.
test('archive files under meetings/<meeting id>/screenshots/, nested by the full id not the basename', () => {
	const src = path.join(os.tmpdir(), `detect-shot-${process.pid}.png`);
	fs.writeFileSync(src, Buffer.from('not a real png, only bytes to move'));
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-ff-'));
	try {
		const out = JSON.parse(execFileSync('node',
			[SCRIPT, 'archive', src, '2026/07/2026-07-08--16-45--northwind--sam-dana', '--files-folder', filesFolder],
			{ encoding: 'utf8' }));
		const target = path.join(filesFolder, 'meetings/2026/07/2026-07-08--16-45--northwind--sam-dana/screenshots', path.basename(src));
		assert.equal(out.archived_to, target);
		assert.ok(fs.existsSync(target), 'the shot must land under meetings/<meeting id>/screenshots/');
		assert.ok(!fs.existsSync(src), 'the source must be MOVED, not left in the inbox');
	} finally {
		fs.rmSync(src, { force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

// ── resolveInboxRoots() — splitting, trimming, blank-dropping, skipping a nonexistent root ────────
// Same contract and same override shape as the recordings scanner's own test — see that file for
// the fuller rationale. `scan` is the one verb that calls resolveInboxRoots() here.
test('resolveInboxRoots splits on newlines, trims, drops blanks, and skips a root that does not exist', () => {
	const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-inbox-'));
	fs.mkdirSync(path.join(realRoot, 'meeting-screenshots'), { recursive: true });
	const missingRoot = path.join(os.tmpdir(), `detect-inbox-missing-${process.pid}`);
	assert.ok(!fs.existsSync(missingRoot), 'precondition: this path must not exist');
	const raw = `\n  ${realRoot}  \n\n${missingRoot}\n   \n`;
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-ff-'));
	try {
		const r = execFileSync('node',
			[SCRIPT, 'scan', '--files-folder', filesFolder, '--inbox-folders', raw],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		const out = JSON.parse(r);
		assert.deepEqual(out.inbox_roots, [path.join(realRoot, 'meeting-screenshots')],
			'only the real, trimmed root survives — the blank lines and the missing root are dropped');
	} finally {
		fs.rmSync(realRoot, { recursive: true, force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

test('resolveInboxRoots dies with no usable root, rather than silently reporting zero', () => {
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-ff-'));
	try {
		execFileSync('node', [SCRIPT, 'scan', '--files-folder', filesFolder, '--inbox-folders', '\n  \n'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		assert.fail('must not exit 0 with no usable inbox root');
	} catch (e) {
		assert.match((e.stderr ?? '').toString(), /INBOX_FOLDERS resolves to no usable root/);
	} finally {
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

// ── the inbox log — working memory beside the payload (spec §3.2b) ──────────────────────────────
test('archive logs "seen" at first touch, then DELETES the log once fully filed', () => {
	const src = path.join(os.tmpdir(), `detect-shot-log-${process.pid}.png`);
	fs.writeFileSync(src, Buffer.from('not a real png, only bytes to move'));
	const logPath = `${src}.log`;
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-log-ff-'));
	try {
		execFileSync('node',
			[SCRIPT, 'archive', src, '2026/07/2026-07-08--16-45--northwind--sam-dana', '--files-folder', filesFolder],
			{ encoding: 'utf8' });
		assert.ok(!fs.existsSync(logPath), 'fully processed = payload filed + log DELETED — durable history is the meeting record, not this scratch file');
	} finally {
		fs.rmSync(src, { force: true });
		fs.rmSync(logPath, { force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

test('archive logs "refused" (and keeps both file and log) when the destination is already filed', () => {
	const src = path.join(os.tmpdir(), `detect-shot-refuse-${process.pid}.png`);
	fs.writeFileSync(src, Buffer.from('not a real png, only bytes to move'));
	const logPath = `${src}.log`;
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-log-refuse-ff-'));
	const meetingDir = path.join(filesFolder, 'meetings/2026/07/2026-07-08--16-45--northwind--sam-dana/screenshots');
	fs.mkdirSync(meetingDir, { recursive: true });
	// pre-occupy the destination with a file of the SAME basename — the refuse path
	fs.writeFileSync(path.join(meetingDir, path.basename(src)), 'already filed');
	try {
		try {
			execFileSync('node',
				[SCRIPT, 'archive', src, '2026/07/2026-07-08--16-45--northwind--sam-dana', '--files-folder', filesFolder],
				{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
			assert.fail('must refuse rather than overwrite an already-filed shot');
		} catch { /* expected: archive dies */ }
		assert.ok(fs.existsSync(src), 'the source stays in the inbox — refused, not filed');
		assert.ok(fs.existsSync(logPath), 'the log stays too — it is the narrative that explains the refusal');
		const log = fs.readFileSync(logPath, 'utf8');
		assert.match(log, /\bseen\b/);
		assert.match(log, /refused.*reason=already-filed-at-destination/);
	} finally {
		fs.rmSync(src, { force: true });
		fs.rmSync(logPath, { force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

test('scan skips `*.log` sidecars as payloads, and heals a moot one (payload gone) into <root>/trash/', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-moot-'));
	fs.mkdirSync(path.join(root, 'meeting-screenshots'), { recursive: true });
	fs.writeFileSync(path.join(root, 'meeting-screenshots/ghost.png.log'), '2026-08-01T00:00:00Z  seen  sha256=x size=1  by=drain@desktop\n');
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-moot-ff-'));
	try {
		const out = JSON.parse(execFileSync('node',
			[SCRIPT, 'scan', '--files-folder', filesFolder, '--inbox-folders', root], { encoding: 'utf8' }));
		assert.equal(out.total, 0, 'the .log must never be read as a payload');
		assert.ok(!fs.existsSync(path.join(root, 'meeting-screenshots/ghost.png.log')), 'the moot log must leave meeting-screenshots/');
		assert.ok(fs.existsSync(path.join(root, 'trash/ghost.png.log')), 'and land in trash/, never be unlinked');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});
