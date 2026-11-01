export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export interface Route {
	/** Stable id; contract cases name the route they exercise by it. */
	id: string;
	method: Method;
	/** After `/api`. `:name` one decoded segment; `*name` greedy, last. */
	pattern: string;
	/** The section anchor in PROTOCOL.md. */
	doc: string;
}
export declare const ROUTES: Route[];
export declare function matchRoute(method: string, rawPath: string): { route: Route; params: Record<string, string> } | null;
