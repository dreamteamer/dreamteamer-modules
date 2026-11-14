import type { RouteLevel } from './routes.d.ts';
export declare const LEVELS: RouteLevel[];
export declare function levelRank(level: string): number;
export declare function lowerLevel<A extends string, B extends string>(a: A, b: B): A | B;
export declare const RECORD_WRITE_ROUTES: Set<string>;
export declare function internalCollections(descriptors: Iterable<{ name: string; runtime?: boolean }>,
	engine: { isInternal?: (d: any) => boolean; isRuntime?: (d: any) => boolean }): Set<string>;
export interface PaneScope {
	kind: 'pane'; level: RouteLevel; internal: Set<string>; label: string;
	sentences: { level(scope: PaneScope, d: { method: string; pattern: string; need: RouteLevel }): string };
}
export declare function paneScope(input: { level: RouteLevel; internal: Set<string>; label?: string }): PaneScope;
