// The frame bridge (cr-modules-008 §2; cr-modules-007 §4a): a message counts only when its source is a frame
// the host registered, and a frame whose document is ever replaced stops counting.
export function createFrameBridge() {
	const frames = new Map(); // window → { meta, loads }
	return {
		add(win, meta) { frames.set(win, { meta, loads: 0 }); },
		remove(win) { frames.delete(win); },
		/** Call on every `load` of the frame element; the second load drops the frame. */
		loaded(win) { const f = frames.get(win); if (!f) return; if (++f.loads > 1) frames.delete(win); },
		/** @returns {{meta: unknown, msg: {dt: 1, id: unknown, op: string}} | null} */
		accept(event) {
			const f = frames.get(event?.source);
			const d = event?.data;
			if (!f || !d || d.dt !== 1 || d.id === undefined || typeof d.op !== 'string') return null;
			return { meta: f.meta, msg: d };
		},
		reply(win, id, reply) { if (frames.has(win)) win.postMessage({ dt: 1, id, reply }, '*'); },
		post(win, msg) { if (frames.has(win)) win.postMessage({ dt: 1, ...msg }, '*'); },
	};
}
