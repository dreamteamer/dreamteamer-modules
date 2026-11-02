<!--
	Sticky page header, TWO rows over a splitter, with provenance beneath it (operator ask
	2026-07-29, second pass — "more obsidian like"):

	  row 1   ← →  collection / 2026 / 07 / <id>          ← a browser chrome bar: history + path
	  row 2   ⬤ Name                            actions   ← the record's identity
	  ─────────────────────────────────────────────────    splitter (sticky ends here)
	          AL  ada        <commit subject>   9 hours ago

	The three bands each carry one idea, which is what the earlier single block could not do: row 1
	is where you ARE and how you got here, row 2 is WHAT this is, and the commit line is a footnote
	about the file. The path lives on row 1 because Obsidian puts it there and because it frees row
	2 to be one confident line — the collection name used to be a crumb stacked above the title.

	The arrows hug the page's left edge (row 1 uses a small left inset, not the 24px body gutter):
	they are window chrome, not content, and reading them as part of the text column made the whole
	bar feel indented. Row 2 keeps the 24px so the icon lines up with the property rows below.

	The commit row sits OUTSIDE the sticky wrapper on purpose: it is a footnote, not chrome, so it
	gets no `position: sticky` of its own. Since 2026-08-08 that distinction only shows in a page
	that still scrolls — ContentDetail and BrowseView both give this whole block a fixed frame and
	scroll their body underneath it, so there the footnote is pinned along with everything else.

	`commit` reads the `$last-modified-by` / `$last-commit-message` / `last-modified` fields the
	single-record GET returns; ContentDetail passes null in create mode and before the record loads,
	and the band disappears rather than rendering blanks. BrowseView passes no commit at all.

	`origin` (design 2026-10-30) ends the same band: where the record is read from and its repo state —
	`● project-a layer · ahead 1 · uncommitted`, `env folder · never committed` (`lib/record-origin.ts`).
	It is the ONE place a record page says its source; the "shared from" line under the title is gone,
	so "Source" no longer appears twice a few rows apart (the provenance field is "Information source").
	The band draws for an origin alone too — a record no commit holds yet still says where it lives.
-->
<script setup lang="ts">
import { computed } from 'vue';
import DtLink from './DtLink.vue';
import { useNavHistory } from '../composables/nav-history';
import { initialsOf } from '../lib/initials';
import { relativeTime } from '../lib/relative-time';
import { originClassWord, type RecordOrigin } from '../lib/record-origin';
import type { SourceEntry } from '../api/types';
import DtIcon from './DtIcon.vue';
import SourceMark from './SourceMark.vue';
import StubNote from './StubNote.vue';

const props = withDefaults(
	defineProps<{
		/** Material Symbols Outlined icon name shown in the row-2 icon chip. */
		icon: string;
		title: string;
		/** Row 1's path. Crumbs with a `to` are links; the rest (id segments) are plain text. */
		breadcrumb?: Array<{ label: string; to?: string }>;
		commit?: { author: string; message: string; date: string } | null;
		/** Where the record is read from and its repo state; `record` links the mark to a `repos` record;
		 *  `access` / `via` / `note` are its root's class and writability (cr-vscode-004). */
		origin?:
			| (RecordOrigin & { record?: string | null } & Partial<Pick<SourceEntry, 'access' | 'via' | 'note'>> & {
					/** The stubs the record shadows, or that it is one — drawn after the class word (line 9). */
					stub?: { stubs: string[]; self: boolean; winner: string | null } | null;
					stubSources?: readonly SourceEntry[];
			  })
			| null;
	}>(),
	{ breadcrumb: () => [], commit: null, origin: null },
);

const { canBack, canForward, back, forward } = useNavHistory();

const commitRelativeTime = computed(() => {
	if (!props.commit) return '';
	const date = new Date(props.commit.date);
	return Number.isNaN(date.getTime()) ? props.commit.date : relativeTime(date);
});
</script>

<template>
	<div class="dt-page-header-block">
		<div class="dt-page-header-wrap">
			<!-- row 1: history + path -->
			<div class="dt-page-nav">
				<div class="dt-page-nav__history">
					<button
						type="button"
						class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm"
						title="Back"
						:disabled="!canBack"
						@click="back"
					>
						<DtIcon name="arrow-left" />
					</button>
					<button
						type="button"
						class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm"
						title="Forward"
						:disabled="!canForward"
						@click="forward"
					>
						<DtIcon name="arrow-right" />
					</button>
				</div>

				<nav v-if="breadcrumb.length" class="dt-page-nav__path">
					<template v-for="(crumb, index) in breadcrumb" :key="index">
						<span v-if="index > 0" class="dt-page-nav__sep" aria-hidden="true">/</span>
						<DtLink v-if="crumb.to" :to="crumb.to" class="dt-page-nav__crumb">{{ crumb.label }}</DtLink>
						<span v-else class="dt-page-nav__crumb">{{ crumb.label }}</span>
					</template>
				</nav>

				<!-- Search belongs with the chrome, right-aligned (operator ask 2026-07-29): it acts
				     on the whole collection, not on the record row 2 identifies, and centring it on
				     row 2 put it between the title and the actions where it read as a third
				     competing element. -->
				<div v-if="$slots.search" class="dt-page-nav__search">
					<slot name="search" />
				</div>
			</div>

			<!-- row 2: identity + actions -->
			<header class="dt-page-header">
				<div class="dt-page-header-left">
					<span class="dt-page-header-icon">
						<DtIcon :name="icon" />
					</span>
					<!-- Full value in the tooltip: the tab label is clipped (src/titles.ts) and this
					     line ellipsises at the viewport, so hover is where the whole title lives. -->
					<h1 class="dt-page-header-title" :title="title">{{ title }}</h1>
				</div>

				<div class="dt-page-header-actions">
					<slot />
				</div>
			</header>
		</div>

		<!-- below the splitter -->
		<div v-if="commit || origin" class="dt-page-commit">
			<template v-if="commit">
				<span class="dt-page-commit__avatar" :title="commit.author">{{ initialsOf(commit.author) }}</span>
				<span class="dt-page-commit__author">{{ commit.author }}</span>
				<span class="dt-page-commit__message" :title="commit.message">{{ commit.message }}</span>
				<span class="dt-page-commit__time">{{ commitRelativeTime }}</span>
			</template>
			<span v-else-if="origin?.inRepo" class="dt-page-commit__message dt-page-commit__message--none">no commit holds this record yet</span>
			<span v-else class="dt-page-commit__message"></span>
			<span v-if="origin" class="dt-page-commit__origin" :title="origin.tooltip" :data-origin-kind="origin.kind">
				<SourceMark v-if="origin.name" :name="origin.name" :record="origin.record ?? null" context="record" :access="origin.access" :via="origin.via" :note="origin.note" />
				<span v-if="originClassWord(origin.kind, origin.via)" class="dt-page-commit__kind">{{ originClassWord(origin.kind, origin.via) }}</span>
				<!-- a read-only root says why, in the line (cr-vscode-004): the record page has no Edit for it -->
				<template v-if="origin.access === 'read'">
					<span class="dt-page-commit__sep" aria-hidden="true">·</span>
					<span class="dt-page-commit__readonly" data-read-only>read-only{{ origin.note ? ` — ${origin.note}` : '' }}</span>
				</template>
				<template v-if="origin.stub">
					<span class="dt-page-commit__sep" aria-hidden="true">·</span>
					<StubNote :stubs="origin.stub.stubs" :self="origin.stub.self" :winner="origin.stub.winner" :sources="origin.stubSources" />
				</template>
				<template v-for="part in origin.state" :key="part">
					<span class="dt-page-commit__sep" aria-hidden="true">·</span>
					<span class="dt-page-commit__state" :class="`is-${part.split(' ')[0]}`">{{ part }}</span>
				</template>
			</span>
		</div>
	</div>
</template>

<style scoped>
/* The two rows + the splitter stick; the commit band below does not. */
.dt-page-header-wrap {
	position: sticky;
	top: 0;
	z-index: 10;
	background: var(--dt-bg);
	border-bottom: 1px solid var(--dt-border);
}

/* ---- row 1: browser chrome ------------------------------------------------------------------- */
/* FIXED height, not `min-height` (operator 2026-07-29: "while search textbox in focus its height
   grows ~2px and layout snaps"). The search swaps a 22px collapsed icon button for a 26px expanded
   field, so a content-sized row changed height the moment you clicked it and shoved row 2 — and
   everything below it — down. 26px of content box (32 − 3 − 3) is exactly the tallest thing row 1
   can hold, so the field fits without the row ever resizing and the 22px button centres inside it.

   24px right so the search's edge lines up with row 2's action buttons; 6px left because the
   arrows are window chrome and shouldn't sit in the body's text column. */
.dt-page-nav {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 32px;
	padding: 3px 24px 3px 6px;
}

.dt-page-nav__history {
	display: flex;
	align-items: center;
	gap: 0;
	flex-shrink: 0;
}

.dt-page-nav__history .codicon {
	font-size: var(--dt-icon);
}

.dt-page-nav__path {
	display: flex;
	align-items: center;
	gap: 5px;
	min-width: 0;
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
}

/* The id segments are long; the path gives up characters before it pushes anything off-row. */
.dt-page-nav__crumb {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: inherit;
	text-decoration: none;
}

a.dt-page-nav__crumb {
	flex-shrink: 0;
}

a.dt-page-nav__crumb:hover {
	color: var(--dt-fg);
	text-decoration: underline;
}

.dt-page-nav__sep {
	flex-shrink: 0;
	color: var(--dt-fg-muted);
}

/* `auto` margin rather than a spacer, so row 1 needs no filler element when there is no path. */
.dt-page-nav__search {
	flex-shrink: 0;
	margin-left: auto;
	display: flex;
	align-items: center;
}

/* ---- row 2: identity ------------------------------------------------------------------------- */
.dt-page-header {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 36px;
	/* 24px left matches `--dt-page-pad-form`, so the icon chip lines up with the property rows. */
	padding: 2px 24px 12px;
}

.dt-page-header-left {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.dt-page-header-icon {
	flex-shrink: 0;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	border: 1px solid var(--dt-border);
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--dt-fg-subtle);
}

.dt-page-header-icon .codicon {
	font-size: var(--dt-icon);
}

.dt-page-header-title {
	font-size: calc(var(--dt-text) + 2px);
	font-weight: 600;
	line-height: 1.35;
	color: var(--dt-fg);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.dt-page-header-actions {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 8px;
	margin-left: auto;
}

/* ---- below the splitter: provenance ---------------------------------------------------------- */
.dt-page-commit {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	padding: 9px 24px;
	font-size: var(--dt-text);
	color: var(--dt-fg-muted);
}

.dt-page-commit__avatar {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: var(--dt-module-bg-active, var(--dt-accent));
	color: var(--dt-module-fg-active, #ffffff);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 8px;
	font-weight: 700;
	opacity: 0.8;
}

.dt-page-commit__author {
	flex-shrink: 0;
	font-weight: 600;
}

/* The one part allowed to lose characters — a commit subject can be any length. */
.dt-page-commit__message {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.dt-page-commit__time {
	flex-shrink: 0;
}

.dt-page-commit__message--none {
	font-style: italic;
}

/* where the record is read from + its repo state: the band's right end, never the part that clips */
.dt-page-commit__origin {
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding-left: 12px;
	border-left: 1px solid var(--dt-border);
}

.dt-page-commit__sep {
	color: var(--dt-fg-muted);
}

.dt-page-commit__readonly {
	color: var(--dt-fg-muted);
	white-space: normal;
}

/* uncommitted is the one state worth a colour: work on disk no commit holds */
.dt-page-commit__state.is-uncommitted {
	color: var(--dt-warning, var(--dt-fg));
}
</style>
