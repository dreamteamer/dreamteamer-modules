/**
 * useDesignerState(collection): the single source of truth for the schema Designer's staged,
 * unsaved field edits (plan contract C2). It loads `GET /fields/:collection` (adapter →
 * /api/presentation rows) into an ordered `StagedField[]`, lets the field grid (reorder / hide /
 * width) and the FieldDrawer (`@apply`) mutate that array in memory, and flushes through `save()`.
 *
 * WRITE PATH: the engine has PER-FIELD ops (`POST /fields/:c`, `PATCH`/`DELETE /fields/:c/:f`,
 * each a compile-gated descriptor source write), not a full-rewrite PUT — so `save()` DIFFS the
 * staged fields against the loaded baseline and issues one op per added/changed/removed field,
 * each a WHOLE v2 field built by `lib/field-def.ts` over the field as its source authored it — its
 * `display` included, since descriptor v2 stores a field's presentation (§3.4.2). Honesty over
 * silent loss: what a v2 field has no place for (a grid width, a note, a new object's sub-fields,
 * pure reordering) is skipped with a returned warning instead of being silently eaten.
 *
 * ⚠ A RELATION IS AUTHORED FROM WHICHEVER SIDE THE OPERATOR IS LOOKING AT, so a save is no longer
 * one op on one collection. Which collection stores the foreign key is a QUESTION IN THE DRAWER
 * (`def.link_side`), not a fact the operator has to discover and then navigate to — so the field on
 * the other collection is written here, silently, and named in the notice. See `planRelation` for
 * the sequences and lib/relation-meta.ts for why they are the shapes they are.
 */
import { computed, ref, type Ref } from 'vue';
import { api } from '../api/client';
import { fieldFromDef, SURFACES } from '../lib/field-def';
import { createField, createFieldFlags, deleteField, updateField, updateFieldFlags } from './schema';
import { invalidateRelations, loadRelations, useFields } from './fields';
import { isGeneratedDescription, mirrorOwnerOf, type MirrorOwner } from '../lib/relation-meta';
import { isBodyField, isMirrorField, isReferenceField, isRelationField } from '../lib/field-row';
import type { FieldRow } from '../api/types';

export interface StagedField {
	/** Field name. */
	key: string;
	/** The presentation-shaped overlay the drawer/grid mutate (type/required/target/edit/view/…). */
	def: Record<string, unknown>;
	/** Locked-block field (implicit / body / derived relation field): never draggable, and never
	 *  carries a PRESENTATION edit. A derived relation field is still saved — see `authored`. */
	implicit: boolean;
	/** Set only on a field DERIVED from a relation whose key lives on another collection — the
	 *  `<collection>.<field>` that key is. Its presence is what locks the row's presentation knobs;
	 *  it does NOT make the relation read-only, which is the whole point of this wave. */
	mirror?: MirrorOwner;
}

/** Does this staged field have a descriptor of its own to write? True for every ordinary field, and
 *  true for a derived relation field — whose relation this collection may perfectly well declare. */
export function authored(f: StagedField): boolean {
	return !f.implicit || f.mirror !== undefined;
}

/** `$`-prefixed names are the adapter's synthetic record keys (`$path`, `$writable`…), never fields. */
function isSynthetic(row: FieldRow): boolean {
	return row.field.startsWith('$');
}

/** What `save()` tells the caller: what it could not absorb, what it declared, what failed. */
export interface SaveOutcome {
	warnings: string[];
	notices: string[];
	/** Per-field failures. `save()` no longer aborts on the first one — see the note on `save`. */
	errors: string[];
}

/**
 * A locked-block field: one the engine owns (`kind` — the injected `id`, `created`, `last_modified`,
 * a generated mirror), the markdown body, or an adapter synthetic.
 *
 * ⚠ A mirror is keyed on its `kind`, which nothing relaxes. Keying on a presentation knob is what
 * once let a width or hide toggle stage a change on it: `save()` then PATCHed the field with a
 * presentation knob, the engine answered 400, and the whole save aborted on that one failure.
 *
 * ⚠ AND THE LOCK IS ON PRESENTATION ONLY. The RELATION a mirror describes is editable from here —
 * name, single-or-list, description, one-to-one and the delete rule — because which side stores the
 * key is storage, not permission. That is what `authored()` exists to say.
 */
export function isLockedRow(row: FieldRow): boolean {
	return row.kind !== undefined || isBodyField(row) || isSynthetic(row);
}

/**
 * One `GET /fields` row → a `StagedField`. Reconstructs the *logical* type (relation / list /
 * tags), so the drawer's Relationship tab and `lib/field-def.ts` both key off `def.type` rather than
 * the wire type, and carries over the field's display keys (the authored block where the source has
 * one) plus its default, so a save round-trips what it did not touch. `target` comes from
 * the separately-resolved relations map (a field row never carries it) — and for a mirror that map
 * already answers with the collection holding the key, because `/relations` emits one row per side.
 * `farField` is the name of the mirror a KEY has on its target, found by `load()` one collection over.
 */
function rowToStaged(
	row: FieldRow,
	target: string | undefined,
	keyRule: 'restrict' | 'set-null' | undefined,
	farField: string | undefined,
	authoredDisplay: Record<string, unknown> = {},
): StagedField {
	const def: Record<string, unknown> = {};

	if (isRelationField(row)) {
		if (row.many) {
			def['type'] = 'list';
			def['of'] = 'relation';
		} else {
			def['type'] = 'relation';
		}
	} else if (row.many && row.type !== 'object') {
		// a list of scalars is the drawer's `tags`; `of` keeps its element type, so a save restates
		// `integer`, `date`, … rather than turning every scalar list into a list of strings.
		def['type'] = 'tags';
		def['of'] = row.type;
	} else {
		def['type'] = row.type;
		if (row.many) def['many'] = true;
	}

	if (target) def['target'] = `/${target}`;
	def['required'] = row.required;
	if (row.editor !== undefined) def['editor'] = row.editor;
	if (row.viewer !== undefined) def['viewer'] = row.viewer;
	if (row.editor_options !== undefined) def['editor_options'] = row.editor_options;
	if (row.viewer_options !== undefined) def['viewer_options'] = row.viewer_options;
	// ---- the field's display (§3.4.2), as its source authored it where it says, else as projected ---
	// The row's `form_section` is the engine's answer (the field's own, else the section listing it),
	// which is what a field this source does not declare — an overlay's, a mixin's — falls back to.
	// ⚠ The authored block is still asked FIRST: the row omits `form_section` on a DEPRECATED field,
	// and a whole-field write restates every modelled display key, so a save of a deprecated field
	// would otherwise delete the section its source names.
	const hidden = (Array.isArray(authoredDisplay['hidden']) ? authoredDisplay['hidden'] : row.hidden ?? []) as string[];
	// hidden from every surface is the grid's one "hidden" toggle
	if (SURFACES.every((x) => hidden.includes(x))) def['hidden'] = true;
	else if (hidden.length) def['hidden'] = SURFACES.filter((x) => hidden.includes(x));
	const editable = authoredDisplay['editable'] ?? (row.kind ? true : row.editable);
	if (editable === false || editable === 'create') def['editable'] = editable;
	for (const k of ['form_section', 'placeholder', 'unit', 'unit_field', 'direction', 'width'] as const) {
		const v = authoredDisplay[k] ?? (row as unknown as Record<string, unknown>)[k];
		if (v !== undefined && v !== null && v !== '') def[k] = v;
	}

	// ---- the relation, in the drawer's vocabulary ------------------------------------------------
	// ONE fact decides the rest: which collection stores the foreign key. A mirror says "the other
	// one" and names the key; a key says "this one" and names the mirror it has over there (empty =
	// nothing mirrors it). `unique` and `on_delete` belong to the key.
	const owner = mirrorOwnerOf(row, target);
	if (owner) {
		def['link_side'] = 'target';
		def['far_field'] = owner.field;
		// The delete rule belongs to the KEY, and the key is on the other collection — so the contract
		// reports it on THAT row, not this one. Read there by `load()` and carried here, because the
		// drawer offers it from this side too and a control that cannot show the current value would
		// report every open as a change.
		if (keyRule !== undefined) def['on_delete'] = keyRule;
	} else if (isReferenceField(row)) {
		def['link_side'] = 'here';
		def['far_field'] = farField ?? '';
		if (row.unique) def['unique'] = true;
		if (row.on_delete !== undefined) def['on_delete'] = row.on_delete;
	}

	// The field's own prose. ⚠ NOT the sentence compile stamps on a derived field when nobody wrote
	// one — showing that in an editable box, and writing it back, launders engine wording into a
	// hand-authored source (the same trap `upsertField` guards for a resolved `title`).
	const description = row.description;
	if (typeof description === 'string' && !isGeneratedDescription(description)) def['description'] = description;

	if (row.default !== undefined && row.default !== null) def['default'] = row.default;

	return { key: row.field, def, implicit: isLockedRow(row), ...(owner ? { mirror: owner } : {}) };
}

// ---- the relation, read off a staged def -------------------------------------------------------

interface FarSide {
	/** The other collection, slashless. */
	target: string;
	/** The field on it. Empty = there is none (a one-way reference). */
	field: string;
	/** Which collection stores the foreign key. */
	side: 'here' | 'target';
	/** THIS field holds a list. */
	list: boolean;
	/** Each target record may be claimed once (side 'here' only). */
	unique: boolean;
	onDelete: 'restrict' | 'set-null';
}

function bareTarget(def: Record<string, unknown>): string {
	const t = def['target'];
	return typeof t === 'string' ? t.replace(/^\//, '') : '';
}

/** The far side of the relation this def describes, or null when there is no relation to write. */
function farSideOf(def: Record<string, unknown> | undefined): FarSide | null {
	if (!def) return null;
	const type = def['type'];
	const isRelation = type === 'relation' || (type === 'list' && (def['of'] === 'relation' || (def['of'] as Record<string, unknown> | null)?.['type'] === 'relation'));
	if (!isRelation) return null;
	const target = bareTarget(def);
	if (!target || target === '*') return null;
	const side = def['link_side'] === 'target' ? 'target' : 'here';
	const field = typeof def['far_field'] === 'string' ? (def['far_field'] as string) : '';
	if (side === 'target' && !field) return null; // a derived field with no key is not expressible
	return {
		target,
		field,
		side,
		list: type === 'list',
		// Only meaningful when the key is HERE. With the key on the target, a single reference here IS
		// the one-to-one and compile derives it — so the flag is normalized away rather than left to
		// make two identical relations compare unequal.
		unique: side === 'here' && def['unique'] === true,
		onDelete: def['on_delete'] === 'set-null' ? 'set-null' : 'restrict',
	};
}

/** Two far sides that would produce the same writes. */
function sameFarSide(a: FarSide | null, b: FarSide | null): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function useDesignerState(collection: Ref<string>) {
	const fields = ref<StagedField[]>([]);
	/** Deep snapshot of the last server-synced state — powers `dirty` and lets a toggle-back clear it. */
	const baseline = ref<string>('[]');
	/** Loaded (authored) defs by key — `save()` diffs the staged set against these. */
	const loadedDefs = new Map<string, Record<string, unknown>>();
	/** Each field as its source authored it — what a whole-field write is built over. */
	let authoredFields: Record<string, Record<string, unknown>> = {};

	const dirty = computed(() => JSON.stringify(fields.value) !== baseline.value);

	function snapshot(): void {
		baseline.value = JSON.stringify(fields.value);
	}

	function applyRows(
		rows: FieldRow[],
		targets: Map<string, string>,
		keyRules: Map<string, 'restrict' | 'set-null'>,
		farFields: Map<string, string>,
	): void {
		loadedDefs.clear();
		fields.value = rows.map((row) => {
			const display = authoredFields[row.field]?.['display'];
			const staged = rowToStaged(row, targets.get(row.field), keyRules.get(row.field), farFields.get(row.field), display && typeof display === 'object' ? (display as Record<string, unknown>) : {});
			if (authored(staged)) loadedDefs.set(staged.key, JSON.parse(JSON.stringify(staged.def)) as Record<string, unknown>);
			return staged;
		});
		snapshot();
	}

	async function load(): Promise<void> {
		const [res, relations, record] = await Promise.all([
			api.get<FieldRow[]>(`/fields/${encodeURIComponent(collection.value)}`),
			loadRelations(),
			// the collection's own record: its `fields` map is the source's, as authored
			api.get<Record<string, unknown>>(`/items/collections/${encodeURIComponent(collection.value)}`).catch(() => ({ data: {} as Record<string, unknown> })),
		]);
		const own = record.data?.['fields'];
		authoredFields = own && typeof own === 'object' ? (own as Record<string, Record<string, unknown>>) : {};

		const targets = new Map<string, string>();
		for (const rel of relations) {
			if (rel.collection === collection.value && rel.related_collection) targets.set(rel.field, rel.related_collection);
		}

		// Both halves of a relation are stated ONE collection over: a mirror's delete rule is on the
		// key's row, and a key's mirror is the target's field whose `mirror_of` names it. The adapter
		// serves every `/fields/:c` out of ONE cached `/presentation` payload, so asking is free after
		// the first — and asking is the difference between the drawer showing the relation and the
		// drawer inventing one.
		const keyRules = new Map<string, 'restrict' | 'set-null'>();
		const farFields = new Map<string, string>();
		for (const row of res.data) {
			const target = targets.get(row.field);
			if (!target || (!isMirrorField(row) && !isReferenceField(row))) continue;
			try {
				const far = (await api.get<FieldRow[]>(`/fields/${encodeURIComponent(target)}`)).data;
				const owner = mirrorOwnerOf(row, target);
				if (owner) {
					const rule = far.find((r) => r.field === owner.field)?.on_delete;
					keyRules.set(row.field, rule === 'set-null' ? 'set-null' : 'restrict');
				} else {
					const mirror = far.find((r) => isMirrorField(r) && r.mirror_of === row.field && relations.some((rel) => rel.collection === target && rel.field === r.field && rel.related_collection === collection.value));
					if (mirror) farFields.set(row.field, mirror.field);
				}
			} catch {
				// A collection we cannot read leaves the relation unstated rather than guessed — the
				// drawer then shows the engine's own default, which is what an unreadable far side means.
			}
		}

		applyRows(res.data, targets, keyRules, farFields);
	}

	function move(fromIdx: number, toIdx: number): void {
		const list = fields.value;
		if (fromIdx < 0 || fromIdx >= list.length || toIdx < 0 || toIdx >= list.length || fromIdx === toIdx) return;
		const next = list.slice();
		const [moved] = next.splice(fromIdx, 1);
		if (!moved) return;
		next.splice(toIdx, 0, moved);
		fields.value = next;
	}

	function update(key: string, patch: Record<string, unknown>): void {
		fields.value = fields.value.map((f) => (f.key === key ? { ...f, def: { ...f.def, ...patch } } : f));
	}

	/** Swap the whole StagedField for `field.key` (drawer Apply): REPLACES the def rather than merging,
	 * so clearing an attribute in the drawer actually drops it from the staged def. No-op if the key is
	 * absent (use `add()` for new fields). */
	function replace(field: StagedField): void {
		fields.value = fields.value.map((f) => (f.key === field.key ? { ...f, def: field.def } : f));
	}

	function add(field: StagedField): void {
		if (fields.value.some((f) => f.key === field.key)) {
			update(field.key, field.def);
			return;
		}
		fields.value = [...fields.value, field];
	}

	function remove(key: string): void {
		fields.value = fields.value.filter((f) => f.key !== key);
	}

	/**
	 * The far side's writes for one field, as an ordered list of thunks.
	 *
	 * ⚠ EVERY ONE IS A NORMAL FIELD OP IN THE FLAG VOCABULARY, and the ORDER is the mechanism:
	 *
	 *  1. The KEY must exist before anything derives from it — compile checks that the field a
	 *     `mirror_of` names is there and points back — so a mirror's own write always comes last.
	 *  2. The other collection's field is written with flags, never a whole field: a flag body
	 *     restates only what it names and carries the rest, so the far field keeps its enum, format,
	 *     default and display. The key says nothing about the relation except `unique` — which is
	 *     what makes its mirror a single value — so that is the one keyword stated on it.
	 */
	function farOpsFor(here: string, key: string, next: FarSide | null, previous: FarSide | null): (() => Promise<void>)[] {
		const ops: (() => Promise<void>)[] = [];

		// The key is on the other collection: make sure it exists, unique exactly when this mirror is
		// a single value.
		if (next && next.side === 'target') {
			ops.push(async () => {
				const res = await api.get<FieldRow[]>(`/fields/${encodeURIComponent(next.target)}`);
				const exists = res.data.some((r) => r.field === next.field);
				// `restrict` is the engine's DEFAULT, so stating it writes a keyword the source never
				// had and makes an untouched field look changed. It is stated only to CLEAR a
				// `set-null` that was there.
				const rule = next.onDelete === 'set-null' ? 'set-null' : previous?.onDelete === 'set-null' ? 'restrict' : undefined;
				const withRule = rule ? { 'on-delete': rule } : {};
				if (exists) await updateFieldFlags(next.target, next.field, { unique: !next.list, ...withRule });
				else await createFieldFlags(next.target, { name: next.field, type: here, ...(next.list ? {} : { unique: true }), ...withRule });
			});
			return ops;
		}

		// The key is HERE: the far field is its mirror — `mirror_of` this field, on the far
		// collection, its cardinality derived by the engine from this key's `unique`.
		if (next && next.field) {
			ops.push(async () => {
				const res = await api.get<FieldRow[]>(`/fields/${encodeURIComponent(next.target)}`);
				const flags = { type: here, 'mirror-of': key };
				if (res.data.some((r) => r.field === next.field)) await updateFieldFlags(next.target, next.field, flags);
				else await createFieldFlags(next.target, { name: next.field, ...flags });
			});
			return ops;
		}

		// Going one-way: the far field the operator just turned off has to go. This runs AFTER the own
		// write (see `save`), so by now this field's prop no longer declares anything — if the far
		// field is gone with it, the relation was declared HERE and there is nothing left to do; if it
		// survives, the far collection's own source declares it and removing it there is the removal.
		if (previous?.side === 'here' && previous.field) {
			const gone = previous;
			ops.push(async () => {
				const res = await api.get<FieldRow[]>(`/fields/${encodeURIComponent(gone.target)}`);
				if (!res.data.some((r) => r.field === gone.field)) return;
				await deleteField(gone.target, gone.field);
			});
		}
		return ops;
	}

	/**
	 * Remove a field this collection declares — a mirror included: in v2 only the mirror names the
	 * relation (`mirror_of`), so removing it IS removing the relation, and the key on the other
	 * collection stays an ordinary reference. `remove-field` clears the field's values in the same
	 * write and commit and reports the count.
	 *
	 * Returns what the removal did to the records, or null when it touched none.
	 */
	async function removeAuthored(here: string, key: string): Promise<string | null> {
		const { cleared } = await deleteField(here, key);
		return clearedNote(here, key, cleared);
	}

	/**
	 * Flush the staged diff as per-field /schema ops (see file header).
	 *
	 * `warnings` names every staged change the descriptor could NOT absorb; `notices` names the
	 * relations the write actually declared, BOTH sides of each — a relation is the one schema edit
	 * that produces a field the operator never typed, on a collection they were not looking at, so
	 * "recordings.meeting saved" would be a true sentence that hides the result.
	 *
	 * ⚠ ONE FIELD'S FAILURE NO LONGER TAKES THE BATCH DOWN. It used to throw straight out, so a
	 * single 400 discarded every other staged change in the same save — and with a relation now
	 * costing two or three ops, the odds of one of them refusing went up rather than down. Each
	 * field is attempted, its own failure is reported against its own name, and every op is
	 * compile-gated on its own, so what lands always compiles.
	 */
	async function save(): Promise<SaveOutcome> {
		const warnings: string[] = [];
		const notices: string[] = [];
		const errors: string[] = [];
		const here = collection.value;
		let ops = 0;
		const staged = fields.value.filter(authored);
		const stagedKeys = new Set(staged.map((f) => f.key));

		const fail = (key: string, err: unknown): void => {
			errors.push(`'${key}': ${err instanceof Error ? err.message : String(err)}`);
		};

		// removed fields first, so a remove+re-add (rename by hand) doesn't trip "already exists".
		for (const key of loadedDefs.keys()) {
			if (stagedKeys.has(key)) continue;
			try {
				const note = await removeAuthored(here, key);
				ops++;
				// A NOTICE, not a warning: it says what the removal did, and the removal succeeded.
				if (note) notices.push(note);
			} catch (err) {
				fail(key, err);
			}
		}

		for (const f of staged) {
			const loaded = loadedDefs.get(f.key);
			const base = authoredFields[f.key] ?? {};
			const next = fieldFromDef(f.def, base);
			const far = farSideOf(f.def);
			const farWas = farSideOf(loaded);
			if (next.unsaved.length && (!loaded || JSON.stringify(f.def) !== JSON.stringify(loaded))) {
				warnings.push(`'${f.key}': ${next.unsaved.join('; ')} — a v2 field has no place for it, so it was not stored.`);
			}

			try {
				if (!loaded) {
					// new field
					if (!next.field) {
						warnings.push(`'${f.key}': an object field's sub-fields can't be created here yet — edit the collection descriptor instead.`);
						continue;
					}
					// the key goes in first when it is on the other collection
					if (far?.side === 'target') for (const op of farOpsFor(here, f.key, far, null)) await op();
					await createField(here, f.key, next.field);
					if (far?.side !== 'target') for (const op of farOpsFor(here, f.key, far, null)) await op();
					ops++;
					noticeFor(notices, here, f.key, far);
					continue;
				}

				if (JSON.stringify(f.def) === JSON.stringify(loaded)) continue; // untouched

				const was = fieldFromDef(loaded, base);
				if (!next.field || !was.field) {
					warnings.push(`'${f.key}': this field's schema is structured — edit the collection descriptor to change it.`);
					continue;
				}
				const ownChanged = JSON.stringify(next.field) !== JSON.stringify(was.field);
				const farChanged = !sameFarSide(far, farWas);
				if (!ownChanged && !farChanged) continue;
				// The far side goes first when it holds the key (nothing can derive from a field that
				// isn't there yet) and last when it derives from this one.
				const farOps = farChanged ? farOpsFor(here, f.key, far, farWas) : [];
				if (far?.side === 'target') for (const op of farOps) await op();
				if (ownChanged) await updateField(here, f.key, next.field);
				if (far?.side !== 'target') for (const op of farOps) await op();
				ops++;
				noticeFor(notices, here, f.key, far);
			} catch (err) {
				fail(f.key, err);
			}
		}

		if (!ops && !warnings.length && !errors.length && dirty.value) {
			warnings.push('Field order isn’t persisted by the server yet — reordering stays local to this session.');
		}

		// Refresh every read path that caches schema: the adapter already dropped its /presentation
		// contract; drop the relations cache and the shared useFields cache too, then reload the
		// staged baseline from what actually landed on disk.
		invalidateRelations();
		await load();
		void useFields(here).reload();
		return { warnings, notices, errors };
	}

	async function discard(): Promise<void> {
		await load();
	}

	return { fields, dirty, load, move, update, replace, add, remove, save, discard };
}

/**
 * What a removal DID to the records, or null when it touched none.
 *
 * Removing a field takes its values with it, in the same write and commit as the schema change — the
 * engine's own `remove-field` does this now, and it is what keeps the collection WRITABLE afterwards:
 * a key left behind is an unknown field, so `check` reported it and the store refused the next write
 * to that record. It is still a deletion, so it is reported rather than silent, with where the
 * previous values went.
 *
 * ⚠ There is deliberately no fallback for "the removal left values behind anyway". It is reachable —
 * the engine skips a record whose frontmatter will not PARSE — but in exactly that case the
 * extension's own record read throws too (measured: `store.readAll` on such a collection dies on the
 * YAML error), so a check for it could never run, and `check` already reports the syntax error, which
 * is the real problem. An error path nobody can reach is a claim nobody can verify.
 */
function clearedNote(collection: string, field: string, cleared: number | undefined): string | null {
	if (!cleared) return null;
	const subject = cleared === 1 ? `1 ${collection} record` : `${cleared} ${collection} records`;
	return `${collection}.${field} removed; its values went with it from ${subject} (the previous version is in git).`;
}

/**
 * "meetings.summary ↔ meeting-summaries.meeting — one summary per meeting" — BOTH fields named,
 * because one of the two did not exist a moment ago and it is on a collection the operator was not
 * looking at. Silent for a field that declares no relation.
 */
function noticeFor(notices: string[], here: string, key: string, far: FarSide | null): void {
	if (!far || !far.field) return;
	const stored = far.side === 'here' ? `${here}.${key}` : `${far.target}.${far.field}`;
	notices.push(`${here}.${key} ↔ ${far.target}.${far.field} — the link is kept on ${stored}`);
}
