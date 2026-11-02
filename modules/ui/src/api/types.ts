/** Shared shapes for the server contract (spec: GET /collections, /fields/:path, /items/:path). */

/**
 * ONE COLLECTION ROW OF THE DISPLAY CONTRACT — the engine's `presentation()` (descriptor format v2,
 * §4.3), carried VERBATIM by `api/collection-rows.ts`, plus the two webview constants below.
 *
 * `display` is resolved by the engine (what the author wrote over what compile supplied), so every
 * sub-block is present and a surface never re-derives a default: `list.layout` is always set, and
 * `record_title` is always a template. A key absent from a sub-block was never authored.
 */
export interface CollectionRow {
	collection: string;
	/** What to call this collection — engine-resolved. */
	title: string;
	nav: {
		/** A codicon name. */
		icon?: string;
		/** Position in the tree, lower first. */
		order?: number;
		/** A free partition with no reserved values. */
		section?: string;
	};
	/** The collection's default LIST: what a bare route renders. */
	list: {
		layout: string;
		/** The column set AND its order. */
		columns?: string[];
		/** `field` or `-field`. */
		sort?: string;
		/** Layout option keys (§3.5.1), for `layout`. */
		options?: Record<string, unknown>;
	};
	/** The collection's default RECORD page. */
	record: {
		layout: string;
		/** A display template rendered under the record's title. */
		subtitle?: string;
		/** A field drawn as a chip in the record header. */
		badge?: string;
		/** A field whose enum choices' colours tint row, card and chip. */
		color_by?: string;
		/** The record layout's options (§3.5) — where `relation_views` is authored. */
		options?: Record<string, unknown>;
	};
	/** `collapsed` (engine after 0.39.1): drawn shut, after every other field, until opened. */
	form: { sections: Array<{ title: string; fields: string[]; collapsed?: boolean }> };
	/** The field a manual drag writes (`type: position`). Absent when the collection has no hand order. */
	position_field?: string;
	/** How ONE record is labelled wherever it is referenced — a template (§3.7). */
	record_title: string;
	/** The record's row shape — its filename's middle segment. */
	record_type: string;
	/** The records are compile's build output: a write goes through the compile gate. */
	runtime: boolean;
	/** Workspace plumbing rather than a domain noun. */
	internal: boolean;
	/** Webview constant — 'disk' on every registered row (`lib/okf.ts`'s marker). */
	provenance?: string;
	/** Webview constant — `''`, the local workspace. */
	layer?: string;
	/**
	 * Every root this collection's records are read from, NAMED, write root first — the extension's
	 * own key on the engine's row (host `src/sources.ts`, 0.24.0). What decides whether a browse is
	 * mixed, single-foreign or the workspace's own before a record is fetched.
	 */
	sources?: SourceEntry[];
}

/** One root a collection reads, named: the workspace's `package.json` name, a layer's `git_modules`
 *  key, or a module's id. `count` is the records read FROM it (the write root wins a duplicate). */
export interface SourceEntry {
	name: string;
	kind: 'own' | 'layer' | 'module';
	/** The repo an edit of such a record commits to, workspace-relative (`.` = the workspace). */
	repo: string;
	path: string;
	/** False for a layer whose clone is absent — its records are not read. */
	installed: boolean;
	count: number;
	/** `repos/<id>` when a `repos` record's `url` matches the root's remote — rendered as a link. */
	record?: string;
	/** What the folder is: the workspace's own root, a linked clone, a record layer, an installed
	 *  package (host `src/sources.ts` `SourceVia`). Absent from a host older than cr-vscode-004. */
	via?: SourceVia;
	/** Whether a write from this workspace lands there — `write` (edits and new records), `edit` (edits
	 *  only), `read` (nothing). Absent: unknown, and no surface draws a writability glyph. */
	access?: SourceAccess;
	/** Why, for anything short of `write`. */
	note?: string;
}

export type SourceVia = 'own' | 'clone' | 'layer' | 'package';
export type SourceAccess = 'write' | 'edit' | 'read';

export interface UnregisteredFolder {
	path: string;
	recordFileCount: number;
}

/** The wire types of the display contract — the AUTHORED type names (design §3.4.1, §4.3). A
 *  reference travels as `string` and says what it is through `role`; a list is `many: true` over
 *  its item's type. */
export type FieldType =
	| 'string' | 'markdown' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime'
	| 'url' | 'email' | 'object' | 'map' | 'position';

/** The three surfaces a field can be hidden from — `display`'s own sub-blocks. */
export type FieldSurface = 'list' | 'form' | 'record';

/** One enum value as every surface draws it: `label` is what to show, `value` what is stored. */
export interface FieldChoice {
	label: string;
	/** A string from the engine; the extension's own registry options also use numbers (page size). */
	value: string | number;
	description?: string;
	/** A codicon name, or a reference to a binary record (`lib/file-record.ts`). */
	icon?: string;
	/** A theme colour id. */
	color?: string;
	background?: string;
}

/** What a field's component needs beyond the field itself: the enum's choice rows, an object's
 *  sub-field rows (each a full `FieldRow`) and their row label, and the authored `display.options`. */
export interface FieldComponentOptions {
	choices?: FieldChoice[];
	fields?: FieldRow[];
	item_title?: string;
	[option: string]: unknown;
}

/**
 * ONE FIELD ROW OF THE DISPLAY CONTRACT — the engine's `presentation()` (descriptor v2, §4.3), flat,
 * exactly as `src/records-api.d.ts`'s `PresentationField` types it. There is no `meta` and no
 * `schema` block: every key is a word of the contract.
 *
 * - `kind` names the three engine-held kinds of read-only (`mirror_of`, `derived`, `virtual`): every
 *   writer is refused, so no surface offers a control. `editable` is the UI's own lock — `false`
 *   draws no control, `create` draws one on the create form only.
 * - `hidden` names the surfaces NOT to draw it on. `form` is the edit and create form; `record` is
 *   the record page read; `list` is every list layout.
 * - `role` replaces the old `special`: `body` is the page field, `reference`/`reference_many` a
 *   foreign key, `mirror` the generated far side.
 */
export interface FieldRow {
	collection?: string;
	field: string;
	type: FieldType;
	many?: true;
	/** What to call this field — engine-resolved. */
	title: string;
	description?: string;
	required: boolean;
	kind?: 'derived' | 'virtual' | 'mirror';
	editable: boolean | 'create';
	hidden?: FieldSurface[];
	role?: 'body' | 'reference' | 'reference_many' | 'mirror';
	/** A registered Edit id; absent means the type's default. */
	editor?: string;
	editor_options?: FieldComponentOptions;
	/** A registered View id; absent means the type's default. */
	viewer?: string;
	viewer_options?: FieldComponentOptions;
	/** MIRROR side: the owner's field this one is generated from — the field NAME on the target. */
	mirror_of?: string;
	/** What removing a TARGET does to this reference. */
	on_delete?: string;
	unique?: true;
	nullable: boolean;
	default?: unknown;
	/** `currency` · `percent` · `bytes` · or a literal suffix (`min`, `kg`). */
	unit?: string;
	/** `unit: currency` only: the sibling field holding the ISO 4217 code. */
	unit_field?: string;
	/** Text direction of the VALUES. */
	direction?: 'ltr' | 'rtl';
	/** A list-column width hint, in characters. */
	width?: number;
	placeholder?: string;
	/** The `form.sections` title this field is drawn under. */
	form_section?: string;
	deprecated?: true;
	sensitive?: true;
}

/**
 * One record from `/items/*`: explicit fields + `body` + implicit `id`/`type`/`date_*`/`user_*`,
 * plus the hidden `$`-prefixed implicits — `$path`, `$size`, `$bundle` (`''` = local), and
 * `$writable` (false when the record is supplied read-only by a dependency bundle). Folder-shape
 * records also carry `attachments: AttachmentInfo[]`.
 */
export type ItemRecord = Record<string, unknown>;

/** One entry of a folder-shape record's read-only `attachments` list. */
export interface AttachmentInfo {
	name: string;
	size: number;
}

/**
 * `GET /activity` row shape (server/src/services/history.ts `activityRow`): git-log-backed,
 * never stored. There is no commit-message/"subject" field in the real contract (verified via
 * `curl` against the demo workspace — only `action`/`user`/`timestamp`/`collection`/`item` plus
 * `ip`/`user_agent`/`origin`, all structured from git trailers, never free text) — ItemHistory
 * renders `action` where the C2 plan sketch expected a "subject". `id` is `<sha>.<n>`; the short
 * hash shown in the UI is `id`'s `sha` segment, sliced.
 */
export interface ActivityUser {
	id?: string;
	first_name?: string | null;
	last_name?: string | null;
	email?: string | null;
}

export interface ActivityRow {
	id: string;
	action: string;
	user: ActivityUser | string | null;
	timestamp: string;
	collection: string | null;
	item: string | null;
}
