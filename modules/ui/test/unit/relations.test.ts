/**
 * Two-way relations, tier 1: the pure decisions this repo makes about them — which side of a
 * relation a field row is on, the names the drawer prefills, and the sentence it shows.
 *
 * The rows are display-contract rows (descriptor v2, §4.3): a mirror is `kind: mirror` and names the
 * key's field with `mirror_of`, the key is an ordinary reference. What the designer WRITES for a
 * relation is pinned by `field-def.test.ts` and the render tier's `designer-save.test.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	baseNameOf,
	cardinalityOf,
	defaultForeignKeyName,
	defaultInverseName,
	defaultLinkSide,
	deleteRuleTarget,
	describeLink,
	isGeneratedDescription,
	isMirrorField,
	mirrorOwnerOf,
} from '../../src/lib/relation-meta';

// The ERD's half of this file moved to `schema-refs.test.ts`, which builds it from a real compile.

describe('which side of a relation a field row is on', () => {
	// display-contract rows (descriptor v2 §4.3): the mirror says `kind: mirror` and names the key's
	// field with `mirror_of`; the key is an ordinary reference; the injected id is `virtual`.
	const mirrorRow = { kind: 'mirror' as const, role: 'mirror' as const, many: true as const, mirror_of: 'meeting' };
	const ownerRow = { role: 'reference' as const, on_delete: 'set-null' };
	const idRow = { kind: 'virtual' as const, editable: false, hidden: ['list' as const, 'form' as const, 'record' as const] };

	it('a mirror is recognised by its kind — and the virtual id, read-only too, is not one', () => {
		assert.equal(isMirrorField(mirrorRow), true);
		assert.equal(isMirrorField(ownerRow), false);
		assert.equal(isMirrorField(idRow), false);
	});

	it('the key a mirror derives from is `mirror_of` on the mirror\'s own relation target', () => {
		assert.deepEqual(mirrorOwnerOf(mirrorRow, 'recordings'), { collection: 'recordings', field: 'meeting' });
		assert.deepEqual(mirrorOwnerOf({ kind: 'mirror', mirror_of: 'trip' }, 'family/travel/legs'), {
			collection: 'family/travel/legs',
			field: 'trip',
		});
		assert.equal(mirrorOwnerOf(ownerRow, 'meetings'), null);
		assert.equal(mirrorOwnerOf(mirrorRow, undefined), null, 'no relation target, no owner — never a guess');
	});
});

describe('the mirror name the drawer prefills', () => {
	it('strips the target’s singular prefix, the way the engine’s --inverse does', () => {
		assert.equal(defaultInverseName('meeting-recordings', 'meetings', false), 'recordings');
		assert.equal(defaultInverseName('meeting-summaries', 'meetings', true), 'summary');
		assert.equal(defaultInverseName('contacts', 'companies', false), 'contacts');
	});

	it('has no answer for a self-reference — the derived name is the field it would collide with', () => {
		assert.equal(defaultInverseName('companies', 'companies', false), null);
	});

	it('derives from the BARE names, so a namespace changes nothing', () => {
		assert.equal(baseNameOf('family/travel/legs'), 'legs');
		assert.equal(defaultInverseName('family/travel/legs', 'family/travel/trips', false), 'legs');
	});
});

describe('which side the drawer offers, and the sentence it shows', () => {
	it('offers the key HERE for a single reference and on the TARGET for a list', () => {
		// The cardinality already chosen implies it: one slot holds its own key, while a list of
		// references is far more often the many end of a one-to-many than a real many-to-many. In this
		// vault every list-shaped relation field but one is the many end.
		assert.equal(defaultLinkSide(false), 'here');
		assert.equal(defaultLinkSide(true), 'target');
	});

	it('derives the cardinality from the two facts already on screen', () => {
		assert.equal(cardinalityOf('here', false, false), 'm2o');
		assert.equal(cardinalityOf('here', false, true), 'o2o');
		assert.equal(cardinalityOf('here', true, false), 'm2m');
		// with the key on the target, this field's own type IS the cardinality
		assert.equal(cardinalityOf('target', true, false), 'o2m');
		assert.equal(cardinalityOf('target', false, false), 'o2o');
	});

	it('says it in the two collections’ own words — never m2o', () => {
		const intent = { side: 'target' as const, target: 'contacts', farField: 'company', list: true, unique: false, onDelete: 'restrict' as const };
		assert.equal(describeLink(intent, 'companies'), 'Each company has many contacts; each contact belongs to one company.');
		assert.equal(
			describeLink({ ...intent, list: false }, 'companies'),
			'Each company has at most one contact, and each contact at most one company.',
		);
		assert.equal(
			describeLink({ ...intent, side: 'here', list: true }, 'companies'),
			'Each company can have many contacts, and each contact many companies.',
		);
		assert.equal(
			describeLink({ ...intent, side: 'here', list: false }, 'companies'),
			'Each company has one contact; each contact can have many companies.',
		);
	});

	it('names the collection whose deletion the rule is about — the one the KEY points at', () => {
		const base = { target: 'contacts', farField: 'company', list: true, unique: false, onDelete: 'restrict' as const };
		assert.equal(deleteRuleTarget({ ...base, side: 'here' }, 'companies'), 'contacts');
		assert.equal(deleteRuleTarget({ ...base, side: 'target' }, 'companies'), 'companies');
	});

	it('prefills the KEY’s name from this collection’s singular, and a self-link as parent', () => {
		assert.equal(defaultForeignKeyName('companies', 'contacts'), 'company');
		assert.equal(defaultForeignKeyName('family/travel/trips', 'family/travel/legs'), 'trip');
		// a self-reference has no such name — the singular is what the field would be called on both
		// sides — so it answers the word a tree actually uses (the dogfood vault's own `companies.parent`)
		assert.equal(defaultForeignKeyName('companies', 'companies'), 'parent');
	});

	it('treats compile’s own generated sentence as no description at all', () => {
		// Showing it in an editable box, and writing it back, launders engine wording into a
		// hand-authored source — the same trap `upsertField` guards for a resolved `title`.
		assert.equal(isGeneratedDescription('Generated from summaries.meeting — set that field.'), true);
		assert.equal(isGeneratedDescription('Generated from family/travel/legs.trip — set that field.'), true);
		assert.equal(isGeneratedDescription('Everyone who works here.'), false);
		assert.equal(isGeneratedDescription(undefined), false);
	});
});
