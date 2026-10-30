// THE WORKFLOWS MODULE, pinned by shape: a workflow is a DOCUMENT — steps that name a command, the
// collection it walks, the filter that makes its record set and where a person decides — and nothing
// that records a run. The runner is one command and one skill; core carries all of it by composition.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT, MODULES } from '../../../tests/helpers/descriptors.mjs';

const HERE = path.join(MODULES, 'workflows');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const descriptor = yaml.load(read(HERE, 'collections', 'workflows.collection.yaml'));
const frontmatter = (text) => yaml.load(text.split(/^---\s*$/m)[1]);

describe('the workflows collection', () => {
	test('records live in the workspace at data/workflows/<id>.workflow.md, id slugged from the name', () => {
		assert.equal(descriptor.name, 'workflows');
		assert.deepEqual(descriptor.storage, { path: 'data/workflows', format: 'md' });
		assert.match('customer-factory', new RegExp(descriptor.ids.pattern));
		assert.equal(descriptor.ids.from, '{{ name | slug }}');
	});
	test('status is draft · active · retired, draft by default', () => {
		assert.deepEqual(descriptor.fields.status.enum, ['draft', 'active', 'retired']);
		assert.equal(descriptor.fields.status.default, 'draft');
	});
	test('a step names a command and a collection as REFERENCES, so dt check refuses one the workspace lacks', () => {
		const s = descriptor.fields.steps;
		assert.equal(s.type, 'object');
		assert.equal(s.many, true);
		assert.equal(s.required, true);
		assert.equal(s.fields.command.type, 'commands');
		assert.equal(s.fields.collection.type, 'collections');
		assert.equal(s.fields.collection.required, true);
		assert.equal(s.fields.where.type, 'string');
		assert.equal(s.fields.stop.type, 'string');
		assert.equal(s.fields.name.required, true);
	});
	test('a step with no command must say what the person decides', () => {
		const items = descriptor.constraints?.[0]?.properties?.steps?.items;
		assert.deepEqual(items, { if: { not: { required: ['command'] } }, then: { required: ['stop'] } });
	});
	test('nothing records a run: no run, cursor, progress or trigger field', () => {
		const names = [...Object.keys(descriptor.fields), ...Object.keys(descriptor.fields.steps.fields)];
		const stateful = names.filter((n) => /run|cursor|progress|trigger|last|current|done|schedule/.test(n));
		assert.deepEqual(stateful, []);
	});
	test('the body is the prose of the steps', () => {
		assert.equal(descriptor.fields.content.body, true);
	});
});

describe('the runner', () => {
	test('/workflow:run is a namespaced command that loads running-workflows and writes nothing about the run', () => {
		const text = read(HERE, 'commands', 'workflow', 'run.command.md');
		const fm = frontmatter(text);
		assert.equal(fm.name, 'workflow/run');
		assert.match(fm['argument-hint'], /<workflows\/id>/);
		assert.match(text, /load the `running-workflows` skill/);
		assert.match(text, /dt next/);
		assert.match(text, /write nothing about the run/);
	});
	test('running-workflows has the five headings, in order, in under 120 lines', () => {
		const text = read(HERE, 'skills', 'running-workflows', 'SKILL.md');
		assert.equal(frontmatter(text).name, 'running-workflows');
		const headings = text.split('\n').filter((l) => l.startsWith('## '));
		assert.deepEqual(headings, ['## What you are doing', '## Before you start', '## Do this', "## Don't", '## Done when']);
		assert.ok(text.split('\n').length < 120, `${text.split('\n').length} lines`);
	});
	test('dt-workflows is the npm bin, and the script it names ships', () => {
		const pkg = JSON.parse(read(HERE, 'package.json'));
		assert.equal(pkg.bin['dt-workflows'], 'bin/install.mjs');
		assert.ok(fs.existsSync(path.join(HERE, 'bin', 'install.mjs')));
		assert.ok(pkg.files.includes('data'), 'data/ holds the shipped workflows and must be in the tarball');
	});
});

describe('core carries workflows', () => {
	const spec = JSON.parse(read(MODULES, 'core', 'compose.json'));
	const corePkg = JSON.parse(read(MODULES, 'core', 'package.json'));
	test('workflows is an origin of core', () => {
		assert.ok(spec.origins.includes('workflows'));
	});
	test('the collection, the command, the skill, the script and customer-factory are all composed into core', () => {
		for (const dest of ['collections/workflows/workflows.collection.yaml', 'commands/workflow/run.command.md', 'skills/running-workflows/SKILL.md', 'bin/workflows-install.mjs', 'lib/workspace-root.mjs', 'data/workflows/customer-factory.workflow.md']) {
			assert.ok(spec.files[dest], `${dest} is not listed in core/compose.json`);
			assert.ok(fs.existsSync(path.join(MODULES, 'core', dest)), `${dest} is not in modules/core`);
		}
		assert.equal(corePkg.bin['dt-workflows'], 'bin/workflows-install.mjs');
		assert.ok(corePkg.files.includes('data'));
	});
	test('software-factory ships with rnd, which peers the workflows collection', () => {
		assert.ok(fs.existsSync(path.join(MODULES, 'rnd', 'data', 'workflows', 'software-factory.workflow.md')));
		const rnd = JSON.parse(read(MODULES, 'rnd', 'package.json'));
		assert.ok(rnd.dreamteamer.peer_collections.includes('workflows'));
		assert.ok(rnd.files.includes('data'));
	});
});
