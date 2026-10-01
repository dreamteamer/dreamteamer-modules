// CLI-level tests for detect.mjs. Subprocess rather than import: the module executes its verb
// dispatch at load time, so importing it would run a scan as a side effect.
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
const SCRIPT = path.join(HERE, '..', '..', 'skills', 'ingesting-recordings', 'bin', 'detect.mjs');

// `scan` is read-only, so it is safe to run for real against whatever `INBOX_FOLDERS` resolves to on
// THIS machine — unlike `import`'s archive step (see below), nothing here can write into a real
// synced folder. Captured as {ok, out} / {ok:false, stderr} rather than assumed to succeed: mid
// migration `INBOX_FOLDERS` has no value at all (Task 7 sets it), so `scan` correctly DIES today
// (CLAUDE.md rule: a script naming a missing var under the current root has passed, not failed) —
// and dying identically from every cwd is exactly as much a cwd-independence proof as matching JSON
// would be. Once Task 7 sets `INBOX_FOLDERS`, this same test starts exercising the success path
// instead, with no change needed here.
const scanFrom = (cwd) => {
	try { return { ok: true, out: JSON.parse(execFileSync('node', [SCRIPT, 'scan'], { cwd, encoding: 'utf8' })) }; }
	catch (e) { return { ok: false, stderr: (e.stderr ?? '').toString() }; }
};

test('scan is identical from any working directory — the vault root is walked, not cwd', () => {
	const fromRoot = scanFrom(VAULT);
	// The skill's own folder, to prove cwd is irrelevant — a non-existent cwd makes execFileSync report
	// the confusing `spawnSync node ENOENT`, so it must be a folder that exists wherever the module lands.
	const fromModule = scanFrom(path.join(HERE, '..'));
	const fromSlash = scanFrom('/');
	assert.deepEqual(fromModule, fromRoot);
	assert.deepEqual(fromSlash, fromRoot);
});

// `import` files the recording into `${env:FILES_FOLDER}`, which is machine-specific — exercising it
// against whatever FILES_FOLDER really resolves to would write into the operator's actual
// meeting-recordings/ tree on every `npm test` run. `--files-folder` is the escape hatch: an
// explicit local-dir override pointed at a throwaway fixture. That makes the archive path a genuinely pinnable derivation (CLAUDE.md's own
// example of what a fixture test IS for) without ever touching a real synced folder.
//
// ⚠ Rewritten 23/08/2026, when `media/` retired, and again 2026-08-31 (capture→recording terminology
// pass, and the archive filename becoming the record id instead of the inbox payload's own name).
// The sequence is copy → verify by sha256 → move the payload to the inbox root's `trash/` — no
// second `media/` copy to fall back on, so letting go of the source before the archive copy is
// proven would be the one mistake that loses a recording outright.
test('import archives the recording under its RECORD ID, verifies it, and trashes the inbox payload — no media/ copy', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-import-inbox-'));
	fs.mkdirSync(path.join(root, 'meeting-recordings'), { recursive: true });
	const src = path.join(root, 'meeting-recordings', '2026 08 20 1400 detect probe.m4a');
	const bytes = Buffer.from('not real audio, only bytes to hash');
	fs.writeFileSync(src, bytes);
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-ff-'));
	try {
		const out = JSON.parse(execFileSync('node',
			[SCRIPT, 'import', src, '--id', '2026/08/detect-probe', '--files-folder', filesFolder,
				'--inbox-folders', root],
			{ encoding: 'utf8' }));
		// FLAT under meeting-recordings/ — the path below it IS the record id, named `<id>.<ext>`, never
		// the inbox payload's own filename ("2026 08 20 1400 detect probe.m4a").
		const archived = path.join(filesFolder, 'meeting-recordings/2026/08/detect-probe.m4a');
		// `recording_file` is the machine-portable TEMPLATE (what goes on the record verbatim);
		// `recording_file_resolved` is this machine's absolute path (what a local caller reads next).
		assert.equal(out.recording_file, '${env:FILES_FOLDER}/meeting-recordings/2026/08/detect-probe.m4a',
			"recording_file is the ${env:FILES_FOLDER} template, named after the record id");
		assert.equal(out.recording_file_resolved, archived, 'recording_file_resolved is the absolute path');
		assert.ok(fs.existsSync(archived), 'the recording must land at meeting-recordings/<id>.<ext>');
		assert.deepEqual(fs.readFileSync(archived), bytes, 'and it must be the same bytes');
		assert.ok(!fs.existsSync(src), 'the inbox payload must be gone from meeting-recordings/');
		// …gone to trash/, not unlinked: removal is never a delete (design §3.2).
		const trashed = fs.readdirSync(path.join(root, 'trash'));
		assert.ok(trashed.some((n) => n.endsWith('detect probe.m4a')), `payload must be in trash/, saw ${trashed.join(', ')}`);
		// the retired second copy must NOT come back
		assert.ok(!('file' in out), '`file` must no longer be reported — media/ is retired');
		assert.ok(!fs.existsSync(path.join(VAULT, 'media/meeting-recordings/detect-probe.m4a')),
			'nothing may be written into media/ any more');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

test('no code path writes into media/ any more', () => {
	const src = fs.readFileSync(SCRIPT, 'utf8');
	assert.ok(!/const MEDIA = /.test(src), 'the MEDIA constant must be gone');
	assert.ok(!/copyFileSync\(src, dest\)/.test(src), 'the media/ copy must be gone');
	assert.ok(!/backfill-fingerprints'/.test(src.replace(/^\s*[/*].*$/gm, '')),
		'backfill-fingerprints read media/ and is retired — only prose may mention it');
});

test('archive-known is gone', () => {
	assert.ok(!fs.readFileSync(SCRIPT, 'utf8').includes("verb === 'archive-known'"));
});

// Retry-safety: before this fix, `import` never mkdir'd the destination YEAR folder, so the first
// recording of a new year (or a backdated one) died with ENOENT AFTER the media/ copy had already
// verified — and re-running `import` then hit the OTHER guard ("destination already exists"),
// because media/ already held the copy, forcing a hand-delete before retrying. This fixture
// deliberately does NOT pre-create `meeting-recordings/2027` (unlike the happy-path test above), so
// BOTH the year and the month folder must be created on demand — a new year needs two levels, not
// one, which is the part the month segment could have quietly broken. `media/` is retired, so there
// is no consolation copy any more — this is purely about the archive's own folders.
test('import creates missing folders under meeting-recordings/ — retry-safe for a new year or a backdated recording', () => {
	const src = path.join(os.tmpdir(), `detect-newyear-${process.pid}.m4a`);
	fs.writeFileSync(src, Buffer.from('not real audio, only bytes to hash'));
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-newyear-ff-'));
	try {
		const out = JSON.parse(execFileSync('node',
			[SCRIPT, 'import', src, '--id', '2027/01/detect-newyear', '--files-folder', filesFolder],
			{ encoding: 'utf8' }));
		const archived = path.join(filesFolder, 'meeting-recordings/2027/01/detect-newyear.m4a');
		assert.equal(out.recording_file_resolved, archived, 'both folders and the filename come from the id');
		assert.ok(fs.existsSync(archived), 'both folders must be created on demand, not require a pre-existing one');
		assert.ok(!fs.existsSync(src), 'the source must be MOVED, not left in the inbox');
	} finally {
		fs.rmSync(src, { force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

// The `gdrive://` guard: a cloud session's `.env.web` FILES_FOLDER is a remote address, not a local
// path. Without this guard, `path.join`/`mkdirSync`/`renameSync` would treat it as RELATIVE and
// silently create real directories inside the repo rather than failing loudly.
test('import refuses a non-local (gdrive://) FILES_FOLDER rather than creating directories inside the repo', () => {
	const src = path.join(os.tmpdir(), `detect-gdrive-${process.pid}.m4a`);
	fs.writeFileSync(src, Buffer.from('not real audio, only bytes to hash'));
	const bogusDir = path.join(VAULT, 'gdrive:');   // what path.join('gdrive://x', …) would create, relative to VAULT
	try {
		let threw = false;
		try {
			execFileSync('node',
				[SCRIPT, 'import', src, '--id', '2026/08/detect-gdrive', '--files-folder', 'gdrive://some-folder-id'],
				{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (e) {
			threw = true;
			assert.match((e.stderr ?? '').toString(), /not a local path/);
		}
		assert.ok(threw, 'must refuse rather than silently archiving into a relative "gdrive:" directory');
		assert.ok(!fs.existsSync(bogusDir), 'must never have created a stray directory inside the repo');
	} finally {
		fs.rmSync(src, { force: true });
		fs.rmSync(bogusDir, { recursive: true, force: true });
	}
});

// ── resolveInboxRoots() — splitting, trimming, blank-dropping, skipping a nonexistent root ────────
// `--inbox-folders` mirrors `--files-folder`'s override shape, so this is pinnable with a throwaway
// fixture and no real .env / synced folder — matching CLAUDE.md's own example of what a fixture
// test is for. `scan` is the one verb that calls resolveInboxRoots(), so it is exercised through
// the CLI rather than imported (the module dispatches its verb at load time — see the file header).
test('resolveInboxRoots splits on newlines, trims, drops blanks, and skips a root that does not exist', () => {
	const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-inbox-'));
	fs.mkdirSync(path.join(realRoot, 'meeting-recordings'), { recursive: true });
	const missingRoot = path.join(os.tmpdir(), `detect-inbox-missing-${process.pid}`);
	assert.ok(!fs.existsSync(missingRoot), 'precondition: this path must not exist');
	const raw = `\n  ${realRoot}  \n\n${missingRoot}\n   \n`;   // leading/trailing space + blanks, on purpose
	try {
		const r = execFileSync('node', [SCRIPT, 'scan', '--inbox-folders', raw], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		const out = JSON.parse(r);
		assert.deepEqual(out.inbox_roots, [path.join(realRoot, 'meeting-recordings')],
			'only the real, trimmed root survives — the blank lines and the missing root are dropped');
	} finally {
		fs.rmSync(realRoot, { recursive: true, force: true });
	}
});

test('resolveInboxRoots dies with no usable root, rather than silently reporting zero', () => {
	try {
		execFileSync('node', [SCRIPT, 'scan', '--inbox-folders', '\n  \n'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		assert.fail('must not exit 0 with no usable inbox root');
	} catch (e) {
		assert.match((e.stderr ?? '').toString(), /INBOX_FOLDERS resolves to no usable root/);
	}
});

// ── the inbox log — working memory beside the payload (spec §3.2b) ──────────────────────────────
test('import logs "seen" at first touch, then DELETES the log once fully filed', () => {
	const src = path.join(os.tmpdir(), `detect-log-probe-${process.pid}.m4a`);
	fs.writeFileSync(src, Buffer.from('not real audio, only bytes to hash'));
	const logPath = `${src}.log`;
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-log-ff-'));
	// Pre-creates only the YEAR level, on purpose (mirrors the retry-safety test above) — the MONTH
	// level must still be created on demand.
	fs.mkdirSync(path.join(filesFolder, 'meeting-recordings/2026'), { recursive: true });
	try {
		execFileSync('node', [SCRIPT, 'import', src, '--id', '2026/08/detect-log-probe', '--files-folder', filesFolder], { encoding: 'utf8' });
		assert.ok(!fs.existsSync(logPath), 'fully processed = payload filed + log DELETED — durable history is the record, not this scratch file');
	} finally {
		fs.rmSync(src, { force: true });
		fs.rmSync(logPath, { force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

test('import logs "refused" (and keeps both file and log) when the archive destination already exists', () => {
	const src = path.join(os.tmpdir(), `detect-log-refuse-${process.pid}.m4a`);
	fs.writeFileSync(src, Buffer.from('not real audio, only bytes to hash'));
	const logPath = `${src}.log`;
	const filesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-log-refuse-ff-'));
	fs.mkdirSync(path.join(filesFolder, 'meeting-recordings/2026/08'), { recursive: true });
	// pre-occupy the archive destination — named after the RECORD id, never the inbox payload's own
	// filename — with an unrelated file, the refuse path.
	fs.writeFileSync(path.join(filesFolder, 'meeting-recordings/2026/08/detect-log-refuse.m4a'), 'already here');
	try {
		try {
			execFileSync('node', [SCRIPT, 'import', src, '--id', '2026/08/detect-log-refuse', '--files-folder', filesFolder], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
			assert.fail('must refuse rather than overwrite the archive');
		} catch { /* expected: import dies */ }
		assert.ok(fs.existsSync(src), 'the source stays in the inbox — refused, not filed');
		assert.ok(fs.existsSync(logPath), 'the log stays too — it is the narrative that explains the refusal');
		const log = fs.readFileSync(logPath, 'utf8');
		assert.match(log, /\bseen\b/);
		assert.match(log, /refused.*reason=archive-destination-already-exists/);
	} finally {
		fs.rmSync(src, { force: true });
		fs.rmSync(logPath, { force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

test('scan skips `*.log` sidecars as payloads, and heals a moot one (payload gone) into <root>/trash/', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-moot-'));
	fs.mkdirSync(path.join(root, 'meeting-recordings'), { recursive: true });
	// a moot log: no matching payload beside it
	fs.writeFileSync(path.join(root, 'meeting-recordings/ghost.m4a.log'), '2026-08-01T00:00:00Z  seen  sha256=x size=1  by=drain@desktop\n');
	try {
		const out = JSON.parse(execFileSync('node', [SCRIPT, 'scan', '--inbox-folders', root], { encoding: 'utf8' }));
		assert.equal(out.total, 0, 'the .log must never be read as a payload');
		assert.ok(!fs.existsSync(path.join(root, 'meeting-recordings/ghost.m4a.log')), 'the moot log must leave meeting-recordings/');
		assert.ok(fs.existsSync(path.join(root, 'trash/ghost.m4a.log')), 'and land in trash/, never be unlinked');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

// The bug this pins, found 23/08/2026: `scan` walked exactly ONE level and skipped directories with
// a comment claiming it thereby "skips ingested/ by construction" — a staging folder retired the day
// before. So the skip protected nothing and stranded everything: two receipts sat in an
// `inbox/invoices/ingested/` subfolder invisible to the drain meant to file them, while
// `verify-drive-index` (which does walk) counted them as new. The other three flows over this same
// inbox shape were already recursive. A subfolder here is never legitimate — the point is that a
// file put in one is still FOUND rather than silently skipped.
test('scan finds a payload nested in a SUBFOLDER — a stray folder must never strand a file', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-nested-'));
	fs.mkdirSync(path.join(root, 'meeting-recordings/some-stray-folder'), { recursive: true });
	const nested = path.join(root, 'meeting-recordings/some-stray-folder/2026 08 20 1400 nested probe.m4a');
	fs.writeFileSync(nested, Buffer.from('not real audio, only bytes to hash'));
	// and one at the top level, to prove nesting is additive rather than a replacement
	const top = path.join(root, 'meeting-recordings/2026 08 21 0900 top probe.m4a');
	fs.writeFileSync(top, Buffer.from('different bytes, so a different fingerprint'));
	try {
		const out = JSON.parse(execFileSync('node', [SCRIPT, 'scan', '--inbox-folders', root], { encoding: 'utf8' }));
		const found = out.recordings.map((c) => c.inbox_path);
		assert.equal(out.total, 2, 'both the nested and the top-level payload must be seen');
		assert.ok(found.includes(nested), 'the payload inside the subfolder must be found, not skipped');
		assert.ok(found.includes(top), 'the top-level payload must still be found');
		// the nested one must be a real candidate, with its date parsed the same way as any other
		const c = out.recordings.find((x) => x.inbox_path === nested);
		assert.equal(c.date, '2026-08-20', 'a nested payload is parsed identically to a top-level one');
		assert.equal(c.time_hint, '14:00');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
