/**
 * The designer's staged def → ONE v2 FIELD, the shape a descriptor's `fields` map holds (descriptor
 * v2, §3.4.1 and §3.4.2) and the shape `POST`/`PATCH /fields/:c` take whole. Pure, so the mapping is
 * a test rather than a click.
 *
 * The def is the drawer's vocabulary — a logical `type` (`relation`, `list` of relations, `tags` with
 * its element type in `of`, or an authored type name), `target`, `required`, `default`, the enum as `editor_options.choices`, the
 * relation as `link_side` / `far_field` / `unique` / `on_delete`, and the display keys
 * (`editable`, `readonly`, `hidden`, `form_section`, `placeholder`, `unit`, `unit_field`,
 * `direction`, `width`, `editor`, `viewer`, `editor_options`, `viewer_options`).
 *
 * ⚠ A WHOLE FIELD REPLACES THE ONE IN THE SOURCE, so it is built OVER the field as its source
 * authored it (`authored`): every key the drawer models is restated from the def — set or removed —
 * and every key it does not model (`pattern`, `examples`, `sensitive`, `deprecated`, an object's
 * `fields`, a display option the drawer has no control for, …) is carried exactly as written. A field
 * built from a presentation row alone would silently drop all of those on the first save.
 *
 * ⚠ ONE RELATION SPELLING: the generated far side carries `mirror_of: <the key's field>` and its
 * type is the key's collection; the key is an ordinary reference that says nothing about it, except
 * `unique: true` when its mirror is a single value (§3.4.1).
 */

/** The keys of a field the drawer states; anything else in the source is carried. */
const MODELED = ['type', 'required', 'many', 'default', 'enum', 'unique', 'mirror_of', 'on_delete', 'description'];
/** The `display` keys the drawer states (§3.4.2). */
const DISPLAY_MODELED = ['editable', 'hidden', 'form_section', 'placeholder', 'unit', 'unit_field', 'direction', 'width', 'viewer', 'editor', 'options'];
/** Component-option keys that are not authored options: the engine projects them from the field. */
const PROJECTED_OPTIONS = ['choices', 'fields', 'item_title'];
/** The surfaces a field can be hidden from. */
export const SURFACES = ['list', 'form', 'record'] as const;
/** §3.4.1's canonical key order — how a written field reads. */
const KEY_ORDER = ['type', 'title', 'required', 'many', 'default', 'enum', 'unique', 'mirror_of', 'on_delete', 'soft', 'sensitive', 'body', 'derived', 'virtual', 'deprecated', 'passthrough', 'fields', 'values', 'item_title', 'examples', 'pattern', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'const', 'display', 'description'];

type Def = Record<string, unknown>;
type Field = Record<string, unknown>;

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `/collection` or `collection` → `collection`. */
function bare(target: unknown): string {
	return typeof target === 'string' ? target.replace(/^\//, '') : '';
}

function holdsRelations(def: Def): boolean {
	const of = def['of'];
	return of === 'relation' || (isMap(of) && of['type'] === 'relation');
}

/** A scalar list's element type, from the def's `of`: a type name stays itself, anything else is a
 *  list of strings. */
function scalarOf(of: unknown): string {
	return typeof of === 'string' && of && of !== 'relation' && of !== 'object' ? of : 'string';
}

/** The hidden surfaces a def states: `true` is every surface (the grid's one toggle), a list is itself. */
export function hiddenSurfaces(def: Def): string[] {
	const h = def['hidden'];
	if (h === true) return [...SURFACES];
	return Array.isArray(h) ? SURFACES.filter((s) => h.includes(s)) : [];
}

/** The enum a def's choice rows state: a plain list, or a map when any value carries decoration. */
function enumOf(def: Def): unknown[] | Record<string, Record<string, unknown>> | undefined {
	const options = def['editor_options'];
	const choices = isMap(options) ? options['choices'] : undefined;
	if (!Array.isArray(choices) || !choices.length) return undefined;
	const rows: Record<string, unknown>[] = choices.map((c) => (isMap(c) ? c : { value: c }));
	const decorated = rows.some((r) => (r['label'] !== undefined && String(r['label']) !== String(r['value'])) || ['description', 'icon', 'color', 'background'].some((k) => typeof r[k] === 'string' && r[k]));
	if (!decorated) return rows.map((r) => r['value']);
	const out: Record<string, Record<string, unknown>> = {};
	for (const r of rows) {
		const entry: Record<string, unknown> = {};
		if (r['label'] !== undefined && String(r['label']) !== String(r['value'])) entry['label'] = r['label'];
		for (const k of ['description', 'icon', 'color', 'background']) if (typeof r[k] === 'string' && r[k]) entry[k] = r[k];
		out[String(r['value'])] = entry;
	}
	return out;
}

/** The authored component options a def carries: both panels' options, minus what the engine projects. */
function optionsOf(def: Def): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of ['editor_options', 'viewer_options']) {
		const o = def[key];
		if (!isMap(o)) continue;
		for (const [k, v] of Object.entries(o)) if (!PROJECTED_OPTIONS.includes(k)) out[k] = v;
	}
	return out;
}

function ordered(field: Field): Field {
	const rank = (k: string) => { const i = KEY_ORDER.indexOf(k); return i < 0 ? KEY_ORDER.length : i; };
	return Object.fromEntries(Object.keys(field).sort((a, b) => rank(a) - rank(b)).map((k) => [k, field[k]]));
}

export interface FieldFromDef {
	/** The v2 field, or null when the def cannot be expressed as one (a new structured object). */
	field: Field | null;
	/** What the def says that a v2 field has no place for — named back so the caller can warn. */
	unsaved: string[];
}

export function fieldFromDef(def: Def, authored: Field = {}): FieldFromDef {
	const unsaved: string[] = [];
	const out: Field = {};
	for (const [k, v] of Object.entries(authored)) if (!MODELED.includes(k) && k !== 'display') out[k] = structuredClone(v);

	// ---- type and cardinality -----------------------------------------------------------------------
	const type = typeof def['type'] === 'string' ? (def['type'] as string) : 'string';
	const target = bare(def['target']);
	const relation = type === 'relation' || (type === 'list' && holdsRelations(def));
	const mirror = relation && def['link_side'] === 'target' && typeof def['far_field'] === 'string' && def['far_field'] !== '';
	if (relation) {
		out['type'] = target && target !== '*' ? target : 'reference';
		if (type === 'list') out['many'] = true;
	} else if (type === 'tags' || type === 'list') {
		// a list of scalars of the element type `of` names (a list with none is of strings); a list of
		// rows stays the object it was authored as
		out['type'] = authored['type'] === 'object' ? 'object' : scalarOf(def['of']);
		out['many'] = true;
	} else {
		out['type'] = type;
		if (def['many'] === true) out['many'] = true;
	}
	if (out['type'] === 'object' && !isMap(out['fields'])) {
		// an object's rows are `fields`, which the drawer does not author — a new one is a descriptor edit
		return { field: null, unsaved: ['an object field\'s sub-fields'] };
	}

	// ---- facts about the data -----------------------------------------------------------------------
	if (def['required'] === true) out['required'] = true;
	if (def['default'] !== undefined && def['default'] !== null && def['default'] !== '') out['default'] = def['default'];
	const enumeration = out['type'] === 'string' ? enumOf(def) : undefined;
	if (enumeration) out['enum'] = enumeration;
	if (mirror) {
		out['mirror_of'] = def['far_field'];
	} else if (relation) {
		if (def['unique'] === true) out['unique'] = true;
		if (def['on_delete'] === 'set-null') out['on_delete'] = 'set-null';
	} else if (def['unique'] === true) {
		out['unique'] = true;
	}
	if (typeof def['description'] === 'string' && def['description']) out['description'] = def['description'];

	// ---- display (§3.4.2) ---------------------------------------------------------------------------
	const display: Record<string, unknown> = isMap(authored['display']) ? structuredClone(authored['display']) : {};
	for (const k of DISPLAY_MODELED) delete display[k];
	if (def['readonly'] === true || def['editable'] === false) display['editable'] = false;
	else if (def['editable'] === 'create') display['editable'] = 'create';
	const hidden = hiddenSurfaces(def);
	if (hidden.length) display['hidden'] = hidden;
	for (const k of ['form_section', 'placeholder', 'unit', 'unit_field', 'editor', 'viewer']) {
		if (typeof def[k] === 'string' && def[k]) display[k] = def[k];
	}
	if (def['direction'] === 'rtl') display['direction'] = 'rtl';
	const width = def['width'];
	if (typeof width === 'number' && width > 0) display['width'] = width;
	else if (typeof width === 'string' && /^\d+$/.test(width)) display['width'] = Number(width);
	else if (typeof width === 'string' && width) unsaved.push(`width "${width}" (a field's width is a list column hint in characters)`);
	// The row projects the authored `display.options` into both panels' options, so the def's options
	// ARE the authored ones as the drawer last left them — replaced, so removing one removes it.
	const options = optionsOf(def);
	if (Object.keys(options).length) display['options'] = options;
	else delete display['options'];
	if (Object.keys(display).length) out['display'] = display;

	if (typeof def['note'] === 'string' && def['note']) unsaved.push('note (a field has one description)');
	return { field: ordered(out), unsaved };
}

/** Two defs that write the same field over the same source. */
export function sameField(a: Def, b: Def, authored: Field = {}): boolean {
	return JSON.stringify(fieldFromDef(a, authored).field) === JSON.stringify(fieldFromDef(b, authored).field);
}
