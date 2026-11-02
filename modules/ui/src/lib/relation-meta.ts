/**
 * The two SIDES of a relation, read off the display contract — one place, so no component
 * re-derives them.
 *
 * The engine (`src/presentation.js`) projects the key as an ordinary reference (`role: reference` or
 * `reference_many`, plus `unique` and `on_delete`), and the GENERATED mirror it stamps onto the
 * target as `kind: mirror` + `role: mirror`, with `mirror_of` naming the key's field on the target.
 * The relation rows (`/relations`) name the other collection for both sides.
 *
 * ⚠ A mirror is locked by its `kind`, which nothing relaxes: every writer is refused by the store, so
 * no form — create included — may offer a control for it.
 */
import type { FieldRow } from '../api/types';
import { isMirrorField } from './field-row';

export { isMirrorField };

export interface MirrorOwner {
	collection: string;
	field: string;
}

/**
 * The key a mirror was generated from, or null: `mirror_of` names the field, and the mirror's own
 * relation target — the collection holding the key — names where. The target comes from the
 * relation rows (`useFields(...).relationTargets`), because a field row does not carry it.
 */
export function mirrorOwnerOf(field: Pick<FieldRow, 'kind' | 'mirror_of'>, target: string | undefined): MirrorOwner | null {
	if (!isMirrorField(field) || !field.mirror_of || !target) return null;
	return { collection: target, field: field.mirror_of };
}

/** The bare name of a collection — its namespace prefix dropped. */
export function baseNameOf(collection: string): string {
	const slash = collection.lastIndexOf('/');
	return slash === -1 ? collection : collection.slice(slash + 1);
}

function singular(name: string): string {
	if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
	if (name.endsWith('s')) return name.slice(0, -1);
	return name;
}

/**
 * The name to PREFILL for a mirror — what a mirror is conventionally called. The drawer always
 * sends the name it shows (the mirror's own field name, with `mirror_of` naming the key), so this is
 * a suggestion, never a different schema.
 *
 * `meeting-recordings` → `meetings` mirrors as `recordings` (the target's singular prefix is
 * already implied on a meeting); singularized when the link is one-to-one, so it reads as the one
 * record it holds (`meetings.summary`). Null for a self-reference, which has no derivable name —
 * the owner's own name is the field it would collide with.
 *
 * Namespace-safe without the declared namespace list: a collection name is `<namespace>/<base>` and
 * a base carries no slash, so the last-slash split is the same answer `baseNameOf` gives the engine.
 */
export function defaultInverseName(owner: string, target: string, unique: boolean): string | null {
	const base = baseNameOf(owner);
	const targetBase = baseNameOf(target);
	if (base === targetBase) return null;
	const prefix = `${singular(targetBase)}-`;
	const stripped = base.startsWith(prefix) ? base.slice(prefix.length) : base;
	return unique ? singular(stripped) : stripped;
}

// ---- WHICH SIDE STORES THE LINK, and the two shapes that answer it ------------------------------
//
// A relation is one foreign key plus one field derived from it. WHICH COLLECTION HOLDS THE KEY is
// storage, and the operator should never have to go to that collection to say so — so both shapes
// are authored on the collection being looked at:
//
//   side 'here'    this field IS the key; the derived field appears on the target.
//   side 'target'  the key is a field on the target; THIS field is the derived one.
//
// The descriptor keys follow from that and are never typed (descriptor v2, §3.4.1): side 'here'
// writes this field as a reference to the target (+ `unique`, + the delete rule) and the target's
// field as its mirror; side 'target' writes the target's key and this field as `mirror_of` it. There
// is ONE relation spelling — `mirror_of` on the derived side — so both shapes compile to the same
// pair, and the choice is only about where the sentence reads best: a question in the UI rather than
// a fact about the schema.

export type LinkSide = 'here' | 'target';

/** The whole relation, in the drawer's vocabulary — no descriptor keyword in sight. */
export interface RelationIntent {
	/** Which collection stores the foreign key. */
	side: LinkSide;
	/** The OTHER collection, slashless (`family/travel/trips`). */
	target: string;
	/** The field on the other collection. Empty with side 'here' means a one-way reference. */
	farField: string;
	/** THIS field holds a list of references. */
	list: boolean;
	/** side 'here' only — each target record may be claimed once, so the far field is single. */
	unique: boolean;
	onDelete: 'restrict' | 'set-null';
}

/**
 * The description compile stamps on a derived field when its author wrote none. It is the ENGINE's
 * sentence, not the operator's, so the drawer shows an empty box for it — otherwise the first edit
 * of any derived field launders engine wording into a hand-authored source, exactly as a resolved
 * `title` used to (`upsertField` guards that one).
 */
export function isGeneratedDescription(text: string | undefined): boolean {
	return typeof text === 'string' && /^Generated from \S+ — set that field\.$/.test(text);
}

/** Crude English singular — the same three rules `schema-ops.js#singular` applies. Exported because
 *  every LABEL about a link is about one record of a collection, not the collection: "on each
 *  meetings" and "each meetings has at most one" are the two sentences that gave the first cut away. */
export function singularOf(name: string): string {
	if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
	if (name.endsWith('s')) return name.slice(0, -1);
	return name;
}

/**
 * The name to prefill for the FOREIGN KEY when the operator says the link is stored on the target:
 * the singular of THIS collection, because that is what the field on the other side is about
 * (`companies` → each contact's `company`).
 *
 * A self-reference has no such name — the singular of the collection is what the field would be
 * called on both sides — so it answers `parent`, the word a tree actually uses.
 */
export function defaultForeignKeyName(here: string, target: string): string {
	const base = baseNameOf(here);
	if (base === baseNameOf(target)) return 'parent';
	return singularOf(base);
}

/**
 * Which side to OFFER first for a field of this shape. A single reference is one slot, so it holds
 * the key itself; a LIST of references is far more often the many end of a one-to-many (every
 * contact at this company) than a genuine many-to-many, so it defaults to the key living on the
 * target. Either way it is a radio the operator can move, not a decision they have to make.
 */
export function defaultLinkSide(list: boolean): LinkSide {
	return list ? 'target' : 'here';
}

export type Cardinality = 'm2o' | 'o2o' | 'm2m' | 'o2m';

/** The cardinality the two facts already on screen imply — never a separate question. */
export function cardinalityOf(side: LinkSide, list: boolean, unique: boolean): Cardinality {
	if (side === 'target') return list ? 'o2m' : 'o2o';
	if (list) return 'm2m';
	return unique ? 'o2o' : 'm2o';
}

/**
 * The shape as a sentence, in the two collections' own names. This is the only "cardinality"
 * anything shows the operator: `m2o` is a word from the engine's log, not from the vault.
 */
export function describeLink(intent: RelationIntent, here: string): string {
	const H = baseNameOf(here), T = baseNameOf(intent.target);
	const h = singularOf(H), t = singularOf(T);
	switch (cardinalityOf(intent.side, intent.list, intent.unique)) {
		case 'o2m':
			return `Each ${h} has many ${T}; each ${t} belongs to one ${h}.`;
		case 'o2o':
			return `Each ${h} has at most one ${t}, and each ${t} at most one ${h}.`;
		case 'm2m':
			return `Each ${h} can have many ${T}, and each ${t} many ${H}.`;
		default:
			return `Each ${h} has one ${t}; each ${t} can have many ${H}.`;
	}
}

/** Which collection's records disappear under the delete rule — the one the FOREIGN KEY points at. */
export function deleteRuleTarget(intent: RelationIntent, here: string): string {
	return intent.side === 'here' ? intent.target : here;
}
