/**
 * THE TEMPLATE GRAMMAR (descriptor format v2, §3.7) — a PORT of the engine's `src/template.js`, kept
 * byte-for-byte equivalent by ONE shared vector file run against both (`test/fixtures/
 * template-vectors.json`, `test/unit/template-grammar.test.ts`).
 *
 *   token    {{ field }} · {{ field | filter }} · {{ field | filter:arg | … }}
 *   field    a declared field, or a built-in: `id`, `created`, `last_modified`
 *   filters  date[:fmt] · datetime · slug · pad:n · basename — nothing else
 *
 * One grammar for every display position this app draws: `record_title`, `display.record.subtitle`,
 * and the layout options `card_title`, `group_title`, `group_summary`. A REFERENCE field renders
 * through the target record's own `record_title` (`resolve`), so `{{ doctor }}` reads as the
 * doctor's name rather than their id.
 *
 * ⚠ WHY A PORT AND NOT THE HOST. The engine exports this grammar and the host could render with it,
 * but the view-level templates are not the host's to know: `card_title`, `group_title` and
 * `group_summary` are LAYOUT OPTIONS, edited live in the options panel against rows the webview
 * already holds, and a card renders its tokens through their Views (a status as its chip, a date in
 * the viewer's zone) inside markdown — which a pre-rendered string cannot carry. So the grammar runs
 * here, and the vectors are what make "two implementations" a claim a test can refute.
 *
 * ⚠ NO DOTTED PATHS. `{{ assignee.name }}` was a webview-only extension the engine never had; under
 * the one grammar it names a field called `assignee.name`, which no record carries, and renders ''.
 */

/** The filters the grammar accepts, in the engine's order. */
export const FILTERS = ['date', 'datetime', 'slug', 'pad', 'basename'] as const;
/** The fields every collection carries, so a template may name them without declaring them. */
export const BUILTINS = ['id', 'created', 'last_modified'] as const;

export interface TemplateFilter {
	name: string;
	arg?: string;
}

/** One piece of a parsed template: literal `text`, or a `{{ field | filter… }}` token. */
export type TemplatePart = { text: string } | { field: string; filters: TemplateFilter[] };

/** The options `renderDisplay` takes — the engine's, by name. */
export interface RenderOptions {
	/** A reference value → the target's own record title, or undefined while it is unknown. */
	resolve?: (ref: string) => string | undefined;
	/** Whether `field` holds references — the only fields `resolve` is asked about. */
	isReference?: (field: string) => boolean;
}

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Split a template into literal text and tokens, in source order. Throws on a non-string. */
export function parseTemplate(tpl: string): TemplatePart[] {
	if (typeof tpl !== 'string') throw new Error('a template is a string');
	const parts: TemplatePart[] = [];
	let last = 0;
	for (const m of tpl.matchAll(TOKEN)) {
		const at = m.index ?? 0;
		if (at > last) parts.push({ text: tpl.slice(last, at) });
		const [field = '', ...rest] = (m[1] ?? '').split('|').map((x) => x.trim());
		parts.push({
			field,
			filters: rest.map((f) => {
				const [name = '', arg] = f.split(':').map((x) => x.trim());
				return arg === undefined ? { name } : { name, arg };
			}),
		});
		last = at + m[0].length;
	}
	if (last < tpl.length) parts.push({ text: tpl.slice(last) });
	return parts;
}

/** The fields a template names, in order, built-ins included. */
export function templateFields(tpl: string): string[] {
	return parseTemplate(tpl).flatMap((p) => ('field' in p ? [p.field] : []));
}

/**
 * Render ONE token against a record — `renderDisplay` is a join of these. Exported because
 * `DisplayTemplate.vue` draws a bare token through its View and only spells out the rest.
 */
export function renderToken(part: { field: string; filters: TemplateFilter[] }, record: Record<string, unknown>, opts: RenderOptions = {}): string {
	const { resolve, isReference } = opts;
	let value: unknown = record[part.field];
	if (value === undefined || value === null || value === '') return '';
	if (Array.isArray(value)) value = value.map((v) => (isReference?.(part.field) && resolve ? resolve(v as string) ?? v : v)).join(', ');
	else if (isReference?.(part.field) && resolve) value = resolve(value as string) ?? value;
	for (const f of part.filters) value = applyFilter(f.name, f.arg, value);
	if (value instanceof Date) value = fmtDate(value, 'YYYY-MM-DD');
	return String(value);
}

/**
 * Render a DISPLAY template against one record. A missing value renders as ''; an unknown filter
 * THROWS, as the engine's does (compile refuses one, so only a template typed live can carry it —
 * `tryRenderDisplay` is the form a surface calls).
 */
export function renderDisplay(tpl: string, record: Record<string, unknown>, opts: RenderOptions = {}): string {
	return parseTemplate(tpl)
		.map((p) => ('text' in p ? p.text : renderToken(p, record, opts)))
		.join('');
}

/** `renderDisplay`, or null when the template cannot render (an unknown filter typed into a view). */
export function tryRenderDisplay(tpl: string, record: Record<string, unknown>, opts: RenderOptions = {}): string | null {
	try {
		return renderDisplay(tpl, record, opts);
	} catch {
		return null;
	}
}

function applyFilter(name: string, arg: string | undefined, value: unknown): unknown {
	switch (name) {
		case 'date':
			return fmtDate(value, arg || 'YYYY-MM-DD');
		case 'datetime':
			return asDate(value).toISOString().slice(0, 19).replace(/:/g, '-');
		case 'slug':
			return slugOrHash(String(value));
		case 'pad':
			return String(value).padStart(Number(arg) || 0, '0');
		case 'basename':
			return String(value).split('/').pop();
		default:
			throw new Error(`unknown template filter "${name}" — the filters are ${FILTERS.join(' · ')}`);
	}
}

const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string));

// A date or date-time STRING renders as written, in its own offset; only a Date object reads the
// machine's zone. Tokens are replaced longest-first so `MM` cannot eat the `M` of a minute pattern.
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
function fmtDate(v: unknown, fmt: string): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const m = typeof v === 'string' ? WALL_CLOCK.exec(v) : null;
	let tokens: Record<string, string>;
	if (m) {
		tokens = { YYYY: m[1]!, MM: m[2]!, DD: m[3]!, HH: m[4] ?? '00', mm: m[5] ?? '00', ss: m[6] ?? '00' };
	} else {
		const d = asDate(v);
		tokens = {
			YYYY: String(d.getFullYear()),
			MM: pad(d.getMonth() + 1),
			DD: pad(d.getDate()),
			HH: pad(d.getHours()),
			mm: pad(d.getMinutes()),
			ss: pad(d.getSeconds()),
		};
	}
	return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => tokens[t] ?? t);
}

export function slug(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** A text with no Latin letters slugs to '' — fall back to a short deterministic hash. */
export function slugOrHash(s: string): string {
	const out = slug(s);
	if (out) return out;
	let h = 0;
	for (const ch of s) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
	return 'x' + h.toString(36).padStart(7, '0');
}
