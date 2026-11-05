import { themeColor } from './collection-display';
/**
 * WHERE A RECORD COMES FROM — the webview half of the source mark (host: `src/sources.ts`).
 *
 * A collection on engine 0.35.0+ is a stack of roots: the workspace's own data, each record layer it
 * lists (another workspace cloned under `git_modules/`), and the folder a module-owned collection
 * keeps its shared list in. The host names each root — the workspace's `package.json` name, the
 * layer's `git_modules` key, the module's id — and stamps every list row and record with `$source`,
 * the name of the root it was read from. The collection row of the overview carries `sources`, every
 * root with the records read from it.
 *
 * Three rules, and no fourth (design 2026-10-28):
 *   1. MARK ONLY THE EXCEPTION. A record from the workspace's own root carries no mark; a workspace
 *      using neither layers nor module-owned lists looks exactly as it does today.
 *   2. THE MARK MEANS "READ FROM". `● name` — a dot in a colour hashed from the name, and the name,
 *      always together. Where an edit COMMITS is the commit action's to say, and nothing else's.
 *   3. THE GESTURE IS THE CHIP. Filtering by source is the ordinary filter rule, reached from the
 *      builder like any field and from the facet strip; a bare click on a mark does nothing hidden.
 *
 * Pure and its own module so every rule here is a test, not a render.
 */
import type { CollectionRow, FieldRow, SourceAccess, SourceEntry, SourceVia } from '../api/types';
import { newRule, type FilterGroup, type FilterRule } from './filter-query';

/** The wire key, and therefore the column's field name. `$`-prefixed like every synthetic key the
 *  adapter never persists — NOT `source`, which a module may author as a record field. */
export const SOURCE_FIELD = '$source';
/** `own` · `layer` · `module` beside it. */
export const SOURCE_KIND_FIELD = '$source-kind';
/** On an id more than one root holds: the names of BOTH roots, the first being the one read. */
export const DUPLICATES_FIELD = '$duplicates';

/** The id of the registered View that draws the mark (`views/ViewSource.vue`). */
export const SOURCE_VIEW = 'source';

/** The workspace's own root among a collection's sources, or undefined when the collection reads no
 *  own root (a module-owned list has none). */
export function ownSource(sources: readonly SourceEntry[] | undefined): SourceEntry | undefined {
	return sources?.find((s) => s.kind === 'own');
}

/** Does any root of the collection NOT belong to the workspace? Only then can a mark ever appear,
 *  and only then is `$source` a column at all. */
export function hasForeignSource(sources: readonly SourceEntry[] | undefined): boolean {
	return (sources ?? []).some((s) => s.kind !== 'own');
}

/** The sources that actually hold records, in root order. */
export function holdingSources(sources: readonly SourceEntry[] | undefined): SourceEntry[] {
	return (sources ?? []).filter((s) => s.installed && s.count > 0);
}

/** Do the rows SPAN more than one source? The Source column is on by default, the facet strip
 *  shows, and a card wears its corner mark. */
export function isMixed(sources: readonly SourceEntry[] | undefined): boolean {
	return holdingSources(sources).length > 1;
}

/**
 * The ONE foreign source every record comes from — a module-owned list, or a collection whose only
 * records are a layer's — or null. The browse says it once, under the title (*shared from org*),
 * instead of marking every row with the same word.
 */
export function singleForeignSource(sources: readonly SourceEntry[] | undefined): SourceEntry | null {
	const holding = holdingSources(sources);
	return holding.length === 1 && holding[0]!.kind !== 'own' ? holding[0]! : null;
}

/**
 * Is `name` the workspace's own root — the one that carries no mark? Answered against the
 * collection's sources when they are known, else against the workspace name the caller holds.
 */
export function isOwnSource(name: unknown, sources: readonly SourceEntry[] | undefined, workspace?: string): boolean {
	if (typeof name !== 'string' || !name) return true;
	const own = ownSource(sources);
	return own ? own.name === name : name === workspace;
}

/**
 * THE DEFAULT COLUMN RULE: the Source column joins the DEFAULT column set only when the rows span
 * more than one source; otherwise it sits in the column picker. Applied to the heuristic default,
 * never to a column set a view or the collection authored — an authored list is the author's answer.
 */
export function withSourceColumn(columns: string[], sources: readonly SourceEntry[] | undefined): string[] {
	if (!isMixed(sources) || columns.includes(SOURCE_FIELD)) return columns;
	return [...columns, SOURCE_FIELD];
}

/**
 * The `$source` FIELD ROW — the display contract's shape, so the column, the filter builder, the
 * group-by axis and the layout drawer treat it like any field. Its enum is the collection's sources
 * (a dropdown of names in the filter, bands in root order when grouped), its View is the mark, and
 * it is drawn on the list alone: the record page says its source under the title and in the
 * sidebar, and no form has a control for a fact the engine computes from the file.
 */
export function sourceFieldRow(collection: string, sources: readonly SourceEntry[]): FieldRow {
	const choices = sources.filter((s) => s.installed).map((s) => ({ label: s.name, value: s.name }));
	const options = { choices, sources: [...sources], own: ownSource(sources)?.name ?? null };
	return {
		collection,
		field: SOURCE_FIELD,
		type: 'string',
		title: 'Source',
		description: 'Where the record is read from — the workspace itself, a record layer, or a module’s shared list. Computed from the file; never stored.',
		required: false,
		kind: 'virtual',
		editable: false,
		nullable: true,
		hidden: ['form', 'record'],
		viewer: SOURCE_VIEW,
		viewer_options: options,
		editor_options: options,
	};
}

/**
 * THE DOT'S COLOUR — a stable slot in a small palette of theme colour ids, hashed from the name, so
 * `project-a` is the same colour on every surface and in every window. Theme ids, never hex (a hex
 * is authored against one theme and wrong in the other) — the same palette the gantt falls back to.
 */
const PALETTE = ['charts.blue', 'charts.orange', 'charts.purple', 'charts.green', 'charts.red', 'charts.yellow'] as const;

export function sourceColorId(name: string): string {
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
	return PALETTE[h % PALETTE.length]!;
}

/** The CSS for the dot: `var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))`. */
export function sourceColor(name: string): string {
	return themeColor(sourceColorId(name));
}

// ---- WHETHER A WRITE LANDS — the glyph vocabulary (cr-vscode-004) -----------------------------
// Every mark carries ONE trailing codicon, chosen by whether rows of that root are changed from here
// (decision 2026-10-31, "writability glyphs"): a PENCIL when they are (the workspace's own root, a
// linked clone, an installed layer — new records too when `access` is `write`), a LOCK when nothing is
// written from here (an installed package, a layer not installed). The root's CLASS and the exact
// writability are words — the hover on every mark, the picker row, the record page's source line and
// the target choice — never a third glyph. No `access` (a host older than this) draws no glyph.

/** The codicon each writability draws. */
export const ACCESS_GLYPH: Readonly<Record<SourceAccess, string>> = { write: 'edit', edit: 'edit', read: 'lock' };

/** What the root IS, in words. */
export function viaWord(via: SourceVia | undefined): string {
	return via === 'own' ? 'this workspace' : via === 'clone' ? 'linked clone' : via === 'layer' ? 'record layer' : via === 'package' ? 'installed package' : '';
}

/** Whether a write lands there, in words. */
export function accessWord(access: SourceAccess | undefined): string {
	return access === 'write' ? 'writes here' : access === 'edit' ? 'edits here · new records in its own workspace' : access === 'read' ? 'read-only' : '';
}

/** The hover of a mark: `project-a — record layer · writes here`, and the reason for anything less. */
export function markTitle(name: string, entry: { via?: SourceVia; access?: SourceAccess; note?: string; record?: string | null } = {}): string {
	const words = [viaWord(entry.via), accessWord(entry.access)].filter(Boolean).join(' · ');
	return [`${name}${words ? ` — ${words}` : ''}`, entry.note && entry.access !== 'write' ? entry.note : '', entry.record ?? ''].filter(Boolean).join('\n');
}

/** What a surface hands `SourceMark` for one record's root. */
export interface SourceMarkProps {
	name: string;
	record: string | null;
	access?: SourceAccess;
	via?: SourceVia;
	note?: string;
}

// ---- STUBS (engine 0.41.0) in the same vocabulary (cr-vscode-004, line 9; operator decision 6a) ------
// A record carrying `stub: true` YIELDS to any non-stub of its id in any root: the row shown is the
// non-stub, and the stubs are shadowed. The host names the roots holding the stubs a row shadows
// (`$stubs`); beside the row's mark the vocabulary says `● <stub root> stub · yields to <row's root>`.
// A row that IS a stub (no non-stub of its id anywhere this workspace reads) says `stub · yields to any
// non-stub of its id`. The engine's `stub` field itself stays an ordinary checkbox on the form.

/** The wire key: roots holding the stubs the answering record shadows. */
export const STUBS_FIELD = '$stubs';
/** The engine-owned field (0.41.0) that makes a record a stub. */
export const STUB_FIELD = 'stub';

/** What a row or a record says about stubs, or null when it says nothing: `stubs` — the roots holding
 *  stubs it shadows; `self` — it IS a stub; `winner` — its own root, which those stubs yield to. */
export function stubNoteOf(record: Record<string, unknown> | null | undefined): { stubs: string[]; self: boolean; winner: string | null } | null {
	if (!record) return null;
	const raw = record[STUBS_FIELD];
	const stubs = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : [];
	const self = record[STUB_FIELD] === true;
	if (!stubs.length && !self) return null;
	return { stubs, self, winner: typeof record[SOURCE_FIELD] === 'string' && record[SOURCE_FIELD] ? (record[SOURCE_FIELD] as string) : null };
}

/** The words beside a stub root's mark: `stub · yields to project-a`. */
export function yieldsWords(winner: string | null): string {
	return winner ? `stub · yields to ${winner}` : 'stub · yields to the copy shown';
}

/** The words for a record that is itself a stub with nothing to yield to here. */
export const SELF_STUB_WORDS = 'stub · yields to any non-stub of its id';

/** Beside a stub that answers, each other root's stub of the same id — shadowed by it, as the engine
 *  resolves a stubs-only id (first root wins). */
export const ALSO_STUB_WORDS = 'also a stub';

/** A source of the collection by name — what a surface holding only `$source` reads the class from. */
export function sourceEntry(sources: readonly SourceEntry[] | undefined, name: unknown): SourceEntry | undefined {
	return typeof name === 'string' ? sources?.find((s) => s.name === name) : undefined;
}

// ---- THE SOURCE PICKER (operator 2026-10-29) -------------------------------------------------
// It replaced the facet strip under the header: one control beside the filter button that shows the
// selection, and lists every source only while it is open. It writes the ORDINARY filter (one `$source`
// rule), so Save, the URL and the nav rows that open a layer all read the same thing — and since
// cr-vscode-004 the chips row draws that rule as a `Source is …` chip and the filter badge counts it.

/** The Source chip's words: `Source is project-a`, `Source is project-a · project-b` — ONE chip for the
 *  picker's one rule, whatever it names (decision 2026-10-31, "one Source chip"). */
export function sourceChipLabel(names: readonly string[]): string {
	return `Source is ${names.join(' · ')}`;
}

/** Is this the picker's rule — a `$source` is / is-one-of? */
export function isSourceRule(rule: FilterRule): boolean {
	return rule.field === SOURCE_FIELD && (rule.operator === '_eq' || rule.operator === '_in');
}

/** The sources the group narrows to, in rule order; EMPTY means all of them. */
export function selectedSources(group: FilterGroup): string[] {
	const out: string[] = [];
	for (const rule of group.rules) {
		if (!isSourceRule(rule)) continue;
		for (const v of Array.isArray(rule.value) ? rule.value : [rule.value]) if (typeof v === 'string' && !out.includes(v)) out.push(v);
	}
	return out;
}

/**
 * The group with its source rules replaced by ONE: none for all (`names` null or empty), `is` for a
 * single source — the same rule a layer's nav row opens with — `is one of` for several. Every other
 * rule is kept, in place.
 */
export function withSourceSelection(group: FilterGroup, names: readonly string[] | null): FilterGroup {
	const rules = group.rules.filter((r) => !isSourceRule(r));
	if (names?.length) {
		rules.push(newRule(names.length === 1 ? { field: SOURCE_FIELD, operator: '_eq', value: names[0]! } : { field: SOURCE_FIELD, operator: '_in', value: [...names] }));
	}
	return { ...group, rules };
}

/**
 * One click on a source row of the open picker. From ALL it narrows to that source alone; otherwise
 * it toggles it in or out — and a selection that ends up empty, or naming every source there is, IS
 * all, so it collapses back to no rule rather than a filter that matches everything the long way.
 */
export function toggleSource(group: FilterGroup, name: string, available: readonly string[]): FilterGroup {
	const current = selectedSources(group);
	const next = current.length === 0 ? [name] : current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
	const everything = available.length > 0 && available.every((n) => next.includes(n));
	return withSourceSelection(group, next.length === 0 || everything ? null : next);
}

/**
 * The part of a browse's remount key the SOURCES move: the names of the sources its collection row
 * carries — a layer installed, or a module-owned list compiled in, changes what the collection can show,
 * and only that: a list re-reads its records only when it remounts, and a count changing must not
 * remount it. (It was the private / shared scope's key until cr-vscode-004 removed the scope.)
 */
export function sourcesKey(row: Pick<CollectionRow, 'sources'> | null | undefined): string {
	return (row?.sources ?? []).map((s) => s.name).join(',');
}

/** The sources of a collection, read off its overview row. */
export function sourcesOf(row: Pick<CollectionRow, 'sources'> | null | undefined): SourceEntry[] | undefined {
	return row?.sources;
}

// ---- THE PICKER ON A HAND-BUILT LIST --------------------------------------------------------
// The Schema tab's Collections and Modules pages are tables of their own, not browses — but their
// rows are records of runtime kinds, each sourced to the module it was compiled from (host
// `runtimeSources`), so they carry the same picker (operator 2026-10-29: "all list views should have
// sources filter"). The page holds each row's `$source`; these two answer what the picker counts and
// which rows stay.

/** The collection's sources counted over the rows the page can show (`only`, when the tab is narrowed
 *  to a module), in the host's order; a source holding none of them is left out. */
export function facetsOver(sources: readonly SourceEntry[], sourceById: ReadonlyMap<string, string>, only?: readonly string[] | null): SourceEntry[] {
	const counts = new Map<string, number>();
	for (const [id, name] of sourceById) if (!only || only.includes(id)) counts.set(name, (counts.get(name) ?? 0) + 1);
	return sources.map((s) => ({ ...s, count: counts.get(s.name) ?? 0 })).filter((s) => s.count > 0);
}

/** Does the row stay under the picker's selection? Every row, when all sources are shown. */
export function keepsSource(group: FilterGroup, source: string | undefined): boolean {
	const picked = selectedSources(group);
	return picked.length === 0 || (source !== undefined && picked.includes(source));
}

// ---- WHERE A NEW RECORD GOES — the target choice (cr-vscode-004, decision 2026-10-31) ----------------
// New on a list that reads two or more roots a record can be ADDED to asks which one first — a popover
// under the header's +, before the form — unless the picker already narrows to exactly one such root.
// A target is an installed source whose `access` is `write` (the workspace's own root, a linked clone,
// a compiled layer; host `src/sources.ts`). Pure, so every branch is a unit test.

/** Can a new record be added to this root from here? */
export function isTarget(s: SourceEntry): boolean {
	return s.installed && s.access === 'write';
}

/** Why a source is not offered as a target — the host's own sentence where it sent one. */
export function notTargetReason(s: SourceEntry): string {
	if (s.note) return s.note;
	if (!s.installed) return `${s.name} is not installed`;
	return `${s.name} takes no new record from here`;
}

export type TargetChoice =
	/** Open the form at once — `target` is where it saves; null when the host said nothing about
	 *  writability (an older host), which is the form as it always opened. */
	| { mode: 'direct'; target: SourceEntry | null }
	/** Ask first. `excluded` is each NARROWED source that is not offered, with its reason; `others` the other
	 *  sources that take no new record, each with its reason — said in one '+N not offered' line rather than one
	 *  row each (cr-vscode-016) — and `hidden` their number. */
	| { mode: 'choose'; targets: SourceEntry[]; excluded: Array<{ source: SourceEntry; reason: string }>; others: Array<{ source: SourceEntry; reason: string }>; hidden: number };

/**
 * Decide what New does, from the collection's sources and the picker's selection:
 *   - the picker narrows to exactly ONE target → direct, to it;
 *   - it narrows to several targets → choose among those;
 *   - it narrows to sources none of which is a target → choose among EVERY target, each narrowed
 *     source listed as not offered with its reason;
 *   - nothing narrowed → several targets choose, one goes direct.
 */
export function targetChoice(sources: readonly SourceEntry[] | undefined, selection: readonly string[]): TargetChoice {
	const all = sources ?? [];
	if (!all.some((s) => s.access !== undefined)) return { mode: 'direct', target: null };
	const targets = all.filter(isTarget);
	const othersOf = (offered: readonly SourceEntry[], listed: readonly SourceEntry[]) =>
		all.filter((s) => s.installed && !offered.includes(s) && !listed.includes(s)).map((source) => ({ source, reason: notTargetReason(source) }));
	const choose = (targets: SourceEntry[], excluded: Array<{ source: SourceEntry; reason: string }>, others: Array<{ source: SourceEntry; reason: string }>): TargetChoice => ({ mode: 'choose', targets, excluded, others, hidden: others.length });
	const narrowed = selection.length ? all.filter((s) => selection.includes(s.name)) : [];
	if (narrowed.length) {
		const narrowedTargets = narrowed.filter(isTarget);
		if (narrowedTargets.length === 1) return { mode: 'direct', target: narrowedTargets[0]! };
		if (narrowedTargets.length > 1) return choose(narrowedTargets, [], []);
		return choose(targets, narrowed.map((source) => ({ source, reason: notTargetReason(source) })), othersOf(targets, narrowed));
	}
	if (targets.length === 1) return { mode: 'direct', target: targets[0]! };
	return choose(targets, targets.length ? [] : all.filter((s) => s.installed).map((source) => ({ source, reason: notTargetReason(source) })), targets.length ? othersOf(targets, []) : []);
}

// ---- THE NEW RECORD MENU'S CARD (cr-vscode-016) ------------------------------------------------------
// The menu draws a target row as its mark alone; every word about it is on a card that opens the moment the
// pointer is over the row. The lines are cr-vscode-013's HoverCard `lines` shape, so when that component lands
// the menu swaps its own card for it in one place and these builders stay.

/** One line of a hover card: the title, a body line, or a raw name in monospace. */
export interface HoverLine {
	text: string;
	kind?: 'title' | 'body' | 'code';
}

function wordsLine(s: SourceEntry): HoverLine[] {
	const words = [viaWord(s.via), accessWord(s.access)].filter(Boolean).join(' · ');
	return words ? [{ text: words, kind: 'body' }] : [];
}

/** A target row's card: the full name, its kind and writability in words, and the host's note when it sent one. */
export function targetHoverLines(s: SourceEntry): HoverLine[] {
	return [{ text: s.name, kind: 'title' }, ...wordsLine(s), ...(s.note ? [{ text: s.note, kind: 'body' as const }] : [])];
}

/** A narrowed source that is not offered: the name and its kind — its reason is visible text under its mark. */
export function excludedHoverLines(x: { source: SourceEntry; reason: string }): HoverLine[] {
	return [{ text: x.source.name, kind: 'title' }, ...wordsLine(x.source)];
}

/** The '+N not offered' line's card: one line per source, its reason (which names the source). */
export function othersHoverLines(others: ReadonlyArray<{ source: SourceEntry; reason: string }>): HoverLine[] {
	return [{ text: 'Not offered here', kind: 'title' }, ...others.map((x) => ({ text: x.reason, kind: 'body' as const }))];
}

/** The card's widest — its CSS `max-width` when the viewport allows. */
export const CARD_MAX = 280;

/**
 * Where the card goes, beside the menu that hangs from the + at the header's right edge: LEFT of the menu when
 * it fits there, else RIGHT of it, else BELOW the menu (covering none of its rows) with its x clamped into the
 * viewport. `rowTop` is the hovered row's top relative to the menu; `left` (below only) is relative to the menu.
 */
export function cardPlace(menu: { left: number; right: number; height: number }, rowTop: number, cardWidth: number, viewportWidth: number): { side: 'left' | 'right' | 'below'; top: number; left?: number } {
	if (menu.left - 4 - cardWidth >= 4) return { side: 'left', top: rowTop };
	if (menu.right + 4 + cardWidth <= viewportWidth - 4) return { side: 'right', top: rowTop };
	const x = Math.max(4, Math.min(menu.left, viewportWidth - cardWidth - 4));
	return { side: 'below', top: menu.height + 4, left: x - menu.left };
}

// ---- the commit action --------------------------------------------------------------------------

/** One pending record as `dt commit --dry-run` reports it, under the repo that will hold the commit. */
export interface PendingRepo {
	repo: string;
	rows: Array<{ collection: string; id: string; verb?: string }>;
}

/**
 * What the commit button CALLS its target. The engine names a repo by its workspace-relative path
 * (`.` for the workspace itself, `git_modules/org` for a clone); the button says the workspace's own
 * name for `.` and the path otherwise — a path is honest about which clone, and a layer's name
 * alone would hide that an inline module's records commit to the WORKSPACE (source ≠ repo, which
 * is the whole reason the commit action, not the mark, says where an edit lands).
 */
export function commitRepoLabel(repo: string, workspace: string | undefined): string {
	return repo === '.' ? (workspace || 'this workspace') : repo;
}

/** The repos with something pending, each with its count — the dropdown's rows. */
export function pendingByRepo(results: readonly PendingRepo[] | undefined): Array<{ repo: string; count: number; only: string[] }> {
	return (results ?? [])
		.filter((r) => (r.rows?.length ?? 0) > 0)
		.map((r) => ({ repo: r.repo, count: r.rows.length, only: r.rows.map((row) => `${row.collection}/${row.id}`) }));
}
