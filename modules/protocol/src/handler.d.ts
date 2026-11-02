import type { WorkspaceApi } from './host/api.js';
export interface Handler {
	handle(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
	readonly api: WorkspaceApi;
	scope: string;
	reopen(): Promise<void>;
}
export declare function createHandler(opts: { root: string; scope?: 'all' | 'private' | 'shared'; onSystemWrite?: (result: unknown) => void }): Promise<Handler>;
