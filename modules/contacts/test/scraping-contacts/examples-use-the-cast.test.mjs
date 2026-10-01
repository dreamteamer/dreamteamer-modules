// Every person an example in this module names is from the synthetic cast. The module ships to npm,
// so a worked example drawn from a real scrape publishes that person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CAST_SLUGS = new Set(['dana-oren', 'sam-diaz', 'priya-raman', 'tom-whitfield']);
const CAST_FIRST_NAMES = new Set(['Dana', 'Sam', 'Priya', 'Tom']);

function* shipped(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'test' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* shipped(p);
		else if (/\.(md|ya?ml|json|mjs)$/.test(e.name)) yield p;
	}
}
const TEXT = [...shipped(MODULE)].map((f) => [path.relative(MODULE, f), fs.readFileSync(f, 'utf8')]);
const SKILL = fs.readFileSync(path.join(MODULE, 'skills/scraping-contacts/SKILL.md'), 'utf8');

const all = (re) => TEXT.flatMap(([file, text]) => [...text.matchAll(re)].map((m) => [file, m[1]]));

test('the scan reads the skill, the descriptor and the scripts', () => {
	const files = TEXT.map(([f]) => f);
	for (const f of ['skills/scraping-contacts/SKILL.md', 'collections/contacts.collection.yaml', 'skills/scraping-contacts/bin/li.mjs']) {
		assert.ok(files.includes(f), `${f} was not scanned`);
	}
});

test('every LinkedIn profile slug in an example is a cast member', () => {
	const slugs = [
		...all(/linkedin\.com\/in\/([a-z0-9-]+)/gi),
		...all(/"linkedin_username"\s*:\s*"([^"]+)"/g),
		...all(/`linkedin_username` is `([^`]+)`/g),
	];
	assert.ok(slugs.length >= 3, `expected the worked slug examples, found ${slugs.length}`);
	assert.deepEqual(slugs.filter(([, s]) => !CAST_SLUGS.has(s)), []);
});

test('the mutual-connections example names only cast members', () => {
	const lines = all(/`([^`]*mutual connections)`/g);
	assert.equal(lines.length, 1, 'the relationship table carries one mutual-connections example');
	const names = lines[0][1].replace(/ and \d+ other mutual connections$/, '').split(/,\s*|\s+and\s+/);
	assert.deepEqual(names.filter((n) => !CAST_FIRST_NAMES.has(n)), []);
});

test('the page-load wall is stated as counts, not as the people it was measured on', () => {
	assert.match(SKILL, /two profiles at 3 loads each = 6, and load 7 was refused/i);
});
