export interface NavSettings {
	navGroups?: unknown;
	navOrder?: unknown;
	navHidden?: unknown;
	layersFolder?: unknown;
}
import type { NavTarget, NavDoc } from './nav-doc.js';
export interface NavNode {
	kind: 'workspace' | 'folder' | 'namespace' | 'collection' | 'view' | 'layers' | 'layer' | 'layer-group' | 'layer-collection' | 'layer-note' | 'message';
	key: string;
	label: string;
	icon?: string;
	description?: string;
	tooltip?: string;
	route?: string;
	marks?: string;
	/** On folder, namespace and collection nodes: what a host sends back in a PATCH /nav op. */
	target?: NavTarget;
	/** On the workspace node: a message to draw once above the tree (an unreadable nav.yaml). */
	notice?: string;
	children?: NavNode[];
}
export declare function workspaceNavSettings(root: string): NavSettings;
/** `<root>/nav.yaml` through the engine's reader when it has one, else the protocol's own; null when absent. */
export declare function readNavDoc(root: string): NavDoc | null;
/** What a nav write is checked against: drawable rows in drawn tail order, every compiled collection, the namespaces. */
export declare function navOpContext(root: string): { collections: Set<string>; known: Set<string>; namespaces: string[] };
export declare function navModel(ctx: { root: string; settings?: NavSettings }): NavNode[];
