// The README is written first and is the contract the module is built to: it names every part a stranger
// needs, in the order they need it, and speaks in the repository's one voice (the same rules
// tests/voice.test.mjs applies to shipped files, which reach this README only once the package exists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const README = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');

test('the README names every part of the contract, in order', () => {
	const headings = [...README.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
	assert.deepEqual(headings, ['quick start', 'commands', 'what you see', 'security', 'the editor marker', 'versions', 'limits', 'troubleshooting']);
	for (const must of [
		// one step, and the verbs (cr-modules-017 §8)
		'dt web open', 'dt web show', 'dt web select', 'dt web selection', 'dt web hook --install', 'dt web token', 'dt web list',
		'dt web revoke', 'dt web status', 'dt web stop', 'dt web start', 'dt serve', 'npx dreamteamer init',
		// one listener, its prefixes and its rules (§1, §3)
		'/sign-in/', '/app/', '/api/', '/_dt/', '/_files/', '/_frames/', 'Sec-Fetch-Site', 'HttpOnly; SameSite=Strict', 'a restart signs the pane out',
		'Content-Security-Policy: sandbox', 'Referrer-Policy: no-referrer', "form-action 'none'", 'control token', 'client token',
		// levels, the hook, the handoff (§4, §6, §7)
		'Read', 'Edit', 'Admin', 'POST /_dt/level', 'UserPromptSubmit', 'data, not instructions', 'POST /_dt/handoff',
		'does not protect against', '### served', 'SECURITY.md', 'an open question', '@dreamteamer/ui', '@dreamteamer/protocol', '@dreamteamer/http', '>=0.43.0',
		// the residual risks of §9 as revised, each with what bounds it
		'Codex', "'unsafe-inline'", 'files key', 'reads the control token', 'whichever chat', 'record ids', 'another registered workspace',
		// review round 1: what reaches another server on 127.0.0.1, and how the verbs and the hook know their own server
		'Path=/api/', 'Path=/_dt/', 'Another server on `127.0.0.1`', '/_dt/identity', 'instance id', 'a stale runtime file',
		// review round 2: a live server that does not answer is not stale
		'not answering', 'dt web stop --force', 'ps -o etime=', 'SIGKILL', 'SIGCONT',
	]) {
		assert.ok(README.includes(must), `the README does not say ${must}`);
	}
	for (const gone of ['dt web url', '--no-open', '/_dt/frame/', '10 minutes', 'Max-Age=604800', 'takes the stored port']) assert.ok(!README.includes(gone), `the README still says ${gone} (the 0.2 grammar, or the persisted session the security sign-off removed)`);
});

test('the README speaks in one voice', () => {
	const RULES = [
		['the workspace it came from', new RegExp(`\\b(operator|vault|dogfood|${['gk', 'brain'].join('-')})\\b`, 'i')],
		['a dated history note', /(?<![\w/'"`-])20\d\d-\d\d-\d\d(?![\w/.'"`-]|T\d)/],
		['a decision number', /\bdecisions? \d+\b/i],
		['a warning marker', /⚠/],
		['a history clause', /\bsince engine \d|\buntil 20\d\d\b|\b(?:was|were) (?:renamed|moved|deleted) on\b/i],
		['a command only one workspace has', /\bnpm run (?:--silent )?(?:dt|doctor)\b/],
	];
	let fenced = false;
	const prose = README.split('\n').filter((l) => { if (/^```/.test(l)) { fenced = !fenced; return false; } return !fenced; });
	for (const [name, re] of RULES) {
		const hits = prose.filter((l) => re.test(l));
		assert.deepEqual(hits, [], `no ${name}`);
	}
});
