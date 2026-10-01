// THE RULES A WIKI IS JUDGED BY, pinned. Every case here fails without `lib/wiki.mjs`, and every
// fixture is synthetic.
//
// ⚠ The one that earns the whole design is `classify`. A corpus that is half fetched and LOOKS
// finished is the failure this module exists against, and the two states that make it possible are
// the ones a naive reader collapses: a fetch that exits 0 and writes nothing, and a fetch that exits
// 0 and writes a truncated page. Both are successes by exit code. Neither is a source.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import {
	COMPLETENESS, MIN_BYTES, classify, summarise, adapterOf, ADAPTERS, defaultFolder, wikiPaths,
	slug, sourceFileName, sourcePath, parseSource, renderSource, stubFields,
	renderManifest, parseManifest, outline, searchBody, renderTemplate, parseEnv,
	kindFromUpstream, pullPlan, vendorResult, MARKDOWN_EXTRA_MISSING,
} from '../lib/wiki.mjs';

const body = (n) => 'x'.repeat(n);

describe('the completeness marker', () => {
	test('the five states are named, ordered worst first, and nothing else is a state', () => {
		assert.deepEqual(COMPLETENESS, ['pending', 'failed', 'empty', 'partial', 'complete']);
	});

	test('nothing attempted is `pending` — the stub, which is what makes absence impossible', () => {
		const r = classify({});
		assert.equal(r.completeness, 'pending');
		assert.match(r.reason, /never fetched/);
	});

	test('a non-zero exit is `failed`, and the adapter\'s FIRST stderr line is kept as the reason', () => {
		const r = classify({ attempted: true, status: 1, bytes: 0, error: 'HTTP 403 forbidden\n  at fetch (…)\n  at main (…)' });
		assert.equal(r.completeness, 'failed');
		assert.equal(r.reason, 'HTTP 403 forbidden');
	});

	test('a non-zero exit that still wrote plenty is `failed`, never `complete` — the exit code wins', () => {
		assert.equal(classify({ attempted: true, status: 2, bytes: 90_000, error: 'aborted' }).completeness, 'failed');
	});

	test('exit 0 with nothing worth keeping is `empty`, NOT `failed` — the route is wrong, not the attempt', () => {
		const r = classify({ attempted: true, status: 0, bytes: 12 });
		assert.equal(r.completeness, 'empty');
		assert.match(r.reason, /12 bytes/);
		assert.match(r.reason, /the route works, the content is not there/);
	});

	test('exit 0 and truncated is `partial`, NOT `complete` — the case the marker exists for', () => {
		const r = classify({ attempted: true, status: 0, bytes: 2000, truncated: true });
		assert.equal(r.completeness, 'partial');
		assert.match(r.reason, /truncated at 2000 bytes/);
	});

	test('exit 0 and short of a length the adapter declared is `partial` too', () => {
		const r = classify({ attempted: true, status: 0, bytes: 4_000, expectedBytes: 48_000 });
		assert.equal(r.completeness, 'partial');
		assert.match(r.reason, /4000 of 48000 bytes/);
	});

	test('exit 0, enough bytes, nothing truncated is `complete` and carries no reason', () => {
		assert.deepEqual(classify({ attempted: true, status: 0, bytes: 48_000 }), { completeness: 'complete', reason: '' });
	});

	test('the floor is 256 by default and MOVES with minBytes — so re-classifying never needs a re-download', () => {
		assert.equal(MIN_BYTES, 256);
		assert.equal(classify({ attempted: true, status: 0, bytes: 255 }).completeness, 'empty');
		assert.equal(classify({ attempted: true, status: 0, bytes: 256 }).completeness, 'complete');
		assert.equal(classify({ attempted: true, status: 0, bytes: 255, minBytes: 10 }).completeness, 'complete');
		assert.equal(classify({ attempted: true, status: 0, bytes: 4_000, minBytes: 8_000 }).completeness, 'empty');
	});

	test('summarise counts every state, and an unknown or absent marker counts as pending rather than vanishing', () => {
		const s = summarise([
			{ completeness: 'complete' }, { completeness: 'complete' },
			{ completeness: 'partial' }, { completeness: 'failed' },
			{ completeness: 'nonsense' }, {},
		]);
		assert.equal(s.total, 6);
		assert.equal(s.complete, 2);
		assert.equal(s.incomplete, 4);
		assert.equal(s.by.pending, 2, 'an unknown marker and a missing one are both pending');
		assert.deepEqual(Object.keys(s.by), COMPLETENESS);
	});
});

describe('which adapter answers', () => {
	test('a record with a live uuid is served by notebooklm; a bare one is served locally', () => {
		assert.equal(adapterOf({ notebook_id: 'c3ad6df2' }), 'notebooklm');
		assert.equal(adapterOf({}), 'local');
		assert.equal(adapterOf({ wikis: ['wikis/share-based-payments'] }), 'local');
	});
	test('the explicit field overrides the derivation — the one case it exists for', () => {
		assert.equal(adapterOf({ notebook_id: 'c3ad6df2', adapter: 'local' }), 'local');
		assert.equal(adapterOf({ adapter: 'notebooklm' }), 'notebooklm');
	});
	test('an argument override beats the field', () => {
		assert.equal(adapterOf({ adapter: 'local' }, 'notebooklm'), 'notebooklm');
	});
	test('an adapter nobody implements is refused, naming the two that exist', () => {
		assert.deepEqual(ADAPTERS, ['local', 'notebooklm']);
		assert.throws(() => adapterOf({ adapter: 'obsidian' }), /unknown adapter "obsidian"/);
	});
});

describe('the folder', () => {
	test('a new wiki\'s folder is workspace-relative and in the repo — no variable, no machine path', () => {
		assert.equal(defaultFolder('share-based-payments'), 'wikis/share-based-payments');
		assert.ok(!defaultFolder('x').includes('${env:'), 'the default needs no variable on any machine');
		assert.ok(!path.isAbsolute(defaultFolder('x')), 'relative — it resolves against the workspace, never the cwd');
	});
	test('wikiPaths names the manifest and the sources tree under the rendered root', () => {
		const p = wikiPaths('/tmp/w');
		// ⚠ `index.md`, not `wiki.yaml`. A corpus is ONLY markdown — every file in it carries
		// frontmatter and opens in the same reader — and a lone YAML file was the one thing in the
		// folder that did not. The legacy name is still resolved so an older folder keeps working.
		assert.equal(p.index, '/tmp/w/index.md');
		assert.equal(p.legacyManifest, '/tmp/w/wiki.yaml');
		assert.equal(p.sources, '/tmp/w/sources');
	});
	test('slug is lowercase kebab and capped', () => {
		assert.equal(slug('3.2 Share-Based Payments | DART'), '3-2-share-based-payments-dart');
		assert.ok(slug('a'.repeat(200)).length <= 48);
	});
	test('a title with nothing latin-alphanumeric slugs to empty, so the NUMBER becomes the filename', () => {
		assert.equal(slug('··· — ‡'), '');
		assert.equal(sourceFileName(7, '··· — ‡'), '007.md');
	});
	test('a source filename carries the corpus order as a zero-padded prefix, so `ls` IS the order', () => {
		assert.equal(sourceFileName(1, 'Share-Based Payments'), '001--share-based-payments.md');
		assert.equal(sourceFileName(129, 'Last One'), '129--last-one.md');
	});
	test('a section becomes ONE subfolder, POSIX-spelled, and the number stays global', () => {
		assert.equal(sourcePath(31, 'A Circular On Vesting', 'Regulation'), 'regulation/031--a-circular-on-vesting.md');
		assert.equal(sourcePath(31, 'A Circular On Vesting'), '031--a-circular-on-vesting.md');
	});
});

describe('the source file format', () => {
	test('frontmatter and body round-trip', () => {
		const fields = { kind: 'url', ref: 'https://northwind.example/a', completeness: 'complete', bytes: 12 };
		const { fields: back, body: b } = parseSource(renderSource(fields, '# Heading\n\ntext\n'));
		assert.deepEqual(back, fields);
		assert.equal(b, '# Heading\n\ntext\n');
	});
	test('a body containing its own `---` line survives — only the FIRST closing marker is a boundary', () => {
		const text = renderSource({ kind: 'text' }, 'before\n---\nafter\n');
		assert.equal(parseSource(text).body, 'before\n---\nafter\n');
		assert.equal(parseSource(text).fields.kind, 'text');
	});
	test('a hand-written markdown file with no frontmatter reads as all body', () => {
		// bodyLine 1: with no frontmatter the body IS the file, so a citation needs no offset.
		assert.deepEqual(parseSource('# just markdown\n'), { fields: {}, body: '# just markdown\n', bodyLine: 1 });
	});
	test('a stub is pending with zero bytes — the state every source starts in', () => {
		const f = stubFields({ kind: 'url', ref: 'https://northwind.example/a', title: 'A' });
		assert.equal(f.completeness, 'pending');
		assert.equal(f.bytes, 0);
	});
	test('the manifest holds identity and adapter and NOTHING per-source — one index of the folder, not two', () => {
		const m = parseManifest(renderManifest({ id: 'w', title: 'W', adapter: 'notebooklm', upstream: 'abc', counts: { total: 3 } }));
		assert.deepEqual(Object.keys(m).sort(), ['adapter', 'counts', 'id', 'title', 'upstream']);
		assert.ok(!('sources' in m), 'a manifest listing the sources is a second index that will disagree with the first');
	});
});

describe('reading a corpus without a model', () => {
	test('outline returns the headings in order, and a `#` inside a fenced block is not one', () => {
		const md = '# Top\n\n```sh\n# not a heading\n```\n\n## Second\n\n### too deep\n';
		assert.deepEqual(outline(md), [{ level: 1, text: 'Top' }, { level: 2, text: 'Second' }]);
	});
	test('search returns 1-BASED line numbers, so a hit reads as a citation you can open', () => {
		const hits = searchBody('alpha\nbeta\ngamma beta\n', /beta/i);
		assert.deepEqual(hits, [{ line: 2, text: 'beta' }, { line: 3, text: 'gamma beta' }]);
	});
});

describe('templates and the environment', () => {
	test('a template renders against the environment it is given', () => {
		assert.deepEqual(renderTemplate('${env:FILES_FOLDER}/wikis/w', { FILES_FOLDER: '/files' }), { value: '/files/wikis/w' });
	});
	test('an unset variable is a REFUSAL naming it, never a half-rendered path', () => {
		const r = renderTemplate('${env:FILES_FOLDER}/wikis/w', {});
		assert.ok(!('value' in r));
		assert.match(r.refusal, /\$\{env:FILES_FOLDER\} is not set/);
	});
	test('parseEnv takes names AND values, drops blanks, and unquotes', () => {
		assert.deepEqual(parseEnv('# c\nFILES_FOLDER=/files\nexport REPOS_FOLDER="/repos"\nEMPTY=\nnot a line\n'), {
			FILES_FOLDER: '/files', REPOS_FOLDER: '/repos',
		});
	});
});

describe('reading the vendor\'s answer', () => {
	// ⚠ THE CASE THAT COST THE FIRST BENCHMARK RUN. All 129 sources came back `failed` with the reason
	// "Command failed: notebooklm --quiet source fulltext …" — the command line echoed back, naming
	// nothing — because the vendor puts its error in a JSON payload on STDOUT and leaves stderr empty.
	// Verbatim from notebooklm-py 0.7.3 on 2026-09-11.
	const MARKDOWN_PAYLOAD = '{"error": true, "code": "UNEXPECTED_ERROR", "message": "Unexpected error: The \'markdown\' format requires the \'markdownify\' package. Install it with: pip install \'notebooklm-py[markdown]\'"}';

	test('an error payload on stdout is an ERROR even at exit 0, and the vendor\'s own message is kept', () => {
		const r = vendorResult({ stdout: MARKDOWN_PAYLOAD, stderr: '', status: 0 });
		assert.ok(!('json' in r), 'exit 0 with an error payload is the trap — it must not read as success');
		assert.match(r.error, /requires the 'markdownify' package/);
		assert.match(r.error, /pip install/, 'the fix travels with the reason, or the reason names nothing');
	});

	test('the same payload at a non-zero exit reads the payload, not the exit code', () => {
		assert.match(vendorResult({ stdout: MARKDOWN_PAYLOAD, status: 2 }).error, /markdownify/);
	});

	test('a non-zero exit with no payload falls back to stderr, then to the code', () => {
		assert.equal(vendorResult({ stdout: '', stderr: 'boom\n', status: 1 }).error, 'boom');
		assert.equal(vendorResult({ stdout: 'not json', stderr: '', status: 3 }).error, 'notebooklm exited 3');
	});

	test('a banner before the JSON is skipped, and a clean call returns the payload', () => {
		assert.deepEqual(vendorResult({ stdout: 'fetching…\n{"source": {"id": "a1"}}' }).json, { source: { id: 'a1' } });
		assert.deepEqual(vendorResult({ stdout: '' }).json, {});
	});

	test('the markdown-extra gap is the ONLY error a lossier retry is allowed for', () => {
		assert.ok(MARKDOWN_EXTRA_MISSING.test(MARKDOWN_PAYLOAD));
		assert.ok(!MARKDOWN_EXTRA_MISSING.test('HTTP 403 forbidden'), 'retrying a real failure in a lossier format writes a bad answer down as a good one');
		assert.ok(!MARKDOWN_EXTRA_MISSING.test('notebooklm exited 1'));
	});
});

describe('the pull plan', () => {
	const live = {
		sources: [
			{ index: 1, id: 'a1', title: 'First Page', type: 'web_page', url: 'https://northwind.example/1' },
			{ index: 2, id: 'b2', title: 'A Note', type: 'markdown' },
			{ index: 3, id: 'c3', title: 'A Deck', type: 'google_slides' },
		],
	};

	test('an upstream type becomes the kind a local source file carries', () => {
		assert.equal(kindFromUpstream('SourceType.WEB_PAGE'), 'url');
		assert.equal(kindFromUpstream('youtube_video'), 'youtube');
		assert.equal(kindFromUpstream('pasted_text'), 'text');
		assert.equal(kindFromUpstream('google_slides'), 'drive');
		assert.equal(kindFromUpstream('pdf'), 'file');
	});

	test('every live source produces a step, in corpus order, with its file path derived', () => {
		const { steps, refusals } = pullPlan(live);
		assert.deepEqual(refusals, []);
		assert.deepEqual(steps.map((s) => s.file), [
			'sources/001--first-page.md', 'sources/002--a-note.md', 'sources/003--a-deck.md',
		]);
		assert.deepEqual(steps.map((s) => s.action), ['fetch', 'fetch', 'fetch']);
		assert.deepEqual(steps.map((s) => s.kind), ['url', 'file', 'drive']);
	});

	test('a source already `complete` is SKIPPED — which is what makes a dead run resumable', () => {
		const existing = [{ upstream_id: 'b2', completeness: 'complete', path: 'sources/002--a-note.md' }];
		const { steps } = pullPlan(live, existing);
		assert.deepEqual(steps.map((s) => s.action), ['fetch', 'skip', 'fetch']);
		assert.match(steps[1].reason, /--refresh/);
	});

	test('a source that is `partial` or `empty` is fetched again — only `complete` is done', () => {
		const existing = [
			{ upstream_id: 'a1', completeness: 'partial', path: 'sources/001--first-page.md' },
			{ upstream_id: 'b2', completeness: 'empty', path: 'sources/002--a-note.md' },
		];
		assert.deepEqual(pullPlan(live, existing).steps.map((s) => s.action), ['fetch', 'fetch', 'fetch']);
	});

	test('--refresh stops the skipping', () => {
		const existing = [{ upstream_id: 'b2', completeness: 'complete', path: 'sources/002--a-note.md' }];
		assert.deepEqual(pullPlan(live, existing, { refresh: true }).steps.map((s) => s.action), ['fetch', 'fetch', 'fetch']);
	});

	test('a step for an existing source keeps its EXISTING path, so a rename upstream does not orphan the file', () => {
		const existing = [{ upstream_id: 'a1', completeness: 'partial', path: 'sources/regulation/001--old-name.md' }];
		assert.equal(pullPlan(live, existing).steps[0].file, 'sources/regulation/001--old-name.md');
	});

	test('--limit caps the FETCHES and leaves the rest as steps — the plan is still the whole inventory', () => {
		const { steps } = pullPlan(live, [], { limit: 2 });
		assert.deepEqual(steps.map((s) => s.action), ['fetch', 'fetch', 'skip']);
		assert.equal(steps.length, 3, 'a step dropped because of a limit is a source that stops being counted');
		assert.match(steps[2].reason, /--limit 2/);
	});

	test('a live entry with no id is REFUSED, not guessed at — it could never be resumed', () => {
		const { refusals } = pullPlan({ sources: [{ index: 1, title: 'x', type: 'web_page' }] });
		assert.equal(refusals.length, 1);
		assert.match(refusals[0], /gave no id/);
	});

	test('an empty upstream is a refusal rather than a silent no-op', () => {
		assert.match(pullPlan({ sources: [] }).refusals[0], /no sources/);
	});

	test('a section function nests the file and the number stays global', () => {
		const { steps } = pullPlan(live, [], { section: (row) => (row.type === 'web_page' ? 'web' : '') });
		assert.equal(steps[0].file, 'sources/web/001--first-page.md');
		assert.equal(steps[1].file, 'sources/002--a-note.md');
	});
});
