import type { WorkspaceApi } from './host/api.js';
export interface Handler {
	handle(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
	readonly api: WorkspaceApi;
	reopen(): Promise<void>;
}
export declare function createHandler(opts: { root: string; onSystemWrite?: (result: unknown) => void }): Promise<Handler>;
