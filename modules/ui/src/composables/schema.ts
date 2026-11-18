/**
 * THE SCHEMA-WRITE CLIENT — the designer's and the saved-view panel's write side.
 *
 * It used to be "the `/schema/*` wrappers". That grammar is gone: a system entity is written through
 * the SAME endpoints as any other record, and a field — the one sub-entity — through field verbs that
 * take the collection as their target.
 *
 *   POST   /collections/collections/records[?module=<id>]   a collection
 *   DELETE /collections/collections/records/<name>          …and its removal
 *   PATCH  /collections/collections/records/<name>          …its keys, by v2 path (display.list.sort=…)
 *   POST   /collections/ui-views/records                    a saved view (upsert; `id` is a field now)
 *   DELETE /collections/ui-views/records/<id>
 *   POST   /fields/<collection>[?module=<id>]               a field
 *   PATCH  /fields/<collection>/<field>[?module=<id>]
 *   DELETE /fields/<collection>/<field>[?module=<id>]
 *
 * ⚠ SELECTOR IN THE QUERY STRING, FIELD IN THE BODY. `?module=hr` narrows WHICH SOURCE contributes;
 * a `module` in a body would be a value being WRITTEN (the move). Never blur them.
 *
 * Each call is a compile-gated source write host-side — the engine writes the descriptor or view
 * source, proves it with a real compile (400 with the compiler's own message on failure, source
 * restored), commits, and reloads. Deliberately NOT a cached reactive composable: every call is a
 * one-shot mutation; callers refresh the shared read caches (`useCollections().reload()`,
 * `useFields(collection).reload()`, `loadUiViews(router)`) afterward.
 */
import { api } from '../api/client';

/** `?module=<id>` when there is one, nothing when there is not. One spelling, every call site. */
function selector(module?: string): string {
	return module ? `?module=${encodeURIComponent(module)}` : '';
}

/** `/fields/<collection>[/<field>]` — the field verbs' path. ⚠ Percent-encoded, always: a collection
 *  name may carry a namespace slash and `:collection` is ONE segment on both routers. */
function fieldsPath(collection: string, field?: string): string {
	return `/fields/${encodeURIComponent(collection)}${field ? `/${encodeURIComponent(field)}` : ''}`;
}

export interface CreateCollectionInput {
	name: string;
	/** `mixins` record ids, applied in this order — omitted = the minimal compilable descriptor. */
	mixins?: string[];
	/** `ids.from` — the id template; omitted = the engine's default. */
	idFrom?: string;
	/** Which module's sources the descriptor is written into. Omitted = the workspace module, the
	 *  engine's own default. A SELECTOR, so it rides in the query string, never in the body. */
	module?: string;
}

export async function createCollection({ module, ...fields }: CreateCollectionInput): Promise<void> {
	await api.post(`/collections/collections/records${selector(module)}`, fields);
}

export async function deleteCollection(collection: string): Promise<void> {
	await api.delete(`/collections/collections/records/${encodeURIComponent(collection)}`);
}

/**
 * Field writes take a WHOLE v2 field (descriptor v2, §3.4.1) — the entry a descriptor's `fields` map
 * holds, `display` included (`lib/field-def.ts` builds it from the designer's staged def). The engine
 * writes it as given: on a create it is the new field, on an update it REPLACES the field in the
 * source that declares it, so the caller builds it over the field as authored.
 */
export async function createField(collection: string, name: string, field: Record<string, unknown>): Promise<void> {
	await api.post(fieldsPath(collection), { name, field });
}

export async function updateField(collection: string, name: string, field: Record<string, unknown>): Promise<void> {
	await api.patch(fieldsPath(collection, name), { field });
}

/** The field as its source authored it — the collection record's own `fields` entry, or `{}`. What a
 *  whole-field update is built over, so keys the designer does not model are carried. */
export async function authoredField(collection: string, name: string): Promise<Record<string, unknown>> {
	try {
		const res = await api.get<Record<string, unknown>>(`/items/collections/${encodeURIComponent(collection)}`);
		const fields = res.data?.['fields'];
		const field = fields && typeof fields === 'object' ? (fields as Record<string, unknown>)[name] : undefined;
		return field && typeof field === 'object' && !Array.isArray(field) ? (field as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * The FLAG-vocabulary write (`dt set-field`): a body that is not `{ field }` restates only what it
 * names, over the field as its source declares it, and carries the rest. The safe way to touch a
 * field on ANOTHER collection — the key of a relation kept over there, whose enum, format, default
 * and display the operator is not looking at. An update that would change nothing exits 0 saying so.
 */
export async function updateFieldFlags(collection: string, field: string, flags: Record<string, unknown>): Promise<void> {
	await api.patch(fieldsPath(collection, field), flags);
}

/** Create a field from the flag vocabulary — `type` may name a collection, which makes it a reference. */
export async function createFieldFlags(collection: string, flags: Record<string, unknown>): Promise<void> {
	await api.post(fieldsPath(collection), flags);
}

/**
 * Remove a field, and report what that DID to the records.
 *
 * The engine clears the removed field's values in the same write and commit (engine `2e04d94`), which
 * is what keeps the collection writable afterwards — the key left behind used to make every later
 * write to those records fail on an unknown field. It returns the count, and a silent deletion and a
 * reported one are different acts, so this returns it too.
 */
export interface FieldRemoval {
	/** Records whose values for this field were cleared with it. `git show HEAD~1` holds them. */
	cleared?: number;
}

export async function deleteField(collection: string, field: string): Promise<FieldRemoval> {
	const res = await api.delete<FieldRemoval>(fieldsPath(collection, field));
	return res.data ?? {};
}

/**
 * Rename a field — NEW capability (engine `rename-field`), and the reason this repo's own docs no
 * longer say renaming is impossible.
 *
 * The designer does not offer it yet; the spelling lives here rather than in a component because the
 * client is where every schema path belongs. It rewrites the key in every record and in every
 * descriptor and view that names the field, so a caller that offers it must show the plan first
 * (`?dry-run=true`) — which is what the native gesture does.
 */
export async function renameFieldTo(collection: string, field: string, to: string): Promise<void> {
	await api.post(`${fieldsPath(collection, field)}/rename`, { to });
}

// ---- saved views = ui-view records (spec: "agents and users reshape the app by editing records") --

export type { ViewWrite as UiViewWrite } from '../lib/view-write';
import type { ViewWrite } from '../lib/view-write';

/**
 * Save a view. ⚠ THE `{id, view}` WRAPPER IS GONE from the wire: a ui-view is written like any other
 * record, with `id` alongside the fields, which is what "system entities are collections" means at
 * the transport. The host routes it to the engine's UPSERT, so saving an existing view is the same
 * call as saving a new one. With no `id` the engine derives it from the route (`{{ route | slug }}`).
 */
export async function saveUiView(id: string | undefined, view: ViewWrite, module?: string): Promise<Record<string, unknown>> {
	const res = await api.post<Record<string, unknown>>(`/collections/ui-views/records${selector(module)}`, { ...(id ? { id } : {}), ...view });
	return res.data ?? {};
}

/**
 * MOVE a view's source to another module — `dt set ui-views/<id> module=<m>`. `module` in the BODY is
 * the value being written (the move), never the selector; the engine moves the file through the
 * compile gate and commits in the repo that holds the destination (a linked clone's, for its modules).
 */
export async function moveUiView(id: string, module: string): Promise<Record<string, unknown>> {
	const res = await api.patch<Record<string, unknown>>(`/collections/ui-views/records/${encodeURIComponent(id)}`, { module });
	return res.data ?? {};
}

/**
 * Set collection-level keys by their v2 path — `dt set collections/<c> display.list.columns=…`. An
 * empty value removes the key. Compile-gated host-side like every other source write.
 */
export async function setCollectionKeys(collection: string, changes: Record<string, unknown>): Promise<Record<string, unknown>> {
	const res = await api.patch<Record<string, unknown>>(`/collections/collections/records/${encodeURIComponent(collection)}`, changes);
	return res.data ?? {};
}

export async function deleteUiView(id: string): Promise<void> {
	await api.delete(`/collections/ui-views/records/${encodeURIComponent(id)}`);
}
