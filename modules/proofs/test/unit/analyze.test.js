// Tier 1 — `analyze(draft)`: the compile-time half, as data in and data out. The engine hands a
// frozen draft and prints what comes back; nothing here may print, write or read the disk.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../helpers.mjs';
import { analyze } from '../../src/analyze.js';

const entry = (text, source) => ({ sources: [{ path: source, hash: 'sha256:x' }], bytes: Buffer.from(text) });
const NOTES = { name: 'notes', compiled: { defaults: { storage: { path: 'data/notes' } }, runtime: false, fields: { title: { type: 'string' } } } };

function draft({ proofs = {}, extra = {}, previousManifest = null, declaredVars = [] } = {}) {
	const entries = new Map([
		['skills/using-dreamteamer/SKILL.md', entry('---\nname: using-dreamteamer\n---\n', 'node_modules/dreamteamer/skills/using-dreamteamer/SKILL.md')],
		['commands/hello.command.md', entry('---\nname: hello\n---\n', 'modules/default/commands/hello.command.md')],
		...Object.entries(extra),
	]);
	for (const [id, p] of Object.entries(proofs)) entries.set(`proofs/${id}.proof.yaml`, entry(api.dumpYaml(p), `modules/default/proofs/${id}.proof.yaml`));
	return Object.freeze({
		entries,
		descriptors: new Map([['notes', NOTES]]),
		modules: [{ id: 'default', name: 'default', root: 'modules/default', channel: 'inline' }, { id: 'dreamteamer', name: 'dreamteamer', root: 'node_modules/dreamteamer', channel: 'npm' }],
		declaredVars,
		declaredEnv: [],
		previousManifest,
		parse: (rt) => api.loadYaml(entries.get(rt).bytes.toString('utf8')),
	});
}

const gate = (about) => ({ name: 'g', about, kind: 'gate', steps: [{ run: 'true' }] });

describe('analyze — validation, coverage and the nudge, returned rather than printed', () => {
	test('a valid proof: no errors, and the coverage note counts what it names', () => {
		const out = analyze(draft({ proofs: { g: gate(['commands/hello']) } }));
		assert.deepEqual(out.errors, []);
		assert.deepEqual(out.notes, ['proofs: 1 declared · commands 1/1 · skills 0/1 · scripts 0/0 · bindings 0/0']);
	});

	test('every error is prefixed with the proof\'s runtime path', () => {
		const out = analyze(draft({ proofs: { g: gate(['skills/greter']) } }));
		assert.equal(out.errors.length, 1);
		assert.match(out.errors[0], /^proofs\/g\.proof\.yaml: about "skills\/greter" names no artifact/);
	});

	test('an undeclared requires.env is an error; declaring it clears it', () => {
		const p = { g: { ...gate(['commands/hello']), requires: { env: ['SOME_TOKEN'] } } };
		assert.match(analyze(draft({ proofs: p })).errors[0], /requires\.env "SOME_TOKEN" is not declared/);
		assert.deepEqual(analyze(draft({ proofs: p, declaredVars: ['SOME_TOKEN'] })).errors, []);
	});

	test('a brace nobody substitutes is a WARNING, never an error', () => {
		const out = analyze(draft({ proofs: { g: { ...gate(['commands/hello']), steps: [{ run: 'echo {recrod}' }] } } }));
		assert.deepEqual(out.errors, []);
		assert.equal(out.warnings.length, 1);
		assert.match(out.warnings[0], /^proofs\/g\.proof\.yaml: step 1 uses "\{recrod\}"/);
	});

	test('an unparseable proof is an error naming it, not a throw out of compile', () => {
		const d = draft({ extra: { 'proofs/bad.proof.yaml': entry('name: [unclosed\n', 'modules/default/proofs/bad.proof.yaml') } });
		const out = analyze(d);
		assert.equal(out.errors.length, 1);
		assert.match(out.errors[0], /^proofs\/bad\.proof\.yaml: /);
	});

	test('a first-ever compile nudges nothing; a NEW command or skill is nudged once, a shipped one never', () => {
		assert.equal(analyze(draft()).notes.length, 1, 'no previous manifest, so nothing is new');
		const prev = { entries: { 'skills/using-dreamteamer/SKILL.md': {} } };
		const out = analyze(draft({
			previousManifest: prev,
			extra: { 'skills/fresh/SKILL.md': entry('---\nname: fresh\n---\n', 'modules/default/skills/fresh/SKILL.md') },
		}));
		assert.deepEqual(out.notes.slice(1), [
			'no proof yet for commands/hello — modules/default/proofs/hello.proof.yaml (see the proving-artifacts skill)',
			'no proof yet for skills/fresh — modules/default/proofs/fresh.proof.yaml (see the proving-artifacts skill)',
		]);
		const known = analyze(draft({ previousManifest: { entries: { 'commands/hello.command.md': {} } } }));
		assert.equal(known.notes.length, 1, 'an artifact the previous manifest knew is not new');
	});
});
