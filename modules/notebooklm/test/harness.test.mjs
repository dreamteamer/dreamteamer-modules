// Tier 2 — the `notebooklm` harness. NOTEBOOKLM.md is a USER-OWNED root file carrying a managed
// block, exactly like CLAUDE.md: your own notes above and below must survive every compile,
// and switching the harness off — or uninstalling this package — must remove the block without
// deleting his file.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFile } from './fixture.mjs';
import { fixture, PEOPLE, LEDGER } from './helpers.mjs';

const PEOPLE_MARKED = { ...PEOPLE, schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, email: { type: 'string', 'x-sensitive': true } } } };
const harness = (harnesses = ['claude-code', 'notebooklm'], extra = {}) =>
	fixture({ harnesses, collections: { people: PEOPLE_MARKED, ledger: LEDGER }, records: {}, ...extra });

const setPkg = (ws, edit) => {
	const file = path.join(ws.root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
	edit(pkg);
	fs.writeFileSync(file, JSON.stringify(pkg, null, '\t') + '\n');
};

describe('NOTEBOOKLM.md is written when the harness is on', () => {
	test('⚠ it warns that --mode DISCARDS the persona, and never advises setting one', () => {
		const md = readFile(harness().root, 'NOTEBOOKLM.md');
		assert.match(md, /chat mode \| \*\*do not set one\*\*/);
		assert.match(md, /passing `--mode` with a persona silently discards the persona/);
		assert.match(md, /a bare `configure`.*CLEARS them/s, 'the no-read-only-inspection trap must be stated');
		assert.ok(!/\| chat mode \| \*\*default\*\*/.test(md), 'advising --mode default is the defect');
	});

	test('it carries the settings, the persona and the limits, inside one managed block', () => {
		const ws = harness();
		const md = readFile(ws.root, 'NOTEBOOKLM.md');
		assert.ok(md, 'NOTEBOOKLM.md was not written');
		assert.equal((md.match(/<!-- dreamteamer:begin/g) || []).length, 1);
		assert.match(md, /## settings/);
		assert.match(md, /response length \| \*\*longer\*\*/);
		assert.match(md, /## custom instructions/);
		assert.match(md, /## limits/);
		assert.match(md, /\| pro \| 300 \| 500 \|/, 'the plan table must carry the source ceilings');
		assert.match(ws.compileOut.stdout + ws.compileOut.stderr, /notebooklm → NOTEBOOKLM\.md block/, 'compile reports the harness');
	});

	test('the persona NAMES what was withheld, so the notebook can say "withheld" instead of "I don\'t know"', () => {
		const md = readFile(harness().root, 'NOTEBOOKLM.md');
		assert.match(md, /the whole collection ledger/);
		assert.match(md, /people\.email/);
		assert.ok(!md.includes('Nothing has been withheld'), 'it claimed nothing was withheld');
	});

	test('a workspace with no marks says so rather than printing an empty list', () => {
		const ws = fixture({ collections: { people: { ...PEOPLE, schema: { type: 'object', properties: { name: { type: 'string' } } } } }, records: {} });
		assert.match(readFile(ws.root, 'NOTEBOOKLM.md'), /Nothing has been withheld from this export\./);
	});

	test('the exported collection count is stated, because it decides which plan is needed', () => {
		assert.match(readFile(harness().root, 'NOTEBOOKLM.md'), /exports \*\*\d+ collections\*\* \(1 withheld\)/);
	});

	// ⚠ TWO RENDERERS, ONE NUMBER — and nothing related them, so they once diverged silently: the
	// harness filtered on the presentational `system` partition while the export filters on storage,
	// and `repos` (machinery whose records are real files) is in one and not the other. So the
	// assertion is made ACROSS the two, from their own output, rather than re-deriving the number here.
	test('the count and the brief describe what the export actually ships', () => {
		const ws = harness();
		assert.equal(ws.dt('add', 'repos', '--name', 'acme', '--url', 'git@example.invalid:acme/acme.git').code, 0);
		const out = path.join(ws.root, '.notebook-out');
		const res = ws.dt('notebooklm', '--out', out);
		assert.equal(res.code, 0, `the export must run — stderr:\n${res.stderr}`);

		const schema = fs.readFileSync(path.join(out, '00-schema.md'), 'utf8');
		const counted = /· (\d+) collections \((\d+) exported, (\d+) omitted as sensitive\)/.exec(schema);
		assert.ok(counted, `the schema source must state its counts — got:\n${schema.split('\n')[4]}`);
		const [, , exported, omitted] = counted;

		const md = readFile(ws.root, 'NOTEBOOKLM.md');
		const stated = /exports \*\*(\d+) collections\*\*(?: \((\d+) withheld\))?/.exec(md);
		assert.ok(stated, `NOTEBOOKLM.md must state a count — got:\n${md}`);
		assert.equal(stated[1], exported, 'the plan-slot count must be the number of sources the export ships');
		assert.equal(stated[2] ?? '0', omitted, 'and the withheld count must be the export\'s own');

		const brief = md.split('What this workspace keeps, by module:')[1].split('\n\n')[0];
		for (const [, name] of schema.matchAll(/^### collection: (\S+)$/gm)) {
			assert.match(brief, new RegExp(`\\b${name}\\b`), `the brief must name ${name}, which the export ships — got:\n${brief}`);
		}
		assert.match(brief, /\brepos\b/, 'data-backed machinery is exported, so it belongs in the brief');
	});

	test('the measured CSV ceiling is carried, and it names no workspace', () => {
		const md = readFile(harness().root, 'NOTEBOOKLM.md');
		assert.match(md, /805,081 bytes indexed/);
		assert.match(md, /a large private workspace/, 'the measurement keeps its numbers and loses the source');
	});

	test('it follows the schema: a new sensitive collection changes the block on the next compile', () => {
		const ws = harness();
		assert.equal(ws.dt('set', 'collections/people', 'sensitive=true').code, 0);
		const md = readFile(ws.root, 'NOTEBOOKLM.md');
		assert.match(md, /the whole collection ledger; the whole collection people/);
	});
});

describe('it is the user\'s file, with a managed block inside', () => {
	test('notes above and below the block survive a recompile', () => {
		const ws = harness();
		const file = path.join(ws.root, 'NOTEBOOKLM.md');
		fs.writeFileSync(file, `# my notes\n\nkeep me\n\n${fs.readFileSync(file, 'utf8')}\n\ntrailing note\n`);
		assert.equal(ws.dt('compile').code, 0);
		const after = fs.readFileSync(file, 'utf8');
		assert.match(after, /^# my notes$/m);
		assert.match(after, /^keep me$/m);
		assert.match(after, /^trailing note$/m);
		assert.equal((after.match(/dreamteamer:begin/g) || []).length, 1, 'the block was duplicated');
	});

	test('turning the harness OFF removes the block and keeps the file', () => {
		const ws = harness();
		const file = path.join(ws.root, 'NOTEBOOKLM.md');
		fs.writeFileSync(file, `# my notes\n\n${fs.readFileSync(file, 'utf8')}`);
		setPkg(ws, (pkg) => { pkg.dreamteamer.harnesses = ['claude-code']; });
		assert.equal(ws.dt('compile').code, 0);
		const after = fs.readFileSync(file, 'utf8');
		assert.match(after, /^# my notes$/m, 'the user\'s own file was deleted');
		assert.ok(!after.includes('dreamteamer:begin'), 'the block should be gone');
	});

	test('removing the module removes the block on the next compile, and the user\'s own text survives', () => {
		const ws = harness();
		const file = path.join(ws.root, 'NOTEBOOKLM.md');
		fs.writeFileSync(file, `# my notebook notes\n\nthe notebook id lives in the team wiki\n\n${fs.readFileSync(file, 'utf8')}\n\nafter the block\n`);
		// what deleting the module leaves — the harness still NAMED in dreamteamer.harnesses, because
		// nobody edits that first
		fs.rmSync(path.join(ws.root, 'modules', 'notebooklm'), { recursive: true });
		const res = ws.dt('compile');
		assert.equal(res.code, 0, `compile must survive the uninstall:\n${res.stdout}\n${res.stderr}`);
		const after = fs.readFileSync(file, 'utf8');
		assert.ok(!after.includes('dreamteamer:begin'), 'the block of an uninstalled package survived');
		assert.ok(!after.includes('NOTEBOOKLM — the configuration'), 'block content survived');
		assert.match(after, /^# my notebook notes$/m);
		assert.match(after, /^the notebook id lives in the team wiki$/m);
		assert.match(after, /^after the block$/m);
		assert.match(res.stderr, /unknown harness "notebooklm"/, 'a harness named but no longer installed is warned about, not silently kept');
		// and the verb and the skill went with it
		assert.equal(readFile(ws.root, '.claude/skills/exporting-to-notebooklm/SKILL.md'), null, 'the package skill outlived the package');
		const verb = ws.dt('notebooklm');
		assert.notEqual(verb.code, 0);
		// engine 0.33: a verb an extension answers, typed without its package, prints the install line
		assert.match(verb.stderr, /`dt notebooklm` comes from an extension this workspace does not have/, 'the verb without its module names the package that answers it');
		assert.match(verb.stderr, /npm i @dreamteamer\/notebooklm\n/);
	});

	test('removing the module whose block was the whole file deletes the file it created', () => {
		const ws = harness();
		fs.rmSync(path.join(ws.root, 'modules', 'notebooklm'), { recursive: true });
		assert.equal(ws.dt('compile').code, 0);
		assert.equal(readFile(ws.root, 'NOTEBOOKLM.md'), null);
	});

	test('no NOTEBOOKLM.md at all when the harness was never on', () => {
		const ws = harness(['claude-code']);
		assert.equal(readFile(ws.root, 'NOTEBOOKLM.md'), null);
	});

	test('an unknown harness still warns, and notebooklm is not it while the package is installed', () => {
		const ws = harness(['notebooklm', 'bogus-harness']);
		const out = ws.compileOut.stdout + ws.compileOut.stderr;
		assert.match(out, /unknown harness "bogus-harness"/);
		assert.ok(!/unknown harness "notebooklm"/.test(out), 'notebooklm must be recognised');
		assert.ok(readFile(ws.root, 'NOTEBOOKLM.md'));
	});
});
