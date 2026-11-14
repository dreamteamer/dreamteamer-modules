// The nav document's types — the cross-repo contract of cr-dt-008 ("Protocol → hosts"). A host imports them from
// `@dreamteamer/protocol/nav-doc` and builds each gesture as one NavOp.

/** One entry of nav.yaml: a collection by name (or its long form, to override the icon), a folder, a namespace. */
export type Entry =
	| string
	| { collection: string; icon?: string }
	| { folder: string; icon?: string; hidden?: boolean; items: Entry[] }
	| { namespace: string; icon?: string; hidden?: boolean; items?: Entry[] };

/** nav.yaml: the tree, top to bottom, and the names that are not drawn. */
export interface NavDoc {
	tree: Entry[];
	hidden: string[];
}

/** What an op addresses. `name` is a collection or a namespace exactly as nav.yaml writes it; `folder` is the label
 *  path from the top level, where a namespace entry is the element `ns:<name>` — `{ folder: ['ns:rnd', 'Product'] }`.
 *  Labels match exactly; the path is an array, never a joined string. */
export type NavTarget = { name: string } | { folder: string[] };

/** One gesture. `into` is a folder or a namespace (`{ name: 'rnd' }` is the namespace entry); `position` is within
 *  `into`, or the top level when `into` is absent; `after` places right after that sibling in its parent. */
export type NavOp =
	| { op: 'move'; target: NavTarget; into?: NavTarget; after?: NavTarget; position?: 'top' | 'bottom' }
	| { op: 'new-folder'; label: string; into?: NavTarget }
	| { op: 'rename'; target: { folder: string[] }; label: string }
	| { op: 'dissolve'; target: { folder: string[] } }
	| { op: 'icon'; target: NavTarget; icon: string | null }
	| { op: 'hide'; target: NavTarget }
	| { op: 'show'; target: NavTarget };

/** What applyNavOp needs of the workspace: its collections in drawn tail order (by title — `tailOrder()`), and its
 *  namespaces in drawn order. */
export interface NavOpContext {
	collections: Set<string>;
	namespaces: string[];
}

/** A refused op; the message names the input. A host answers it 400 with the message. */
export declare class NavOpError extends Error {
	constructor(message: string);
	name: 'NavOpError';
}

/** nav.yaml exists and cannot be read; the message names the problem. */
export declare class NavDocError extends Error {
	constructor(message: string);
	name: 'NavDocError';
}
/** The protocol's own reader of `<root>/nav.yaml` (for an engine without `readNavDoc`): null when absent. Throws NavDocError. */
export declare function readNavDocFile(root: string): NavDoc | null;

/** The next document after one op. Pure: the input is never touched; an absent document is `{ tree: [], hidden: [] }`.
 *  A name the document does not place but the workspace has is a valid target or anchor, and placing it moves
 *  nothing else on screen. Throws NavOpError on any refusal. */
export declare function applyNavOp(doc: NavDoc | null | undefined, op: NavOp, ctx: NavOpContext): NavDoc;

/** An absent or partial document as a whole one, deep-copied. */
export declare function normalizeNavDoc(doc: unknown): NavDoc;
/** The collection a collection entry names; undefined for a folder or a namespace entry. */
export declare function collectionOf(entry: Entry): string | undefined;
/** The namespace a collection draws in: the longest declared namespace its name starts with, '' for none. */
export declare function namespaceOf(name: string, namespaces: readonly string[]): string;
/** Every name the document places: collection names, `ns:<name>` for namespace entries, and every hidden name. */
export declare function placedNames(doc: NavDoc): Set<string>;

export declare const NAV_FILE = "nav.yaml";
/** The first line of every nav.yaml a host writes. */
export declare const NAV_HEADER = "# The left nav of this workspace. Drag and drop writes this file; so may you.";
/** `<root>/nav.yaml` through the engine's reader when the loaded engine has one (0.49), else the protocol's own:
 *  null when absent; throws NavDocError when unreadable. */
export declare function readNavDoc(root: string): NavDoc | null;
/** A NavDoc as nav.yaml's text: the header line, `tree`, and `hidden` only when it holds a name. */
export declare function serializeNavDoc(doc: NavDoc): string;
/** The protocol's own atomic writer (an engine before 0.49). False when the bytes were already there. */
export declare function writeNavDocFile(root: string, doc: NavDoc): boolean;
/** Write `<root>/nav.yaml` through the engine's writer when the loaded engine has one, else the protocol's own. */
export declare function writeNavDoc(root: string, doc: NavDoc): boolean;
/** A PUT body checked for shape; the document as a whole one. Throws NavOpError naming the first problem. */
export declare function checkNavDoc(input: unknown): NavDoc;
/** `unknown collection "x"` / `unknown namespace "y"` for each name the workspace does not have. */
export declare function unknownNavNames(doc: NavDoc, ctx: { collections: Set<string> | Iterable<string>; namespaces: readonly string[] }): string[];

/** The legacy tree's top level (computed with no navHidden) as a NavDoc: folders keep label, nesting, order and icon;
 *  a hidden top-level row goes to `hidden`, a hidden top-level folder gets `hidden: true`; the layers entry is dropped. */
export declare function legacyDoc(
	entries: ReadonlyArray<unknown>,
	settings?: { navHidden?: unknown },
	ctx?: { titleOf?: Map<string, string | undefined>; iconOf?: (folder: any) => string | undefined },
): NavDoc;
/** Write the old nav settings into nav.yaml once (absent file, a setting set), then apply the engine's fragments when
 *  it merges them (0.49). The engine must be loaded for `root`. */
export declare function migrateNavSettings(
	root: string,
	settings?: { navGroups?: unknown; navOrder?: unknown; navHidden?: unknown },
): { written: boolean; fragments: boolean };
