// THE PERSONA VERB — the one thing in this CLI that writes over the network, pinned where a fixture
// can pin it: how the persona is cut out of NOTEBOOKLM.md, when the verb refuses, and what --print
// emits. The live `configure` call is smoked by hand against a throwaway notebook and quoted.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { section, personaFrom, PERSONA_MAX } from '../bin/notebook.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const CLI = path.join(ROOT, 'bin', 'extensions.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/** A NOTEBOOKLM.md the way compile writes it: hand-written additions ABOVE the managed block, the
 *  generated custom instructions and limits inside it. */
const FIXTURE = `# NOTEBOOKLM.md

Prose about the file. Never part of the persona.

## custom instructions — this workspace's additions

⚠ Hand-written, and part of the applied persona. This line is a warning and is filtered.
\`bin/apply-notebook-persona.mjs\` is the old pointer and is filtered.
- Dates are ISO. Amounts are in the currency the row names.
- Answer in the language the question was asked in.

<!-- dreamteamer:begin (generated — do not edit inside this block) -->
NOTEBOOKLM — preamble that must NOT be captured.

## settings

| setting | value |
|---|---|

## custom instructions

You are the reference desk for this workspace. Answer only from the sources.

## limits

| plan | sources |
<!-- dreamteamer:end -->
`;

/** A consumer folder the CLI accepts as a workspace, with or without a NOTEBOOKLM.md. */
function consumer(md) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-nb-')); made.push(ws);
	fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'consumer', private: true, dreamteamer: {} }));
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	if (md !== undefined) fs.writeFileSync(path.join(ws, 'NOTEBOOKLM.md'), md);
	return ws;
}
const cli = (ws, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: ws, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('section', () => {
	test('stops at the next ## heading', () => {
		assert.equal(section(FIXTURE, 'custom instructions'), 'You are the reference desk for this workspace. Answer only from the sources.');
	});
	test('stops at the managed-block BEGIN marker, so the additions never swallow the block preamble', () => {
		const s = section(FIXTURE, 'custom instructions — this workspace\'s additions');
		assert.ok(s.includes('Dates are ISO'));
		assert.ok(!s.includes('dreamteamer:begin'), s);
		assert.ok(!s.includes('preamble that must NOT'), s);
	});
	test('an absent heading is the empty string', () => {
		assert.equal(section(FIXTURE, 'no such heading'), '');
	});
});

describe('personaFrom', () => {
	test('generated first, additions after, warnings and the old pointer dropped', () => {
		const p = personaFrom(FIXTURE);
		assert.ok(p.startsWith('You are the reference desk'), p);
		assert.ok(p.indexOf('Dates are ISO') > p.indexOf('reference desk'));
		assert.ok(!p.includes('⚠'), p);
		assert.ok(!p.includes('apply-notebook-persona'), p);
	});
	test('any "## custom instructions — … additions" heading counts, whatever the possessive', () => {
		const md = FIXTURE.replace("this workspace's additions", "this team's additions");
		assert.ok(personaFrom(md).includes('Dates are ISO'));
	});
	test('a file with no generated section throws, naming compile', () => {
		assert.throws(() => personaFrom('# NOTEBOOKLM.md\n\nnothing generated here\n'), /compile/);
	});
});

describe('npx dt-notebook persona', () => {
	test('--print emits exactly the persona and exits 0, touching no network', () => {
		const r = cli(consumer(FIXTURE), 'notebook', 'persona', '--print');
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout.trimEnd(), personaFrom(FIXTURE));
	});
	test('refuses when NOTEBOOKLM.md is absent, naming the harness to declare', () => {
		const r = cli(consumer(undefined), 'notebook', 'persona', '--print');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /dreamteamer\.harnesses/);
		assert.match(r.stderr, /notebooklm/);
	});
	test('refuses a persona over the cap, naming the count', () => {
		const big = FIXTURE.replace('Answer only from the sources.', 'x'.repeat(PERSONA_MAX + 1));
		const r = cli(consumer(big), 'notebook', 'persona', '--print');
		assert.equal(r.status, 1);
		assert.match(r.stderr, new RegExp(String(PERSONA_MAX)));
	});
	test('without --print and without an id it prints usage and exits 2', () => {
		const r = cli(consumer(FIXTURE), 'notebook', 'persona');
		assert.equal(r.status, 2);
		assert.match(r.stderr, /usage/i);
	});
	test('an unknown sub-verb exits 2', () => {
		const r = cli(consumer(FIXTURE), 'notebook', 'bogus');
		assert.equal(r.status, 2);
	});
	test('the CLI\'s unknown-verb message names the notebook verb', () => {
		const r = cli(consumer(FIXTURE), 'bogus');
		assert.equal(r.status, 2);
		assert.match(r.stderr, /notebook/);
	});
});
