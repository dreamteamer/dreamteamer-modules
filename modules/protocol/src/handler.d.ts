import type { WorkspaceApi } from './host/api.js';
export interface Handler {
	handle(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
	readonly api: WorkspaceApi;
	reopen(): Promise<void>;
}
export declare function createHandler(opts: { root: string; onSystemWrite?: (result: unknown) => void; settings?: () => object;
	/** The store the five pane routes answer from; absent, one in memory at admin. */
	pane?: import('./pane.d.ts').PaneStore }): Promise<Handler>;
export declare function route(
	api: { descriptors(): unknown },
	method: string,
	path: string,
	body: unknown,
	opts: { root: string; settings: () => object; host: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
		pane?: import('./pane.d.ts').PaneStore },
): Promise<{ status: number; body: unknown }>;
/** The 409 PATCH and PUT /nav answer while nav.yaml is absent and an old nav setting is still set. */
export declare const NAV_UNMIGRATED: string;
export declare function unreadableDryRun(method: string, path: string): string | null;
