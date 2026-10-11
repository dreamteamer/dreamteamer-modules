// Tier 2 — `dt notebooklm` against a real compiled workspace, through the real binary, with the
// package installed the way a workspace installs it.
//
// The load-bearing assertions are NEGATIVE: a value of a sensitive field appears in NO file the
// export writes, and a sensitive collection produces NO shard. Everything else — the hierarchy of
// the schema source, the shard titles, the budget refusal — is checked on the bytes on disk, never
// on the exporter's own report of them. The vendor CLI is never reached: without `--notebook` or
// `--create` the verb is a pure render, and one test proves it with a tripwire on PATH.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFile } from './fixture.mjs';
import { fixture, filesUnder, tripwire, EMAILS, PEOPLE, LEDGER, COMPANIES } from './helpers.mjs';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const bundleFiles =(root, out = 'bundle') => fs.readdirSync(path.join(root, out)).filter((f) => f.endsWith('.md')).sort();
const manifest = (root, out = 'bundle') => JSON.parse(readFile(root, `${out}/manifest.json`));

describe('dt notebooklm — the privacy line (canaries)', () => {
	// One distinctive token per thing that must never travel, then EVERY file the verb and the harness
	// write is scanned for it: record shards, the schema source, the persona, the manifest and
	// NOTEBOOKLM.md. A leak through any renderer — present or future — fails here.
	test('a sensitive collection, a sensitive field and a withheld reference reach no output file', () => {
		const SECRET = {
			...LEDGER,
			fields: { ...LEDGER.fields,
				account: { type: 'string', description: 'e.g. zq7-canary-example.', examples: ['zq7-canary-example'] },
				kind: { type: 'string', enum: ['zq7-canary-enum', 'other'] },
			},
		};
		const ws = fixture({
			collections: { companies: COMPANIES, people: { ...PEOPLE, fields: { ...PEOPLE.fields, paid_from: { type: 'ledger' } } }, ledger: SECRET },
			records: {
				companies: [{ name: 'Analytical Engines' }],
				ledger: [{ name: 'zq7-canary-ledger', amount: 98765.4321, account: 'zq7-canary-account', kind: 'zq7-canary-enum' }],
				people: [
					{ name: 'Ada', email: 'zq7-canary-mail@example.invalid', company: 'companies/analytical-engines', paid_from: 'ledger/zq7-canary-ledger', notes: 'Settled through [[ledger/zq7-canary-ledger]] and ledger/zq7-canary-ledger.' },
				],
			},
		});
		const res = ws.dt('notebooklm', '--out', 'bundle');
		assert.equal(res.code, 0, res.stderr);
		const written = [...filesUnder(path.join(ws.root, 'bundle')), ['NOTEBOOKLM.md', readFile(ws.root, 'NOTEBOOKLM.md')]];
		assert.deepEqual(written.map(([f]) => f).sort(), ['00-schema.md', 'NOTEBOOKLM.md', 'companies.md', 'instructions.md', 'manifest.json', 'people.md']);
		for (const [f, text] of written) {
			assert.ok(text, `${f} is empty`);
			for (const canary of ['zq7', '98765']) assert.ok(!text.includes(canary), `"${canary}" leaked into ${f}:\n${text.split('\n').filter((l) => l.includes(canary)).join('\n')}`);
		}
		// and the stdout report is an output too
		assert.ok(!/zq7|98765/.test(res.stdout), `the report leaked:\n${res.stdout}`);
		// the gaps are NAMED, not silent
		const people = readFile(ws.root, 'bundle/people.md');
		assert.match(people, /^- paid_from: ledger\/… \(withheld\)$/m);
		assert.match(readFile(ws.root, 'bundle/instructions.md'), /the whole collection ledger; people\.email/);
	});

	test('a sensitive field\'s values reach no file, and the omission is reported', () => {
		const ws = fixture();
		const res = ws.dt('notebooklm', '--out', 'bundle');
		assert.equal(res.code, 0, res.stderr);
		for (const [f, text] of filesUnder(path.join(ws.root, 'bundle'))) {
			for (const e of EMAILS) assert.ok(!text.includes(e), `${e} leaked into bundle/${f}`);
		}
		assert.deepEqual(manifest(ws.root).omitted.fields.people, ['email']);
		assert.ok(readFile(ws.root, 'bundle/people.md').includes('Ada'), 'non-sensitive values are exported');
		assert.match(res.stdout, /omitted fields: people\.email/);
	});

	test('a sensitive collection produces no shard, is listed as omitted, and is marked in the schema', () => {
		const ws = fixture();
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		assert.deepEqual(bundleFiles(ws.root), ['00-schema.md', 'companies.md', 'instructions.md', 'people.md']);
		assert.deepEqual(manifest(ws.root).omitted.collections, ['ledger']);
		const schema = readFile(ws.root, 'bundle/00-schema.md');
		assert.match(schema, /### collection: ledger[\s\S]*?sensitive — not exported/);
		assert.ok(!schema.includes('1234.5'));
		// the entry STOPS at the note: no field names, no authored examples, no enum values
		for (const leak of ['bank-main-0001', 'stipend', '- amount', '- kind']) assert.ok(!schema.includes(leak), `the schema published "${leak}" of a withheld collection`);
		assert.ok(schema.includes('Money that moved.'), 'the description survives — the reader has to know what the gap covers');
	});

	test('a reference into a withheld collection is redacted wherever it appears — field value and body prose', () => {
		const ws = fixture();
		assert.equal(ws.dt('add-field', 'people', '--name', 'paid_from', '--type', 'ledger').code, 0);
		assert.equal(ws.dt('set', 'people/ada', 'paid_from=ledger/rent').code, 0);
		assert.equal(ws.dt('set', 'people/grace', 'notes=Billed against [[ledger/rent]] last month.').code, 0);
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		const people = readFile(ws.root, 'bundle/people.md');
		assert.match(people, /^- paid_from: ledger\/… \(withheld\)$/m);
		assert.match(people, /\[\[ledger\/… \(withheld\)\]\]/);
		assert.ok(!people.includes('ledger/rent'), 'the id of a withheld record survived');
		assert.match(readFile(ws.root, 'bundle/companies.md'), /^## companies\/analytical-engines$/m, 'an exported collection\'s own refs are untouched');
	});

	test('system collections get no shard — they ARE the schema source', () => {
		const ws = fixture();
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		const files = bundleFiles(ws.root);
		for (const sys of ['collections', 'skills', 'modules', 'ui-views']) assert.ok(!files.includes(`${sys}.md`), `${sys} was exported as records`);
	});

	test('a binary collection is described in the schema and never shipped as records', () => {
		const ws = fixture({ collections: { companies: COMPANIES, blobs: { description: 'Pictures a view draws.', storage: { path: 'data/blobs', format: 'binary' }, fields: {} } }, records: { companies: [{ name: 'Acme' }] } });
		fs.mkdirSync(path.join(ws.root, 'data', 'blobs'), { recursive: true });
		fs.writeFileSync(path.join(ws.root, 'data', 'blobs', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		const res = ws.dt('notebooklm', '--out', 'bundle');
		assert.equal(res.code, 0, res.stderr);
		assert.deepEqual(bundleFiles(ws.root), ['00-schema.md', 'companies.md', 'instructions.md']);
		assert.match(readFile(ws.root, 'bundle/00-schema.md'), /### collection: blobs[\s\S]*?binary records — not exported\./);
	});
});

describe('dt notebooklm — the render', () => {
	test('a render reaches no vendor CLI and no network — the notebooklm on PATH is a tripwire', () => {
		const ws = fixture();
		const wire = tripwire(ws.root);
		const res = wire.dt(ws, 'notebooklm', '--out', 'bundle');
		assert.equal(res.code, 0, res.stderr);
		assert.equal(wire.tripped(), null, 'the vendor CLI was spawned by a pure render');
	});

	test('the default out dir is the gitignored cache', () => {
		const ws = fixture();
		const res = ws.dt('notebooklm');
		assert.equal(res.code, 0, res.stderr);
		assert.ok(fs.existsSync(path.join(ws.root, '.cache/dreamteamer/notebooklm/manifest.json')));
		assert.equal(ws.git(['status', '--porcelain', '--', '.cache']), '', 'the bundle must not show up as a change to commit');
	});

	test('the schema source renders workspace → module → collection → field, by heading level', () => {
		const ws = fixture();
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		const schema = readFile(ws.root, 'bundle/00-schema.md');
		const iModule = schema.indexOf('## module: ');
		const iPeople = schema.indexOf('### collection: people');
		const iField = schema.indexOf('- name (string, required)', iPeople);
		assert.ok(iModule > -1 && iPeople > iModule && iField > iPeople, `order was module@${iModule} people@${iPeople} field@${iField}`);
		assert.match(schema, /- email \(string\) — sensitive, not exported/);
		assert.match(schema, /- company \(reference → companies\)/);
		assert.match(schema, /- peers \(reference → people, many\)/, 'a many-reference names its target');
		assert.match(schema, /- status \(enum: draft \| verified, default draft\)/);
		assert.match(schema, /system collections \(not exported as records\): .*collections.*skills/);
	});

	test('a record renders its id, its kept fields, a labelled reference and its body with headings demoted', () => {
		const ws = fixture();
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		const people = readFile(ws.root, 'bundle/people.md');
		assert.match(people, /^## people\/ada$/m);
		assert.match(people, /^- company: companies\/analytical-engines \(Analytical Engines\)$/m);
		assert.match(people, /^### Ada$/m, 'a body H1 becomes H3 so record sections stay the H2 boundary');
		assert.match(people, /^- peers: people\/ada \(Ada\)$/m, 'each element of a many-reference is labelled');
		assert.ok(!people.includes('- email:'));
	});

	test('--collections narrows the render; an unknown collection is refused', () => {
		const ws = fixture();
		assert.equal(ws.dt('notebooklm', '--out', 'bundle', '--collections', 'companies').code, 0);
		assert.deepEqual(bundleFiles(ws.root), ['00-schema.md', 'companies.md', 'instructions.md']);
		const bad = ws.dt('notebooklm', '--out', 'bundle', '--collections', 'compnies');
		assert.equal(bad.code, 1);
		assert.match(bad.stderr, /unknown collection "compnies" in --collections/);
	});

	test('two renders of unchanged records hash identically — no timestamp or version in a source', () => {
		const ws = fixture();
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		const first = manifest(ws.root).sources.map((s) => [s.title, s.sha256]);
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		assert.deepEqual(manifest(ws.root).sources.map((s) => [s.title, s.sha256]), first, 'a sync would re-upload every source otherwise');
	});

	test('a stale shard from a previous export is removed from the bundle, and notebook.json is kept', () => {
		const ws = fixture();
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		fs.writeFileSync(path.join(ws.root, 'bundle', 'notebook.json'), '{"notebook_id":"kept"}\n');
		assert.equal(ws.dt('notebooklm', '--out', 'bundle', '--collections', 'companies').code, 0);
		assert.ok(!bundleFiles(ws.root).includes('people.md'));
		assert.equal(readFile(ws.root, 'bundle/notebook.json'), '{"notebook_id":"kept"}\n', 'sync state survives a re-render');
	});
});

describe('dt notebooklm — sharding and the budget', () => {
	test('--max-words shards a collection into [N/M] sources, every id exactly once, no file over the cap', () => {
		const ws = fixture();
		const res = ws.dt('notebooklm', '--out', 'bundle', '--max-words', '55');
		assert.equal(res.code, 0, res.stderr);
		const shards = manifest(ws.root).sources.filter((s) => s.collection === 'people');
		assert.ok(shards.length >= 2, `expected people to shard, got ${shards.length}`);
		assert.deepEqual(shards.map((s) => s.title), shards.map((_, i) => `dt · people [${i + 1}/${shards.length}]`));
		assert.deepEqual(shards.map((s) => s.file), shards.map((_, i) => `people--${String(i + 1).padStart(2, '0')}.md`));
		assert.deepEqual(shards.flatMap((s) => s.records).sort(), ['ada', 'grace', 'linus']);
		for (const s of shards) {
			const text = readFile(ws.root, `bundle/${s.file}`);
			assert.ok(text.trim().split(/\s+/).length <= 55, `${s.file} is over the cap`);
		}
	});

	test('more sources than the plan allows is a refusal that names the count, the plan and the remedies', () => {
		const ws = fixture();
		const res = ws.dt('notebooklm', '--out', 'bundle', '--plan', '2');
		assert.equal(res.code, 1);
		assert.match(res.stderr, /3 sources.*plan 2 allows 2/s);
		assert.match(res.stderr, /--collections/);
		assert.match(res.stderr, /--plan/);
		assert.ok(!fs.existsSync(path.join(ws.root, 'bundle', 'manifest.json')), 'a refused export writes no bundle');
	});

	test('an unknown plan and a non-numeric --max-words are refusals', () => {
		const ws = fixture();
		const plan = ws.dt('notebooklm', '--out', 'bundle', '--plan', 'enterprise');
		assert.equal(plan.code, 1);
		assert.match(plan.stderr, /unknown plan "enterprise"/);
		const words = ws.dt('notebooklm', '--out', 'bundle', '--max-words', 'lots');
		assert.equal(words.code, 1);
		assert.match(words.stderr, /--max-words takes a positive number/);
	});

	test('the manifest carries the budget, and --json prints it — whole, on stdout', () => {
		const ws = fixture();
		const res = ws.dt('notebooklm', '--out', 'bundle', '--plan', 'pro', '--json');
		assert.equal(res.code, 0, res.stderr);
		const m = JSON.parse(res.stdout);
		assert.deepEqual(m.budget, { plan: 'pro', limit: 300, used: 3 });
		assert.equal(m.out, 'bundle');
		assert.equal(m.sync, null);
	});
});

describe('dt notebooklm — the persona', () => {
	test('the default template renders the workspace name and the schema brief into instructions.md', () => {
		const ws = fixture();
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		const text = readFile(ws.root, 'bundle/instructions.md');
		assert.ok(text.includes(ws.pkg.name), 'workspace name');
		assert.match(text, /people/);
		assert.match(text, /ledger/, 'the omitted collection is named so the assistant knows what it cannot answer');
		assert.ok(!text.includes('{{'), 'no placeholder survives');
	});

	test('--instructions takes a template file; an unknown placeholder and an oversize render are refusals', () => {
		const ws = fixture();
		fs.writeFileSync(path.join(ws.root, 'tpl.md'), 'Brain of {{workspace}}. Sources: {{sources}}');
		assert.equal(ws.dt('notebooklm', '--out', 'bundle', '--instructions', 'tpl.md').code, 0);
		assert.match(readFile(ws.root, 'bundle/instructions.md'), /^Brain of .*\. Sources: dt · schema, dt · companies, dt · people$/);
		fs.writeFileSync(path.join(ws.root, 'bad.md'), 'Brain of {{workspce}}');
		const bad = ws.dt('notebooklm', '--out', 'bundle', '--instructions', 'bad.md');
		assert.equal(bad.code, 1);
		assert.match(bad.stderr, /unknown placeholder "workspce"/);
		fs.writeFileSync(path.join(ws.root, 'big.md'), 'x'.repeat(10001));
		const big = ws.dt('notebooklm', '--out', 'bundle', '--instructions', 'big.md');
		assert.equal(big.code, 1);
		assert.match(big.stderr, /10001 characters/);
	});
});

describe('dt notebooklm — the verb', () => {
	test('an unknown flag and a stray positional are refused, and nothing is written', () => {
		const ws = fixture();
		const flag = ws.dt('notebooklm', '--out', 'bundle', '--bogus');
		assert.equal(flag.code, 1);
		assert.match(flag.stderr, /unknown flag "--bogus" on `dt notebooklm`/);
		assert.match(flag.stderr, /--max-words/, 'the refusal lists the known flags');
		const word = ws.dt('notebooklm', 'notebooklm', '--out', 'bundle');
		assert.equal(word.code, 1);
		assert.match(word.stderr, /takes no positional argument \(got "notebooklm"\)/);
		assert.ok(!fs.existsSync(path.join(ws.root, 'bundle')));
	});

	test('dt help lists the verb under the installed package', () => {
		const ws = fixture();
		const res = ws.dt('help');
		assert.equal(res.code, 0);
		const ext = res.stdout.split('installed extensions:')[1] ?? '';
		assert.match(ext, new RegExp(`^@dreamteamer/notebooklm@${VERSION.replaceAll('.', '\\.')}:`, 'm'));
		assert.match(ext, /notebooklm \[--out <dir>\] \[--plan standard\|plus\|pro\|ultra\|<n>\]/);
	});

	test('the package\'s skill compiles into the harness', () => {
		const ws = fixture();
		const skill = readFile(ws.root, '.claude/skills/exporting-to-notebooklm/SKILL.md');
		assert.ok(skill, 'the skill was not compiled into .claude/skills');
		assert.match(skill, /^name: exporting-to-notebooklm$/m);
		assert.match(skill, /`dt notebooklm`/);
	});
});

describe('the marks are written by the schema verbs, and the export follows them', () => {
	test('add-field --sensitive marks the field sensitive, set-field --sensitive false clears it, and the export follows', () => {
		const ws = fixture();
		let res = ws.dt('add-field', 'people', '--name', 'phone', '--type', 'string', '--sensitive');
		assert.equal(res.code, 0, res.stderr);
		assert.match(readFile(ws.root, '.dreamteamer/collections/people.collection.yaml'), /phone:[\s\S]*?sensitive: true/);
		assert.equal(ws.dt('set', 'people/ada', 'phone=+000-0000').code, 0);
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		assert.ok(!readFile(ws.root, 'bundle/people.md').includes('+000-0000'));
		assert.deepEqual(manifest(ws.root).omitted.fields.people, ['email', 'phone']);
		res = ws.dt('set-field', 'people', '--name', 'phone', '--sensitive', 'false');
		assert.equal(res.code, 0, res.stderr);
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		assert.ok(readFile(ws.root, 'bundle/people.md').includes('+000-0000'), 'a cleared mark travels again');
		assert.deepEqual(manifest(ws.root).omitted.fields.people, ['email']);
	});

	test('set collections/<c> sensitive=true lands on the descriptor and the next export omits the collection', () => {
		const ws = fixture();
		const res = ws.dt('set', 'collections/people', 'sensitive=true');
		assert.equal(res.code, 0, res.stderr);
		assert.equal(ws.dt('notebooklm', '--out', 'bundle').code, 0);
		assert.deepEqual(manifest(ws.root).omitted.collections, ['ledger', 'people']);
		assert.ok(!bundleFiles(ws.root).includes('people.md'));
	});
});
