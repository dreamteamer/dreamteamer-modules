/**
 * A BAND NAMED AFTER THE RECORD IT POINTS AT, not after a slug.
 *
 * The pure halves only — `idFor` and `labelFor`. The fetch orchestration is `useGroupLabels`, which
 * needs the relations list and the record cache and is exercised through the layout's own tier.
 *
 * ⚠ `idFor` is where the reference-splitting argument lives: a collection name may contain slashes
 * (a namespace) and so may an id, so there is no position in a stored path where "collection ends"
 * can be read off. Every one of these cases would be a coin-flip without the target.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { idFor, bandTitleTemplate, labelFor } from '../../src/lib/group-label';
import type { CollectionRow } from '../../src/api/types';

test('idFor strips the target prefix, leading slash or not, and never guesses', () => {
	assert.equal(idFor('/companies/acme', 'companies'), 'acme');
	assert.equal(idFor('companies/acme', 'companies'), 'acme');
	// A NAMESPACED collection and a PATH id — the case a string split cannot do
	assert.equal(
		idFor('perspective/topics/2026-09-07--acme/agent-decision-log', 'perspective/topics'),
		'2026-09-07--acme/agent-decision-log',
	);
	// A value that does not carry its target is passed through: it is already an id
	assert.equal(idFor('acme', 'companies'), 'acme');
	// A near-miss prefix is NOT stripped — `companies-archive/x` is not in `companies`
	assert.equal(idFor('companies-archive/x', 'companies'), 'companies-archive/x');
});

test('a band is named by the view’s group_title, else the TARGET collection’s record_title — never a field template', () => {
	const people = { collection: 'ns/people', record_title: '{{ name }}' } as CollectionRow;
	assert.equal(bandTitleTemplate('{{ name }} — {{ role }}', people), '{{ name }} — {{ role }}', 'the view’s own choice wins');
	assert.equal(bandTitleTemplate(null, people), '{{ name }}', 'blank is what a relation cell for the reference shows');
	assert.equal(bandTitleTemplate(null, { ...people, record_title: '' }), null);
	assert.equal(bandTitleTemplate(null, undefined), null, 'no row for the target: the de-slugged name stands');
});

test('labelFor prefers a resolved name, then what bucketize computed, then the de-slugged path', () => {
	const value = 'perspective/topics/2026-09-07--acme/agent-decision-log';
	assert.equal(labelFor(value, 'Agent decision log', { [value]: 'Agent decision log — 12 activities' }), 'Agent decision log — 12 activities');
	assert.equal(labelFor(value, 'Agent decision log', {}), 'Agent decision log');
	// No fallback at all (a caller with no bucket label) still never prints the raw path
	assert.equal(labelFor(value, '', {}), 'Agent decision log');
});
