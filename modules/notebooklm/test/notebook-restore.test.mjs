// THE RESTORE AND CAPTURE VERBS — a `notebooks` record is the spec a notebook can be rebuilt from on
// any Google account: its ordered sources and the one `configure` call. Everything a fixture can pin
// is pinned here: the plan a record produces, what the verb refuses, how a live source list maps onto
// record sources, and that the frontmatter round-trips. The live calls are smoked against a throwaway
// notebook and quoted in the commit.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { restorePlan, captureSources, sourceFromLive, readRecord, writeRecord, PERSONA_MAX } from '../bin/notebook.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
// `dt-notebook` — the module's own command since the pack's dispatcher was split by owner; the
// wrapper below takes the old leading `notebook` word so every call site reads as it did
const CLI = path.join(ROOT, 'modules', 'notebooklm', 'bin', 'notebook.mjs');
const SETUP = path.join(ROOT, 'modules', 'setup', 'bin', 'setup.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const argvOf = (plan, purpose) => plan.steps.filter((s) => s.purpose === purpose).map((s) => s.argv);
const record = (extra = {}) => ({ name: 'Harbor Mutual — reference desk', status: 'active', ...extra });

describe('restorePlan — the ordered CLI calls a record becomes', () => {
	test('a url source: create, add as url, wait, rename to its title', () => {
		const plan = restorePlan(record({ sources: [{ kind: 'url', ref: 'https://example.com/a', title: 'Example A' }] }), {});
		assert.deepEqual(plan.refusals, []);
		assert.deepEqual(plan.steps.map((s) => s.purpose), ['create', 'add', 'wait', 'rename']);
		assert.deepEqual(argvOf(plan, 'create')[0], ['create', 'Harbor Mutual — reference desk', '--json']);
		assert.deepEqual(argvOf(plan, 'add')[0], ['source', 'add', '-n', '<NOTEBOOK>', 'https://example.com/a', '--type', 'url', '--json']);
		assert.deepEqual(argvOf(plan, 'rename')[0], ['source', 'rename', '-n', '<NOTEBOOK>', '<SOURCE>', 'Example A', '--json']);
	});

	test('--title overrides the notebook title; a source without a title is not renamed', () => {
		const plan = restorePlan(record({ sources: [{ kind: 'youtube', ref: 'https://youtu.be/x' }] }), { title: 'Copy for Dana' });
		assert.deepEqual(argvOf(plan, 'create')[0], ['create', 'Copy for Dana', '--json']);
		assert.equal(argvOf(plan, 'add')[0][6], 'youtube');
		assert.deepEqual(argvOf(plan, 'rename'), []);
	});

	test('a text source sends its inline text; one without text is refused, by index', () => {
		const ok = restorePlan(record({ sources: [{ kind: 'text', text: 'hello', title: 'Note' }] }), {});
		assert.deepEqual(argvOf(ok, 'add')[0], ['source', 'add', '-n', '<NOTEBOOK>', 'hello', '--type', 'text', '--title', 'Note', '--json']);
		const bad = restorePlan(record({ sources: [{ kind: 'text', title: 'Empty' }] }), {});
		assert.match(bad.refusals[0], /sources\[0\].*text/);
	});

	// ⚠ A file source is a `${env:VAR}/…` template — a record never carries a machine path. The plan
	// renders it from the environment it runs in and refuses, naming the var, when it is unset.
	test('a file source renders ${env:…} from the environment, and refuses an unset var by name', () => {
		const env = { FILES_FOLDER: '/vol/files' };
		const src = { kind: 'file', ref: '${env:FILES_FOLDER}/corpus/a.pdf', title: 'A' };
		const ok = restorePlan(record({ sources: [src] }), { env, exists: () => true });
		assert.deepEqual(argvOf(ok, 'add')[0], ['source', 'add', '-n', '<NOTEBOOK>', '/vol/files/corpus/a.pdf', '--type', 'file', '--title', 'A', '--json']);
		const unset = restorePlan(record({ sources: [src] }), { env: {}, exists: () => true });
		assert.match(unset.refusals[0], /FILES_FOLDER/);
		const missing = restorePlan(record({ sources: [src] }), { env, exists: () => false });
		assert.match(missing.refusals[0], /does not exist/);
	});

	test('a drive source uses add-drive with its mime type', () => {
		const plan = restorePlan(record({ sources: [{ kind: 'drive', ref: '1AbC', mime: 'google-slides' }] }), {});
		assert.deepEqual(argvOf(plan, 'add')[0], ['source', 'add-drive', '-n', '<NOTEBOOK>', '1AbC', '--mime-type', 'google-slides', '--json']);
	});

	// An `export` source is `dt notebooklm` (@dreamteamer/notebooklm), pointed at the NEW notebook — the
	// module never re-implements the export.
	test('an export source re-runs dt notebooklm against the new notebook, with the record\'s args', () => {
		const plan = restorePlan(record({ sources: [{ kind: 'export', ref: '--collections tasks,meetings --plan plus' }] }), {});
		const step = plan.steps.find((s) => s.purpose === 'export');
		assert.deepEqual(step.argv, ['npx', 'dreamteamer', 'notebooklm', '--notebook', '<NOTEBOOK>', '--collections', 'tasks,meetings', '--plan', 'plus']);
		assert.deepEqual(argvOf(plan, 'wait'), [], 'the export waits for its own sources');
	});

	test('an unknown kind is refused, by index and name', () => {
		const plan = restorePlan(record({ sources: [{ kind: 'carrier-pigeon', ref: 'x' }] }), {});
		assert.match(plan.refusals[0], /sources\[0\].*carrier-pigeon/);
	});

	// ⚠ ONE configure call carrying every setting, and NEVER --mode beside --persona: the CLI drops
	// the persona silently at exit 0 when both are sent (measured 2026-09-08).
	test('chat becomes ONE configure call; persona and mode never travel together', () => {
		const persona = restorePlan(record({ chat: { persona: 'Be terse.', response_length: 'longer' } }), {});
		assert.deepEqual(argvOf(persona, 'configure'), [['configure', '-n', '<NOTEBOOK>', '--persona', 'Be terse.', '--response-length', 'longer', '--json']]);
		const mode = restorePlan(record({ chat: { mode: 'concise' } }), {});
		assert.deepEqual(argvOf(mode, 'configure'), [['configure', '-n', '<NOTEBOOK>', '--mode', 'concise', '--response-length', 'default', '--json']]);
		const both = restorePlan(record({ chat: { persona: 'x', mode: 'concise' } }), {});
		assert.match(both.refusals[0], /mode.*persona|persona.*mode/);
		assert.deepEqual(argvOf(restorePlan(record(), {}), 'configure'), [], 'no chat, no configure');
	});

	test('a persona over the cap is refused with the count', () => {
		const plan = restorePlan(record({ chat: { persona: 'x'.repeat(PERSONA_MAX + 1) } }), {});
		assert.match(plan.refusals[0], new RegExp(`${PERSONA_MAX + 1}.*${PERSONA_MAX}`));
	});

	// `persona_file` is the workspace persona — NOTEBOOKLM.md is cut the way the persona verb cuts it,
	// any other file is taken whole.
	test('persona_file NOTEBOOKLM.md is cut to its custom-instructions; another file is taken whole', () => {
		const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-nbr-')); made.push(ws);
		fs.writeFileSync(path.join(ws, 'NOTEBOOKLM.md'), '# x\n<!-- dreamteamer:begin -->\n## custom instructions\nAnswer from sources.\n## limits\nnone\n<!-- dreamteamer:end -->\n');
		fs.writeFileSync(path.join(ws, 'persona.md'), '  Be a tutor.\n');
		const a = restorePlan(record({ chat: { persona_file: 'NOTEBOOKLM.md' } }), { root: ws });
		assert.equal(argvOf(a, 'configure')[0][4], 'Answer from sources.');
		const b = restorePlan(record({ chat: { persona_file: 'persona.md' } }), { root: ws });
		assert.equal(argvOf(b, 'configure')[0][4], 'Be a tutor.');
		const c = restorePlan(record({ chat: { persona_file: 'missing.md' } }), { root: ws });
		assert.match(c.refusals[0], /missing\.md/);
	});
});

describe('captureSources — a live source list becomes record sources', () => {
	const live = { sources: [
		{ id: 'a1', title: 'Example', type: 'SourceType.WEB_PAGE', url: 'https://example.com' },
		{ id: 'b2', title: 'Talk', type: 'youtube_video', url: 'https://youtu.be/t' },
		{ id: 'c3', title: 'deck.pdf', type: 'SourceType.PDF' },
		{ id: 'd4', title: 'Pasted', type: 'pasted_text' },
		{ id: 'e5', title: 'Plan', type: 'google_docs' },
	] };
	test('kinds map from the vendor enum, and the id every later call needs is kept', () => {
		const { sources } = captureSources(live);
		assert.deepEqual(sources.map((s) => [s.kind, s.source_id]), [['url', 'a1'], ['youtube', 'b2'], ['file', 'c3'], ['text', 'd4'], ['drive', 'e5']]);
		assert.equal(sources[0].ref, 'https://example.com');
		assert.equal(sources[0].title, 'Example');
	});
	// The list does not carry a file's bytes, a pasted text's content or a Drive document's id — those
	// are yours to fill, and the verb SAYS which rather than writing a restorable-looking record.
	test('what the list cannot recover is named as unresolved, never silently blank', () => {
		const { sources, unresolved } = captureSources(live);
		assert.deepEqual(unresolved.map((u) => u.title), ['deck.pdf', 'Pasted', 'Plan']);
		assert.equal(sources[2].ref, '');
		assert.match(unresolved[0].needs, /\$\{env:/);
	});
	test('an existing record source with the same live id keeps its ref and text', () => {
		const { sources } = captureSources(live, [{ kind: 'file', ref: '${env:FILES_FOLDER}/deck.pdf', source_id: 'c3', title: 'deck.pdf' }]);
		assert.equal(sources[2].ref, '${env:FILES_FOLDER}/deck.pdf');
	});
	// 21 of the sources across nine live notebooks were PDFs the web UI fetched from a URL, titled by
	// that URL and typed `pdf` — the list carries no bytes, but it carries the restore key.
	test('an upload whose title is a URL becomes a url source — restorable, with no rename', () => {
		const one = sourceFromLive({ id: 'p1', title: 'https://example.org/paper.pdf', type: 'SourceType.PDF' });
		assert.deepEqual(one.source, { kind: 'url', ref: 'https://example.org/paper.pdf', title: '', source_id: 'p1' });
		assert.equal(one.needs, null);
	});
	test('a `dt · <collection>` source is named as the export verb\'s, not as a file to find', () => {
		const one = sourceFromLive({ id: 'x1', title: 'dt · meetings', type: 'markdown' });
		assert.match(one.needs, /kind: export/);
	});
	test('an unknown live type is kept as file with the type named, not dropped', () => {
		const one = sourceFromLive({ id: 'z', title: 'odd', type: 'SourceType.SOMETHING_NEW' });
		assert.equal(one.source.kind, 'file');
		assert.match(one.needs ?? '', /something_new/);
	});
});

describe('the record file round-trips', () => {
	test('frontmatter is rewritten and the body is untouched', () => {
		const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-nbr-')); made.push(ws);
		const f = path.join(ws, 'x.notebook.md');
		fs.writeFileSync(f, '---\nname: X\nstatus: active\n---\nThe body.\n\nTwo paragraphs — kept.\n');
		const r = readRecord(f);
		assert.equal(r.fields.name, 'X');
		r.fields.notebook_id = 'uuid-1';
		writeRecord(f, r);
		const back = readRecord(f);
		assert.equal(back.fields.notebook_id, 'uuid-1');
		assert.equal(back.body, 'The body.\n\nTwo paragraphs — kept.\n');
	});
});

describe('npx dt-notebook restore / capture', () => {
	function consumer(frontmatter) {
		const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-nbr-')); made.push(ws);
		fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'consumer', private: true, dreamteamer: {} }));
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		fs.mkdirSync(path.join(ws, 'data', 'notebooks'), { recursive: true });
		if (frontmatter) fs.writeFileSync(path.join(ws, 'data', 'notebooks', 'desk.notebook.md'), `---\n${frontmatter}\n---\nbody\n`);
		return ws;
	}
	// `notebooklm` is deliberately NOT on PATH here — a dry run that reached for it would be a bug.
	const cli = (ws, ...args) => spawnSync(process.execPath, args[0] === 'notebook' ? [CLI, ...args.slice(1)] : [SETUP, ...args], { cwd: ws, encoding: 'utf8', env: { PATH: path.dirname(process.execPath), NO_COLOR: '1', HOME: os.homedir() } });

	test('--dry-run prints the plan, one line per call, and touches no network', () => {
		const ws = consumer('name: Desk\nsources:\n  - kind: url\n    ref: https://example.com\n    title: Ex\nchat:\n  persona: Be terse.\n');
		const r = cli(ws, 'notebook', 'restore', 'desk', '--dry-run');
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /create Desk --json/);
		assert.match(r.stdout, /source add .*https:\/\/example\.com/);
		assert.match(r.stdout, /configure .*--persona/);
	});
	test('a record with a live notebook_id is refused without --account or --replace', () => {
		const ws = consumer('name: Desk\nnotebook_id: live-1\nsources: []\n');
		const r = cli(ws, 'notebook', 'restore', 'desk', '--dry-run');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /live-1/);
		assert.match(r.stderr, /--account|--replace/);
		assert.equal(cli(ws, 'notebook', 'restore', 'desk', '--dry-run', '--replace').status, 0);
	});
	test('a refusal in the plan is printed and exits 1', () => {
		const ws = consumer('name: Desk\nsources:\n  - kind: text\n    title: Empty\n');
		const r = cli(ws, 'notebook', 'restore', 'desk', '--dry-run');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /sources\[0\]/);
	});
	test('an unknown record exits 1 naming the file it looked for', () => {
		const r = cli(consumer(), 'notebook', 'restore', 'nope', '--dry-run');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /nope\.notebook\.md/);
	});
	test('capture refuses a record with no notebook_id — there is nothing live to read', () => {
		const ws = consumer('name: Desk\n');
		const r = cli(ws, 'notebook', 'capture', 'desk');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /notebook_id/);
	});
	test('usage names all three sub-verbs', () => {
		const r = cli(consumer(), 'notebook', 'bogus');
		assert.equal(r.status, 2);
		for (const v of ['persona', 'restore', 'capture']) assert.match(r.stderr, new RegExp(v));
	});
});
