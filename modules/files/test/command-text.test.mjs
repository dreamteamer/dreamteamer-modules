// The skill, the command and the binding say what the code does — the verb, the flags, the field names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT } from './fixture.mjs';
import { DERIVED } from '../src/sync.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the skill names the verb, the two pointer forms, and every derived field as sync-owned', () => {
	const skill = read('skills/working-with-files/SKILL.md');
	assert.match(skill, /^name: working-with-files$/m);
	assert.match(skill, /dt files sync/); assert.match(skill, /dt files status/);
	assert.match(skill, /files\/<drive>\/<relative path>/); assert.match(skill, /\$\{env:NAME\}\/<relative path>/);
	for (const f of DERIVED) assert.ok(skill.includes(`\`${f}\``), `the skill does not name ${f}`);
	for (const f of ['description', 'tags', 'notes']) assert.ok(skill.includes(`\`${f}\``), `the skill does not name ${f}`);
});

test('the command runs the verb and reports its summary; the binding targets file-drives per record', () => {
	const cmd = read('commands/sync-files.command.md');
	assert.match(cmd, /^name: sync-files$/m); assert.match(cmd, /dt files sync/); assert.match(cmd, /--dry-run/);
	const b = yaml.load(read('command-bindings/sync-files--file-drives.command-binding.yaml'));
	assert.equal(b.command, 'commands/sync-files'); assert.equal(b.collection, 'collections/file-drives'); assert.equal(b.scope, 'record');
});

test('the shipped folders are all in the manifest', () => {
	const pkg = JSON.parse(read('package.json'));
	for (const k of ['collections', 'ui-views', 'skills', 'commands', 'command-bindings', 'src', 'README.md']) assert.ok(pkg.files.includes(k), k);
});
