import type { Decision } from './gate.js';
export function applyWrite(handle: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>,
	decision: Extract<Decision, { ok: true }>): Promise<{ status: number; body: any }>;
