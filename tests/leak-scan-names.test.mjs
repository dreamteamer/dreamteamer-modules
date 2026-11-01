// leak-scan's "private names" step, run for real under bash with synthetic patterns shaped like the
// vault's (bare organisation alternatives, then one `\b(…)\b` group of people literals and
// `<a>[ ._/-]?<b>` pairs) — cr-modules-001, design D-c. The step must fail CLOSED when the secret is
// absent or malformed, print nothing derived from the secret but a 12-hex fingerprint and pass/fail,
// prove on every run that the secret is a people-carrying pattern its own grep fires on (the canary),
// and reach grep only through `-f`, so the pattern never sits on a process's argv. Every name here is
// synthetic.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const wf = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'leak-scan.yml'), 'utf8'));
const step = wf.jobs.scan.steps.find((s) => s.name === 'private names');

const letters = 'abcdefghijklmnopqrstuvwxyz';
const word = (prefix, i) => `${prefix}${letters[Math.floor(i / 26) % 26]}${letters[i % 26]}`;
const literals = (n, prefix = 'synth') => Array.from({ length: n }, (_, i) => word(prefix, i));
const pairs = (n) => Array.from({ length: n }, (_, i) => `${word('pera', i)}[ ._/-]?${word('perb', i)}`);
const shaped = (people, orgs = ['northwind', 'harbor-mutual']) => [...orgs, `\\b(${people.join('|')})\\b`].join('|');
const GOOD = shaped([...literals(120), ...pairs(20)]);

function run(pattern, added = 'a clean line\n') {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
	fs.writeFileSync(path.join(tmp, 'added.txt'), added.split('\n').map((l) => (l ? `+${l}` : l)).join('\n'));
	const env = { ...process.env, RUNNER_TEMP: tmp };
	if (pattern !== undefined) env.LEAK_NAMES = pattern;
	else delete env.LEAK_NAMES;
	const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], { env, encoding: 'utf8' });
	return { ...r, leftovers: fs.readdirSync(tmp).filter((f) => f !== 'added.txt') };
}
const literalsOf = (pattern) => pattern.split('|').map((p) => p.replace(/^\\b\(/, '').replace(/\)\\b$/, '').replace(/\[ \._\/-\]\?/, ' '));

test('the step defines one names_grep that reads the pattern through -f, and nothing else expands the secret', () => {
	assert.ok(step, "no step named 'private names'");
	assert.match(step.run, /names_grep\(\) \{ grep -icE -f <\(printf '%s' "\$LEAK_NAMES"\) "\$@"; \}/);
	const expanding = step.run.split('\n').filter((l) => /\$\{?LEAK_NAMES/.test(l));
	const allowed = [
		/^\s*names_grep\(\) \{ grep -icE -f <\(printf '%s' "\$LEAK_NAMES"\) "\$@"; \}$/,
		/^\s*if \[ -z "\$\{LEAK_NAMES:-\}" \]; then$/,
		/printf '%s' "\$LEAK_NAMES" \| sha256sum \| cut -c1-12/,
		/printf '%s\\n' "\$LEAK_NAMES" \| tr '\|' '\\n'/,
	];
	for (const l of expanding) assert.ok(allowed.some((re) => re.test(l)), `this line expands LEAK_NAMES outside the four allowed forms: ${l.trim()}`);
	const outsideF = step.run.replaceAll(`<(printf '%s' "$LEAK_NAMES")`, '<(…)');
	assert.doesNotMatch(outsideF, /grep[^\n]*\$\{?LEAK_NAMES/, 'a grep takes the pattern as an argument');
	assert.equal((step.run.match(/names_grep/g) ?? []).length >= 3, true, 'the probe, the canary and the scan all go through names_grep');
});

test('an absent or empty LEAK_NAMES fails the job', () => {
	for (const p of [undefined, '']) {
		const r = run(p);
		assert.equal(r.status, 1);
		assert.match(r.stdout, /::error::/);
		assert.match(r.stdout, /take-in/, 'the message says how a fork PR is taken in');
	}
});

test('a malformed pattern fails the job', () => {
	const r = run('\\b(unbalanced');
	assert.equal(r.status, 1);
	assert.match(r.stdout, /::error::/);
});

test('a people-carrying pattern passes the canary, and the step prints only the fingerprint and pass', () => {
	const r = run(GOOD);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /^LEAK_NAMES fingerprint: sha256 [0-9a-f]{12}$/m);
	assert.match(r.stdout, /^canary: pass \(floor 100\)$/m);
	for (const lit of literalsOf(GOOD)) assert.ok(!r.stdout.includes(lit), 'stdout carries a literal of the pattern');
	const rest = r.stdout.split('\n').filter((l) => !/^LEAK_NAMES fingerprint: /.test(l) && l !== 'canary: pass (floor 100)');
	assert.doesNotMatch(rest.join('\n'), /[0-9]/, 'a number derived from the secret reached the log');
	assert.deepStrictEqual(r.leftovers, [], 'the canary files are removed');
});

test('the fingerprint is sha256 over the exact bytes, no trailing newline: the pinned vector', () => {
	const r = run('\\b(alpha-one|beta-two)\\b');
	assert.match(r.stdout, /^LEAK_NAMES fingerprint: sha256 15e1e12558a2$/m);
});

test('fewer than 100 literals fails the canary', () => {
	const r = run(shaped(literals(10)));
	assert.equal(r.status, 1);
	assert.match(r.stdout, /^canary: FAIL$/m);
});

test('literals the pattern never matches on their own fail the canary', () => {
	const r = run(`northwind|\\b(q(${literals(120).join('|')}))\\b`);
	assert.equal(r.status, 1);
	assert.match(r.stdout, /^canary: FAIL$/m);
});

test('a name in the added lines fails the scan, without printing it', () => {
	const r = run(GOOD, `clean\nmet ${word('synth', 7)} today\n`);
	assert.equal(r.status, 1);
	assert.match(r.stdout, /::error::/);
	assert.ok(!r.stdout.includes(word('synth', 7)));
});
