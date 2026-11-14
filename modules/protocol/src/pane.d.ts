export type PaneLevel = 'read' | 'edit' | 'admin';
export type PaneView = { collection: string } | { collection: string; id: string } | { uiView: string } | { other: true };
export interface PaneSelection { view: PaneView | null; refs: string[]; place: string | null; at: string | null }
export interface QueueItem {
	id: string; command: string; refs: string[]; invocation: string;
	state: 'waiting' | 'delivered' | 'expired'; queuedAt: string; deliveredAt?: string;
}
export interface HostInfo {
	level: PaneLevel; chat: boolean; workspace: { id?: string; name: string }; raisedAt?: string;
	filesBase?: string; framesBase?: string; fileBases?: unknown[]; varRoots?: unknown[]; moduleGrants?: unknown; moduleGrantProblem?: unknown;
}
export interface PaneStore {
	host(): HostInfo | Promise<HostInfo>;
	getSelection(): PaneSelection;
	putSelection(s: PaneSelection): void;
	/** Expiry applied on read, newest first, at most 20. */
	getQueue(now?: number): QueueItem[];
	addQueue(i: { command: string; refs: string[]; invocation: string }): QueueItem | Promise<QueueItem>;
}
/** What the validators read: the compiled descriptors and the host's own record and command reads. */
export interface PaneReader {
	descriptors(): Map<string, unknown>;
	handle(method: string, path: string): Promise<{ status: number; body?: any }>;
}
/** THE parseRef seam: absent, the loaded engine's `engine().parseRef` (namespaces honoured). */
export interface PaneOptions { parseRef?: (ref: string) => { collection: string; id: string } | null }
export declare const MAX_REFS: 50;
export declare const QUEUE_TTL_MS: 3_600_000;
export declare const QUEUE_LIST_MAX: 20;
export declare const PANE_ROUTES: Set<string>;
export declare function validateSelection(api: PaneReader, body: unknown, opts?: PaneOptions):
	Promise<{ ok: true; value: { view: PaneView; refs: string[] } } | { ok: false; error: string }>;
export declare function validateQueue(api: PaneReader, body: unknown, opts?: PaneOptions):
	Promise<{ ok: true; value: { command: string; refs: string[]; invocation: string } } | { ok: false; error: string }>;
/** From ids alone: a ui-view's place is its id unless a title function is given (the router passes none). */
export declare function renderPlace(view: PaneView | null, uiViewTitle?: (id: string) => string | null): string | null;
export declare function expireQueue(items: QueueItem[], now: number): QueueItem[];
export declare function listQueue(items: QueueItem[], now: number): QueueItem[];
export declare function newQueueItem(i: { command: string; refs: string[]; invocation: string }, now?: number): QueueItem;
export declare function memoryPane(o: { host: () => HostInfo | Promise<HostInfo>; now?: () => number }): PaneStore;
export declare function defaultPane(api: object, host: (method: string, path: string) => Promise<{ status: number; body: any }>): PaneStore;
export declare function answerPane(id: string, body: unknown, o: { pane: PaneStore; reader: PaneReader; parseRef?: PaneOptions['parseRef'] }):
	Promise<{ status: number; body: unknown }>;
