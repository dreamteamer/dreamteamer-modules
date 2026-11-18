/**
 * The field editor's DISPLAY keys (descriptor v2, §3.4.2), read and written on the designer's staged
 * def — pure, so each control's round-trip is a test. `lib/field-def.ts` turns the def into the
 * field's `display` block; these helpers are the def's side of that contract:
 *
 *   editable      true (default, the key is absent) · false · 'create' (only on the create form)
 *   hidden        `true` (every surface — the grid's one toggle) or a list of `list`/`form`/`record`
 *   form_section · placeholder · unit · unit_field · direction · width — one value each; an empty
 *                 value removes the key, so an untouched field writes nothing it did not have.
 */
import { SURFACES, hiddenSurfaces } from './field-def';

type Def = Record<string, unknown>;
export type Editable = 'true' | 'false' | 'create';
export type Surface = (typeof SURFACES)[number];

export function editableOf(def: Def): Editable {
	if (def['editable'] === false || def['readonly'] === true) return 'false';
	return def['editable'] === 'create' ? 'create' : 'true';
}

export function setEditable(def: Def, value: Editable): void {
	delete def['readonly'];
	if (value === 'true') delete def['editable'];
	else def['editable'] = value === 'false' ? false : 'create';
}

export function isHiddenOn(def: Def, surface: Surface): boolean {
	return hiddenSurfaces(def).includes(surface);
}

/** Every surface is `true`, none removes the key, anything between is the list. */
export function setHiddenOn(def: Def, surface: Surface, hidden: boolean): void {
	const now = new Set(hiddenSurfaces(def));
	if (hidden) now.add(surface);
	else now.delete(surface);
	if (now.size === SURFACES.length) def['hidden'] = true;
	else if (now.size === 0) delete def['hidden'];
	else def['hidden'] = SURFACES.filter((s) => now.has(s));
}

/** A one-value display key: empty removes it. */
export function setText(def: Def, key: 'form_section' | 'placeholder' | 'unit' | 'unit_field', value: string): void {
	const v = value.trim();
	if (v) def[key] = v;
	else delete def[key];
}

/** `rtl`, or the default `ltr` — which is stated by saying nothing. */
export function setDirection(def: Def, value: string): void {
	if (value === 'rtl') def['direction'] = 'rtl';
	else delete def['direction'];
}

/** A list column hint in characters; anything that is not a positive whole number removes it. */
export function setWidth(def: Def, value: string | number): void {
	const n = typeof value === 'number' ? value : Number(String(value).trim());
	if (Number.isInteger(n) && n > 0) def['width'] = n;
	else delete def['width'];
}

/** The width as the control shows it — a stale grid layout word (`half`) shows as blank. */
export function widthOf(def: Def): string {
	const w = def['width'];
	return typeof w === 'number' ? String(w) : typeof w === 'string' && /^\d+$/.test(w) ? w : '';
}

/** `unit_field` names the sibling holding a currency code, so it only means something for `currency`. */
export function unitFieldApplies(def: Def): boolean {
	return def['unit'] === 'currency';
}
