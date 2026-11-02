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
	for (const must of ['dt web status', 'dt web stop', 'dt web url', 'npx dreamteamer init', 'HttpOnly; SameSite=Strict', 'Sec-Fetch-Site', 'Content-Security-Policy: sandbox', 'Referrer-Policy: no-referrer', 'single-use sign-in', 'does not protect against', '### served', 'SECURITY.md', 'an open question', 'dist/app/SOURCE.json', 'sha256', '@dreamteamer/protocol', '@dreamteamer/http', '>=0.43.0']) {
		assert.ok(README.includes(must), `the README does not say ${must}`);
	}
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
