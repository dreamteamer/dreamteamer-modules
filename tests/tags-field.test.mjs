// EVERY `tags` FIELD IS THE SAME FIELD. A tag is a free label, lowercase and hyphenated, optionally
// `key:value` with no space around the colon. The field's pattern is what enforces it: `dt add`
// and `dt check` refuse a value that breaks it, so no descriptor restates the rule in prose and no
// module ships a script to police it. Each descriptor may add one `examples:` line of its own.
//
// A field that mirrors another system's labels is not this field: it keeps whatever that system
// writes, so it is named here with the reason rather than given the pattern.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');

const PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*(:[a-z0-9]+(-[a-z0-9]+)*)?$';
const DEFINITION = {
	type: 'string',
	many: true,
	pattern: PATTERN,
	description: 'Free labels, lowercase and hyphenated, optionally key:value with no space around the colon.',
};
const EXTERNAL = {
	'perspective/collections/perspective/tickets.collection.yaml': 'the ticketing system\'s own labels, as its reader found them',
};

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const descriptors = fs.readdirSync(MODULES).flatMap((m) =>
	['collections', 'mixins'].flatMap((k) => walk(path.join(MODULES, m, k))))
	.filter((f) => f.endsWith('.yaml'));

const withTags = descriptors
	.map((f) => ({ rel: path.relative(MODULES, f), doc: yaml.load(fs.readFileSync(f, 'utf8')) }))
	.filter(({ doc }) => doc?.fields?.tags);

test('the scan finds the tags fields it is meant to check', () => {
	assert.ok(withTags.length >= 20, `only ${withTags.length} descriptors declare tags; the walk is broken`);
});

for (const { rel, doc } of withTags) {
	if (EXTERNAL[rel]) continue;
	test(`${rel}: tags is the shared definition`, () => {
		// the definition is what a tag IS; `display` is how one field is drawn (rnd's stage checks)
		const { examples, display, ...field } = doc.fields.tags;
		assert.deepEqual(field, DEFINITION);
		if (display !== undefined) assert.ok(display && typeof display === 'object' && !Array.isArray(display), 'display is a block');
		if (examples === undefined) return;
		assert.ok(Array.isArray(examples) && examples.length, 'examples is one non-empty list');
		for (const e of examples) assert.match(e, new RegExp(PATTERN), `example ${e} breaks the pattern`);
	});
}

test('every exempted descriptor still exists and still declares tags', () => {
	for (const rel of Object.keys(EXTERNAL)) assert.ok(withTags.some((d) => d.rel === rel), `${rel} is exempted but no longer declares tags`);
});

test('the pattern accepts the convention and refuses what breaks it', () => {
	const re = new RegExp(PATTERN);
	for (const ok of ['finance', 'client:northwind', 'area:home-office', 'v2']) assert.match(ok, re);
	for (const bad of ['Status: Pending', 'status: pending', 'local first', 'snake_case', 'Finance', 'a:b:c', '-x', 'key:']) assert.doesNotMatch(bad, re);
});

test('no shipped file points at a tags script or skill', () => {
	const shipped = fs.readdirSync(MODULES, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => walk(path.join(MODULES, e.name))
		.filter((f) => !/\/(docs|test|tests)\//.test(path.relative(MODULES, f))));
	const hits = shipped.filter((f) => /working-with-tags|tags\.py|@dreamteamer\/tags\b/.test(fs.readFileSync(f, 'utf8')));
	assert.deepEqual(hits.map((f) => path.relative(MODULES, f)), []);
});
