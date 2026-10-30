// WHAT CORE ADDS — the nouns no small module has, pinned by shape: the five collections, the users
// overlay, the mirrors each side names, and the unions that let an agent be a worker.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { CORE } from '../../../scripts/compose-core.mjs';

const own = (c) => yaml.load(fs.readFileSync(path.join(CORE, 'collections', 'core', `${c}.collection.yaml`), 'utf8'));
const composedFields = (dest) => yaml.load(fs.readFileSync(path.join(CORE, dest), 'utf8')).fields;

describe('the five collections core adds', () => {
	test('sessions: a dated sitting of work by a person or an agent, on a project', () => {
		const d = own('sessions');
		assert.equal(d.name, 'sessions');
		assert.match('2026/10/2026-10-28--northwind-calendar', new RegExp(d.ids.pattern));
		assert.deepEqual(d.fields.worker.type, ['users', 'agents']);
		assert.equal(d.fields.project.type, 'projects');
		assert.equal(d.fields.tasks.type, 'tasks');
		assert.equal(d.fields.outcome.body, true);
		assert.match(d.fields.transcript.examples[0], /^\$\{env:FILES_FOLDER\}/);
	});
	test('metrics: a measure with unit, scope, target and a series of readings', () => {
		const d = own('metrics');
		assert.deepEqual(d.fields.scope.type, ['projects', 'users', 'agents']);
		assert.equal(d.fields.unit.required, true);
		assert.deepEqual(d.fields.kind.enum, ['gauge', 'counter', 'ratio']);
		assert.equal(d.fields.readings.type, 'object'); assert.equal(d.fields.readings.many, true);
		assert.deepEqual(Object.keys(d.fields.readings.fields), ['date', 'value', 'note']);
	});
	test('roles and responsibilities list their users back, and users names them', () => {
		const users = own('users');
		assert.equal(users.overlay, true);
		for (const c of ['roles', 'responsibilities']) {
			const d = own(c);
			assert.equal(d.fields.users.type, 'users'); assert.equal(d.fields.users.many, true); assert.equal(d.fields.users.mirror_of, c);
			assert.equal(users.fields[c].type, c); assert.equal(users.fields[c].many, true);
		}
		assert.equal(users.fields.manager.type, 'users');
		assert.equal(users.fields.reports.mirror_of, 'manager');
	});
	test('artifacts is a folder whose entry is index.md, keyed by name, with built_from distinct from source', () => {
		const d = own('artifacts');
		assert.equal(d.storage.shape, 'folder'); assert.equal(d.storage.entry, 'index.md');
		assert.equal(d.ids.from, '{{ name | slug }}');
		assert.deepEqual(d.fields.kind.enum, ['pitch', 'prototype', 'report', 'canvas', 'page']);
		assert.ok(d.fields.built_from && d.fields.source, 'both built_from (bytes) and source (information) exist');
		assert.equal(d.fields.company.type, 'companies');
	});
	test('agents is drawn in the nav by an overlay of the engine kind, with no fields', () => {
		const d = own('agents');
		assert.equal(d.overlay, true); assert.deepEqual(d.fields, {}); assert.ok(d.display.nav.icon);
	});
	test('the users base core composes is the one the overlay extends', () => {
		assert.ok(composedFields('collections/users/users.collection.yaml').name, 'users base is composed');
		for (const f of ['roles', 'responsibilities', 'manager', 'reports']) assert.ok(!composedFields('collections/users/users.collection.yaml')[f], `${f} is the overlay's, not the base's`);
	});
});
