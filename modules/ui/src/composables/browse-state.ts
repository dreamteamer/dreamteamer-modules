/**
 * Shared browse state for ContentBrowse (phase E scope item 3-4): fields/items data, search,
 * filter, column selection, sort, pagination, and the table/cards layout toggle — everything a
 * saved view (`lib/view-state.ts`) captures. Extracted from what used to be DataTable-internal
 * state (see git history) so ContentBrowse can own ONE instance and hand it to either DataTable
 * (table rows) or ListCards (card grid) as a plain prop — both are now thin renderers, not
 * independent state owners, so switching layout never re-fetches or loses in-progress
 * search/filter/column state.
 *
 * URL sync covers `search`/`filter` (unchanged from the pre-E contract) plus the new `layout`
 * query param (scope item 3: "persisted per collection in the URL query (?layout=cards) alongside
 * existing search/filter params"). Column selection stays in localStorage per collection
 * (pre-existing mechanism — "disposable browser convenience, not a preferences
 * store" — unchanged); sort stays in-memory only, same as before phase E. Applying a saved view
 * writes directly into these refs/the URL rather than round-tripping sort/columns through the URL
 * too — nothing here regresses the pre-E persistence contract, it only adds `layout`.
 *
 * Browse-restyle additions (BROWSE wave): an optional `rowTo` override for `openRecord`, so a
 * caller (BrowseView) can redirect row-clicks to a bespoke detail page while everything else
 * about the collection stays generic.
 * Also adds batch-selection state (checkbox column + header-bar delete) — page/query-scoped, see
 * the watcher below.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { api } from '../api/client';
import type { FieldRow, ItemRecord } from '../api/types';
import { choicesOf, isBodyField } from '../lib/field-row';
import { useCollections } from './collections';
import { useFields } from './fields';
import { useItems } from './items';
import { compileFilter, emptyFilterGroup, serializeFilterGroup, type FilterGroup } from '../lib/filter-query';
import { SOURCES_QUERY, TARGET_QUERY, takeCreated, widenedFor, type CreatedNote } from '../lib/created-visibility';
import { filterFromUrl, seedFilter } from '../lib/view-filter';
import { effectiveLimit } from '../lib/page-size';
import { currentContentBasePath } from '../lib/content-path';
import { resolveView } from '../registry/resolve';
import { listSeed, scratchKey as scratchKeyFor } from '../lib/list-seed';
import { templateFields } from '../lib/template';
import { recordTitle, referenceTitles } from '../lib/record-titles';
import { colorByFor, isReferenceField, tintOf as tintOf_, tintStyle } from '../lib/collection-display';
import { SOURCE_FIELD, isMixed, isOwnSource, selectedSources, sourceEntry, stubNoteOf, targetChoice, withSourceColumn, withSourceSelection, type SourceMarkProps, type TargetChoice } from '../lib/sources';
import type { BrowseLayout, ViewState } from '../lib/view-state';

function isValidLayout(value: unknown): value is BrowseLayout {
	// A layout id is any non-empty string now (module Lists, not just table/cards) — the registry
	// resolves whether it actually renders (lib/presets.ts#resolveRendererEntry), degrading if not.
	return typeof value === 'string' && value.length > 0;
}

// ---- default column selection (polish wave defect 3) -----------------------------------------
// Naive `slice(0, 6)` used to pick whatever 6 fields the server happened to declare first — on
// `tasks` that's 6+ columns including a `run` path field (horizontal scroll), on `humans` it put
// the markdown `body` field first. This ranks fields into priority buckets and caps at 5, so a
// fresh browse (no saved view, no localStorage selection yet) always leads with the record's
// title-ish field and its status, not whatever the descriptor happened to list first.
const TITLE_FIELD_NAMES = new Set(['title', 'name']);
const STATUS_FIELD_PATTERN = /status|state|stage|priority|kind/i;
const SHORT_SCALAR_TYPES = new Set(['string', 'date', 'datetime', 'integer', 'number', 'boolean', 'url', 'email']);

function hasChoices(field: FieldRow): boolean {
	return choicesOf(field) !== null;
}

/** object/map fields (would render "[object Object]"/lose the point of a column) and the markdown
 * body field never make the default cut — still reachable via Layout options' field toggles. */
function isExcludedFromDefault(field: FieldRow): boolean {
	// a computed `$` field (source, module, authors) is there to be ADDED — `$source` joins the default
	// set on its own condition (`withSourceColumn`), the rest never do (`lib/computed-fields.ts`)
	return field.type === 'object' || field.type === 'map' || isBodyField(field) || field.field.startsWith('$');
}

function isStatusish(field: FieldRow): boolean {
	return hasChoices(field) || STATUS_FIELD_PATTERN.test(field.field);
}

/** Lower sorts first: 0 title-ish, 1 enum/status-ish, 2 short scalar, 3 everything else eligible. */
function columnPriority(field: FieldRow): number {
	if (TITLE_FIELD_NAMES.has(field.field)) return 0;
	if (isStatusish(field)) return 1;
	if (SHORT_SCALAR_TYPES.has(field.type)) return 2;
	return 3;
}

/**
 * The "no saved view / no prior localStorage selection" default column set: title field first,
 * then status-ish, then short scalars, then whatever's left — excluding json/body fields — capped
 * at `max`. Exported for the pure-function unit test (see test/browse-state-columns.test.ts); a
 * ties-broken-by-original-order sort keeps the server's declared field order stable within a
 * priority bucket rather than depending on `Array.prototype.sort`'s stability guarantee alone.
 */
export function defaultColumns(fields: FieldRow[], max = 5): FieldRow[] {
	return fields
		.map((field, index) => ({ field, index }))
		.filter((entry) => !isExcludedFromDefault(entry.field))
		.sort((a, b) => columnPriority(a.field) - columnPriority(b.field) || a.index - b.index)
		.slice(0, max)
		.map((entry) => entry.field);
}

/**
 * ui-view page config (UiViewPage → BrowseView): pins the initial layout, applies a base
 * server-side filter under every user filter (`_and`-combined), and pins the column set/order —
 * without touching the regular browse's localStorage column selection.
 */
export interface BrowseViewConfig {
	/** Initial layout id (a URL ?layout= still wins). */
	layout?: string;
	/**
	 * A NAMED ui-view's `filter`, in the engine's own shape.
	 *
	 * ⚠ This used to be applied server-side and kept INVISIBLE to the FilterBuilder, justified by a
	 * filter that "may carry an already-resolved `@me` and so must not round-trip through Save". That
	 * hazard died in engine 0.8.0 — `@me` was removed with the `users` collection, and compile now
	 * REFUSES a ui-view filter containing it, by name. What the invisibility actually produced was a
	 * table showing 90 of 429 rows over a panel that said "No filters yet".
	 *
	 * It is now DECOMPILED into editable conditions (`decompileFilter`), so the panel shows what is
	 * applied and Save writes it back to the view record — decision 36's rule that view state belongs
	 * in a record, finally true of the filter too. It stays applied server-side ONLY in the fallback
	 * case below: a filter the flat builder cannot represent (nested groups, mixed `_and`/`_or`).
	 */
	baseFilter?: Record<string, unknown>;
	/** Column set AND order from the governing view record. */
	columns?: string[];
	/** Sort field from the governing view record (`-field` for descending). */
	sort?: string;
	/** Per-List declared options from the governing view record, keyed by list id. */
	listOptions?: Record<string, Record<string, unknown>>;
	/** Record id of the governing view — what "Save" writes back to. Absent = unsaved default. */
	viewId?: string;
	/**
	 * Write `search`/`filter`/`layout` back into the route query. TRUE (the default) for a browse
	 * that IS the page; FALSE for one EMBEDDED in another page — a relation field's view
	 * (`components/RelationField.vue`).
	 *
	 * ⚠ Not cosmetic. An embedded browse shares the record page's route, so a URL-syncing one would
	 * rewrite the RECORD's own query string — and a record with three relation fields would have
	 * three of them fighting over the same three keys, each `router.replace` racing the others. An
	 * embedded browse is presentation of a value already on screen; it has no address of its own.
	 */
	urlSync?: boolean;
	/**
	 * Extra key material for the unsaved-tweaks scratch pad, which is otherwise keyed
	 * `<collection>::<viewId>`. An embedded browse renders the SAME view record as the target
	 * collection's own browse page, so without this the two share one scratch — and a column hidden
	 * on the browse page would silently vanish from every embedded copy of that view too.
	 */
	scratchScope?: string;
	/**
	 * `baseFilter` is SCOPE, not a filter: apply it server-side under everything and keep it out of
	 * the builder, out of the chips, and out of anything Save would write.
	 *
	 * The one caller is the embedded relation view, whose base filter is the set of ids the relation
	 * field names. It decompiles perfectly, so without this it would appear as an editable rule with
	 * 52 values and a ✕ that widens the row to the whole collection. See `lib/view-filter.ts`.
	 */
	baseFilterOpaque?: boolean;
}

/**
 * UNSAVED tweaks, per collection+view, for this session only.
 *
 * Column choice and order used to live in localStorage, which made them invisible to git, to
 * agents, and to every other machine — exactly the state decision 36 says belongs in a record.
 * Now the RECORD is the source of truth and this is only the scratch pad you work in before
 * hitting Save. It is deliberately in memory: reload and you are back to what is committed, so
 * "what is in git" and "what I see" can never silently diverge across sessions.
 */
interface Scratch {
	layout: string;
	columns: string[];
	sort: string;
	listOptions: Record<string, Record<string, unknown>>;
	/**
	 * The filter builder's conditions — as much part of the view record as the columns are.
	 *
	 * ⚠ `null` for a view whose stored filter could NOT be decompiled (`baseFilterIsOpaque`): the
	 * builder never held it, so comparing against it would read as permanently dirty and saving
	 * from it would FLATTEN a nested group away. Null means "this half is not the builder's to
	 * speak for" — `apply` leaves the live filter alone and Save preserves what the record says.
	 */
	filter: FilterGroup | null;
}
const scratchByView = new Map<string, Scratch>();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function useBrowseState(collection: string, rowTo?: (record: ItemRecord) => RouteLocationRaw, config?: BrowseViewConfig) {
	const router = useRouter();
	const route = useRoute();

	// ⚠ Symmetrical with the URL WRITE below: a browse that does not own the route must not read it
	// either. An embedded browse arriving on a record page that still carries a `?filter=` from the
	// list it was opened from would seed itself with a filter meant for a different collection.
	const ownsUrl = config?.urlSync !== false;
	const urlFilter = ownsUrl && typeof route.query['filter'] === 'string' ? route.query['filter'] : null;
	// A view's own filter SEEDS the builder, so the panel shows what the table is doing. The URL wins
	// when it carries one: that is the operator having already edited this session, and re-seeding
	// from the record would throw their edit away on every navigation.
	// One decision, made in `lib/view-filter.ts` where it can be run by a test: what the builder
	// starts with, what the RECORD says (the baseline half of `dirty` and what Reset returns to),
	// and whether the stored filter is opaque. ⚠ Opacity is decided by the DECOMPILE, never by
	// "did we seed" — see that module's header for the double-apply this caused.
	const { initial: initialFilter, record: recordFilter, opaque: baseFilterIsOpaque } = seedFilter(
		config?.baseFilter,
		urlFilter,
		config?.baseFilterOpaque === true,
	);

	/**
	 * Combine the pinned base filter with the user's compiled filter (both optional).
	 *
	 * ⚠ Once the view's filter has been decompiled into visible conditions it is part of `compiled`,
	 * so anding it in again would apply it TWICE — harmless for `_eq`, wrong the moment anyone edits
	 * the seeded condition (the old value would still be anded underneath and the edit would appear
	 * to do nothing). It is only combined in the opaque case, where it never reached the builder.
	 */
	function effectiveFilter(compiled: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
		const base = baseFilterIsOpaque ? config?.baseFilter : undefined;
		if (!base) return compiled;
		if (!compiled) return base;
		return { _and: [base, compiled] };
	}

	const fields = useFields(collection);
	// the list on screen is the one reader that draws a note mark, so it alone asks for `$notes`
	const items = useItems(collection, { notes: true });

	// The collection's own `display.list` (descriptor v2 §3.5) — what a bare route renders: its
	// layout, columns, sort and layout options. A governing view record is merged over it key by key
	// (`lib/list-seed.ts`). Precedence for columns: view > the collection's list.columns > heuristic.
	const collections = useCollections();
	const collectionRow = computed(() => collections.tree.value.find((row) => row.collection === collection) ?? null);
	// Every root the collection reads, off its overview row (`lib/sources.ts`). ⚠ DECLARED HERE, above the
	// `immediate` watcher that runs `ensureSelection`: its heuristic branch reads this, and with the fields
	// already loaded that first run happens during setup — declared further down, it threw "Cannot access
	// 'sources' before initialization" after marking the selection done, and the list kept ZERO columns.
	const sources = computed(() => collectionRow.value?.sources);

	// The collection's `position_field` — WHICH field a manual drag writes (a field of `type:
	// position`, `dt reorder`). Absent on a collection with no hand-set order, so every consumer treats null as
	// "this list has no hand-set order" rather than assuming one. NOT `sortField` below — that one is
	// the field the list is sorted BY right now; the two only coincide while `manualOrder` is true.
	const manualSortField = computed<string | null>(() => collectionRow.value?.position_field ?? null);

	// Manual ordering is only OFFERED while the list is actually sorted by that field. A drag handle
	// on a list sorted by anything else would write a position the operator cannot see take effect —
	// a control that lies about what it does.
	const manualOrder = computed<boolean>(
		() => !!manualSortField.value && (items.sort.value ?? '').replace(/^-/, '') === manualSortField.value,
	);

	// ---- search + filter (unchanged from the pre-E DataTable contract) --------------------
	const initialSearch = ownsUrl && typeof route.query['search'] === 'string' ? route.query['search'] : '';
	// What the page renders with no `?layout=`: the view's, else the collection's `display.list.layout`.
	// A function, because the collections overview may land after setup — read at each URL write.
	const defaultLayout = () => listSeed(config, collectionRow.value?.list).layout;
	const initialLayout = ownsUrl && isValidLayout(route.query['layout']) ? route.query['layout'] : defaultLayout();

	const searchInput = ref(initialSearch);
	const filterGroup = ref<FilterGroup>(initialFilter);
	// Always starts CLOSED, even when the URL restores rules. It used to auto-open so a restored
	// filter was visible, which was harmless while the builder was an in-flow block; now that the
	// panel floats over the table (BrowseView), auto-opening would land a popover on top of the
	// rows on every page load. The active-filter chips under the header already say what's applied.
	const filterOpen = ref(false);
	const layout = ref<BrowseLayout>(initialLayout);

	items.search.value = initialSearch;
	items.filter.value = effectiveFilter(compileFilter(initialFilter));

	const hasActiveQuery = computed(() => Boolean(searchInput.value) || filterGroup.value.rules.length > 0);

	let searchDebounce: ReturnType<typeof setTimeout> | undefined;

	function onSearchInput(value: string): void {
		searchInput.value = value;
		if (searchDebounce) clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			items.page.value = 1;
			items.search.value = value;
		}, 300);
	}

	// A navigation that changes only `?filter=` (another layer's nav row, back/forward) reaches a browse
	// that is already mounted — re-seed the builder from it. Its own URL writes echo back as no-ops.
	watch(
		() => route.query['filter'],
		(raw) => {
			if (!ownsUrl) return;
			const next = filterFromUrl(typeof raw === 'string' ? raw : null, filterGroup.value, config?.baseFilter, config?.baseFilterOpaque === true);
			if (next) filterGroup.value = next;
		},
	);

	watch(
		filterGroup,
		(group) => {
			items.page.value = 1;
			items.filter.value = effectiveFilter(compileFilter(group));
		},
		{ deep: true },
	);

	function setLayout(next: BrowseLayout): void {
		layout.value = next;
	}

	/** Per-List declared-option values, keyed by list id (OptionsForm writes here; the active
	 *  list component reads its own slice). In-memory + preset-persisted, NOT URL-synced. */
	const listOptions = ref<Record<string, Record<string, unknown>>>({});
	function setListOptions(listId: string, values: Record<string, unknown>): void {
		listOptions.value = { ...listOptions.value, [listId]: values };
	}

	// Persist committed search + filter + layout to the URL (`router.replace`, never `push`, so
	// neither typing nor toggling layout spams browser history). An EMBEDDED browse opts out —
	// see `BrowseViewConfig.urlSync` for why sharing a route is not the same as owning one.
	watch(
		[() => items.search.value, filterGroup, layout],
		() => {
			if (!ownsUrl) return;
			const query: Record<string, string> = {};
			for (const [key, value] of Object.entries(route.query)) {
				if (typeof value === 'string' && key !== 'search' && key !== 'filter' && key !== 'layout') query[key] = value;
			}
			if (items.search.value) query['search'] = items.search.value;
			const serializedFilter = serializeFilterGroup(filterGroup.value);
			if (serializedFilter) query['filter'] = serializedFilter;
			if (layout.value !== defaultLayout()) query['layout'] = layout.value;

			router.replace({ path: route.path, query }).catch(() => {
				// vue-router rejects a same-target replace as a "duplicated navigation" — a no-op here, never a real error.
			});
		},
		{ deep: true },
	);

	// A record just created from this list under a Sources selection that leaves out the root it was
	// saved to (a layer's records are added in its own workspace, so a new one lands in the write root):
	// WIDEN the selection to that root, so the record is in the list the operator comes back to, and
	// say so (`createdNotice`). After the URL watcher, so the widened selection is written to the URL
	// like any pick (`lib/created-visibility.ts` has why widening rather than a "show it" button).
	const justCreated = ownsUrl ? takeCreated(collection) : null;
	const widened = justCreated ? widenedFor(filterGroup.value, justCreated.source) : null;
	if (widened) filterGroup.value = widened;
	const createdNotice = ref<CreatedNote | null>(widened ? justCreated : null);
	/** Re-widen after the view record's seed lands: its session scratch restores the filter as it was
	 *  BEFORE the create (measured in a dev host — the notice drew over a list still narrowed). */
	function keepCreatedInView(): void {
		const note = createdNotice.value;
		const again = note ? widenedFor(filterGroup.value, note.source) : null;
		if (again) filterGroup.value = again;
	}

	// ---- columns + order: SEEDED BY THE VIEW RECORD ------------------------------------------
	// The governing view record is the source of truth (collection-views.ts). `scratch` holds any
	// unsaved tweaks for this session; the collection's `display.list` and the heuristic are the seed
	// used only where no view record says otherwise.
	const scratchKey = scratchKeyFor(collection, config?.viewId, config?.scratchScope);
	const selected = ref<Set<string>>(new Set());
	const columnOrder = ref<string[]>([]);
	let selectionInitialized = false;

	/** What the RECORD says — the thing `dirty` compares against and `Reset` returns to. */
	const baseline = ref<Scratch | null>(null);

	function ensureSelection(): void {
		// Wait for the collections overview too: `display.list` rides on it, and falling through to
		// the heuristic before it resolves would lock the wrong default in.
		if (selectionInitialized || !fields.visibleFields.value.length || collections.loading.value) return;
		selectionInitialized = true;

		// what the view record asks for, over the collection's own `display.list` — and, when neither
		// names columns, the heuristic.
		const seed = listSeed(config, collectionRow.value?.list);
		// The Source column joins the DEFAULT set only when the rows span more than one source
		// (`lib/sources.ts`); an authored column list is the author's answer and stays as written.
		const seedColumns = seed.columns ?? withSourceColumn(defaultColumns(fields.visibleFields.value).map((f) => f.field), sources.value);

		apply({
			layout: seed.layout,
			columns: [...seedColumns],
			sort: seed.sort ?? items.sort.value ?? '',
			listOptions: clone(seed.listOptions),
			// NOT the record's filter: the builder was already seeded at setup, where the URL
			// deliberately wins. Applying it here would throw away a filter the operator arrived
			// with. The baseline below still records what the RECORD says, which is the half that
			// `dirty` and Reset need.
			filter: null,
		});

		// Baseline is what the record RESOLVES TO, not what it literally declares: a column the
		// schema no longer has drops out here, and an implicit default sort is included. Taking
		// the snapshot after applying is what keeps a freshly-opened page from reading as dirty.
		// Its filter is the RECORD's, so arriving with `?filter=` correctly reads as dirty.
		baseline.value = { ...snapshot(), filter: recordFilter };

		// unsaved tweaks from earlier in this session sit on top, and correctly read as dirty — but NEVER
		// over what this mount's URL says about the filter (cr-vscode-004 test stage h8). A layer's nav
		// row opens the list with `?filter=` naming its source; that filter used to be remembered as a
		// "tweak" and laid over every LATER mount, so layer B's row drew layer A's chip, the plain row
		// drew it too, and the URL was rewritten to it. So: a URL that carries a filter wins outright
		// (as the seed above already says it should); a mount with none takes the scratch's rules but
		// never its SOURCE rule — which sources a list shows is the navigation's fact (the row's URL, the
		// picker on this mount), not a tweak to carry to the next one.
		const scratch = scratchByView.get(scratchKey);
		if (scratch) apply({ ...scratch, filter: urlFilter !== null || !scratch.filter ? null : withSourceSelection(scratch.filter, null) });
		keepCreatedInView();
	}

	function apply(next: Scratch): void {
		selected.value = new Set(next.columns);
		columnOrder.value = [...next.columns];
		layout.value = next.layout;
		items.sort.value = next.sort;
		listOptions.value = clone(next.listOptions);
		// `null` is "leave the filter alone" — an opaque view, or the initial seed above. Writing it
		// runs the filter watcher, which is how Reset re-queries.
		if (next.filter) filterGroup.value = clone(next.filter);
	}


	/** Snapshot of everything a view record stores. */
	function snapshot(): Scratch {
		return {
			layout: layout.value,
			columns: columns.value.map((f) => f.field),
			sort: items.sort.value ?? '',
			listOptions: clone(listOptions.value),
			filter: baseFilterIsOpaque ? null : clone(filterGroup.value),
		};
	}

	function rememberScratch(): void {
		if (!baseline.value) return;
		const now = snapshot();
		if (JSON.stringify(now) === JSON.stringify(baseline.value)) scratchByView.delete(scratchKey);
		else scratchByView.set(scratchKey, now);
	}

	/** True when the on-screen presentation differs from the record — drives the Save affordance. */
	const dirty = computed(() => {
		if (!baseline.value) return false;
		void selected.value;
		void columnOrder.value;
		void layout.value;
		void items.sort.value;
		void listOptions.value;
		void filterGroup.value;
		return JSON.stringify(snapshot()) !== JSON.stringify(baseline.value);
	});

	/** Throw away unsaved tweaks and go back to what the record says. */
	function resetToView(): void {
		if (!baseline.value) return;
		scratchByView.delete(scratchKey);
		apply(baseline.value);
	}

	/** After a successful Save the record now says what the screen says. */
	function markSaved(): void {
		baseline.value = snapshot();
		scratchByView.delete(scratchKey);
	}

	function toggleColumn(field: string): void {
		const next = new Set(selected.value);
		if (next.has(field)) next.delete(field);
		else next.add(field);
		selected.value = next;
		// a newly shown column lands at the end rather than wherever the seed order would put it
		if (next.has(field)) {
			if (!columnOrder.value.includes(field)) columnOrder.value = [...columnOrder.value, field];
		} else {
			columnOrder.value = columnOrder.value.filter((f) => f !== field);
		}
		rememberScratch();
	}

	function setColumns(fieldNames: string[]): void {
		selected.value = new Set(fieldNames);
		columnOrder.value = [...fieldNames];
		rememberScratch();
	}

	/** Drag-and-drop reorder: move the column at `from` to sit at index `to`. */
	function moveColumn(from: number, to: number): void {
		const current = columns.value.map((f) => f.field);
		if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return;
		const next = [...current];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved!);
		columnOrder.value = next;
		rememberScratch();
	}

	// Column order comes from `columnOrder` (seeded by the view record, rewritten by a drag);
	// fields somehow selected but absent from it append in declared order.
	const columns = computed(() => {
		const chosen = fields.visibleFields.value.filter((f) => selected.value.has(f.field));
		const order = columnOrder.value;
		if (!order.length) return chosen;
		const position = (f: FieldRow): number => {
			const i = order.indexOf(f.field);
			return i === -1 ? Number.MAX_SAFE_INTEGER : i;
		};
		return [...chosen].sort((a, b) => position(a) - position(b));
	});

	/** Fields not currently shown as columns — what the "add column" picker offers. */
	const hiddenFields = computed(() => fields.visibleFields.value.filter((f) => !selected.value.has(f.field)));

	// Registered HERE, not beside ensureSelection: it runs immediately, and ensureSelection reads
	// the `columns` computed declared just above — registering it earlier would hit the TDZ the
	// moment fields happened to be loaded already.
	watch([() => fields.visibleFields.value, () => collections.loading.value], ensureSelection, { immediate: true });

	// layout / sort / list-option / FILTER changes are part of the view too, so they mark it dirty.
	// The filter was missing here, which is why editing only the filter offered no Save at all.
	watch([layout, () => items.sort.value, listOptions, filterGroup], () => rememberScratch(), { deep: true });

	/** The ACTIVE list's declared options — the slice the mounted List reads, and the only one whose
	 *  `page_size` and `group_by` should decide what this browse requests. */
	const activeListOptions = computed<Record<string, unknown>>(() => listOptions.value[layout.value] ?? {});

	// PAGE SIZE DRIVES THE REQUEST, because paging here is server-side (`items.limit`). A grouped
	// view defaults to All: a band reading "12 of 40" is not a picture anyone wants, and the rows
	// missing from it are the ones the grouping was supposed to reveal. An explicit `page_size`
	// still wins — a default, not a prohibition (design 2026-09-07, lib/page-size.ts).
	//
	// ⚠ Back to page 1 whenever the size actually changes: staying on page 7 after growing the page
	// size shows rows that have nothing to do with what was asked for — the same reasoning as
	// `setSortValue` below, and the same fix.
	watch(
		[activeListOptions, layout],
		() => {
			const next = effectiveLimit(
				activeListOptions.value['page_size'],
				typeof activeListOptions.value['group_by'] === 'string' && !!activeListOptions.value['group_by'],
			);
			if (items.limit.value === next) return;
			items.limit.value = next;
			items.page.value = 1;
		},
		{ deep: true, immediate: true },
	);

	const chooserOpen = ref(false);

	// fields=* only. The server does not implement relation expansion (`field.*` returns null),
	// so requesting it blanked relation columns to "—"; ViewRelation renders the raw stored
	// value (already human-readable, or path-stemmed) which is what we want in a list cell.
	items.fields.value = '*';

	// ---- cards-layout helpers (scope item 3) -----------------------------------------------
	// First visible field that resolves to the `image` display (opt-in only, see ViewImage.vue)
	// is the card's optional thumbnail; up to 3 selected non-image columns become its subtitle
	// lines — reusing the SAME column selection the table uses, so switching layout doesn't
	// require configuring a second, parallel "which fields matter" setting.
	const imageField = computed(() => fields.visibleFields.value.find((f) => resolveView(f).entry.id === 'image') ?? null);
	const subtitleFields = computed(() => columns.value.filter((f) => f.field !== imageField.value?.field).slice(0, 3));

	// ---- sort + row navigation --------------------------------------------------------------
	/**
	 * Set the sort outright (`field`, `-field`, or `''` for the server's natural order) — what the
	 * Layout options panel drives. Distinct from `items.setSort`, which is the column-header TOGGLE
	 * (asc ↔ desc on the same field). Resets to page 1: staying on page 7 of a re-sorted result set
	 * shows rows that have nothing to do with what you just asked for.
	 */
	function setSortValue(value: string): void {
		if (items.sort.value === value) return;
		items.page.value = 1;
		items.sort.value = value;
	}

	/** Sort split into its parts for the panel's two controls; `field: ''` means unsorted. */
	const sortField = computed(() => (items.sort.value ?? '').replace(/^-/, ''));
	const sortDesc = computed(() => (items.sort.value ?? '').startsWith('-'));

	function sortIndicator(field: string): 'asc' | 'desc' | '' {
		if (items.sort.value === field) return 'asc';
		if (items.sort.value === `-${field}`) return 'desc';
		return '';
	}

	function pkOf(record: ItemRecord): string {
		return String(record[fields.pkField.value] ?? record['id'] ?? '');
	}

	function openRecord(record: ItemRecord): void {
		if (rowTo) {
			void router.push(rowTo(record));
			return;
		}
		void router.push(`${currentContentBasePath(route)}${collection}/${pkOf(record)}`);
	}

	/**
	 * Open the create form. `prefill` seeds fields in the form only — it rides as a `?prefill=`
	 * JSON query param that ContentDetail applies through the ordinary `item.setField`, so the
	 * eventual write is the same POST any typed-in record makes (engine-side validation intact,
	 * and `dreamteamer <c> add --status doing` is the CLI equivalent — no UI-only capability).
	 * Used by the kanban's per-column `+`, which knows the column's group value.
	 */
	function createRecord(prefill?: Record<string, unknown>): void {
		// Several templates bind this bare (`@click="state.createRecord"`), which hands it a
		// MouseEvent. Accept only a PLAIN object as a prefill so those keep meaning "no prefill"
		// rather than depending on a DOM event happening to have no own enumerable keys.
		const plain = prefill != null && Object.getPrototypeOf(prefill) === Object.prototype ? prefill : undefined;
		// WHERE IT GOES, before the form (cr-vscode-004): several roots a record can be added to, and the
		// picker not narrowed to exactly one, ask first — `pendingCreate`, drawn as a popover under the
		// header's + (`browse/TargetChoice.vue`). Every "Create record" button comes through here, the
		// kanban column's + included, so they all ask the same question.
		const choice = targetChoice(sourceFacets.value, selectedSources(filterGroup.value));
		if (choice.mode === 'choose') {
			pendingCreate.value = { prefill: plain, choice };
			return;
		}
		openCreateForm(plain, choice.target?.name);
	}

	/** The target choice, while it is open: what New was pressed with, and what to offer. */
	const pendingCreate = ref<{ prefill: Record<string, unknown> | undefined; choice: Extract<TargetChoice, { mode: 'choose' }> } | null>(null);

	/** A pick in the target choice: the form, saving to that root. */
	function chooseTarget(name: string): void {
		const pending = pendingCreate.value;
		pendingCreate.value = null;
		openCreateForm(pending?.prefill, name);
	}

	function cancelCreate(): void {
		pendingCreate.value = null;
	}

	function openCreateForm(prefill: Record<string, unknown> | undefined, target: string | undefined): void {
		const path = `${currentContentBasePath(route)}${collection}/+`;
		const query: Record<string, string> = {};
		if (prefill && Object.keys(prefill).length) query['prefill'] = JSON.stringify(prefill);
		// the Sources selection rides along, so the create form can say BEFORE the save that the record
		// will not be in it (`SaveTarget.vue`)
		const picked = selectedSources(filterGroup.value);
		if (picked.length) query[SOURCES_QUERY] = picked.join(',');
		// …and the root it saves to, once the target choice (or the picker) has said it
		if (target) query[TARGET_QUERY] = target;
		void router.push(Object.keys(query).length ? { path, query } : path);
	}

	// ---- batch selection (browse restyle: checkbox column + header delete) ----------------
	const selectedIds = ref<Set<string>>(new Set());

	function isSelected(pk: string): boolean {
		return selectedIds.value.has(pk);
	}

	function toggleSelect(pk: string): void {
		const next = new Set(selectedIds.value);
		if (next.has(pk)) next.delete(pk);
		else next.add(pk);
		selectedIds.value = next;
	}

	function clearSelection(): void {
		if (selectedIds.value.size) selectedIds.value = new Set();
	}

	const allVisibleSelected = computed(() => {
		const rows = items.items.value;
		return rows.length > 0 && rows.every((r) => selectedIds.value.has(pkOf(r)));
	});

	function toggleSelectAllVisible(): void {
		selectedIds.value = allVisibleSelected.value ? new Set() : new Set(items.items.value.map(pkOf));
	}

	// A fresh search/filter/page/layout should never carry over stale picks from a previous
	// result set — selection is scoped to "the rows currently on screen", not a cross-page cart.
	watch([() => items.page.value, () => items.search.value, items.filter, layout], clearSelection);

	const deleting = ref(false);

	/** Batch-delete: `DELETE /items/<collection>/<id>` per selected row (no dedicated bulk-delete endpoint), then reload. */
	async function deleteSelected(): Promise<void> {
		if (!selectedIds.value.size) return;
		deleting.value = true;
		try {
			await Promise.all([...selectedIds.value].map((id) => api.delete(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`)));
			clearSelection();
			await items.reload();
		} finally {
			deleting.value = false;
		}
	}

	// ---- where the records come from (`lib/sources.ts`) --------------------------------------------
	// Every root the collection reads, named, off its overview row; `$source` per record rides on the
	// rows. A collection reading only its own root has nothing foreign here and draws no mark anywhere.
	// (`sources` itself is declared beside `collectionRow`, above `ensureSelection`'s watcher — see there.)
	/** The rows span more than one source: the Source column is on by default, the facet strip shows. */
	const mixedSources = computed(() => isMixed(sources.value));
	/** The facet strip's rows: the host's per-query counts once a response has landed, the
	 *  collection's unfiltered ones before. */
	const sourceFacets = computed(() => (items.sources.value.length ? items.sources.value : (sources.value ?? [])));
	/** A record's mark — its source name, the `repos` record it links to, and the root's class and
	 *  writability (the glyph, cr-vscode-004) — or null for one read from the workspace's own root, which
	 *  carries no mark. The picker's per-query rows win over the collection row's, as they are fresher. */
	function sourceOf(record: ItemRecord): SourceMarkProps | null {
		const name = record[SOURCE_FIELD];
		if (typeof name !== 'string' || !name || isOwnSource(name, sources.value)) return null;
		const entry = sourceEntry(sourceFacets.value, name) ?? sourceEntry(sources.value, name);
		return { name, record: entry?.record ?? null, ...(entry?.access ? { access: entry.access } : {}), ...(entry?.via ? { via: entry.via } : {}), ...(entry?.note ? { note: entry.note } : {}) };
	}

	/** What a row says about stubs (engine 0.41.0, cr-vscode-004 line 9) — beside its mark in a card's
	 *  footer — or null. */
	function stubOf(record: ItemRecord): ReturnType<typeof stubNoteOf> {
		return stubNoteOf(record);
	}

	// ---- the collection's display: what a record is called, and its tint -------------------------
	// Both read the display contract only: the collection row's `record_title` and `color_by`, and the
	// field rows' `role` and `editor_options.choices` (descriptor v2, §4.3).
	const fieldRows = computed(() => fields.fields.value);
	const resolveReference = referenceTitles(() => collections.tree.value);
	const isReference = (field: string) => isReferenceField(fieldRows.value, field);

	/**
	 * The COLUMN that names a record — the first field the collection's `record_title` template reads,
	 * when it is a visible field; else `title` or `name` where one exists; else none. The comfortable
	 * table weights this column so a row reads picture · name · details, the way a contacts list does.
	 */
	const titleField = computed<string | null>(() => {
		const visible = new Set(fields.visibleFields.value.map((f) => f.field));
		const fromTemplate = templateFields(collectionRow.value?.record_title ?? '').find((f) => visible.has(f));
		return fromTemplate ?? ['title', 'name'].find((f) => visible.has(f)) ?? null;
	});

	/** A record's name — the collection's `record_title`, its id when that renders to nothing. */
	function recordTitleOf(record: ItemRecord): string {
		return recordTitle(collectionRow.value, record, pkOf(record), { resolve: resolveReference, isReference });
	}

	/** The field whose enum colours tint this list: the layout's own `color_by` option, else the
	 *  collection's `display.record.color_by`. */
	const colorBy = computed(() => colorByFor(collectionRow.value, listOptions.value[layout.value]));

	/** The CSS a tinted row or card carries, or undefined for an untinted one. */
	function tintOf(record: ItemRecord): Record<string, string> | undefined {
		return tintStyle(tintOf_(colorBy.value, fieldRows.value, record));
	}

	// ---- pagination ---------------------------------------------------------------------------
	const from = computed(() => (items.total.value === 0 ? 0 : (items.page.value - 1) * items.limit.value + 1));
	const to = computed(() => Math.min(items.page.value * items.limit.value, items.total.value));
	const hasPrev = computed(() => items.page.value > 1);
	const hasNext = computed(() => items.page.value * items.limit.value < items.total.value);

	function prevPage(): void {
		if (hasPrev.value) items.page.value -= 1;
	}

	function nextPage(): void {
		if (hasNext.value) items.page.value += 1;
	}

	// ---- saved views (scope item 4) ------------------------------------------------------------
	function getViewState(): ViewState {
		return {
			layout: layout.value,
			search: items.search.value,
			filter: filterGroup.value,
			sort: items.sort.value,
			columns: [...selected.value],
			listOptions: listOptions.value,
		};
	}

	/** Load a saved view's state into the live refs/URL — the same "write state, let watchers
	 * react" pattern the rest of this composable already uses for search/filter/layout. */
	function applyViewState(state: ViewState): void {
		layout.value = state.layout;
		searchInput.value = state.search;
		items.page.value = 1;
		items.search.value = state.search;
		filterGroup.value = state.filter.rules.length ? state.filter : emptyFilterGroup();
		// Leave the panel as the operator left it — see the `filterOpen` declaration above.
		items.sort.value = state.sort;
		if (state.columns.length) setColumns(state.columns);
		listOptions.value = state.listOptions ?? {};
	}

	return {
		collection,
		fields,
		items,
		manualSortField,
		manualOrder,
		searchInput,
		onSearchInput,
		filterGroup,
		filterOpen,
		/** A record created from this list that the widened Sources selection now shows — the notice. */
		createdNotice,
		/** True when the view's stored filter never reached the builder — Save must not overwrite it. */
		filterOpaque: baseFilterIsOpaque,
		hasActiveQuery,
		layout,
		setLayout,
		listOptions,
		setListOptions,
		selected,
		toggleColumn,
		moveColumn,
		hiddenFields,
		dirty,
		resetToView,
		markSaved,
		snapshot,
		viewId: config?.viewId,
		chooserOpen,
		columns,
		imageField,
		subtitleFields,
		setSortValue,
		sortField,
		sortDesc,
		sortIndicator,
		pkOf,
		recordTitleOf,
		titleField,
		colorBy,
		tintOf,
		sources,
		mixedSources,
		sourceFacets,
		sourceOf,
		stubOf,
		openRecord,
		createRecord,
		pendingCreate,
		chooseTarget,
		cancelCreate,
		from,
		to,
		hasPrev,
		hasNext,
		prevPage,
		nextPage,
		getViewState,
		applyViewState,
		selectedIds,
		isSelected,
		toggleSelect,
		clearSelection,
		allVisibleSelected,
		toggleSelectAllVisible,
		deleting,
		deleteSelected,
	};
}

export type BrowseState = ReturnType<typeof useBrowseState>;
