// The browser half's pure helpers, run in Node without a DOM, and the one structural promise the vendored folder
// depends on: each browser file imports only its siblings, so it runs wherever `harness/` is copied.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { parseDeepLink, coverageOf, groupJourneys, resolveUser, mergeStep, nextPlayable, stepsFor } from '../lib/prototype/browser/player.js';
import { layerFor, ids } from '../lib/prototype/browser/meta.js';
import { coverage } from '../lib/prototype/browser/catalog.js';

const BROWSER = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'lib', 'prototype', 'browser');
const J = [
	{ key: 'b-renew', group: 'gp', name: 'Renew', steps: [{ screen: 'gp-home', story: 'open', sentence: 'I open it' }, { screen: 'gp-renew', story: 'renew', sentence: 'I renew', caption: 'Renewal form' }] },
	{ key: 'a-apply', group: 'gp', name: 'Apply', steps: [{ screen: 'gp-home', story: 'open', sentence: 'I open it' }] },
	{ key: 'review', group: 'x', name: 'Review', steps: [{ screen: 'bo-review', system: true }, { screen: 'fd-pay', outOfScope: true }] },
];

describe('player helpers', () => {
	test('parseDeepLink reads the journey and step and keeps the rest of the hash', () => {
		assert.deepEqual(parseDeepLink('#/gp/home?demo=a-apply&step=3&id=7'), { key: 'a-apply', step: 3, rest: '#/gp/home?id=7' });
		assert.deepEqual(parseDeepLink('#/?demo=x'), { key: 'x', step: 1, rest: '#/' });
		assert.equal(parseDeepLink('#/gp/home?id=7'), null);
		assert.equal(parseDeepLink('#/gp/home?demo=x&step=zero').step, 1);
	});
	test('coverageOf counts built and stub steps, an unregistered screen as a stub, out-of-scope steps not at all', () => {
		const byKey = { 'gp-home': { key: 'gp-home' }, 'gp-renew': { key: 'gp-renew', stub: true } };
		assert.deepEqual(coverageOf(J[0], byKey), { built: 1, stub: 1 });
		assert.deepEqual(coverageOf(J[2], byKey), { built: 0, stub: 1 });
	});
	test('groupJourneys orders by key by default or by the prototype\'s sort, searches sentences and screens', () => {
		const groups = [{ key: 'gp', label: 'Grantee' }, { key: 'x', label: 'Cross' }, { key: 'bo', label: 'Back office' }];
		assert.deepEqual(groupJourneys(J, groups).map((g) => [g.key, g.journeys.map((j) => j.key)]), [['gp', ['a-apply', 'b-renew']], ['x', ['review']]]);
		assert.deepEqual(groupJourneys(J, groups, 'renewal').map((g) => g.journeys.map((j) => j.key)), [['b-renew']]);
		assert.deepEqual(groupJourneys(J, groups, 'BO-REVIEW').map((g) => g.key), ['x']);
		assert.deepEqual(groupJourneys(J, groups, '', (a, b) => b.key.localeCompare(a.key))[0].journeys.map((j) => j.key), ['b-renew', 'a-apply']);
	});
	test('resolveUser: the module step, then users(persona) or a map, then the portal default', () => {
		const o = { users: (p) => (p === 'applicant' ? 'U-applicant' : null), defaultUser: { bo: 'U-officer' } };
		assert.equal(resolveUser({ user: 'U-x', persona: 'applicant' }, o), 'U-x');
		assert.equal(resolveUser({ persona: 'applicant', portal: 'gp' }, o), 'U-applicant');
		assert.equal(resolveUser({ persona: 'auditor', portal: 'bo' }, o), 'U-officer');
		assert.equal(resolveUser({ persona: 'pm' }, { users: { pm: 'U-pm' } }), 'U-pm');
		assert.equal(resolveUser({ persona: 'nobody', portal: 'zz' }, o), null);
	});
	test('mergeStep: WHAT from the record, HOW from the module; the anchor defaults to the story, none on a system step', () => {
		assert.deepEqual(mergeStep({ screen: 'gp-home', story: 'open', caption: 'record' }, { screen: 'stale', caption: 'module', user: 'U-a', action: { name: 'x' } }),
			{ screen: 'gp-home', story: 'open', caption: 'record', user: 'U-a', action: { name: 'x' }, anchor: 'open' });
		assert.equal(mergeStep({ screen: 's', system: true }, {}).anchor, null);
		assert.equal(mergeStep({ screen: 's', story: 'k', caption: null }, { caption: 'from the module' }).caption, 'from the module', 'an empty record value leaves the module\'s');
		assert.equal(mergeStep({ screen: 's', story: 'open' }, { anchor: 'other' }).anchor, 'other');
	});
	test('nextPlayable skips out-of-scope steps both ways', () => {
		const steps = [{}, { outOfScope: true }, {}, { outOfScope: true }];
		assert.equal(nextPlayable(steps, 0), 2); assert.equal(nextPlayable(steps, 2), -1); assert.equal(nextPlayable(steps, 2, -1), 0);
	});
	test('stepsFor lists the sentences of every journey step on a screen', () => {
		assert.deepEqual(stepsFor(J, 'gp-home'), [{ sentence: 'I open it', story: 'open', journey: 'b-renew' }, { sentence: 'I open it', story: 'open', journey: 'a-apply' }]);
	});
});

describe('meta and catalogue helpers', () => {
	test('layerFor: the stored choice wins, else the portal default', () => {
		const d = (p) => (p === 'gp' ? 'off' : 'on');
		assert.equal(layerFor(null, 'gp', d), 'off'); assert.equal(layerFor(null, 'bo', d), 'on'); assert.equal(layerFor('on', 'gp', d), 'on'); assert.equal(layerFor('junk', 'gp', d), 'off');
	});
	test('ids splits a marker list', () => { assert.deepEqual(ids(' A, B,,C '), ['A', 'B', 'C']); assert.deepEqual(ids(undefined), []); });
	test('coverage counts registered screens per portal, stubs apart', () => {
		const screens = [{ key: 'a', route: '/a', portal: 'gp' }, { key: 'b', route: '/b', portal: 'gp', stub: true }, { key: 'c', route: '/c', portal: 'bo' }, { key: 'd', portal: 'bo' }];
		assert.deepEqual(coverage(screens, 'gp'), { total: 2, built: 1, stub: 1 }); assert.deepEqual(coverage(screens), { total: 3, built: 2, stub: 1 });
	});
});

describe('the vendored folder is self-contained', () => {
	test('each browser file imports only a sibling in harness/', () => {
		for (const f of fs.readdirSync(BROWSER).filter((x) => x.endsWith('.js'))) {
			const src = fs.readFileSync(path.join(BROWSER, f), 'utf8');
			for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) assert.match(m[1], /^\.\/[a-z-]+\.js$/, `${f} imports ${m[1]}`);
		}
	});
	test('the five browser modules and the stylesheet are there', () => {
		assert.deepEqual(fs.readdirSync(BROWSER).sort(), ['catalog.js', 'dom.js', 'harness.css', 'meta.js', 'playback.js', 'player.js']);
	});
});
