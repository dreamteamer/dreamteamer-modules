export interface NavSettings {
	navGroups?: unknown;
	navOrder?: unknown;
	navHidden?: unknown;
	layersFolder?: unknown;
}
export interface NavNode {
	kind: 'workspace' | 'group' | 'collection' | 'view' | 'layers' | 'layer' | 'layer-group' | 'layer-collection' | 'layer-note' | 'message';
	key: string;
	label: string;
	icon?: string;
	description?: string;
	tooltip?: string;
	route?: string;
	marks?: string;
	children?: NavNode[];
}
export declare function workspaceNavSettings(root: string): NavSettings;
export declare function navModel(ctx: { root: string; settings?: NavSettings }): NavNode[];
