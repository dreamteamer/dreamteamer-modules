<!--
	Collection detail / schema Designer (facelift). The static field table is gone; fields are now a
	live two-column grid that mirrors the record form, reorderable by native drag, with a per-row
	kebab menu (Edit field → right drawer · Hide/Show · Delete). A field's `width` is a list column
	hint in characters (descriptor v2 §3.4.2), edited in the drawer; the grid has no width words.
	EVERY mutation stages into `useDesignerState` (contract C2) — nothing here writes to the server
	until the sticky Save bar's Save diffs staged vs loaded and issues per-field /api/schema ops (designer-state.save). Discard reloads
	from disk.

	Implicit fields (`id`/`body`/`type`/`date_*`/`user_*`/`$*`) sit in a locked block at the top: not
	draggable, and their kebab offers only "Edit field" (they're excluded from the save payload — the
	server rejects a non-overlaid implicit field in the body).

	FieldDrawer (contract C3, Agent F) is mounted here: "Add field" opens it in new-field mode
	(`field: null`); a row's Edit opens it on that StagedField; its `@apply` stages back through the
	designer state (never the server).
-->
<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import {
	DialogClose,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogRoot,
	DialogTitle,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuRoot,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from 'reka-ui';
import { useRouter } from 'vue-router';
import { useCollections } from '../composables/collections';
import { useDesignerState, type StagedField } from '../composables/designer-state';
import { deleteCollection } from '../composables/schema';
import FieldDrawer from '../components/designer/FieldDrawer.vue';
import PageHeader from '../components/PageHeader.vue';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{
	collection: string;
	/** Rendered INSIDE a record page rather than as a route of its own: the host already drew the
	 *  title, breadcrumb and record chrome, so this drops its own PageHeader and keeps only the two
	 *  actions that belong to a descriptor (add field, delete collection). */
	embedded?: boolean;
	/** Open this field's drawer as soon as the descriptor has loaded (`?field=` on the route) — a
	 *  deep link into one field, e.g. from a diagram or a search result. */
	openField?: string;
}>();
const router = useRouter();

const collectionRef = toRef(props, 'collection');
const { tree, reload: reloadCollections } = useCollections();
const state = useDesignerState(collectionRef);

const row = computed(() => tree.value.find((r) => r.collection === props.collection));

// --- load ---------------------------------------------------------------------------------------

const loadError = ref<string | null>(null);

async function reload(): Promise<void> {
	loadError.value = null;
	try {
		await state.load();
	} catch (err) {
		loadError.value = err instanceof Error ? err.message : String(err);
	}
}

// `?field=` is honoured AFTER the load resolves — the staged rows do not exist before it, so
// opening the drawer eagerly would open it on nothing.
watch(
	[collectionRef, () => props.openField],
	async () => {
		await reload();
		const wanted = props.openField;
		if (!wanted) return;
		const hit = state.fields.value.find((f) => f.key === wanted);
		if (hit) openEditField(hit);
	},
	{ immediate: true },
);

const implicitFields = computed(() => state.fields.value.filter((f) => f.implicit));
const editableFields = computed(() => state.fields.value.filter((f) => !f.implicit));

// --- fields DERIVED from a relation --------------------------------------------------------------
// Such a field sits in the locked block because its PRESENTATION is not ours — the engine refuses a
// width, an editor or a hide on a value it keeps in step. That is the whole extent of the lock: the
// RELATION is edited here, in this collection's own drawer, and removed here, because which side
// stores the key is storage and the operator should never be sent to the other collection to say so.

/** The link this field is derived from, as a sentence for a tooltip. Never an instruction. */
function linkedTo(field: StagedField): string {
	return field.mirror ? `${field.mirror.collection}.${field.mirror.field}` : '';
}

// --- per-field presentation ---------------------------------------------------------------------

/** Grid span class — wide logical types span both columns (mirrors ItemForm's default heuristic so
 * the designer reads like the record form). */
function gridClass(field: StagedField): string {
	const t = field.def['type'];
	if (t === 'markdown' || t === 'object' || t === 'map' || t === 'list' || t === 'tags') return 'dt-field-wide';
	return '';
}

function typeLabel(field: StagedField): string {
	const t = field.def['type'];
	return typeof t === 'string' ? t : '—';
}

function isHidden(field: StagedField): boolean {
	return field.def['hidden'] === true;
}

function isRequired(field: StagedField): boolean {
	return field.def['required'] === true;
}

// --- field drawer ------------------------------------------------------------------------------

const drawerOpen = ref(false);
const drawerField = ref<StagedField | null>(null);

function openAddField(): void {
	drawerField.value = null;
	drawerOpen.value = true;
}

function openEditField(field: StagedField): void {
	drawerField.value = field;
	drawerOpen.value = true;
}

function onApply(field: StagedField): void {
	// Existing key (an edit) → REPLACE the whole def so cleared attributes actually drop; a brand-new
	// key → add(). (Kebab partial patches keep using state.update() directly.)
	if (state.fields.value.some((f) => f.key === field.key)) state.replace(field);
	else state.add(field);
	drawerOpen.value = false;
}

// --- kebab mutations (stage only) --------------------------------------------------------------

function toggleHidden(field: StagedField): void {
	state.update(field.key, { hidden: !isHidden(field) });
}

function removeField(field: StagedField): void {
	state.remove(field.key);
}

// --- drag reorder (native HTML5 drag; editable rows only) --------------------------------------

const dragKey = ref<string | null>(null);
const dragOverKey = ref<string | null>(null);

function onDragStart(field: StagedField): void {
	dragKey.value = field.key;
}

function onDragEnter(field: StagedField): void {
	if (dragKey.value && dragKey.value !== field.key) dragOverKey.value = field.key;
}

function onDrop(target: StagedField): void {
	const from = state.fields.value.findIndex((f) => f.key === dragKey.value);
	const to = state.fields.value.findIndex((f) => f.key === target.key);
	if (from !== -1 && to !== -1) state.move(from, to);
	dragKey.value = null;
	dragOverKey.value = null;
}

function onDragEnd(): void {
	dragKey.value = null;
	dragOverKey.value = null;
}

// --- save / discard ----------------------------------------------------------------------------

const saving = ref(false);
const saveError = ref<string | null>(null);
// Honesty over silent loss: changes the descriptor can't absorb (presentation-only knobs,
// structured schemas, pure reordering) come back from save() as warnings and surface here.
const saveWarnings = ref<string[]>([]);
// What the save DECLARED, both sides named — a two-way relation writes a field the operator never
// typed, onto a collection they were not looking at.
const saveNotices = ref<string[]>([]);
// Per-field failures. `save()` no longer stops at the first one — a relation costs two or three ops
// and one refusal used to discard every other staged change in the batch.
const saveErrors = ref<string[]>([]);

async function onSave(): Promise<void> {
	saving.value = true;
	saveError.value = null;
	saveWarnings.value = [];
	saveNotices.value = [];
	saveErrors.value = [];
	try {
		const outcome = await state.save();
		saveWarnings.value = outcome.warnings;
		saveNotices.value = outcome.notices;
		saveErrors.value = outcome.errors;
	} catch (err) {
		saveError.value = err instanceof Error ? err.message : String(err);
	} finally {
		saving.value = false;
	}
}

async function onDiscard(): Promise<void> {
	saveError.value = null;
	saveWarnings.value = [];
	saveNotices.value = [];
	saveErrors.value = [];
	await reload();
}

// --- delete collection -------------------------------------------------------------------------

const deleteOpen = ref(false);
const deleteConfirmText = ref('');
const deleting = ref(false);
const deleteError = ref<string | null>(null);

// Descriptor writes target the workspace module's collections source (compile-gated server-side).
const descriptorPath = computed(() => `${props.collection}.collection.yaml`);

async function onConfirmDeleteCollection(): Promise<void> {
	deleting.value = true;
	deleteError.value = null;
	try {
		await deleteCollection(props.collection);
		await reloadCollections();
		deleteOpen.value = false;
		await router.push('/settings/data-model');
	} catch (err) {
		deleteError.value = err instanceof Error ? err.message : String(err);
	} finally {
		deleting.value = false;
	}
}
</script>

<template>
	<div class="dt-data-model-detail">
		<PageHeader
			v-if="!embedded"
			icon="schema"
			:title="collection"
			:breadcrumb="[{ label: 'Data Model', to: '/settings/data-model' }]"
		>
			<button type="button" class="dt-btn dt-btn--icon dt-btn--danger" title="Delete collection" @click="deleteOpen = true">
				<DtIcon name="trash" />
			</button>
			<button type="button" class="dt-btn dt-btn--icon" title="Add field" @click="openAddField">
				<DtIcon name="add" />
			</button>
		</PageHeader>
		<div v-else class="dt-dm-actions">
			<button type="button" class="dt-btn dt-btn--sm" @click="openAddField">
				<DtIcon name="add" /> Add field
			</button>
			<button type="button" class="dt-btn dt-btn--sm dt-btn--danger" @click="deleteOpen = true">
				<DtIcon name="trash" /> Delete collection
			</button>
		</div>

		<div class="dt-page-body">
			<div class="dt-badge-row">
				<span v-if="row?.provenance" class="dt-chip" :class="`dt-chip--${row.provenance}`">{{ row.provenance }}</span>
				<span v-if="row?.layer" class="dt-chip dt-chip--bundle" :title="`Supplied by the '${row.layer}' bundle`">{{ row.layer }}</span>
			</div>

			<section class="dt-card dt-panel">
				<h2 class="dt-section-label">Overview</h2>
				<dl class="dt-meta">
					<dt>Record type</dt>
					<dd>{{ row?.record_type ?? '—' }}</dd>
					<dt>Record title</dt>
					<dd><code>{{ row?.record_title ?? '—' }}</code></dd>
				</dl>
			</section>

			<section class="dt-panel">
				<h2 class="dt-section-label">Fields</h2>

				<p v-if="loadError" class="dt-error">{{ loadError }}</p>
				<div v-if="saveNotices.length" class="dt-save-warnings">
					<p v-for="(notice, index) in saveNotices" :key="index" class="dt-save-notice">
						<DtIcon name="check" />{{ notice }}
					</p>
				</div>
				<div v-if="saveErrors.length" class="dt-save-warnings dt-save-warnings--error">
					<p v-for="(err, index) in saveErrors" :key="index" class="dt-save-warning">
						<DtIcon name="warning" />{{ err }}
					</p>
				</div>
				<div v-if="saveWarnings.length" class="dt-save-warnings">
					<p v-for="(warning, index) in saveWarnings" :key="index" class="dt-save-warning">
						<DtIcon name="warning" />{{ warning }}
					</p>
				</div>

				<!-- Locked block — implicit fields, the body, and fields DERIVED from a relation. Never
				     draggable and never carrying a presentation edit; a derived field's own row opens
				     its drawer here and deletes from here, because the relation is this collection's
				     to change whichever side stores the key. -->
				<div v-if="implicitFields.length" class="dt-field-grid dt-field-grid--locked">
					<div v-for="field in implicitFields" :key="field.key" class="dt-field-card is-locked" :class="gridClass(field)">
						<div class="dt-field-card__main">
							<button
								v-if="field.mirror"
								type="button"
								class="dt-field-card__name dt-field-card__name--btn"
								:title="`Two-way link with ${linkedTo(field)} — edit it here`"
								@click="openEditField(field)"
							>
								{{ field.key }}
							</button>
							<span v-else class="dt-field-card__name">{{ field.key }}</span>
							<span class="dt-field-badges">
								<span class="dt-field-type">{{ typeLabel(field) }}</span>
								<span v-if="field.mirror" class="dt-badge dt-badge-mirror" :title="`Two-way link with ${linkedTo(field)} — kept in step for you`">
									↔ linked
								</span>
								<span v-else class="dt-badge dt-badge-implicit">implicit</span>
								<span v-if="isHidden(field)" class="dt-badge dt-badge-hidden">hidden</span>
							</span>
						</div>
						<DropdownMenuRoot>
							<DropdownMenuTrigger as-child>
								<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" title="Field actions">
									<DtIcon name="ellipsis" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuPortal>
								<DropdownMenuContent class="dt-menu" align="end" :side-offset="4">
									<template v-if="field.mirror">
										<DropdownMenuItem class="dt-menu-item" @select="openEditField(field)">
											<DtIcon name="edit" />Edit field
										</DropdownMenuItem>
										<DropdownMenuSeparator class="dt-menu-separator" />
										<DropdownMenuItem class="dt-menu-item dt-menu-item--danger" @select="removeField(field)">
											<DtIcon name="trash" />Delete field
										</DropdownMenuItem>
									</template>
									<DropdownMenuItem v-else class="dt-menu-item" @select="openEditField(field)">
										<DtIcon name="edit" />Edit field
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenuPortal>
						</DropdownMenuRoot>
					</div>
				</div>

				<!-- Editable fields: draggable two-column grid mirroring the record form. -->
				<div class="dt-field-grid">
					<div
						v-for="field in editableFields"
						:key="field.key"
						class="dt-field-card"
						:class="[gridClass(field), { 'is-dragging': dragKey === field.key, 'is-drag-over': dragOverKey === field.key }]"
						draggable="true"
						@dragstart="onDragStart(field)"
						@dragenter.prevent="onDragEnter(field)"
						@dragover.prevent
						@drop="onDrop(field)"
						@dragend="onDragEnd"
					>
						<DtIcon class="dt-field-card__grip" title="Drag to reorder" name="gripper" />
						<div class="dt-field-card__main">
							<button type="button" class="dt-field-card__name dt-field-card__name--btn" @click="openEditField(field)">{{ field.key }}</button>
							<span class="dt-field-badges">
								<span class="dt-field-type">{{ typeLabel(field) }}</span>
								<span v-if="isRequired(field)" class="dt-badge dt-badge-required" title="Required">★ required</span>
								<span v-if="isHidden(field)" class="dt-badge dt-badge-hidden">hidden</span>
							</span>
						</div>
						<DropdownMenuRoot>
							<DropdownMenuTrigger as-child>
								<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" title="Field actions">
									<DtIcon name="ellipsis" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuPortal>
								<DropdownMenuContent class="dt-menu" align="end" :side-offset="4">
									<DropdownMenuItem class="dt-menu-item" @select="openEditField(field)">
										<DtIcon name="edit" />Edit field
									</DropdownMenuItem>
									<DropdownMenuItem class="dt-menu-item" @select="toggleHidden(field)">
										<DtIcon :name="isHidden(field) ? 'visibility' : 'visibility_off'" />
										{{ isHidden(field) ? 'Show field' : 'Hide field' }}
									</DropdownMenuItem>
									<DropdownMenuSeparator class="dt-menu-separator" />
									<DropdownMenuItem class="dt-menu-item dt-menu-item--danger" @select="removeField(field)">
										<DtIcon name="trash" />Delete field
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenuPortal>
						</DropdownMenuRoot>
					</div>
				</div>

				<div v-if="!editableFields.length && !implicitFields.length && !loadError" class="dt-empty">
					<DtIcon name="list-flat" />
					<p class="dt-empty__line">No fields yet</p>
					<button type="button" class="dt-btn dt-btn--sm" @click="openAddField">Add field</button>
				</div>
			</section>
		</div>

		<!-- Sticky staged-save bar — only present while there are unsaved edits. -->
		<Transition name="dt-save-bar">
			<div v-if="state.dirty.value" class="dt-save-bar">
				<span class="dt-save-bar__label">
					<DtIcon name="edit" />
					Unsaved changes
				</span>
				<span v-if="saveError" class="dt-save-bar__error">{{ saveError }}</span>
				<div class="dt-save-bar__actions">
					<button type="button" class="dt-btn dt-btn--secondary" :disabled="saving" @click="onDiscard">Discard</button>
					<button type="button" class="dt-btn" :disabled="saving" @click="onSave">{{ saving ? 'Saving…' : 'Save changes' }}</button>
				</div>
			</div>
		</Transition>

		<FieldDrawer
			:collection="collection"
			:field="drawerField"
			:existing-keys="state.fields.value.map((f) => f.key)"
			:open="drawerOpen"
			@close="drawerOpen = false"
			@apply="onApply"
		/>

		<DialogRoot v-model:open="deleteOpen">
			<DialogPortal>
				<DialogOverlay class="dt-dialog-overlay" />
				<DialogContent class="dt-dialog">
					<div class="dt-dialog-header">
						<DialogTitle class="dt-dialog__title">Delete collection?</DialogTitle>
						<DialogClose as-child>
							<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" title="Close">
								<DtIcon name="close" />
							</button>
						</DialogClose>
					</div>
					<p class="dt-dialog-description">
						This removes the workspace descriptor (<code>{{ descriptorPath }}</code>) — the collection unmounts from the schema.
						The server refuses if records still exist under <code>data/{{ collection }}/</code> (remove them first). Type the
						collection path to confirm.
					</p>
					<input v-model="deleteConfirmText" class="dt-input" :placeholder="collection" />
					<p v-if="deleteError" class="dt-error">{{ deleteError }}</p>
					<div class="dt-dialog-actions">
						<DialogClose as-child>
							<button type="button" class="dt-btn dt-btn--secondary">Cancel</button>
						</DialogClose>
						<button
							type="button"
							class="dt-btn dt-btn--danger"
							:disabled="deleteConfirmText !== collection || deleting"
							@click="onConfirmDeleteCollection"
						>
							{{ deleting ? 'Deleting…' : 'Delete descriptor' }}
						</button>
					</div>
				</DialogContent>
			</DialogPortal>
		</DialogRoot>
	</div>
</template>

<style scoped>
.dt-dm-actions {
	display: flex;
	gap: 8px;
	justify-content: flex-end;
	padding: 0 0 8px;
}

.dt-panel {
	margin-bottom: 24px;
}
.dt-panel.dt-card {
	padding: 20px;
}
.dt-section-label {
	font-size: var(--dt-label);
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--dt-fg-muted);
	margin-bottom: 14px;
	display: block;
}
.dt-meta {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 8px 16px;
	font-size: var(--dt-text);
}
.dt-meta dt {
	color: var(--dt-fg-subtle);
}
.dt-meta dd {
	color: var(--dt-fg);
}
.dt-error {
	color: var(--dt-danger);
	font-size: var(--dt-text);
	margin-bottom: 8px;
}
.dt-save-warnings {
	margin-bottom: 12px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.dt-save-warning {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 8px 12px;
	border: 1px solid color-mix(in srgb, var(--dt-warning) 35%, transparent);
	border-radius: var(--dt-radius);
	background: color-mix(in srgb, var(--dt-warning) 10%, transparent);
	color: var(--dt-fg);
	font-size: var(--dt-text);
}
.dt-save-warning .codicon {
	font-size: var(--dt-icon);
	color: var(--dt-warning);
}
/* A per-field FAILURE, not a skipped change: red rather than amber, because the save it belongs to
   went through for every other field and this one did not. */
.dt-save-warnings--error .dt-save-warning {
	border-color: color-mix(in srgb, var(--dt-danger) 40%, transparent);
	background: color-mix(in srgb, var(--dt-danger) 10%, transparent);
}
.dt-save-warnings--error .dt-save-warning .codicon {
	color: var(--dt-danger);
}
.dt-save-notice {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 8px 12px;
	border: 1px solid color-mix(in srgb, var(--dt-success) 35%, transparent);
	border-radius: var(--dt-radius);
	background: color-mix(in srgb, var(--dt-success) 10%, transparent);
	color: var(--dt-fg);
	font-size: var(--dt-text);
	font-family: var(--dt-font-mono);
}
.dt-save-notice .codicon {
	font-size: var(--dt-icon);
	color: var(--dt-success);
}
.dt-badge-row {
	display: flex;
	gap: 8px;
	margin-bottom: 16px;
}
.dt-chip--built-in {
	background: var(--dt-bg-subtle);
	color: var(--dt-fg-subtle);
}
.dt-chip--disk {
	background: color-mix(in srgb, var(--dt-success) 15%, transparent);
	color: var(--dt-success);
}
.dt-chip--bundle {
	background: color-mix(in srgb, var(--dt-accent) 12%, transparent);
	color: var(--dt-accent);
}

/* --- field grid (mirrors ItemForm's two-column grid) --- */
.dt-field-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12px;
	align-items: start;
	max-width: 920px;
}
.dt-field-grid--locked {
	margin-bottom: 12px;
}
.dt-field-grid :deep(.dt-field-wide),
.dt-field-card.dt-field-wide {
	grid-column: 1 / -1;
}

.dt-field-card {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 8px 10px 12px;
	background: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	cursor: grab;
}
.dt-field-card:hover {
	border-color: var(--dt-border-strong);
	box-shadow: var(--dt-shadow);
}
.dt-field-card.is-locked {
	cursor: default;
	background: var(--dt-bg-subtle);
}
.dt-field-card.is-dragging {
	opacity: 0.4;
}
.dt-field-card.is-drag-over {
	border-color: var(--dt-accent);
	box-shadow: 0 0 0 1px var(--dt-accent);
}
.dt-field-card__grip {
	font-size: var(--dt-icon);
	color: var(--dt-fg-muted);
	cursor: grab;
	flex: 0 0 auto;
}
.dt-field-card__main {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
	flex: 1 1 auto;
}
.dt-field-card__name {
	font-size: var(--dt-text);
	font-weight: 600;
	color: var(--dt-fg);
	font-family: var(--dt-font-mono);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-field-card__name--btn {
	background: none;
	border: none;
	padding: 0;
	text-align: left;
	cursor: pointer;
}
.dt-field-card__name--btn:hover {
	color: var(--dt-accent);
	text-decoration: underline;
}
.dt-field-badges {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
}
.dt-field-type {
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
	font-family: var(--dt-font-mono);
}
.dt-badge {
	display: inline-block;
	border-radius: var(--dt-radius);
	padding: 1px 6px;
	font-size: var(--dt-label);
	font-weight: 600;
	background: var(--dt-bg-hover);
	color: var(--dt-fg-subtle);
}
.dt-badge-required {
	background: color-mix(in srgb, var(--dt-accent) 14%, transparent);
	color: var(--dt-accent);
}
.dt-badge-hidden {
	background: var(--dt-bg-hover);
	color: var(--dt-fg-subtle);
}
.dt-badge-implicit {
	background: color-mix(in srgb, var(--dt-warning) 18%, transparent);
	color: color-mix(in srgb, var(--dt-warning) 80%, #000);
}
.dt-badge-mirror {
	background: color-mix(in srgb, var(--dt-accent) 14%, transparent);
	color: var(--dt-accent);
	font-weight: 600;
}

/* --- kebab dropdown menu --- */
/* --- sticky staged-save bar --- */
.dt-save-bar {
	position: sticky;
	bottom: 0;
	display: flex;
	align-items: center;
	gap: 16px;
	margin: 0 24px 16px;
	padding: 12px 20px;
	background: var(--dt-fg);
	color: #fff;
	border-radius: var(--dt-radius-lg);
	box-shadow: var(--dt-shadow-lg);
	z-index: 40;
}
.dt-save-bar__label {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: var(--dt-text);
	font-weight: 600;
}
.dt-save-bar__label .codicon {
	font-size: var(--dt-icon);
}
.dt-save-bar__error {
	color: #ffb4c0;
	font-size: var(--dt-text);
}
.dt-save-bar__actions {
	display: flex;
	gap: 8px;
	margin-left: auto;
}
.dt-save-bar-enter-active,
.dt-save-bar-leave-active {
	transition: transform 0.16s ease, opacity 0.16s ease;
}
.dt-save-bar-enter-from,
.dt-save-bar-leave-to {
	transform: translateY(12px);
	opacity: 0;
}

/* --- delete dialog --- */
.dt-input {
	margin: 12px 0;
}
.dt-dialog-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
}
.dt-dialog-header .dt-dialog__title {
	margin-bottom: 0;
}
.dt-dialog-description {
	color: var(--dt-fg);
	font-size: var(--dt-text);
	line-height: 1.5;
}
.dt-dialog-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 4px;
}

@media (max-width: 720px) {
	.dt-field-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
