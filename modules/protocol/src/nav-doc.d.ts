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
