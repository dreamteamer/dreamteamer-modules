/**
 * The Schema tab's LEFT RAIL — which kinds of thing the workspace's schema is made of.
 *
 * ⚠ DERIVED, NEVER LISTED. Every collection the engine's projection marks `internal` is a kind, so a
 * ninth one added by the engine appears here with no change to this file. A hand-written list of
 * the eight is how a table of modules elsewhere went stale for 48 hours while reading as
 * authoritative; a rail is the same trap with a scrollbar.
 *
 * ⚠ IT DERIVES FROM `internal`, NOT FROM `runtime`, AND THE DIFFERENCE IS WHY THIS PARAGRAPH EXISTS.
 * `runtime` is the projection's answer to "are these records the compiled runtime's build output" —
 * a STORAGE question, and the CLI and REST layers dispatch a write on it. `internal` (design §3.3) is
 * whether the collection is workspace plumbing rather than a domain noun — WHERE IT IS DRAWN. The two
 * are orthogonal, and `repos` is where they split: internal, and its records are ordinary files under
 * `data/`. Deriving from the storage flag left it drawn nowhere — folded out of the record tree and
 * never arriving on this page. Never repoint one of these two at the other.
 *
 * The native side asks the SAME question of the same engine (`isInternal` in `src/nav.ts`, through
 * the engine's descriptor accessor); the projection's `internal` is that accessor's answer, so the
 * tree and this rail cannot disagree about which collections are plumbing.
 *
 * Its own module because the ORDER is a decision worth a test, and a decision in a `.vue` file can
 * only be tested by rendering it. Same reasoning as `src/nav.ts` on the native side.
 */

/** What the rail needs off a collection row — the engine projection's v2 keys (design §4.3). */
export interface RailInput {
	collection: string;
	/** The engine-resolved title. */
	title?: string;
	/** `display.nav` — the icon and the position the descriptor authored. */
	nav?: { icon?: string; order?: number };
	/** Workspace plumbing, drawn here rather than in the record tree — what this rail derives from. */
	internal?: boolean;
}

export interface SchemaKind {
	/** The collection name, which is also the route segment: `/settings/schema/<kind>`. */
	kind: string;
	/** The engine-resolved title. Never title-cased here — compile already answered this. */
	title: string;
	/** A codicon id; `symbol-structure` for a kind whose descriptor authors none. */
	icon: string;
}

/**
 * `modules` FIRST, `collections` SECOND, then every other internal kind by its descriptor's own
 * `display.nav.order` and finally by name.
 *
 * The two pinned rows are pinned on purpose rather than by giving those descriptors a low `order`:
 * "add a collection to THIS module" is only expressible because modules are a row, so modules is
 * where the eye should land, and `collections` is what the operator came for. Everything below them
 * is the engine's own machinery and orders itself.
 */
export function schemaRail(rows: readonly RailInput[]): SchemaKind[] {
	const PINNED = ['modules', 'collections'];
	const rank = (name: string) => {
		const at = PINNED.indexOf(name);
		return at === -1 ? PINNED.length : at;
	};

	return rows
		.filter((r) => r.internal === true)
		.map((r) => ({
			kind: r.collection,
			title: r.title ?? r.collection,
			icon: r.nav?.icon ?? 'symbol-structure',
			order: r.nav?.order ?? 999,
		}))
		.sort((a, b) => {
			if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
			if (a.order !== b.order) return a.order - b.order;
			return a.kind.localeCompare(b.kind);
		})
		.map(({ kind, title, icon }) => ({ kind, title, icon }));
}

/** The kind the tab opens on when the route names none. */
export const DEFAULT_SCHEMA_KIND = 'collections';

/**
 * Split a `/settings/schema/<kind>/<id>` tail into its two halves.
 *
 * The KIND is one segment because identity entities stay flat (decision 274) — there is no
 * namespaced `skills` — while the ID may carry slashes for both reasons ids do: a namespaced
 * collection name (`health/doctors`) and a slash-path record id (`meetings/2026/07/kickoff`).
 */
export function splitSchemaRoute(tail: string): { kind: string; id: string | null } {
	const segments = tail.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
	if (!segments.length) return { kind: DEFAULT_SCHEMA_KIND, id: null };
	const [kind, ...rest] = segments;
	return { kind: kind as string, id: rest.length ? rest.join('/') : null };
}
