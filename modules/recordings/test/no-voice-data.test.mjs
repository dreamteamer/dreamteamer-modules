// Tier 3 of cr-modules-019 (design section 16, acceptance line 22): the repository stays clean. The module's
// tests name and enrol synthetic voices made at test time — so no recorded voice and no stored voice vector
// is ever in the tree:
//   · no file under modules/recordings is audio, except the setup clip `lib/clip.wav`, and no file the
//     repository tracks is audio, except that clip (whole-branch review, audio-guard-reaches-only-modules-recordings);
//   · no file the repository tracks holds an array of more than 64 numbers (a voice print or a window vector is
//     192 or 512 of them; a signature holds dozens): JSON and YAML parsed, a Markdown file's frontmatter parsed
//     (every record is one — whole-branch review, vector-guard-skips-markdown-frontmatter), and any text file
//     read for `[` and more than 64 numbers in a row;
//   · the leak gate (tests/leak-gate.test.mjs) passes.
// The first two are checks over the tree, so each is also run against a planted fixture, to show it sees
// what it looks for — a check that never fires proves nothing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(HERE, '..');
const ROOT = path.resolve(MODULE, '..', '..');
const CLIP = path.join('lib', 'clip.wav');
const CLIP_IN_REPO = 'modules/recordings/lib/clip.wav';
const MAX_NUMBERS = 64;

const AUDIO_EXT = /\.(wav|wave|mp3|m4a|m4b|aac|flac|ogg|oga|opus|aif|aiff|aifc|caf|wma|webm|amr|3gp|mka|mp4|mov|m4v|mkv)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__']);

/** Audio by its first bytes, whatever the file is called. */
function audioMagic(file) {
	let buf;
	try {
		const fd = fs.openSync(file, 'r');
		buf = Buffer.alloc(12);
		const n = fs.readSync(fd, buf, 0, 12, 0);
		fs.closeSync(fd);
		buf = buf.subarray(0, n);
	} catch {
		return null;
	}
	const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
	if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ['WAVE', 'RF64'].includes(ascii(8, 12))) return 'wav';
	if (ascii(0, 4) === 'RF64') return 'wav';
	if (buf.length >= 12 && ascii(0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(ascii(8, 12))) return 'aiff';
	if (ascii(0, 4) === 'fLaC') return 'flac';
	if (ascii(0, 4) === 'OggS') return 'ogg';
	if (ascii(0, 4) === 'caff') return 'caf';
	if (ascii(0, 3) === 'ID3') return 'mp3';
	if (ascii(0, 6) === '#!AMR\n') return 'amr';
	if (buf.length >= 8 && ascii(4, 8) === 'ftyp') return 'mp4/m4a';
	if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm/mka';
	if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return 'mp3/aac';
	return null;
}

function* walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(e.name)) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.isFile()) yield p;
	}
}

/** Every file under `dir` that is audio, by name or by its bytes, as `relative path (why)`. */
function audioFiles(dir, allowed = []) {
	const out = [];
	for (const f of walk(dir)) {
		const rel = path.relative(dir, f);
		if (allowed.includes(rel)) continue;
		const magic = audioMagic(f);
		if (AUDIO_EXT.test(f) || magic) out.push(`${rel} (${magic ?? 'audio by its name'})`);
	}
	return out.sort();
}

/** The largest count of numbers in one array anywhere inside `value`. */
function mostNumbers(value) {
	if (Array.isArray(value)) {
		const here = value.filter((v) => typeof v === 'number').length;
		return Math.max(here, ...value.map(mostNumbers));
	}
	if (value && typeof value === 'object') return Math.max(0, ...Object.values(value).map(mostNumbers));
	return 0;
}

// A file that does not parse is read as text: `[` then more than 64 comma-separated numbers.
const NUMBER_RUN = new RegExp(`\\[\\s*(?:-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?\\s*,\\s*){${MAX_NUMBERS}}-?(?:\\d|\\.\\d)`);

/** A Markdown file's YAML frontmatter, or null when it has none. */
const frontmatter = (text) => /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? null;

/** Every file among `files` (paths relative to `dir`) holding an array of more than 64 numbers, as
 *  `relative path (why)`: JSON and YAML parsed (read as text when they do not parse), a Markdown file's
 *  frontmatter parsed and the whole file read as text, every other text file read as text. A file with a NUL
 *  byte in its first 8 KB is binary and not read. */
function numericArrays(dir, files) {
	const out = [];
	for (const rel of files) {
		const file = path.join(dir, rel);
		if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;     // tracked, deleted in the working tree (or a link to a folder)
		const bytes = fs.readFileSync(file);
		if (bytes.subarray(0, 8192).includes(0)) continue;
		const text = bytes.toString('utf8');
		if (/\.md$/i.test(rel)) {
			const fm = frontmatter(text);
			let n = 0;
			if (fm !== null) {
				try { n = Math.max(0, ...yaml.loadAll(fm).map(mostNumbers)); }
				catch { /* an unparseable frontmatter is still read as text, below */ }
			}
			if (n > MAX_NUMBERS) out.push(`${rel} (${n} numbers in its frontmatter)`);
			else if (NUMBER_RUN.test(text)) out.push(`${rel} (more than ${MAX_NUMBERS} numbers in a row)`);
			continue;
		}
		if (!/\.(json|ya?ml)$/i.test(rel)) {
			if (NUMBER_RUN.test(text)) out.push(`${rel} (more than ${MAX_NUMBERS} numbers in a row)`);
			continue;
		}
		let n;
		try {
			n = /\.json$/i.test(rel)
				? mostNumbers(JSON.parse(text))
				: Math.max(0, ...yaml.loadAll(text).map(mostNumbers));
		} catch {
			if (NUMBER_RUN.test(text)) out.push(`${rel} (unparseable, more than ${MAX_NUMBERS} numbers in a row)`);
			continue;
		}
		if (n > MAX_NUMBERS) out.push(`${rel} (${n} numbers)`);
	}
	return out.sort();
}

function tracked(dir) {
	const r = spawnSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
	assert.equal(r.status, 0, `git ls-files failed in ${dir}: ${r.stderr}`);
	return r.stdout.split('\0').filter(Boolean);
}

/** Every file the repository at `dir` tracks that is audio, by name or by its bytes, except the `allowed`
 *  paths (repository-relative, `/`-separated), as `path (why)`. */
function trackedAudio(dir, allowed = []) {
	const out = [];
	for (const rel of tracked(dir)) {
		if (allowed.includes(rel)) continue;
		const magic = audioMagic(path.join(dir, rel));
		if (AUDIO_EXT.test(rel) || magic) out.push(`${rel} (${magic ?? 'audio by its name'})`);
	}
	return out.sort();
}

describe('line 22 — no recorded voice and no stored voice vector in the repository', () => {
	test('line 22 no file under modules/recordings is audio except lib/clip.wav', () => {
		assert.ok(fs.existsSync(path.join(MODULE, CLIP)), 'the setup clip is where the allowance says');
		assert.equal(audioMagic(path.join(MODULE, CLIP)), 'wav', 'the allowance is for the WAV setup clip');
		// on disk (anything a developer left behind) and tracked (what a commit would carry) alike
		const onDisk = audioFiles(MODULE, [CLIP]);
		const inGit = tracked(MODULE).filter((rel) => rel !== CLIP.split(path.sep).join('/'))
			.filter((rel) => AUDIO_EXT.test(rel) || audioMagic(path.join(MODULE, rel)));
		assert.deepEqual(onDisk, []);
		assert.deepEqual(inGit, []);
	});

	test('line 22 no file the repository tracks is audio except modules/recordings/lib/clip.wav', () => {
		assert.ok(tracked(ROOT).includes(CLIP_IN_REPO), 'the allowance names a tracked file');
		assert.deepEqual(trackedAudio(ROOT, [CLIP_IN_REPO]), []);
	});

	test('line 22 no tracked file holds an array of more than 64 numbers — JSON, YAML, Markdown frontmatter, or a run in any text file', () => {
		const files = tracked(ROOT);
		assert.ok(files.filter((f) => /\.(json|ya?ml)$/i.test(f)).length > 50, 'the scan is not vacuous');
		assert.ok(files.filter((f) => /\.md$/i.test(f)).length > 50, 'the Markdown scan is not vacuous');
		assert.deepEqual(numericArrays(ROOT, files), []);
	});

	test('line 22 the leak gate passes', () => {
		const gate = path.join(ROOT, 'tests', 'leak-gate.test.mjs');
		// NODE_TEST_CONTEXT, inherited from a `node --test` parent, would make the child report to its parent
		// instead of printing: the gate runs as a run of its own
		const env = { ...process.env };
		delete env.NODE_TEST_CONTEXT;
		const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', gate], { cwd: ROOT, encoding: 'utf8', env });
		assert.equal(r.status, 0, `${r.stdout.slice(-3000)}\n${r.stderr.slice(-1000)}`);
		assert.match(r.stdout, /# fail 0/);
		assert.match(r.stdout, /# pass [1-9]/);
	});
});

describe('the checks see what they look for (planted fixtures in a temp folder)', () => {
	const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'no-voice-data-'));

	test('a WAV, an audio file under a text name, and audio by its name are each found; the allowed clip is not', () => {
		const dir = tmp();
		try {
			fs.mkdirSync(path.join(dir, 'lib'));
			fs.mkdirSync(path.join(dir, 'test', 'fixtures'), { recursive: true });
			const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(16)]);
			fs.writeFileSync(path.join(dir, 'lib', 'clip.wav'), wav);
			fs.writeFileSync(path.join(dir, 'test', 'fixtures', 'call.wav'), wav);
			fs.writeFileSync(path.join(dir, 'test', 'fixtures', 'notes.txt'), Buffer.concat([Buffer.from('ID3'), Buffer.alloc(9)]));
			fs.writeFileSync(path.join(dir, 'test', 'fixtures', 'memo.m4a'), 'not really audio');
			fs.writeFileSync(path.join(dir, 'test', 'fixtures', 'readme.md'), '# a text file\n');
			assert.deepEqual(audioFiles(dir, [CLIP]), [
				path.join('test', 'fixtures', 'call.wav') + ' (wav)',
				path.join('test', 'fixtures', 'memo.m4a') + ' (audio by its name)',
				path.join('test', 'fixtures', 'notes.txt') + ' (mp3)',
			]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	// Whole-branch review, `audio-guard-reaches-only-modules-recordings`: the tracked-file audio check reaches the
	// whole repository, and the setup clip is the one allowance.
	test('a tracked audio file anywhere in a repository is found, by name or by bytes; only modules/recordings/lib/clip.wav is allowed', () => {
		const dir = tmp();
		try {
			const put = (rel, bytes) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), bytes); };
			const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(16)]);
			put('modules/recordings/lib/clip.wav', wav);
			put('modules/meeting-docs/test/fixtures/call.m4a', 'not really audio');
			put('tests/memo.txt', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(9)]));
			put('docs/clip.wav', wav);
			put('README.md', '# a text file\n');
			put('untracked.wav', wav);
			spawnSync('git', ['init', '-q'], { cwd: dir });
			spawnSync('git', ['add', '--', 'modules', 'tests', 'docs', 'README.md'], { cwd: dir });
			assert.deepEqual(trackedAudio(dir, [CLIP_IN_REPO]), [
				'docs/clip.wav (wav)',
				'modules/meeting-docs/test/fixtures/call.m4a (audio by its name)',
				'tests/memo.txt (mp3)',
			]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('an array of 65 numbers is found in JSON, YAML and unparseable JSON; 64 numbers and long string arrays are not', () => {
		const dir = tmp();
		try {
			const v = (n) => Array.from({ length: n }, (_, i) => Math.round(Math.sin(i + 1) * 1e4) / 1e4);
			const files = {
				'sig.json': JSON.stringify({ labels: { speaker_0: { windows: [{ vector: v(65) }] } } }),
				'print.yaml': yaml.dump({ known_as: [{ person: 'users/dana-oren' }], vector: v(65) }),
				'broken.json': `{ "vector": ${JSON.stringify(v(65))}, }`,
				'edge.json': JSON.stringify({ vector: v(64) }),
				'names.yml': yaml.dump({ ids: Array.from({ length: 200 }, (_, i) => `id-${i}`) }),
				// whole-branch review, `vector-guard-skips-markdown-frontmatter`: Markdown and every other text file are read too
				'readme.md': JSON.stringify(v(300)),
				'x.meeting-recording.md': `---\n${yaml.dump({ name: 'Northwind weekly', transcription: { signature: v(65) } })}---\n\n## Transcript\n`,
				'edge.meeting-recording.md': `---\n${yaml.dump({ name: 'Harbor review', vector: v(64) })}---\n`,
				'fixture.py': `VECTOR = [\n    ${v(65).join(',\n    ')},\n]\n`,
				'small.py': `VECTOR = ${JSON.stringify(v(12))}\n`,
				'blob.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(JSON.stringify(v(300)))]),
			};
			for (const [n, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), text);
			assert.deepEqual(numericArrays(dir, Object.keys(files)), [
				'broken.json (unparseable, more than 64 numbers in a row)',
				'fixture.py (more than 64 numbers in a row)',
				'print.yaml (65 numbers)',
				'readme.md (more than 64 numbers in a row)',
				'sig.json (65 numbers)',
				'x.meeting-recording.md (65 numbers in its frontmatter)',
			]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
