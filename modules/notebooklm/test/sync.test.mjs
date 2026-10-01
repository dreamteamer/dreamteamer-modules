// Tier 2 — `dt notebooklm --notebook/--create`: the sync, against a FAKE vendor CLI on a private PATH.
// The real `notebooklm` is never reached (helpers.mjs refuses to run if the stub PATH could find
// one) and every dt spawn is bounded by the fixture's hard timeout.
//
// Assertions read the FAKE NOTEBOOK's state and the argv log — what the vendor was actually asked to
// do — never the exporter's own report of it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFile } from './fixture.mjs';
import { fixture, fakeVendor } from './helpers.mjs';

const titles = (nb) => nb.sources.map((s) => s.title).sort();
const EXPECTED = ['dt · companies', 'dt · people', 'dt · schema'];
const syncState = (ws) => JSON.parse(readFile(ws.root, 'bundle/notebook.json'));

function created() {
	const ws = fixture();
	const nlm = fakeVendor(ws.root);
	const res = nlm.dt(ws, 'notebooklm', '--out', 'bundle', '--create', 'Team brain');
	assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
	return { ws, nlm, res };
}

describe('the first sync — --create', () => {
	test('creates the notebook, adds one source per bundle file under its title, and applies the persona', () => {
		const { ws, nlm } = created();
		const state = nlm.state();
		const [id] = Object.keys(state.notebooks);
		const nb = state.notebooks[id];
		assert.equal(nb.title, 'Team brain');
		assert.deepEqual(titles(nb), EXPECTED, 'every source is renamed to its title, whatever the vendor kept');
		assert.equal(nb.sources.find((s) => s.title === 'dt · people').text, readFile(ws.root, 'bundle/people.md'), 'the uploaded bytes are the bundle file');
		assert.equal(nb.config.persona, readFile(ws.root, 'bundle/instructions.md'));
		assert.equal(nb.config.mode, null, '--mode is never sent — it discards the persona');
	});

	test('notebook.json keeps the notebook id and each title\'s source id and hash', () => {
		const { ws, nlm } = created();
		const nb = Object.entries(nlm.state().notebooks)[0];
		const st = syncState(ws);
		assert.equal(st.notebook_id, nb[0]);
		const m = JSON.parse(readFile(ws.root, 'bundle/manifest.json'));
		for (const s of m.sources) {
			assert.equal(st.sources[s.title].sha256, s.sha256);
			assert.equal(nb[1].sources.find((x) => x.id === st.sources[s.title].source_id)?.title, s.title);
		}
	});

	test('preflight runs first — the version, then `auth check --test` — and `use` is never called', () => {
		const { nlm } = created();
		const calls = nlm.calls();
		assert.deepEqual(calls[0], ['--version']);
		assert.deepEqual(calls[1], ['--quiet', 'auth', 'check', '--test']);
		assert.ok(!calls.some((c) => c.includes('use')), '`notebooklm use` writes a shared context file');
		// every call after create names its notebook explicitly
		for (const c of calls.slice(3)) assert.ok(c.includes('-n'), `a call without -n: ${JSON.stringify(c)}`);
	});
});

// The next run names the notebook with --notebook (the id `--create` printed, kept in notebook.json):
// the sync only runs when one of the two is passed, so a bare re-render never reaches the network.
const again = (ws, nlm, ...args) => nlm.dt(ws, 'notebooklm', '--out', 'bundle', '--notebook', syncState(ws).notebook_id, ...args);

describe('the next sync — incremental, by source id', () => {
	test('unchanged records: nothing added, deleted or renamed; the persona is re-applied', () => {
		const { ws, nlm } = created();
		const before = nlm.calls().length;
		const res = again(ws, nlm);
		assert.equal(res.code, 0, res.stderr);
		const calls = nlm.calls().slice(before);
		assert.deepEqual(calls.filter((c) => c.includes('source')).map((c) => c[c.indexOf('source') + 1]), ['list'], `only a list should touch sources, got ${JSON.stringify(calls)}`);
		assert.ok(calls.some((c) => c.includes('configure')));
		assert.match(res.stdout, /\+0 added · ~0 replaced · =3 unchanged · -0 removed/);
	});

	test('a changed record replaces exactly its own source; the rest keep their ids', () => {
		const { ws, nlm } = created();
		const ids = syncState(ws).sources;
		assert.equal(ws.dt('set', 'people/ada', 'notes=Rewrote the program.').code, 0);
		assert.equal(again(ws, nlm).code, 0);
		const nb = Object.values(nlm.state().notebooks)[0];
		assert.deepEqual(titles(nb), EXPECTED);
		const now = syncState(ws).sources;
		assert.notEqual(now['dt · people'].source_id, ids['dt · people'].source_id, 'the changed source was not replaced');
		assert.equal(now['dt · companies'].source_id, ids['dt · companies'].source_id);
		assert.ok(nb.sources.find((s) => s.title === 'dt · people').text.includes('Rewrote the program.'));
		assert.ok(!nb.sources.some((s) => s.id === ids['dt · people'].source_id), 'the old copy was left behind');
	});

	test('a source added by hand is never touched; an owned source no longer wanted is removed', () => {
		const { ws, nlm } = created();
		const id = syncState(ws).notebook_id;
		nlm.addForeign(id, 'a paper I added by hand');
		nlm.addForeign(id, 'dt · retired-collection');
		assert.equal(again(ws, nlm, '--collections', 'companies').code, 0);
		const nb = nlm.state().notebooks[id];
		assert.deepEqual(titles(nb), ['a paper I added by hand', 'dt · companies', 'dt · schema']);
	});

	test('--response-length rides along to configure in the same call as the persona', () => {
		const { ws, nlm } = created();
		assert.equal(again(ws, nlm, '--response-length', 'longer').code, 0);
		const nb = Object.values(nlm.state().notebooks)[0];
		assert.deepEqual({ responseLength: nb.config.responseLength, mode: nb.config.mode }, { responseLength: 'longer', mode: null });
		assert.equal(nb.config.persona, readFile(ws.root, 'bundle/instructions.md'));
	});

	test('--mode is refused before the vendor is reached, and the persona stays applied', () => {
		const { ws, nlm } = created();
		const before = nlm.calls().length;
		const res = again(ws, nlm, '--mode', 'concise');
		assert.notEqual(res.code, 0, '--mode was accepted');
		assert.match(res.stderr, /unknown flag "--mode"/);
		assert.equal(nlm.calls().length, before, 'a refused run still called the vendor');
		const nb = Object.values(nlm.state().notebooks)[0];
		assert.equal(nb.config.persona, readFile(ws.root, 'bundle/instructions.md'));
		assert.equal(nb.config.mode, null);
	});

	test('--wait waits on each new source and reports it ready', () => {
		const ws = fixture();
		const nlm = fakeVendor(ws.root);
		const res = nlm.dt(ws, 'notebooklm', '--out', 'bundle', '--create', 'T', '--wait');
		assert.equal(res.code, 0, res.stderr);
		assert.equal(nlm.calls().filter((c) => c.includes('wait')).length, 3);
		assert.equal((res.stdout.match(/✔ ready/g) || []).length, 3);
	});

	test('--json reports the sync on stdout as one JSON document', () => {
		const ws = fixture();
		const nlm = fakeVendor(ws.root);
		const res = nlm.dt(ws, 'notebooklm', '--out', 'bundle', '--create', 'T', '--json');
		assert.equal(res.code, 0, res.stderr);
		const out = JSON.parse(res.stdout);
		assert.deepEqual({ added: out.sync.added, replaced: out.sync.replaced, unchanged: out.sync.unchanged, removed: out.sync.removed }, { added: 3, replaced: 0, unchanged: 0, removed: 0 });
		assert.equal(out.sync.notebook_id, Object.keys(nlm.state().notebooks)[0]);
	});
});

describe('the sync refuses before it touches a notebook', () => {
	test('a re-render without --notebook/--create never reaches the vendor, even with notebook.json present', () => {
		const { ws, nlm } = created();
		const before = nlm.calls().length;
		const res = nlm.dt(ws, 'notebooklm', '--out', 'bundle');
		assert.equal(res.code, 0, res.stderr);
		assert.equal(nlm.calls().length, before);
		assert.ok(!/notebook nb-/.test(res.stdout));
	});

	test('no vendor CLI on PATH: the install line, and the bundle is still written', () => {
		const ws = fixture();
		const nlm = fakeVendor(ws.root);
		fs.rmSync(path.join(nlm.dir, 'bin', 'notebooklm'));
		const res = nlm.dt(ws, 'notebooklm', '--out', 'bundle', '--create', 'T');
		assert.equal(res.code, 1);
		assert.match(res.stderr, /the `notebooklm` CLI is not on PATH — `pip install -U notebooklm-py`/);
		assert.ok(fs.existsSync(path.join(ws.root, 'bundle', 'manifest.json')), 'the local render does not depend on the vendor');
	});

	test('an expired login stops the sync at preflight — nothing is created', () => {
		const ws = fixture();
		const nlm = fakeVendor(ws.root);
		nlm.set('auth-fail', '1');
		const res = nlm.dt(ws, 'notebooklm', '--out', 'bundle', '--create', 'T');
		assert.equal(res.code, 1);
		assert.match(res.stderr, /auth check --test failed — run `notebooklm login`/);
		assert.ok(!nlm.calls().some((c) => c.includes('create')));
	});

	test('a vendor CLI older than 0.7.3 is refused', () => {
		const ws = fixture();
		const nlm = fakeVendor(ws.root);
		nlm.set('version', '0.7.2');
		const res = nlm.dt(ws, 'notebooklm', '--out', 'bundle', '--create', 'T');
		assert.equal(res.code, 1);
		assert.match(res.stderr, /notebooklm 0\.7\.2 is too old — this adapter needs >= 0\.7\.3/);
		assert.equal(nlm.calls().length, 1, 'only --version was asked');
	});

	test('--notebook with an id the vendor does not know fails with the vendor\'s message', () => {
		const ws = fixture();
		const nlm = fakeVendor(ws.root);
		const res = nlm.dt(ws, 'notebooklm', '--out', 'bundle', '--notebook', 'nb-nope');
		assert.equal(res.code, 1);
		assert.match(res.stderr, /notebooklm source list failed \(exit 2\): Error: no notebook nb-nope/);
	});
});
