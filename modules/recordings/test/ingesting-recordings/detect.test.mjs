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
const WORKSPACE = (() => {
	for (let d = HERE; ; d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) return MODULE_ROOT;
	}
})();
const SCRIPT = path.join(HERE, '..', '..', 'skills', 'ingesting-recordings', 'bin', 'detect.mjs');

// `scan` is read-only, so it is safe to run for real against whatever `INBOX_FOLDERS` resolves to on
// THIS machine — unlike `import`'s archive step (see below), nothing here can write into a real
// synced folder. Captured as {ok, out} / {ok:false, stderr} rather than assumed to succeed: where
// `INBOX_FOLDERS` has no value, `scan` dies, and dying identically from every cwd is as much a
// cwd-independence proof as matching JSON would be.
const scanFrom = (cwd) => {
	try { return { ok: true, out: JSON.parse(execFileSync('node', [SCRIPT, 'scan'], { cwd, encoding: 'utf8' })) }; }
	catch (e) { return { ok: false, stderr: (e.stderr ?? '').toString() }; }
};

test('scan is identical from any working directory — the workspace root is walked, not cwd', () => {
	const fromRoot = scanFrom(WORKSPACE);
	// The skill's own folder, to prove cwd is irrelevant — a non-existent cwd makes execFileSync report
	// the confusing `spawnSync node ENOENT`, so it must be a folder that exists wherever the module lands.
	const fromModule = scanFrom(path.join(HERE, '..'));
	const fromSlash = scanFrom('/');
	assert.deepEqual(fromModule, fromRoot);
	assert.deepEqual(fromSlash, fromRoot);
});

// `import` files the recording into `${env:FILES_FOLDER}`, which is machine-specific — exercising it
// against whatever FILES_FOLDER really resolves to would write into a real meeting-recordings/ tree
// on every `npm test` run. `--files-folder` is the escape hatch: an explicit local-dir override
// pointed at a throwaway fixture, which makes the archive path a pinnable derivation.
//
// The sequence is copy → verify by sha256 → move the payload to the inbox root's `trash/`; letting
// go of the source before the archive copy is proven would be the one mistake that loses a recording.
test('import archives the recording under its RECORD ID, verifies it, and trashes the inbox payload', () => {
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
		// …gone to trash/, not unlinked: removal is never a delete.
		const trashed = fs.readdirSync(path.join(root, 'trash'));
		assert.ok(trashed.some((n) => n.endsWith('detect probe.m4a')), `payload must be in trash/, saw ${trashed.join(', ')}`);
		// the retired second copy must NOT come back
		assert.ok(!('file' in out), '`file` must no longer be reported — media/ is retired');
		assert.ok(!fs.existsSync(path.join(WORKSPACE, 'media/meeting-recordings/detect-probe.m4a')),
			'nothing may be written into media/ any more');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(filesFolder, { recursive: true, force: true });
	}
});

// Retry-safety: the fixture does NOT pre-create `meeting-recordings/2027`, so both the year and the
// month folder must be created on demand — a new year needs two levels, not one.
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
	const bogusDir = path.join(WORKSPACE, 'gdrive:');   // what path.join('gdrive://x', …) would create, relative to WORKSPACE
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

// ── the inbox log — working memory beside the payload ──────────────────────────────────────
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

// ── orphan candidates — a file-less `origin: audio` recording matched against a new inbox file ───
// The script walks up to `package-lock.json` for its workspace, so each fixture is a throwaway
// workspace holding a copy of the script, a compiled meetings descriptor and the records.
const MEETINGS_STORAGE = [
	'name: meetings', 'storage:', '  path: data/meetings', '  codec: md', '  shape: file', '  suffix: meeting',
	'  under:', '    field: company', '    path: meetings', '    collection: companies', '',
].join('\n');
const COMPANIES_STORAGE = [
	'name: companies', 'storage:', '  path: data/companies', '  codec: md', '  shape: folder', '  suffix: company', '',
].join('\n');

function orphanWorkspace({ recording, meeting }) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-orphan-ws-'));
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	fs.mkdirSync(path.join(ws, 'bin'));
	fs.copyFileSync(SCRIPT, path.join(ws, 'bin', 'detect.mjs'));
	const compiled = path.join(ws, '.dreamteamer', 'collections');
	fs.mkdirSync(compiled, { recursive: true });
	fs.writeFileSync(path.join(compiled, 'meetings.collection.yaml'), MEETINGS_STORAGE);
	fs.writeFileSync(path.join(compiled, 'companies.collection.yaml'), COMPANIES_STORAGE);
	fs.mkdirSync(path.join(ws, 'data/companies/northwind'), { recursive: true });
	fs.writeFileSync(path.join(ws, 'data/companies/northwind/northwind.company.md'), '---\nname: Northwind\n---\n');
	if (meeting) {
		const mf = path.join(ws, 'data/companies/northwind/meetings', `${meeting.id}.meeting.md`);
		fs.mkdirSync(path.dirname(mf), { recursive: true });
		fs.writeFileSync(mf, meeting.text);
	}
	const rf = path.join(ws, 'data/meeting-recordings', `${recording.id}.meeting-recording.md`);
	fs.mkdirSync(path.dirname(rf), { recursive: true });
	fs.writeFileSync(rf, recording.text);
	const inbox = path.join(ws, 'inbox');
	fs.mkdirSync(path.join(inbox, 'meeting-recordings'), { recursive: true });
	return { ws, inbox, script: path.join(ws, 'bin', 'detect.mjs') };
}

// A silent 8-bit mono WAV at 100 Hz: ffprobe reads its duration from the header, and an hour is 360 KB.
function silentWav(seconds, rate = 100) {
	const n = seconds * rate;
	const b = Buffer.alloc(44 + n, 128);
	b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
	b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
	b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
	return b;
}
const hasFfprobe = (() => {
	try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

test('scan offers a STRONG orphan candidate when the meeting, stored under its company folder, names the file', () => {
	const { ws, inbox, script } = orphanWorkspace({
		meeting: {
			id: '2026/08/2026-08-20--northwind-weekly',
			text: "---\nname: Northwind weekly\ncompany: companies/northwind\n---\nrecording file unreachable, original path: inbox/Dana Oren aug20.m4a\n",
		},
		recording: {
			id: '2026/08/2026-08-20--northwind-weekly',
			text: "---\nname: Northwind weekly\norigin: audio\nmeeting: 'meetings/2026/08/2026-08-20--northwind-weekly'\ndate: '2026-08-20T14:00:00+03:00'\n---\n",
		},
	});
	fs.writeFileSync(path.join(inbox, 'meeting-recordings', 'Dana Oren aug20.m4a'), Buffer.from('not real audio, only bytes to hash'));
	try {
		const out = JSON.parse(execFileSync('node', [script, 'scan', '--inbox-folders', inbox],
			{ cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
		assert.equal(out.recordings_without_file, 1);
		const [c] = out.recordings[0].orphan_candidates;
		assert.equal(c?.strength, 'strong', `expected a strong candidate, got ${JSON.stringify(out.recordings[0].orphan_candidates)}`);
		assert.equal(c.recording, '2026/08/2026-08-20--northwind-weekly');
		assert.equal(c.meeting, 'meetings/2026/08/2026-08-20--northwind-weekly');
		assert.ok(c.evidence.includes('NAMES this exact filename'));
	} finally {
		fs.rmSync(ws, { recursive: true, force: true });
	}
});

test('scan offers a PLAUSIBLE orphan candidate for a same-day recording within 15 s, quoted date-time and h:mm:ss duration', { skip: !hasFfprobe && 'ffprobe not on PATH' }, () => {
	const { ws, inbox, script } = orphanWorkspace({
		recording: {
			id: '2026/08/2026-08-20--harbor-mutual-review',
			text: "---\nname: Harbor Mutual review\norigin: audio\ndate: '2026-08-20T14:00:00+03:00'\nduration: '1:00:05'\n---\n",
		},
	});
	fs.writeFileSync(path.join(inbox, 'meeting-recordings', '2026 08 20 1400 harbor mutual.wav'), silentWav(3600));
	try {
		const out = JSON.parse(execFileSync('node', [script, 'scan', '--inbox-folders', inbox],
			{ cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TZ: 'Etc/GMT-3' } }));
		const [r] = out.recordings;
		assert.equal(r.date, '2026-08-20');
		const [c] = r.orphan_candidates;
		assert.equal(c?.strength, 'plausible', `expected a plausible candidate, got ${JSON.stringify(r.orphan_candidates)}`);
		assert.equal(c.recording, '2026/08/2026-08-20--harbor-mutual-review');
		assert.ok(c.evidence.includes('same date'));
		assert.ok(c.evidence.some((e) => e.startsWith('duration within 15s')));
	} finally {
		fs.rmSync(ws, { recursive: true, force: true });
	}
});

test('scan skips a trash/ folder inside the inbox — a discarded recording is never offered again', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-trash-'));
	fs.mkdirSync(path.join(root, 'meeting-recordings/trash'), { recursive: true });
	fs.writeFileSync(path.join(root, 'meeting-recordings/trash/2026 08 20 1400 discarded.m4a'), Buffer.from('discarded bytes'));
	fs.writeFileSync(path.join(root, 'meeting-recordings/2026 08 21 0900 kept.m4a'), Buffer.from('kept bytes'));
	try {
		const out = JSON.parse(execFileSync('node', [SCRIPT, 'scan', '--inbox-folders', root], { encoding: 'utf8' }));
		assert.deepEqual(out.recordings.map((c) => path.basename(c.inbox_path)), ['2026 08 21 0900 kept.m4a']);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
