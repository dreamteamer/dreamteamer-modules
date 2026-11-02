<!--
	Detail/create view for one record. Composes PageHeader (breadcrumb + title + circular
	save/delete actions), an (in create mode) "start from an existing record" template picker,
	ItemForm, and — via the right sidebar, not inline — Info/Revisions/Comments sections. Owns the
	`useFields`/`useItem` instances for its collection/id props directly: ContentBrowse remounts
	this component (via `:key`) whenever collection or id changes, so plain top-level composable
	calls here are safe and idiomatic — no reactive re-subscription needed.

	Studio-look pass: save/delete used to live as buttons inside ItemForm; they now live in
	PageHeader's action slot (spec §"Detail": circular check save disabled-until-dirty, circular
	delete danger with a confirm dialog) — ContentDetail drives `item.save()`/`item.remove()`
	directly since it already owns `item` (the same instance ItemForm receives as a prop, not a
	re-derived copy). Revisions/Comments/Info move from inline blocks into right-sidebar accordion
	sections registered once at setup (collection/id are stable for this component's lifetime, per
	the remount-on-key-change note above, so no reactive re-registration is needed).
-->
<script setup lang="ts">
import { computed, markRaw, onMounted, onUnmounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import {
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuRoot,
	DropdownMenuTrigger,
} from 'reka-ui';
import ItemHistory from '../components/ItemHistory.vue';
import RecordHeaderDisplay from '../components/RecordHeaderDisplay.vue';
import PageHeader from '../components/PageHeader.vue';
import RefreshSkippedNotice from '../components/RefreshSkippedNotice.vue';
import NextNotes from '../components/NextNotes.vue';
import CommandsSection from '../components/sidebar/CommandsSection.vue';
import InfoSection from '../components/sidebar/InfoSection.vue';
import TemplatePicker from '../components/TemplatePicker.vue';
import { useCollections } from '../composables/collections';
import { useFields } from '../composables/fields';
import { useItem } from '../composables/items';
import { useSavedViews } from '../composables/saved-views';
import { useSidebarSections } from '../composables/page-sidebar';
import { recordTitle, referenceTitles } from '../lib/record-titles';
import { isReferenceField } from '../lib/collection-display';
import { currentContentBasePath } from '../lib/content-path';
import { resolveRendererEntry, resolvePreset } from '../lib/presets';
import { useRecordDisplay } from '../composables/record-display';
import DtIcon from '../components/DtIcon.vue';
import { recordPageFields } from '../lib/record-page-fields';
import { editsAnything } from '../lib/field-row';
import { hasForeignSource, isTarget, notTargetReason, sourceEntry, stubNoteOf } from '../lib/sources';
import { recordOrigin } from '../lib/record-origin';
import { excludedBy, noteCreated, saveRootFor, selectionFromQuery, SOURCES_QUERY, TARGET_QUERY } from '../lib/created-visibility';
import SaveTarget from '../components/SaveTarget.vue';

const props = defineProps<{
	collection: string;
	id: string | null;
	create: boolean;
	/** A record-scope ui-view this page is the route of — its `display.record` governs the page. */
	viewId?: string;
}>();

const router = useRouter();
const route = useRoute();
const basePath = computed(() => currentContentBasePath(route));
const fields = useFields(props.collection);
const item = useItem(props.collection, props.create ? null : props.id);
const { tree } = useCollections();
/** This collection's row of the display contract — its icon, its `record_title`, its `record` block. */
const collectionRow = computed(() => tree.value.find((row) => row.collection === props.collection) ?? null);
// The collection's `display.nav.icon` in the header chip (matches the browse header + nav).
const collectionIcon = computed(() => collectionRow.value?.nav.icon ?? 'description');

// The fields the record page draws. `recordPageFields` drops what compile writes onto a collection
// descriptor (`compiled`), for both layouts at once; which surface a field is hidden from (its row's
// `hidden`) is the layouts' own call (`lib/field-row.ts#drawnOn`).
const formFields = computed(() => recordPageFields(props.collection, fields.visibleFields.value));
// a record whose every field is read from its file or computed (a binary record) has nothing to edit:
// no pencil, and one line saying why instead of a form that can never save
const editsFields = computed(() => editsAnything(formFields.value));
// …and a record whose ROOT takes no write from here (`access: read` — an installed package) is
// read-only too (cr-vscode-004): no pencil, no ⋯ Delete, and the source line in the header says why.
// Declared below `origin`, which carries the root's access.

// Where this record is READ FROM and its repo state (`lib/record-origin.ts`): ONE line, at the end of
// the header's commit band — `● project-a layer · ahead 1 · uncommitted`. It replaced the "shared
// from ● project-a" line under the title, which sat a few rows above the provenance field then also
// titled "Source". On an engine without `$repo` (0.39.1 and older) the line is the origin alone.
const collectionSources = computed(() => collectionRow.value?.sources);
const origin = computed(() => {
	if (props.create) return null;
	const o = recordOrigin(item.record.value);
	if (!o) return null;
	// the root's class and writability ride along (cr-vscode-004): the mark's glyph, the class word, and
	// for a read-only root the reason in the line
	const entry = o.name ? sourceEntry(collectionSources.value, o.name) : undefined;
	// …and the stubs it shadows, or that it is one (engine 0.41.0; cr-vscode-004 line 9)
	const stub = stubNoteOf(item.record.value);
	return {
		...o,
		record: entry?.record ?? null,
		...(entry?.access ? { access: entry.access } : {}),
		...(entry?.via ? { via: entry.via } : {}),
		...(entry?.note ? { note: entry.note } : {}),
		...(stub ? { stub, stubSources: collectionSources.value } : {}),
	};
});
/** The record's root takes no write from here — the source line says why. */
const readOnlySource = computed(() => origin.value?.access === 'read');
const editable = computed(() => editsFields.value && !readOnlySource.value);
// WHERE A NEW RECORD SAVES, said before the save (`SaveTarget.vue`): whenever the collection reads a
// root besides the workspace's own, or the list it came from is narrowed by the Sources picker — the
// cases where "where does this go" has more than one plausible answer. A `?target=` from the target
// choice names the root; under a selection that leaves that root out, the form says so up front.
const selection = computed(() => selectionFromQuery(route.query[SOURCES_QUERY]));
// the root the target choice (or a picker narrowed to one writable root) named — cr-vscode-004
const askedTarget = computed(() => (typeof route.query[TARGET_QUERY] === 'string' && route.query[TARGET_QUERY] ? (route.query[TARGET_QUERY] as string) : null));
// …used only when it names a root of this collection that takes a new record. Anything else (a typed
// URL, a layer uninstalled since) is DROPPED, said beside the Saves-to line, and the save goes to the
// write root — so the line and the POST can never disagree (cr-vscode-004 review, target-query-naming-
// unknown-source: the line said the write root while the POST carried the raw name and was refused).
const target = computed(() => {
	const entry = askedTarget.value ? sourceEntry(collectionSources.value, askedTarget.value) : undefined;
	return entry && isTarget(entry) ? entry.name : null;
});
const droppedTarget = computed(() => {
	const name = askedTarget.value;
	if (!name || target.value) return null;
	const entry = sourceEntry(collectionSources.value, name);
	return { name, reason: entry ? notTargetReason(entry) : `${name} is not a source of this list` };
});
const savesTo = computed(() => {
	if (!props.create) return null;
	const root = saveRootFor(collectionSources.value, target.value);
	if (!root || (!hasForeignSource(collectionSources.value) && !selection.value.length && !askedTarget.value)) return null;
	return { root: root.name, access: root.access, via: root.via, excluded: excludedBy(selection.value, root.name), dropped: droppedTarget.value };
});

// PageHeader's commit line (operator ask 2026-07-27) — server.js only computes these for an
// existing record's single-record GET, so create mode and a not-yet-loaded record both show
// nothing (PageHeader's `v-if="commit"` skips the line entirely rather than rendering blanks).
const commitInfo = computed(() => {
	const record = item.record.value;
	const author = record?.['$last-modified-by'];
	const date = record?.['last-modified'];
	if (typeof author !== 'string' || typeof date !== 'string') return null;
	const message = record?.['$last-commit-message'];
	return { author, date, message: typeof message === 'string' ? message : '' };
});

// ---- record-page resolution through the registry (spec §8) ------------------------------------
// **A record page is an Edit/View too** (terminology decision 2026-07-23). Existing records open
// in `view` mode (built-in record-scoped View `doc` — rendered read-only fields); the pencil in
// the header flips to `edit` mode (built-in record-scoped Edit `form`), where save/cancel replace
// the header actions. Create mode pins the mode. A
// `.schema/presets` record for this collection can override the renderer per mode (workspace-local
// default beats module-shipped). Built-in `form` and `doc` both resolve to ItemForm (doc =
// read-only skin), so switching mode never remounts the form — only its `readonly` prop flips.
const editing = ref(false);
const mode = computed<'view' | 'edit'>(() => {
	if (props.create) return 'edit';
	return editing.value ? 'edit' : 'view';
});
const itemViews = useSavedViews(props.collection);
/**
 * The RECORD display this page draws (descriptor v2, §3.5): a record-scope view's `display.record`
 * when this page is that view's route, else the collection's own `display.record` — the same block
 * that names its list layout names how one record is drawn. The engine's default layout is `page`,
 * which means "the built-in record page", so only another name selects a renderer; it wins over the
 * legacy preset path, which cannot resolve anything (the adapter stubs `.schema/presets` to `[]`).
 */
const recordDisplay = useRecordDisplay(() => props.collection, () => props.viewId);
const itemRendererEntry = computed(() => {
	if (recordDisplay.value.layout) return resolveRendererEntry(recordDisplay.value.layout, 'item', mode.value);
	const resolved = resolvePreset(itemViews.records.value, props.collection, 'item', mode.value);
	return resolveRendererEntry(resolved.rendererId, 'item', mode.value);
});
const itemOptions = computed<Record<string, unknown>>(() => {
	if (recordDisplay.value.layout || recordDisplay.value.options) return recordDisplay.value.options ?? {};
	const resolved = resolvePreset(itemViews.records.value, props.collection, 'item', mode.value);
	return resolved.preset?.options ?? {};
});

if (!props.create) void item.load();

/**
 * `?prefill={"status":"doing"}` — create-mode seed values (kanban wave, 2026-07-29). The board's
 * per-column `+` knows which group value the new record should have, and this is how it says so
 * without a bespoke create route: the values go through the SAME `item.setField` the form's own
 * widgets and TemplatePicker use, so they show up as ordinary pending edits the operator can see
 * and change before saving, and the write stays one plain POST.
 *
 * Unknown field names are not filtered here (the schema may not have loaded yet, and the only
 * producer is our own UI) — the engine rejects them on save, which is the same guardrail a
 * hand-typed `dreamteamer <c> add --nope x` hits.
 */
if (props.create) {
	const raw = route.query['prefill'];
	if (typeof raw === 'string' && raw) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) item.setField(field, value);
			}
		} catch {
			// a malformed prefill is a no-op, never a broken create page
		}
	}
}

// Refetch-on-focus is intentionally SKIPPED here while the record is dirty (a refinement of
// spec §2.6, which specifies refetch-on-focus unconditionally for external-edit safety): never
// clobber an operator's in-progress edits with a server refetch just because the window
// regained focus. DataTable.vue has no dirty state to protect, so it keeps the unconditional
// behavior; the detail form does not.
function onFocus(): void {
	if (item.dirty.value || props.create) return;
	void item.load();
}
onMounted(() => window.addEventListener('focus', onFocus));
onUnmounted(() => window.removeEventListener('focus', onFocus));

onBeforeRouteLeave(() => {
	if (!item.dirty.value) return true;
	return window.confirm('Discard unsaved changes?');
});

// The record's name is its collection's `record_title` (descriptor v2 §3.1), rendered with the one
// grammar — a reference in it reads as the target's own title. The id when it renders to nothing.
/** The field rows as the display contract emits them — what the title, badge and tint read. */
const fieldRows = computed(() => fields.fields.value);
const resolveReference = referenceTitles(() => tree.value);
const isReference = (field: string) => isReferenceField(fieldRows.value, field);
const title = computed(() => {
	if (props.create) return 'Creating item';
	return recordTitle(collectionRow.value, item.record.value, props.id ?? '', { resolve: resolveReference, isReference });
});

/**
 * PageHeader row 1's path: the collection (clickable, back to its browse) followed by the record
 * id split on '/' — `tasks / 2026 / 07 / 2026-07-01--…`, the way Obsidian shows a note's folder
 * path (operator ask 2026-07-29). Only the collection is a link: an id's intermediate segments are
 * FOLDER names inside the collection, not routes, and linking them would 404.
 *
 * Row 1 shows the id while row 2 shows the human title — the two are usually different (a task's
 * name vs its dated slug), which is exactly why the path is worth its own row.
 */
const pathCrumbs = computed(() => {
	const crumbs: Array<{ label: string; to?: string }> = [{ label: props.collection, to: `${basePath.value}${props.collection}` }];
	if (props.create) return [...crumbs, { label: 'new' }];
	for (const segment of (props.id ?? '').split('/').filter(Boolean)) crumbs.push({ label: segment });
	return crumbs;
});

// Sidebar sections only make sense once there's a real record to show history/info for
// (never in create mode — nothing to show yet). collection/id are stable for this component's
// whole lifetime (ContentBrowse remounts on a `:key` change), so a single setup-time registration
// is enough — no reactive re-registration needed.
if (!props.create && props.id) {
	const collection = props.collection;
	const id = props.id;
	// `record` is a single computed ref, not the whole `item` composable object — see
	// InfoSection.vue's header comment for why: composables/page-sidebar.ts's section store is a
	// deep-reactive `ref<SidebarSection[]>([])`, so a nested object of refs (like `item` itself)
	// gets its OWN ref properties silently auto-unwrapped one level down by the time RightSidebar
	// spreads `section.props` — a single top-level ref avoids that double-unwrap trap.
	const record = computed(() => item.record.value);
	useSidebarSections([
		// Commands first (operator ask 2026-07-27): every command bound to this collection,
		// enabled/disabled by its binding's `available_when` (done when `done_when` already holds).
		{ id: 'commands', title: 'Commands', icon: 'terminal', component: markRaw(CommandsSection), props: { collection, ids: [id] } },
		{ id: 'info', title: 'Info', icon: 'info', component: markRaw(InfoSection), props: { collection, id, record, sources: collectionSources } },
		{
			id: 'revisions',
			title: 'Revisions',
			icon: 'history',
			component: markRaw(ItemHistory),
			props: { collection, id, onReverted: () => item.load() },
		},
	]);
}

// --- save ---------------------------------------------------------------------------------------

const saving = ref(false);

async function onSave(): Promise<void> {
	if (saving.value || !item.dirty.value) return;
	saving.value = true;
	item.error.value = null;
	try {
		// a create carries the chosen root to the host, which writes there (`?target=`, cr-vscode-004)
		const result = await item.save(props.create ? target.value : null);
		if (result && props.create) {
			const pk = fields.pkField.value;
			const newId = String(result[pk] ?? result['id'] ?? '');
			// the list it came from widens its Sources selection to show it (`lib/created-visibility.ts`)
			const root = saveRootFor(collectionSources.value, target.value)?.name;
			if (root && newId) noteCreated({ collection: props.collection, id: newId, source: root });
			void router.replace(`${basePath.value}${props.collection}/${newId}`);
		}
		editing.value = false;
	} catch (err) {
		// a refused write keeps the edit and the edit mode, and says the engine's own sentence in the error line
		item.error.value = err instanceof Error ? err.message : String(err);
	} finally {
		saving.value = false;
	}
}

// Cancel: drop pending edits and fall back to view mode (create mode: back to the list — the
// route-leave guard confirms if dirty, so no double prompt here for that path).
function onCancel(): void {
	if (props.create) {
		void router.push(`${basePath.value}${props.collection}`);
		return;
	}
	if (item.dirty.value && !window.confirm('Discard unsaved changes?')) return;
	item.error.value = null;
	item.discard();
	editing.value = false;
}

// --- delete ---------------------------------------------------------------------------------------

const deleteOpen = ref(false);
const deleting = ref(false);

async function onConfirmDelete(): Promise<void> {
	deleting.value = true;
	try {
		await item.remove();
		deleteOpen.value = false;
		void router.push(`${basePath.value}${props.collection}`);
	} finally {
		deleting.value = false;
	}
}
</script>

<template>
	<div class="dt-content-detail">
		<PageHeader :icon="collectionIcon" :title="title" :breadcrumb="pathCrumbs" :commit="commitInfo" :origin="origin">
			<!-- View mode: pencil (rightmost — the primary action) enters edit; destructive/rare
			     actions live in the ⋯ overflow menu to its left. -->
			<template v-if="mode === 'view'">
				<DropdownMenuRoot v-if="!create && !readOnlySource">
					<DropdownMenuTrigger as-child>
						<button type="button" class="dt-btn dt-btn--icon" title="More actions">
							<DtIcon name="ellipsis" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuContent class="dt-menu" align="end" :side-offset="4">
							<DropdownMenuItem class="dt-menu-item dt-menu-item--danger" @select="deleteOpen = true">
								<DtIcon name="trash" />Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
				<button v-if="editable" type="button" class="dt-btn dt-btn--icon" title="Edit" @click="editing = true">
					<DtIcon name="edit" />
				</button>
			</template>
			<!-- Edit mode: check saves, X cancels back to view (discarding pending edits). -->
			<template v-else>
				<button type="button" class="dt-btn dt-btn--icon" title="Cancel" @click="onCancel">
					<DtIcon name="close" />
				</button>
				<button
					type="button"
					class="dt-btn dt-btn--icon"
					title="Save"
					:disabled="!item.dirty.value || saving"
					@click="onSave"
				>
					<DtIcon name="check" />
				</button>
			</template>
		</PageHeader>
		<RefreshSkippedNotice :show="item.refreshSkipped.value" />

		<!-- The collection's `display.record` line — subtitle, badge, color_by tint — for both record
		     layouts at once. Static with the header: it says what this record IS, like the title. -->
		<RecordHeaderDisplay v-if="!create" :row="collectionRow" :fields="fieldRows" :record="item.record.value" />
		<!-- What extensions say about this record — a session holding it, in core's words (cr-vscode-005).
		     Static with the header: it is about the record, like its title. Nothing when there is no note. -->
		<NextNotes v-if="!create && id" :collection="collection" :id="id" />
<p v-if="!create && formFields.length && !editsFields" class="dt-record-source">Nothing here is edited by hand — every field is read from the record's file or computed.</p>

		<!-- Scroll box, so the PageHeader above it is genuinely static rather than sticky (operator
		     2026-08-08). It wraps the form rather than being it: `.dt-page-body--form` is capped at
		     920px, and a scroll container of that width would park its scrollbar mid-page instead of
		     at the pane's right edge. -->
		<div class="dt-detail-scroll">
			<div class="dt-page-body dt-page-body--form">
				<p v-if="fields.error.value || item.error.value" class="dt-detail-error">{{ fields.error.value || item.error.value }}</p>

				<SaveTarget v-if="savesTo" :root="savesTo.root" :excluded="savesTo.excluded" :access="savesTo.access" :via="savesTo.via" :dropped="savesTo.dropped" />

				<TemplatePicker v-if="create && formFields.length" :collection="collection" :fields="formFields" :pk-field="fields.pkField.value" :item="item" />

				<component
					:is="itemRendererEntry.component"
					v-if="formFields.length || create"
					:fields="formFields"
					:item="item"
					:relation-targets="fields.relationTargets.value"
					:readonly="mode === 'view'"
					:create="create"
					:record="item.record.value"
						:mode="mode"
						:options="itemOptions"
					/>
					<!-- what a host page adds under the form, scrolling with it — a module's collections (SchemaTab) -->
					<slot v-if="!create" name="after" />
					</div>
		</div>

		<div v-if="deleteOpen" class="dt-dialog-overlay" @click.self="deleteOpen = false">
			<div class="dt-dialog">
				<div class="dt-dialog-header">
					<h2 class="dt-dialog__title">Delete this record?</h2>
					<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" title="Close" @click="deleteOpen = false">
						<DtIcon name="close" />
					</button>
				</div>
				<p class="dt-dialog-description">This is recoverable from git history, but not from the studio.</p>
				<div class="dt-dialog-actions">
					<button type="button" class="dt-btn dt-btn--secondary" @click="deleteOpen = false">Cancel</button>
					<button type="button" class="dt-btn dt-btn--danger" :disabled="deleting" @click="onConfirmDelete">
						{{ deleting ? 'Deleting…' : 'Delete' }}
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
/* Fixed frame: the page is exactly as tall as the pane it sits in, so the header band (nav row,
   identity row, provenance line) stays put and the form under it is the only thing that scrolls.
   `min-height: 0` is what lets a flex item shrink below its content — without it this box grows to
   fit the form and the pane's own scrollbar comes back. Percentages and flex all the way up
   (`.dt-content` → `.dt-page-area` → `.dt-shell`'s 100vh), so a window resize just relays out. */
.dt-content-detail {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}

/* Both axes: a wide field (a code block, a long relation chip row) scrolls here rather than
   widening the pane. */
.dt-detail-scroll {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
}

.dt-record-source {
	margin: 0;
	padding: 4px 24px 6px;
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
}

.dt-detail-error {
	color: var(--dt-danger);
	white-space: pre-wrap;
	font-size: var(--dt-text);
	margin-bottom: 16px;
}
.dt-dialog-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
}
.dt-dialog-header .dt-dialog__title {
	margin-bottom: 0;
}
.dt-dialog-description {
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
	margin-bottom: 20px;
}
.dt-dialog-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}

</style>
