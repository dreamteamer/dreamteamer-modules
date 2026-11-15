export type Op = 'create' | 'update' | 'delete' | 'position';
export interface WriteGrant { ops: Set<Op>; fields: Set<string> | 'own-fields'; mirroredRefs: 'refuse' | 'allow'; commit: boolean }
export interface Sentences {
	route(scope: Scope, d: { method: string; pattern: string }): string;
	collectionRead(scope: Scope, d: { collection: string }): string;
	collectionWrite(scope: Scope, d: { collection?: string; op?: Op; reason?: string }): string;
	field(scope: Scope, d: { collection: string; field: string }): string;
	filter(scope: Scope, d: { reason: string }): string;
	query(scope: Scope, d: { key: string }): string;
}
export interface Scope {
	kind: 'artifact' | 'module'; label: string; routes: Set<string>; reads: Set<string>;
	writes: Map<string, WriteGrant>; home?: string; module?: string; own?: Set<string>; sentences: Sentences;
}
export interface Call { method: string; path: string; query: Record<string, string>; body: unknown; routeId: string; collection?: string }
export type Decision =
	| { ok: true; call: Call; needsSource?: 'home'; commit?: { only: string[] | null; message: string } }
	| { ok: false; status: number; error: string };
export const OPERATORS: Set<string>;
export const READ_QUERY_KEYS: Set<string>;
export const SYSTEM_COLLECTIONS: Set<string>;
export const BOUNDS: { operand: number; list: number; conditions: number; q: number; limit: number };
export function gate(scope: Scope | import('./pane-scope.d.ts').PaneScope, descriptors: Array<{ name: string; fields?: Record<string, any>; runtime?: boolean }> | Map<string, any>,
	method: string, path: string, query?: URLSearchParams | Record<string, string>, body?: unknown): Decision;
