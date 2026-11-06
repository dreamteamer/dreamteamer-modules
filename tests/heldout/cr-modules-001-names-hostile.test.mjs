// held-out cr-modules-001-h3: the private-names step on hostile but valid patterns.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { leakStep, runStep } from './harness.mjs';

const step = leakStep('private names');
const letters = 'abcdefghijklmnopqrstuvwxyz';
const literals = Array.from({ length: 120 }, (_, i) => `qq${letters[Math.floor(i / 26)]}${letters[i % 26]}zz`);
const pairs = Array.from({ length: 20 }, (_, i) => `qx${letters[i]}x[ ._/-]?qy${letters[i]}y`);
const shape = (people) => `northwind|harbor-mutual|\\b(${people.join('|')})\\b`;
const fp = (v) => createHash('sha256').update(Buffer.from(v, 'utf8')).digest('hex').slice(0, 12);
const flip = (s) => [...s].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');

function run(value, addedLine) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
	fs.writeFileSync(path.join(tmp, 'added.txt'), addedLine ? `+${addedLine}\n` : '');
	return runStep(step.run, { env: { RUNNER_TEMP: tmp, LEAK_NAMES: value } });
}

function quiet(r, value) {
	const out = r.stdout + r.stderr;
	const parts = value.split('|').map((p) => p.replace(/^\\b\(/, '').replace(/\)\\b\s*$/, '').trim());
	for (const p of parts) if (p.length >= 4) assert.ok(!out.includes(p), 'a part of the pattern reached the output');
	const rest = out.split('\n').filter((l) => !/^LEAK_NAMES fingerprint: sha256 [0-9a-f]{12}$/.test(l) && l !== 'canary: pass (floor 100)');
	assert.doesNotMatch(rest.join('\n'), /[0-9]/, 'a digit outside the fingerprint and the canary line');
	const m = /^LEAK_NAMES fingerprint: sha256 ([0-9a-f]{12})$/m.exec(r.stdout);
	if (m) assert.equal(m[1], fp(value));
}

const A = shape([...literals, ...pairs, 'QqUpperzz', 'qq9digitzz', 'qq.dotzz']);
const B = shape([...literals, ...pairs, 'qa[ ._/-]?zb']);

test('(a) uppercase, digit and dot literals', () => {
	const empty = run(A);
	assert.equal(empty.status, 0, empty.stdout);
	assert.match(empty.stdout, /canary: pass \(floor 100\)/);
	quiet(empty, A);
	for (const lit of ['QqUpperzz', 'qq9digitzz', 'qq.dotzz']) {
		const r = run(A, flip(lit));
		assert.equal(r.status, 1, lit);
		assert.match(r.stdout, /::error::/);
		quiet(r, A);
	}
});

test('(b) a pair with two-letter halves', () => {
	const empty = run(B);
	assert.equal(empty.status, 0, empty.stdout);
	assert.match(empty.stdout, /canary: pass \(floor 100\)/);
	quiet(empty, B);
	const r = run(B, 'qa_zb');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /::error::/);
	quiet(r, B);
});

for (const [label, value] of [['(c1) a leading space', ` ${shape([...literals, ...pairs])}`], ['(c2) a trailing space', `${shape([...literals, ...pairs])} `], ['(c3) a trailing CR', `${shape([...literals, ...pairs])}\r`]]) {
	test(`${label}: never a pass on a literal line`, () => {
		const lit = run(value, literals[5]);
		assert.ok(!(lit.status === 0 && /canary: pass/.test(lit.stdout)), 'canary pass with exit 0 on a literal line');
		assert.notEqual(lit.status, 0);
		quiet(lit, value);
		const empty = run(value);
		quiet(empty, value);
		if (label.startsWith('(c3)')) {
			assert.equal(empty.status, 1);
			assert.match(empty.stdout, /canary: FAIL/);
		}
	});
}
