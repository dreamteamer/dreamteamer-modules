export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
/** The least a pane must be at for the route to be answered. */
export type RouteLevel = 'read' | 'edit' | 'admin';
export interface Route {
	/** Stable id; contract cases name the route they exercise by it. */
	id: string;
	method: Method;
	/** After `/api`. `:name` one decoded segment; `*name` greedy, last. */
	pattern: string;
	/** The section anchor in PROTOCOL.md. */
	doc: string;
	/** read: every GET and PUT /selection; edit: record and nav writes, POST /queue; admin: the rest. */
	level: RouteLevel;
}
export declare const ROUTES: Route[];
export declare function matchRoute(method: string, rawPath: string): { route: Route; params: Record<string, string> } | null;
