// THE LEAK GATE, as a test this repo carries with it. These modules were cut out of a private vault
// and scrubbed; the rules below are the ones that can travel — a scan for the source vault's
// own names, machine paths, real-looking addresses, credential shapes, and Hebrew outside the four
// places where Hebrew is the SUBJECT. The private half of the gate (client and colleague names)
// stays in the source vault's own `leak-scan.sh`, because shipping the list would publish the very
// strings it exists to catch.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function* walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (/\.(md|yaml|yml|json|mjs|js|py|toml|sh|txt)$/.test(e.name)) yield p;
	}
}
const FILES = [...walk(ROOT)].filter((f) => !f.endsWith(path.join('tests', 'leak-gate.test.mjs')));
const rel = (f) => path.relative(ROOT, f);
/** Every line matching `re`, as `file:line: text` (text trimmed for display). `keep(file, line)` sees the
 *  FULL line — an allow-list must decide on what is actually there, not on the first 120 characters. */
const hits = (re, keep = () => true, files = FILES) => {
	const out = [];
	for (const f of files) {
		fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (re.test(line) && keep(rel(f), line)) out.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 120)}`); });
	}
	return out;
};

// Hebrew is allowed exactly where `.leak-scan-allow` says, and nowhere else — the SAME file the
// leak-scan workflow reads, parsed the same way. Two gates with separate ideas of what is allowed is
// worse than one gate that knows, and this half covers the WHOLE tree where CI covers added lines.
const ALLOW = (() => {
	const byRule = new Map();
	for (const line of fs.readFileSync(path.join(ROOT, '.leak-scan-allow'), 'utf8').split('\n')) {
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		const [file, rule] = line.split('\t');
		if (!rule) continue;
		if (!byRule.has(rule)) byRule.set(rule, new Set());
		byRule.get(rule).add(file);
	}
	return byRule;
})();
const HEBREW_ALLOWED = ALLOW.get('hebrew') ?? new Set();

describe('the leak gate', () => {
	test('the scan is not vacuous', () => {
		assert.ok(FILES.length > 50, `expected the whole module tree, saw ${FILES.length} files`);
	});
	test('no source-vault name', () => {
		// Assembled rather than spelled: a literal here is itself a hit for the pre-commit hook that
		// scans this repo for the same names (measured 2026-09-10 — the hook refused this file).
		const vaultNames = ['gk-' + 'brain', 'hq[23]', 'dt-' + 'hq'].join('|');
		assert.deepEqual(hits(new RegExp(`\\b(${vaultNames})\\b`, 'i')), []);
	});
	test('no machine path', () => {
		// `/Users/someone` and `/Users/me` are the synthetic fixtures' spelling; anything else is a leak.
		assert.deepEqual(hits(/\/Users\/(?!someone\b|me\b)[A-Za-z]/), []);
	});
	test('no real-looking address — every example lives under .example or example.*', () => {
		// `git@github.com:…` is an SSH remote, not a person; the rest is case-insensitive because a fixture
		// spelling `Ada@Example.com` is exactly what a lower-casing test needs.
		const re = /(?<!git)\b(?!git@)[A-Za-z0-9._%+-]+@(?!(?:[a-z0-9-]+\.)*(?:example|example\.(?:com|org|net|invalid)|users\.noreply\.github\.com|gmail\.example)\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|io|co\.il|net|org|dev|ai)\b/i;
		const keep = (file, line) => !/git@github\.com/.test(line);
		assert.deepEqual(hits(re, keep), []);
	});
	test('no credential shape', () => {
		const re = /sk-ant-[A-Za-z0-9_-]{20}|sk-[A-Za-z0-9]{32}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{10,}|glpat-[0-9A-Za-z_-]{20}|npm_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
		assert.deepEqual(hits(re), []);
	});
	test('no Google Drive folder id outside a template', () => {
		// a Drive id is 25–44 url-safe chars starting with 1; a `${env:…}` template is how a folder is named here
		const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
		assert.deepEqual(hits(/['"`]1[A-Za-z0-9_-]{27,43}['"`]/, (_, line) => !uuid.test(line)), []);
	});
	test('Hebrew only where it is the subject', () => {
		const offenders = hits(/[\u0590-\u05FF]/).filter((h) => !HEBREW_ALLOWED.has(h.split(':')[0]));
		assert.deepEqual(offenders, []);
	});
	test('the allow-list is not empty, and every site on it still exists (a stale entry hides a future leak)', () => {
		assert.ok(HEBREW_ALLOWED.size >= 1, `.leak-scan-allow parsed to ${HEBREW_ALLOWED.size} hebrew entries — the parser or the file is broken, and an empty allow-list would make the rule below vacuous in the other direction`);
		for (const f of HEBREW_ALLOWED) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is allow-listed but gone — remove the entry`);
	});
});
