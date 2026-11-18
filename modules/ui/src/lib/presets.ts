/**
 * Preset resolution (terminology decision 2026-07-23: the saved-view records now live at
 * `.schema/presets`, record_type `preset`, and a preset's renderer is a List id, or a
 * record-scoped Edit/View id). A
 * `.schema/presets` record configures which registered renderer draws a collection for a given
 * `target` ('list' | 'item') and, for item targets, `mode` ('view' | 'edit'). Resolution per
 * `collection × target × mode`:
 *
 *   workspace-local default → module-shipped default → built-in fallback (table / properties)
 *
 * "workspace beats module" uses the same `layer` signal collection rows carry (empty/undefined =
 * local workspace, non-empty = a dependency bundle/module). A record marked `default: true` with
 * no `layer` wins over a module-shipped default; absent any default, the built-in fallback applies.
 *
 * Framework-free (no Vue) so it stays cheaply testable — the registry lookup that turns a resolved
 * renderer id into a component lives in `resolveRendererEntry`, the one place that touches the
 * registry.
 */
import { type ExtensionDefinition, type ListDefinition, edits, lists, views } from '../registry/index';

export type PresetTarget = 'list' | 'item';
export type PresetMode = 'view' | 'edit';

/**
 * A `.schema/presets` record (extended saved-view schema). Legacy saved views carry a serialized
 * `state`; platform presets carry `target`/`renderer`/`mode`/`options`/`default` directly. Both
 * shapes coexist on the same collection — a record may have either or both.
 */
export interface PresetRecord {
	id: string;
	collection: string;
	name?: string;
	target?: PresetTarget;
	/** Registered renderer id: a List id for list targets; a record-scoped Edit/View id for item. */
	renderer?: string;
	mode?: PresetMode;
	options?: Record<string, unknown>;
	default?: boolean;
	/** Bundle/module that supplied this preset ('' / undefined = local workspace). */
	layer?: string;
}

/**
 * Built-in fallback renderer id for a target×mode when no preset resolves one.
 *
 * Item targets resolve to `properties` — the Obsidian-style record page (ItemProperties.vue) —
 * for BOTH modes since 2026-07-29 (operator ask). This is the "change the default" half of that
 * change: `form` (record-scoped Edit) and `doc` (record-scoped View) are still registered and
 * still resolve, so a `.schema/presets` record naming either keeps the two-column form. Nothing
 * about the preset mechanism moved — only which id you get when no preset speaks.
 */
export function builtinRenderer(target: PresetTarget, _mode: PresetMode = 'edit'): string {
	if (target === 'list') return 'table';
	return 'properties';
}

/** All preset records matching a collection/target (and mode, for item targets), default-first. */
export function matchingPresets(records: PresetRecord[], collection: string, target: PresetTarget, mode?: PresetMode): PresetRecord[] {
	return records.filter((r) => {
		if (r.collection !== collection) return false;
		if ((r.target ?? 'list') !== target) return false;
		if (target === 'item' && mode && r.mode && r.mode !== mode) return false;
		return true;
	});
}

export interface ResolvedPreset {
	/** The registered renderer id to render (preset-supplied or built-in fallback). */
	rendererId: string;
	/** The winning preset record, if a default was found (carries `options`/`filter`). */
	preset: PresetRecord | undefined;
}

/**
 * Pick the default preset for `collection × target × mode`: workspace-local default beats a
 * module-shipped default; if none is marked default, fall through to the built-in renderer.
 */
export function resolvePreset(records: PresetRecord[], collection: string, target: PresetTarget, mode: PresetMode = 'edit'): ResolvedPreset {
	const matches = matchingPresets(records, collection, target, mode);
	const defaults = matches.filter((r) => r.default === true && typeof r.renderer === 'string' && r.renderer);
	const chosen = defaults.find((r) => !r.layer) ?? defaults[0];
	return { rendererId: chosen?.renderer ?? builtinRenderer(target, mode), preset: chosen };
}

/**
 * Turn a resolved renderer id into a registered entry, falling back to the built-in when the id
 * names an unregistered renderer (e.g. a module that failed to load) — never throws, matching the
 * studio's "never blank the page" posture. A list target resolves against the `lists` registry; an
 * item target resolves against a record-scoped Edit (mode 'edit') or View (mode 'view').
 */
export function resolveRendererEntry(id: string, target: PresetTarget, mode: PresetMode = 'edit'): ExtensionDefinition | ListDefinition {
	if (target === 'list') {
		const entry = lists.get(id) ?? lists.get('table');
		if (!entry) throw new Error(`[presets] built-in list 'table' is not registered`);
		if (!lists.get(id) && id !== 'table') console.warn(`[presets] list '${id}' not registered — falling back to table`);
		return entry;
	}
	const registry = mode === 'view' ? views : edits;
	// Same id `builtinRenderer` hands out, so a preset naming an unregistered renderer degrades to
	// the page everyone else sees rather than to the layout the default moved away from.
	const fallbackId = builtinRenderer('item', mode);
	const entry = registry.get(id);
	if (entry && entry.scope === 'record') return entry;
	if (id && id !== fallbackId) console.warn(`[presets] '${id}' is not a registered record ${mode === 'view' ? 'View' : 'Edit'} — falling back to ${fallbackId}`);
	const fallback = registry.get(fallbackId);
	if (!fallback) throw new Error(`[presets] built-in record renderer '${fallbackId}' is not registered`);
	return fallback;
}
