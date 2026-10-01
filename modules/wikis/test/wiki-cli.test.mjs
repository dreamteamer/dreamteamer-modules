// THE `wiki` VERBS, ON REAL DISK, WITH NO NETWORK — which is the claim being tested: a notebook on
// top of a folder has no prerequisite. Every case here runs the shipped CLI end to end in a temp
// workspace, and not one of them logs in, installs anything or opens a socket.
//
// ⚠ The pair that matters is the last two in "a corpus that is not finished": `incomplete` EXITS 1
// while a source is short, and exits 0 once it is filled. That is the behaviour the whole module was
// designed for, and a green suite that never asserted the exit code would report success on a corpus
// with holes in it.
//
// `pull` runs here against a fake `notebooklm` on a private PATH; its planning rules are pinned as
// `pullPlan` in wiki-model.test.mjs.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseSource, searchBody } from '../lib/wiki.mjs';
import { virginWorkspace, installCopied as installModules, closure, run as engine } from '../../../tests/helpers/workspace.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
// `dt-wiki` — the module's own command since the pack's dispatcher was split by owner
const CLI = path.join(ROOT, 'modules', 'wikis', 'bin', 'wiki.mjs');
const SETUP = path.join(ROOT, 'modules', 'setup', 'bin', 'setup.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/** A workspace the resolver will find, with FILES_FOLDER set in `.env` and nowhere else. */
function workspace({ env = 'FILES_FOLDER=@FILES@\n' } = {}) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-wiki-')); made.push(ws);
	fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'consumer', private: true, dreamteamer: { vars: ['FILES_FOLDER'] } }, null, '\t'));
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	const files = path.join(ws, 'files');
	if (env) fs.writeFileSync(path.join(ws, '.env'), env.replace('@FILES@', files));
	return { ws, files };
}

/** ⚠ FILES_FOLDER is BLANKED in the spawned environment on purpose: an exported one would override
 *  the fixture's `.env` and the test would measure the developer's machine instead of the fixture. */
const run = (ws, ...args) => spawnSync(process.execPath, [CLI, ...args], {
	cwd: ws, encoding: 'utf8', env: { ...process.env, FILES_FOLDER: '', NO_COLOR: '1' },
});

describe('a corpus that is not finished', () => {
	const { ws, files } = workspace();
	// ⚠ IN THE REPO since 2026-09-11 — `wikis/<id>` at the workspace root, not the synced drive, and
	// NOT under `data/`: every path there belongs to a collection's storage, and check warns on every
	// file in one that is not a record. A wiki is markdown
	// a coding agent greps and cites by `file:line`; outside the clone a bare checkout did not have the
	// corpus, which made the local adapter's one claim — zero prerequisite — false.
	const dir = path.join(ws, 'wikis', 'field-notes');

	test('init writes the folder, its manifest and its record', () => {
		const r = run(ws, 'init', 'field-notes', '--title', 'Field Notes');
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.ok(fs.existsSync(path.join(dir, 'index.md')), 'no index — a folder found without its record must be able to say what it is');
		assert.ok(!fs.existsSync(path.join(dir, 'wiki.yaml')), 'a corpus is markdown only; the YAML manifest is gone');
		// The index carries the manifest's keys, in FRONTMATTER — same facts, readable in any editor.
		const idx = fs.readFileSync(path.join(dir, 'index.md'), 'utf8');
		assert.match(idx, /^---\n/, 'the index opens with frontmatter');
		assert.match(idx, /^id: field-notes$/m);
		assert.match(idx, /^adapter: local$/m);
		assert.ok(fs.existsSync(path.join(dir, 'sources')));
		const rec = fs.readFileSync(path.join(ws, 'data', 'wikis', 'field-notes.wiki.md'), 'utf8');
		assert.match(rec, /^name: Field Notes$/m);
		// ⚠ the record carries a WORKSPACE-RELATIVE path — no variable to set, no template to render,
		// and still no machine path. A stronger portability claim than the template it replaced, not a
		// weaker one: this record works on a clone that has never had a `.env`.
		assert.match(rec, /^folder: '?wikis\/field-notes'?$/m);
		assert.ok(!rec.includes(files), 'a machine path reached the record');
		assert.ok(!rec.includes('${env:'), 'the in-repo default needs no variable at all');
	});

	test('a text source lands complete, with its bytes on the file', () => {
		const r = run(ws, 'add', 'field-notes', '# Vesting\n\n' + 'a note about vesting. '.repeat(40), '--kind', 'text', '--title', 'On Vesting');
		assert.equal(r.status, 0, r.stderr + r.stdout);
		const f = path.join(dir, 'sources', '001--on-vesting.md');
		const { fields, body } = parseSource(fs.readFileSync(f, 'utf8'));
		assert.equal(fields.completeness, 'complete');
		assert.ok(fields.bytes > 256);
		assert.match(body, /^# Vesting/);
	});

	test('a URL lands as a PENDING STUB, and the output says this package fetches nothing', () => {
		const r = run(ws, 'add', 'field-notes', 'https://northwind.example/roadmap', '--title', 'Roadmap');
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /pending/);
		assert.match(r.stdout, /fetches no URL/);
		const { fields, body } = parseSource(fs.readFileSync(path.join(dir, 'sources', '002--roadmap.md'), 'utf8'));
		assert.equal(fields.completeness, 'pending');
		assert.equal(fields.kind, 'url');
		assert.equal(fields.ref, 'https://northwind.example/roadmap');
		assert.equal(body, '', 'a stub has no body — that is what makes it visible');
	});

	test('status counts by state and says how many still need scraping', () => {
		const r = run(ws, 'status', 'field-notes', '--json');
		assert.equal(r.status, 0, r.stderr);
		const s = JSON.parse(r.stdout);
		assert.equal(s.total, 2);
		assert.equal(s.complete, 1);
		assert.equal(s.incomplete, 1);
		assert.equal(s.by.pending, 1);
	});

	test('incomplete EXITS 1 while a source is short, and names it with its ref', () => {
		const r = run(ws, 'incomplete', 'field-notes');
		assert.equal(r.status, 1, 'a query that gates a pipeline must exit non-zero, or it gates nothing');
		assert.match(r.stdout, /002--roadmap\.md/);
		assert.match(r.stdout, /https:\/\/northwind\.example\/roadmap/);
		assert.match(r.stdout, /1 of 2 source\(s\) still need scraping/);
	});

	test('filling the stub by hand leaves the MARKER stale, and verify catches it rather than trusting it', () => {
		const f = path.join(dir, 'sources', '002--roadmap.md');
		const { fields } = parseSource(fs.readFileSync(f, 'utf8'));
		fs.appendFileSync(f, '# Roadmap\n\n' + 'fetched by an agent with a fetch tool. '.repeat(20));
		assert.equal(fields.completeness, 'pending');

		const dry = run(ws, 'verify', 'field-notes');
		assert.equal(dry.status, 1, 'drift that is not reported is drift that is trusted');
		assert.match(dry.stdout, /pending → complete/);

		const fixed = run(ws, 'verify', 'field-notes', '--fix');
		assert.equal(fixed.status, 0, fixed.stderr + fixed.stdout);
		assert.equal(parseSource(fs.readFileSync(f, 'utf8')).fields.completeness, 'complete');
	});

	test('and NOW incomplete exits 0 — the pair this whole module exists for', () => {
		const r = run(ws, 'incomplete', 'field-notes');
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /every source in 2 is complete/);
	});

	test('verify restamps the rollup on the record, so the cache agrees with the folder again', () => {
		const rec = fs.readFileSync(path.join(ws, 'data', 'wikis', 'field-notes.wiki.md'), 'utf8');
		assert.match(rec, /^sources_total: 2$/m);
		assert.match(rec, /^sources_complete: 2$/m);
		assert.match(rec, /^sources_incomplete: 0$/m);
	});

	// ⚠ THIS ASSERTED `:1` AND WAS GREEN WHILE THE FEATURE WAS BROKEN. Body-relative numbering makes
	// the first body line 1 in every file, so the constant matched and the citation opened the wrong
	// line. It now opens the file and checks that the cited line IS the matching line — the only form
	// of this assertion that cannot pass on a bug.
	test('search cites <file>:<line>, and that line really is the match', () => {
		const r = run(ws, 'search', 'field-notes', 'vesting');
		assert.equal(r.status, 0, r.stderr);
		const m = /sources\/(\S+\.md):(\d+)/.exec(r.stdout);
		assert.ok(m, `no <file>:<line> citation in:\n${r.stdout}`);
		const wikiDir = path.join(ws, 'wikis', 'field-notes');
		const lines = fs.readFileSync(path.join(wikiDir, 'sources', m[1]), 'utf8').split('\n');
		assert.match(lines[Number(m[2]) - 1], /vesting/i, `line ${m[2]} of ${m[1]} is not the hit`);
	});

	test('search that finds nothing exits 1, the way grep does', () => {
		assert.equal(run(ws, 'search', 'field-notes', 'nothing-in-this-corpus').status, 1);
	});

	test('outline is a table of contents and SAYS it is not a summary', () => {
		const r = run(ws, 'outline', 'field-notes');
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /Vesting/);
		assert.match(r.stdout, /not a summary/);
	});

	test('list reports every wiki with its incomplete count', () => {
		const r = run(ws, 'list', '--json');
		assert.equal(r.status, 0, r.stderr);
		const rows = JSON.parse(r.stdout);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].id, 'field-notes');
		assert.equal(rows[0].incomplete, 0);
	});
});

describe('verify leaves alone what a file cannot tell it', () => {
	// ⚠ THE DEFECT THIS PAIR EXISTS FOR. `failed` and `partial` are observations of the FETCH — an exit
	// code and a truncation flag — and neither survives on disk. Re-deriving them from the byte count
	// would promote a source truncated at 2,000 bytes to `complete`, inventing a finished corpus, which
	// is the exact failure the module was built against. Only a refetch can observe them again.
	const seed = (completeness, bytes, body) => {
		const { ws, files } = workspace();
		run(ws, 'init', 'w');
		fs.writeFileSync(path.join(ws, 'wikis', 'w', 'sources', '001--x.md'),
			`---\nkind: url\nref: https://northwind.example/x\ntitle: X\nfetched_at: '2026-09-11T00:00:00.000Z'\ncompleteness: ${completeness}\nbytes: ${bytes}\nreason: measured at fetch time\n---\n${body}`);
		return { ws, file: path.join(ws, 'wikis', 'w', 'sources', '001--x.md') };
	};

	test('a `partial` source full of bytes is NOT promoted to complete', () => {
		const { ws, file } = seed('partial', 2000, 'y'.repeat(4000));
		const r = run(ws, 'verify', 'w', '--fix');
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /left alone/);
		const { fields } = parseSource(fs.readFileSync(file, 'utf8'));
		assert.equal(fields.completeness, 'partial');
		assert.equal(fields.reason, 'measured at fetch time', 'the fetch-time reason is the only record of WHY, and it must survive');
	});

	test('a `failed` source is NOT demoted to empty, so its reason survives', () => {
		const { ws, file } = seed('failed', 0, '');
		assert.equal(run(ws, 'verify', 'w', '--fix').status, 0);
		assert.equal(parseSource(fs.readFileSync(file, 'utf8')).fields.completeness, 'failed');
	});

	test('and both still count as incomplete, so nothing they hide gets lost', () => {
		const { ws } = seed('partial', 2000, 'y'.repeat(4000));
		assert.equal(run(ws, 'incomplete', 'w').status, 1);
	});
});

describe('pull, against a fake vendor', () => {
	/** A fake `notebooklm` answering the two calls pull makes: `source list` and `source fulltext -o`.
	 *  PATH holds ONLY its folder, so a real vendor CLI on the machine is never reached. */
	function fakeVendor(ws) {
		const bin = path.join(ws, '.fake-nlm');
		fs.mkdirSync(bin);
		const script = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2).filter((a) => a !== '--quiet');
if (args[0] === 'source' && args[1] === 'list') {
	console.log(JSON.stringify({ sources: [{ id: 'src-1', title: 'Harbor Mutual field guide', type: 'SourceType.PASTED_TEXT' }] }));
} else if (args[0] === 'source' && args[1] === 'fulltext') {
	fs.writeFileSync(args[args.indexOf('-o') + 1], '# Harbor Mutual field guide\\n\\n' + 'Dana Oren walks the claims floor every morning. '.repeat(20));
	console.log('{}');
} else { console.error('unexpected call: ' + args.join(' ')); process.exit(9); }
`;
		fs.writeFileSync(path.join(bin, 'notebooklm'), script, { mode: 0o755 });
		return bin;
	}

	test('the closing line says to commit the record and the corpus folder', () => {
		const { ws } = workspace();
		const bin = fakeVendor(ws);
		const r = spawnSync(process.execPath, [CLI, 'pull', '--notebook', 'nb-0000-fake', '--wiki', 'guide'], {
			cwd: ws, encoding: 'utf8', env: { ...process.env, PATH: bin, FILES_FOLDER: '', NO_COLOR: '1' }, timeout: 30000,
		});
		assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
		assert.ok(fs.existsSync(path.join(ws, 'wikis', 'guide', 'sources')), 'pull wrote no corpus');
		const last = r.stdout.trim().split('\n').at(-1);
		assert.match(last, /commit the record \S*guide\S* and the corpus wikis\/guide\//);
		assert.doesNotMatch(r.stdout, /never committed/);
	});
});

describe('refusals', () => {
	// ⚠ THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-09-11, and the reversal IS the feature. A new wiki
	// used to need `FILES_FOLDER`, so a bare clone could not make one and a cloud session could not
	// touch the capability at all — which made the local adapter's whole claim, zero prerequisite,
	// false. The corpus lives in the repo now, so there is no variable to be unset.
	test('with NO .env at all a wiki still initialises — that is the zero-prerequisite claim', () => {
		const { ws } = workspace({ env: '' });
		const r = run(ws, 'init', 'nowhere');
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.ok(fs.existsSync(path.join(ws, 'wikis', 'nowhere', 'index.md')),
			'a corpus must be creatable on a clone that has never had a credential or a mount');
	});

	// The other half, and it must not regress: a record still carrying the OLD template is still
	// rendered, and still refuses BY NAME rather than guessing a folder. Nothing rewrites those
	// records, so this path stays live for every workspace that has not moved its corpora.
	test('a record still carrying the old ${env:…} template refuses by name when the variable is unset', () => {
		const { ws } = workspace({ env: '' });
		const rec = path.join(ws, 'data', 'wikis', 'legacy.wiki.md');
		fs.mkdirSync(path.dirname(rec), { recursive: true });
		fs.writeFileSync(rec, "---\nname: Legacy\nfolder: ${env:FILES_FOLDER}/wikis/legacy\n---\n");
		const r = run(ws, 'status', 'legacy');
		assert.equal(r.status, 1);
		assert.match(r.stderr + r.stdout, /\$\{env:FILES_FOLDER\} is not set/);
	});

	// ⚠ THE EDGE THE MOVE CREATED, found on the first workspace to split a corpus. `wiki list` finds a
	// wiki from any folder carrying an `index.md` (or a legacy `wiki.yaml`), the old out-of-tree root
	// included. With no record
	// there is no `folder` field, so the DEFAULT applies — and the default is now in the repo, where
	// that corpus is not. The wiki listed with 0 sources: discovered, and unreadable.
	test('an out-of-tree folder under FILES_FOLDER with no record resolves and reads its sources', () => {
		const { ws, files } = workspace();
		const legacy = path.join(files, 'wikis', 'orphan');
		fs.mkdirSync(path.join(legacy, 'sources'), { recursive: true });
		fs.writeFileSync(path.join(legacy, 'wiki.yaml'), 'id: orphan\ntitle: Orphan\nadapter: local\n');
		fs.writeFileSync(path.join(legacy, 'sources', '001--x.md'),
			'---\nkind: text\ntitle: X\ncompleteness: complete\nbytes: 40\n---\n' + 'x'.repeat(40));
		const r = run(ws, 'status', 'orphan');
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /1 source/, 'discovered but unreadable is the defect — it must read its own folder');
	});

	// …and a record, or a real in-repo corpus, always wins over a stale copy on a drive.
	test('an in-repo corpus is never shadowed by a leftover folder of the same id', () => {
		const { ws, files } = workspace();
		const legacy = path.join(files, 'wikis', 'both');
		fs.mkdirSync(path.join(legacy, 'sources'), { recursive: true });
		fs.writeFileSync(path.join(legacy, 'wiki.yaml'), 'id: both\ntitle: Stale\nadapter: local\n');
		fs.writeFileSync(path.join(legacy, 'sources', '001--stale.md'),
			'---\nkind: text\ntitle: Stale\ncompleteness: complete\nbytes: 40\n---\n' + 's'.repeat(40));
		assert.equal(run(ws, 'init', 'both', '--title', 'Fresh').status, 0);
		const r = run(ws, 'status', 'both');
		assert.match(r.stdout, /0 source/, 'the in-repo corpus is empty and that is the truthful answer');
	});

	test('an id that is not a slug is refused before anything is written', () => {
		const { ws, files } = workspace();
		assert.equal(run(ws, 'init', 'Not A Slug').status, 1);
		assert.ok(!fs.existsSync(path.join(ws, 'wikis')));
	});

	test('adding to a wiki that does not exist yet names the verb that makes one', () => {
		const { ws } = workspace();
		const r = run(ws, 'add', 'missing', 'some text', '--kind', 'text');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /wiki init missing/);
	});

	test('a binary file is refused — a wiki holds MARKDOWN, and the message says where bytes go', () => {
		const { ws } = workspace();
		run(ws, 'init', 'w');
		const bin = path.join(ws, 'blob.bin');
		fs.writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02, 0x00]));
		const r = run(ws, 'add', 'w', bin, '--kind', 'file');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /is not text/);
		assert.match(r.stderr, /FILES_FOLDER/);
	});

	test('an unknown wiki verb exits 2 and prints the usage', () => {
		const { ws } = workspace();
		const r = run(ws, 'summarise-everything');
		assert.equal(r.status, 2);
		assert.match(r.stderr, /unknown wiki command "summarise-everything"/);
		assert.match(r.stderr, /wiki incomplete/);
	});

	test('dt-setup, asked for a verb that moved, names where wiki and notebook went', () => {
		const { ws } = workspace();
		const r = spawnSync(process.execPath, [SETUP, 'wiki'], { cwd: ws, encoding: 'utf8' });
		assert.equal(r.status, 2);
		assert.match(r.stderr, /(?=.*\bdt-wiki\b)(?=.*\bdt-notebook\b)/);
	});
});

// ⚠ THE ONE THAT CANNOT DRIFT WITH ITS OWN FIXTURE. Everything above asserts what the CLI writes
// against what this file expects; both are ours, so both could be wrong together — the exact failure
// tests/helpers/virgin-workspace.mjs was written about. This runs the PINNED ENGINE over the record
// the CLI actually produced, and `check` is the thing that says whether it is valid.
// ⚠ A CORPUS IS MARKDOWN, AND NOTHING ELSE. Operator, 2026-09-11: "Only md files … frontmatter,
// index.md files on root where applicable". The rule is not cosmetic — it is what lets one reader
// open every file in the folder, what lets `grep` mean the same thing everywhere in it, and what
// stops a second serialisation format quietly appearing beside the first.
describe('a corpus is markdown only', () => {
	test('every file the CLI writes into a wiki folder is a .md with frontmatter', () => {
		const { ws } = workspace();
		assert.equal(run(ws, 'init', 'only-md', '--title', 'Only MD').status, 0);
		assert.equal(run(ws, 'add', 'only-md', 'a synthetic body, long enough to clear the floor. '.repeat(10), '--kind', 'text', '--title', 'A Source').status, 0);
		const root = path.join(ws, 'wikis', 'only-md');
		const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
			.flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
		const files = walk(root);
		assert.ok(files.length >= 2, `expected an index and a source, saw ${files.length}`);
		const notMd = files.filter((f) => !f.endsWith('.md')).map((f) => path.relative(root, f));
		assert.deepEqual(notMd, [], `not markdown:\n  ${notMd.join('\n  ')}`);
		const noFm = files.filter((f) => !fs.readFileSync(f, 'utf8').startsWith('---\n')).map((f) => path.relative(root, f));
		assert.deepEqual(noFm, [], `markdown without frontmatter:\n  ${noFm.join('\n  ')}`);
		assert.ok(files.some((f) => path.basename(f) === 'index.md'), 'the corpus root needs its index.md');
	});
});

// ⚠ `ask` NEEDS qmd AND `search` MUST NOT. The module's promise is zero GOOGLE prerequisites, not
// zero software — but the fallback still has to hold, because a corpus you cannot grep on a machine
// with nothing installed is a corpus you cannot read at all.
describe('ask needs qmd; everything else survives without it', () => {
	// PATH is emptied so qmd cannot be found even on a machine that has it — this is the contract on
	// a fresh clone, and it must be tested there rather than assumed.
	const runNoQmd = (ws, ...args) => spawnSync(process.execPath, [CLI, ...args], {
		cwd: ws, encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', FILES_FOLDER: '', NO_COLOR: '1' },
	});

	test('with qmd absent, `ask` refuses BY NAME and hands over the install', () => {
		const { ws } = workspace();
		assert.equal(runNoQmd(ws, 'init', 'q', '--title', 'Q').status, 0, 'init must not need qmd');
		const r = runNoQmd(ws, 'ask', 'q', 'what does this say');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /npm install -g @tobilu\/qmd/, 'a refusal without the fix is a dead end');
		assert.match(r.stderr, /no account, no key, no network/, 'and it must say the requirement is local');
		assert.match(r.stderr, /wiki search/, 'and name the fallback that still works');
	});

	test('with qmd absent, `search` still works — grep is the floor that never moves', () => {
		const { ws } = workspace();
		assert.equal(runNoQmd(ws, 'init', 'q', '--title', 'Q').status, 0);
		assert.equal(runNoQmd(ws, 'add', 'q', 'the needle is in this body, long enough to clear the floor. '.repeat(8), '--kind', 'text', '--title', 'S').status, 0);
		const r = runNoQmd(ws, 'search', 'q', 'needle');
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /sources\/001/, 'lexical search must not depend on the retrieval engine');
	});

	test('`index` refuses without qmd rather than silently registering nothing', () => {
		const { ws } = workspace();
		const r = runNoQmd(ws, 'index');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /npm install -g @tobilu\/qmd/);
	});
});

describe('the record the CLI writes survives the real engine', () => {
	test('a wiki initialised by the CLI compiles and checks clean in a virgin workspace', () => {
		const root = virginWorkspace();
		made.push(root);
		installModules(root, closure('wikis'));
		// findWorkspace needs the lockfile too, and `dreamteamer init` writes no such thing.
		fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
		assert.equal(engine(root, ['compile']).status, 0);

		const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], {
			cwd: root, encoding: 'utf8', env: { ...process.env, FILES_FOLDER: '', NO_COLOR: '1' },
		});
		assert.equal(cli('init', 'field-notes', '--title', 'Field Notes').status, 0);
		assert.equal(cli('add', 'field-notes', 'a synthetic source body, long enough to clear the floor. '.repeat(10), '--kind', 'text', '--title', 'A Source').status, 0);
		assert.equal(cli('add', 'field-notes', 'https://northwind.example/roadmap').status, 0);

		const checked = engine(root, ['check']);
		assert.equal(checked.status, 0, `check refused the record the CLI wrote:\n${checked.stdout}\n${checked.stderr}`);
		assert.match(checked.stdout + checked.stderr, /0 violations/);

		// ⚠ AND THE CORPUS IS IN THE WORKSPACE, which is the reversal of what this asserted until
		// 2026-09-11 ("the bytes are never committed"). A wiki is markdown a coding agent greps and
		// cites by `file:line`; outside the clone it was unreachable from a bare checkout and from any
		// cloud session, so the local adapter's one claim — zero prerequisite — was false.
		assert.ok(fs.existsSync(path.join(root, 'wikis', 'field-notes', 'index.md')),
			'the corpus must land in the workspace, where git and grep can both reach it');
		// ⚠ AND NOT UNDER `data/`. Every path there belongs to some collection's storage, and check
		// warns on every file in one that is not a record — four corpora under `data/notebooks/` gave
		// 42 warnings on every run. The check still PASSED, which is worse than failing.
		assert.ok(!fs.existsSync(path.join(root, 'data', 'notebooks', 'field-notes')),
			'a corpus under a collection\'s storage path makes check warn once per source file');
		assert.doesNotMatch(checked.stdout + checked.stderr, /unrecognized file/,
			'a corpus must be invisible to the record layer by construction, not by exemption');
	});
});

// ⚠ A CITATION YOU CANNOT OPEN IS NOT A CITATION, and this is the regression that proves it. The
// first implementation numbered hits inside the BODY and printed them as `<file>:<line>` — short by
// exactly the frontmatter's height. Measured on a real 38-source corpus: reported 44 against actual
// 55, and 62 against 73. Plausible, wrong, and silent, which is the worst combination available.
describe('wiki search cites FILE lines, not body lines', () => {
	const file = ['---', 'title: A Source', 'completeness: complete', 'bytes: 120', '---', '', 'first body line', 'the needle is here', 'after'].join('\n');

	// The property that matters is an INVARIANT, not a constant: whatever the frontmatter's height,
	// the body's first line must BE the file's line `bodyLine`. Asserting a number here is how the
	// original test managed to be green on a broken feature.
	test('parseSource reports the file line the body starts on', () => {
		const { body, bodyLine } = parseSource(file);
		assert.equal(file.split('\n')[bodyLine - 1], body.split('\n')[0], 'bodyLine must index the real file');
		assert.equal(bodyLine, 6);
	});

	test('a file with no frontmatter starts at line 1', () => {
		assert.equal(parseSource('just a body\nand more').bodyLine, 1);
		assert.equal(parseSource('').bodyLine, 1);
	});

	test('a hit resolves to the line the editor opens', () => {
		const { body, bodyLine } = parseSource(file);
		const [hit] = searchBody(body, /needle/i, 200, bodyLine);
		assert.equal(hit.text, 'the needle is here');
		assert.equal(file.split('\n')[hit.line - 1], 'the needle is here', 'the cited line must BE the matching line');
		assert.equal(hit.line, 8);
	});

	// The defect, stated as the thing that must never come back: the default is right only for a
	// string that IS the whole file.
	// Stated as a property, not a constant — the same discipline that would have caught this the
	// first time: the un-offset number must NOT resolve to the hit, whatever it happens to be.
	test('without the offset the number does not resolve to the match — the old, silent behaviour', () => {
		const { body, bodyLine } = parseSource(file);
		const wrong = searchBody(body, /needle/i)[0].line;
		const right = searchBody(body, /needle/i, 200, bodyLine)[0].line;
		assert.notEqual(wrong, right);
		assert.equal(right - wrong, bodyLine - 1, 'the error is exactly the frontmatter height');
		assert.ok(!/needle/.test(file.split('\n')[wrong - 1] ?? ''), 'the un-offset line must not be the hit');
	});
});
