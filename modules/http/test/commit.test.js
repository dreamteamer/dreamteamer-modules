// POST /api/commit — `dt commit` over HTTP. A write does not commit; this publishes, scoped to the
// records named, and answers with exactly what `dt commit --json` prints.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { api as engine } from '../../../tests/helpers/fixture.mjs';
import { httpWorkspace, simpleCollection, mount, call } from './support.mjs';

let h, srv, api, mine, theirs;

const commits = () => Number(h.git(['rev-list', '--count', 'HEAD']));
const tracked = (rel) => h.git(['ls-files', '--', rel]) === rel;
const pending = () => h.git(['status', '--porcelain', '--untracked-files=all', '--', 'data']);

before(async () => {
	h = await httpWorkspace({ collections: { notes: simpleCollection({ storage: { suffix: 'note' } }) } });
	srv = await mount(h.ws);
	api = srv.base;
	// written through the api — the record this client means to publish
	const r = await call('POST', `${api}/collections/notes/records`, { name: 'Mine' });
	assert.equal(r.status, 201);
	mine = r.json;
	// written by someone else and left pending — must never ride along
	const other = new engine.Store(h.ws).add('notes', { name: 'Theirs' });
	theirs = { id: other.id, path: path.relative(h.root, other.file) };
});
after(() => srv?.close());

describe('POST /api/commit', () => {
	test('dryRun commits nothing, and answers exactly what `dt commit --dry-run --json` prints', async () => {
		const before = commits();
		const { status, json } = await call('POST', `${api}/commit`, { only: [`notes/${mine.id}`], dryRun: true });
		assert.equal(status, 200, JSON.stringify(json));
		assert.ok(Array.isArray(json));
		assert.deepEqual(json[0].rows.map((r) => `${r.collection}/${r.id}`), [`notes/${mine.id}`]);
		assert.equal(json[0].sha ?? null, null, 'a plan has no sha');
		assert.equal(commits(), before, 'no commit was made');
		assert.ok(!tracked(mine.path));
		const cli = h.dt('commit', `notes/${mine.id}`, '--dry-run', '--json');
		assert.equal(cli.code, 0, cli.stderr);
		assert.deepEqual(json, JSON.parse(cli.stdout));
	});

	test('every dry-run spelling — the query, the body, or both — commits nothing', async () => {
		const head = h.git(['rev-parse', 'HEAD']);
		const status0 = pending();
		const only = [`notes/${mine.id}`];
		for (const [qs, body] of [['?dry-run=true', { only }], ['', { only, dryRun: true }], ['?dry-run=true', { only, dryRun: true }], ['?dry-run=true', { only, dryRun: false }]]) {
			const { status, json } = await call('POST', `${api}/commit${qs}`, body);
			assert.equal(status, 200, `${qs} ${JSON.stringify(body)} → ${JSON.stringify(json)}`);
			assert.ok(json.every((r) => (r.sha ?? null) === null), `${qs} ${JSON.stringify(body)} answered with a sha — it committed`);
			assert.equal(h.git(['rev-parse', 'HEAD']), head, `${qs} ${JSON.stringify(body)} moved HEAD`);
			assert.equal(pending(), status0, `${qs} ${JSON.stringify(body)} changed what is pending`);
		}
		// an unreadable value is refused, not guessed at
		const odd = await call('POST', `${api}/commit?dry-run=yes`, { only });
		assert.equal(odd.status, 400);
		assert.match(odd.json.error, /does not understand \?dry-run=yes/);
		assert.equal(h.git(['rev-parse', 'HEAD']), head);
	});

	test('publishes the record named in `only`, and leaves an unrelated pending record uncommitted', async () => {
		const before = commits();
		const { status, json } = await call('POST', `${api}/commit`, { only: [`notes/${mine.id}`], message: 'notes: publish mine' });
		assert.equal(status, 200, JSON.stringify(json));
		assert.equal(json.length, 1);
		assert.match(json[0].sha, /^[0-9a-f]{7,40}$/);
		assert.equal(json[0].subject, 'notes: publish mine');
		assert.deepEqual(json[0].rows.map((r) => `${r.collection}/${r.id}`), [`notes/${mine.id}`]);
		assert.equal(commits(), before + 1);
		assert.ok(tracked(mine.path), 'the named record is in HEAD');
		assert.ok(!tracked(theirs.path), 'the other record is not');
		assert.match(pending(), new RegExp(theirs.path.replace(/[.]/g, '\\.')), 'and is still pending on disk');
		assert.equal(h.git(['log', '-1', '--format=%s']), 'notes: publish mine');
	});

	test('nothing pending under the target is an empty results array, not an error', async () => {
		const { status, json } = await call('POST', `${api}/commit`, { only: [`notes/${mine.id}`] });
		assert.equal(status, 200);
		assert.deepEqual(json, []);
	});

	test('unknown body keys and wrongly typed values are refused with 400, committing nothing', async () => {
		const before = commits();
		const only = [`notes/${theirs.id}`];
		for (const body of [{ only, dry_run: true }, { only: `notes/${theirs.id}` }, { only, dryRun: 'yes' }, { only, message: 7 }]) {
			const { status, json } = await call('POST', `${api}/commit`, body);
			assert.equal(status, 400, JSON.stringify(body));
			assert.match(json.error, /POST \/commit .*body: \{ only: string\[\], message\?: string, dryRun\?: boolean \}/);
		}
		const unknown = await call('POST', `${api}/commit`, { only, dry_run: true });
		assert.match(unknown.json.error, /does not take "dry_run"/);
		assert.equal(commits(), before);
		assert.ok(!tracked(theirs.path));
	});

	test('a repo blocked by an in-progress merge is a 409 carrying the results', async () => {
		const marker = path.join(h.root, '.git', 'MERGE_HEAD');
		fs.writeFileSync(marker, h.git(['rev-parse', 'HEAD']) + '\n');
		try {
			const before = commits();
			const { status, json } = await call('POST', `${api}/commit`, { only: [`notes/${theirs.id}`] });
			assert.equal(status, 409, JSON.stringify(json));
			assert.match(json[0].blocked, /merge is in progress/);
			assert.equal(commits(), before);
		} finally { fs.rmSync(marker, { force: true }); }
	});
});
