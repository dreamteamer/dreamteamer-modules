import type { Scope } from './gate.js';
export const MODULE_READ_ROUTES: string[];
export const MODULE_WRITE_ROUTES: string[];
export const MODULE_ROUTES: string[];
export function buildModuleScope(input: {
	module: string; home: string;
	collectionsRows: Array<{ id: string; $module?: string }>;
	descriptors: Array<{ name: string; fields?: Record<string, any>; compiled?: { overlaid_by?: string[] }; runtime?: boolean }>;
	grant: Record<string, { reads?: string[]; writes?: string[] }>;
}): Scope & { kind: 'module'; module: string; home: string; own: Set<string> };
