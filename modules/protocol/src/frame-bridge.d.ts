export interface FrameBridge<M = unknown> {
	add(win: object, meta: M): void;
	remove(win: object): void;
	loaded(win: object): void;
	accept(event: { source: unknown; data: unknown }): { meta: M; msg: { dt: 1; id: unknown; op: string; [k: string]: unknown } } | null;
	reply(win: { postMessage(m: unknown, t: string): void }, id: unknown, reply: unknown): void;
	post(win: { postMessage(m: unknown, t: string): void }, msg: Record<string, unknown>): void;
}
export function createFrameBridge<M = unknown>(): FrameBridge<M>;
