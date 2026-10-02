// Shared fixtures for this package's tier-2 tests: a real workspace with this module
// in it, synthetic collections, and a FAKE `notebooklm` vendor CLI. The real vendor CLI is never
// reached: every spawn that could find one runs with a PATH whose only `notebooklm` is the fake (or a
// tripwire), and the fixture's dt spawns carry a hard timeout.
import fs from 'node:fs';
import path from 'node:path';
import { workspace, writeCollection, dtEnv, api } from './fixture.mjs';

export const COMPANIES = {
	description: 'An organisation.',
	storage: { suffix: 'company' },
	ids: { from: '{{ name | slug }}' },
	fields: { name: { type: 'string', required: true } },
};
export const PEOPLE = {
	description: 'A person we deal with.',
	use_when: 'someone is named',
	storage: { suffix: 'person' },
	ids: { from: '{{ name | slug }}' },
	fields: {
		name: { type: 'string', required: true, description: 'Full name.' },
		email: { type: 'string', sensitive: true, description: 'Where to write.' },
		company: { type: 'companies' },
		peers: { type: 'people', many: true },
		status: { type: 'string', enum: ['draft', 'verified'], default: 'draft' },
		notes: { type: 'markdown', body: true },
	},
};
export const LEDGER = {
	description: 'Money that moved.',
	sensitive: true,
	storage: { suffix: 'entry' },
	ids: { from: '{{ name | slug }}' },
	fields: {
		name: { type: 'string', required: true },
		amount: { type: 'number' },
		// an authored example and an enum, both of which the schema source used to publish for a
		// collection whose records it correctly withheld
		account: { type: 'string', description: 'Which account, e.g. bank-main-0001.', examples: ['bank-main-0001'] },
		kind: { type: 'string', enum: ['salary', 'stipend', 'medical'] },
	},
};

export const EMAILS = ['ada@example.invalid', 'grace@example.invalid', 'linus@example.invalid'];

export const DEFAULT_RECORDS = {
	companies: [{ name: 'Analytical Engines' }, { name: 'Cobol Corp' }],
	people: [
		{ name: 'Ada', email: EMAILS[0], company: 'companies/analytical-engines', notes: '# Ada\n\nWrote the first program.' },
		{ name: 'Grace', email: EMAILS[1], company: 'companies/cobol-corp', peers: ['people/ada'], notes: 'Coined the bug.' },
		{ name: 'Linus', email: EMAILS[2], notes: 'Kernel.' },
	],
	ledger: [{ name: 'rent', amount: 1234.5 }],
};

/**
 * A compiled workspace with the package installed, the given collections in the workspace module and
 * the given records added through the engine's Store.
 */
export function fixture({ collections = { companies: COMPANIES, people: PEOPLE, ledger: LEDGER }, records = DEFAULT_RECORDS, harnesses = ['claude-code', 'notebooklm'], module = true } = {}) {
	const ws = workspace({ module, pkg: { harnesses }, compile: false });
	for (const [name, d] of Object.entries(collections)) writeCollection(ws.root, name, d);
	ws.compileOut = ws.dt('compile');
	if (ws.compileOut.code !== 0) throw new Error(`fixture compile failed:\n${ws.compileOut.stdout}\n${ws.compileOut.stderr}`);
	const store = new api.Store({ root: ws.root, pkg: ws.pkg });
	for (const [collection, rows] of Object.entries(records)) for (const fields of rows) store.add(collection, { ...fields });
	return ws;
}

/** Every file under `dir`, as `[relative path, text]`. */
export function filesUnder(dir) {
	const out = [];
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else out.push([path.relative(dir, p), fs.readFileSync(p, 'utf8')]);
		}
	};
	walk(dir);
	return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// ---- the fake vendor CLI ------------------------------------------------------------------------

/** Directories the stub PATH may add beyond the fake: whatever `git` needs, and nothing that holds a
 *  real `notebooklm`. The engine spawns git; nothing else here needs PATH. */
const SYSTEM_DIRS = ['/usr/bin', '/bin'].filter((d) => fs.existsSync(d));
for (const d of SYSTEM_DIRS) {
	if (fs.existsSync(path.join(d, 'notebooklm'))) throw new Error(`${d}/notebooklm exists — the stub PATH would reach a real vendor CLI; refusing to run`);
}

/**
 * A fake `notebooklm` on a private PATH. It keeps the notebook in `state.json` (sources with ids and
 * titles, the last persona), logs every argv to `calls.jsonl`, and imitates the vendor's three measured
 * traps: `source add --title` keeps the FILE NAME rather than the title, `create` answers with
 * `{ notebook: { id } }`, and `configure --mode` drops the persona and response length sent with it. Knobs are files: `version` (the version it reports), `auth-fail`.
 */
export function fakeVendor(root) {
	const dir = fs.mkdtempSync(path.join(root, '.fake-nlm-'));
	const bin = path.join(dir, 'bin');
	fs.mkdirSync(bin);
	const script = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const DIR = ${JSON.stringify(dir)};
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(DIR, 'calls.jsonl'), JSON.stringify(argv) + '\\n');
const stateFile = path.join(DIR, 'state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { next: 1, notebooks: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const out = (v) => { process.stdout.write(JSON.stringify(v) + '\\n'); };
const opt = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : undefined; };
const args = argv.filter((a) => a !== '--quiet' && a !== '--json');
if (args[0] === '--version') { const v = fs.existsSync(path.join(DIR, 'version')) ? fs.readFileSync(path.join(DIR, 'version'), 'utf8').trim() : '0.7.3'; process.stdout.write('NotebookLM CLI, version ' + v + '\\n'); process.exit(0); }
if (args[0] === 'auth') { if (fs.existsSync(path.join(DIR, 'auth-fail'))) { process.stderr.write('Error: session expired\\n'); process.exit(1); } out({ ok: true }); process.exit(0); }
if (args[0] === 'create') { const id = 'nb-' + state.next++; state.notebooks[id] = { title: args[1], sources: [], config: null }; save(); out({ notebook: { id, title: args[1] } }); process.exit(0); }
const nb = state.notebooks[opt('-n')];
if (!nb) { process.stderr.write('Error: no notebook ' + opt('-n') + '\\n'); process.exit(2); }
if (args[0] === 'configure') { const mode = opt('--mode') ?? null; nb.config = mode ? { persona: null, responseLength: null, mode } : { persona: opt('--persona') ?? null, responseLength: opt('--response-length') ?? null, mode: null }; save(); out({ configured: true }); process.exit(0); }
if (args[0] === 'source') {
	const sub = args[1];
	if (sub === 'list') { out({ sources: nb.sources.map((s) => ({ id: s.id, title: s.title, type: 'markdown' })) }); process.exit(0); }
	if (sub === 'add') { const file = args[2]; const id = 'src-' + state.next++; nb.sources.push({ id, title: path.basename(file), text: fs.readFileSync(file, 'utf8') }); save(); out({ source: { id, title: opt('--title') } }); process.exit(0); }
	if (sub === 'rename') { const s = nb.sources.find((x) => x.id === args[2]); if (!s) process.exit(3); s.title = args[3]; save(); out({ source: { id: s.id, title: s.title } }); process.exit(0); }
	if (sub === 'delete') { const before = nb.sources.length; nb.sources = nb.sources.filter((x) => x.id !== args[2]); if (nb.sources.length === before) process.exit(3); save(); out({ deleted: true }); process.exit(0); }
	if (sub === 'wait') { process.exit(nb.sources.some((x) => x.id === args[2]) ? 0 : 1); }
}
process.stderr.write('fake notebooklm: unhandled ' + JSON.stringify(argv) + '\\n');
process.exit(64);
`;
	fs.writeFileSync(path.join(bin, 'notebooklm'), script, { mode: 0o755 });
	const env = { PATH: [bin, ...SYSTEM_DIRS].join(path.delimiter) };
	return {
		dir,
		env,
		/** `dt …` in `ws` with the fake as the only reachable vendor CLI */
		dt: (ws, ...args) => dtEnv(ws.root, env, ...args),
		calls: () => (fs.existsSync(path.join(dir, 'calls.jsonl')) ? fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
		state: () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')),
		/** a source added by hand in the notebook UI — the sync must never touch it */
		addForeign: (notebookId, title) => {
			const file = path.join(dir, 'state.json');
			const s = JSON.parse(fs.readFileSync(file, 'utf8'));
			s.notebooks[notebookId].sources.push({ id: `hand-${s.next++}`, title, text: 'a paper' });
			fs.writeFileSync(file, JSON.stringify(s, null, 2));
		},
		set: (knob, value) => fs.writeFileSync(path.join(dir, knob), value),
	};
}

/** A PATH whose `notebooklm` fails loudly and records that it was called — for proving a render
 *  never reaches the vendor. */
export function tripwire(root) {
	const fake = fakeVendor(root);
	const log = path.join(fake.dir, 'tripped');
	fs.writeFileSync(path.join(fake.dir, 'bin', 'notebooklm'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\necho tripwire >&2\nexit 99\n`, { mode: 0o755 });
	return { ...fake, tripped: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : null) };
}
