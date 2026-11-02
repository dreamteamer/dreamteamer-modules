/**
 * Edit/View resolution (spec §2.2): given a server `FieldRow`, pick the
 * registered component to render it with, degrading gracefully — never throwing —
 * when the schema names something this build doesn't have registered.
 */
import type { FieldRow } from '../api/types';
import { choicesOf, isBodyField, isRelationField, subFieldsOf } from '../lib/field-row';
import { type ExtensionDefinition, edits, kindDefaultEdits, kindDefaultViews, views } from './index';

export interface Resolved<T> {
	entry: T;
	degraded: string | null;
}

// The kind-default maps (`kindDefaultEdits`/`kindDefaultViews`) live in ./index so a module can
// extend them (`registerKindDefault`) without touching this file; resolve.ts only reads them.

const EDIT_FALLBACK = 'input';
const VIEW_FALLBACK = 'text';

type Lookup = { get(id: string): ExtensionDefinition | undefined };

/**
 * Resolve `primaryId` against `registry`, falling back through `kindDefaultId`
 * (the type's kind default) and finally `ultimateId` when a candidate along the
 * chain isn't registered. `degradedLabel` is set the first time a candidate
 * misses and is preserved through the rest of the chain (the reported reason is
 * always the *original* missing id, not a later one in the fallback chain).
 */
function resolveChain(
	registry: Lookup,
	primaryId: string,
	kindDefaultId: string,
	ultimateId: string,
	degradedLabel: string | null,
): Resolved<ExtensionDefinition> {
	const direct = registry.get(primaryId);
	if (direct) return { entry: direct, degraded: degradedLabel };

	const label = degradedLabel ?? `missing-edit-${primaryId}`;

	if (kindDefaultId !== primaryId) {
		const kindEntry = registry.get(kindDefaultId);
		if (kindEntry) return { entry: kindEntry, degraded: label };
	}

	if (ultimateId !== primaryId && ultimateId !== kindDefaultId) {
		const ultimateEntry = registry.get(ultimateId);
		if (ultimateEntry) return { entry: ultimateEntry, degraded: label };
	}

	// Nothing in the chain is registered. This only happens in an incomplete
	// build/test setup (register-defaults.ts always registers the ultimate
	// fallback) — fail loudly rather than fabricate a component to render.
	throw new Error(`registry: no '${ultimateId}' fallback registered (resolving '${primaryId}')`);
}

/**
 * The Edit a field's SHAPE asks for when it names none — the display contract states the shape
 * (`role`, `many`, the enum's choices, an object's sub-fields), so the default is derived from it
 * rather than from the wire type alone.
 */
function shapeEdit(field: FieldRow): string | null {
	if (isBodyField(field)) return 'markdown-body';
	if (isRelationField(field)) return 'relation-picker';
	if (field.many) {
		if (field.type === 'object') return 'list';
		return 'tags';
	}
	if (choicesOf(field)) return 'select-dropdown';
	if (field.type === 'object' && subFieldsOf(field).length) return 'nested';
	return null;
}

/** The View twin of `shapeEdit`. `context` matters for the body alone: a cell gets the type's own
 *  default, the record page the rendered document. */
function shapeView(field: FieldRow, context: 'cell' | 'record'): string | null {
	if (isBodyField(field)) return context === 'record' ? 'markdown' : null;
	if (isRelationField(field)) return 'relation';
	if (field.many) {
		if (field.type === 'object') return 'list';
		return 'tags';
	}
	if (choicesOf(field)) return 'label';
	if (field.type === 'object' && subFieldsOf(field).length) return 'nested';
	return null;
}

/**
 * An authored `editor`/`viewer` id the build has not registered falls back to the type's default,
 * and says so in the CONSOLE — never on screen. The field still renders, with the control its type
 * implies; a badge in the form would be a message to the person filling it in about a descriptor
 * they did not write.
 */
function warnUnregistered(axis: 'editor' | 'viewer', field: FieldRow, id: string): void {
	console.warn(`dreamteamer: ${field.collection ?? '?'}.${field.field} names ${axis} '${id}', which is not registered — drawing the ${field.type} default`);
}

/**
 * Which Edit draws `field`: its authored `editor` when registered, else the shape's default (a body,
 * a reference, a list, an enum, an object with sub-fields), else the wire type's.
 */
export function resolveEdit(field: FieldRow): Resolved<ExtensionDefinition> {
	const kindDefaultId = shapeEdit(field) ?? kindDefaultEdits[field.type] ?? EDIT_FALLBACK;
	const explicitId = field.editor;
	if (explicitId) {
		const explicitEntry = edits.get(explicitId);
		if (explicitEntry) return { entry: explicitEntry, degraded: null };
		warnUnregistered('editor', field, explicitId);
		return resolveChain(edits, kindDefaultId, kindDefaultId, EDIT_FALLBACK, `missing-edit-${explicitId}`);
	}
	return resolveChain(edits, kindDefaultId, kindDefaultId, EDIT_FALLBACK, null);
}

/** Mirrors `resolveEdit` on the read side, with the authored `viewer` first. */
export function resolveView(field: FieldRow, context: 'cell' | 'record' = 'cell'): Resolved<ExtensionDefinition> {
	const kindDefaultId = shapeView(field, context) ?? kindDefaultViews[field.type] ?? VIEW_FALLBACK;
	const explicitId = field.viewer;
	if (explicitId) {
		const explicitEntry = views.get(explicitId);
		if (explicitEntry) return { entry: explicitEntry, degraded: null };
		warnUnregistered('viewer', field, explicitId);
		return resolveChain(views, kindDefaultId, kindDefaultId, VIEW_FALLBACK, `missing-view-${explicitId}`);
	}
	return resolveChain(views, kindDefaultId, kindDefaultId, VIEW_FALLBACK, null);
}
