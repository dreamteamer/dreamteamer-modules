// The persisted PaneStore (cr-modules-017 §2, §4, §5): what the protocol's five pane routes answer from in dt web.
// `host()` is the page's boot values — level, chat, the workspace's id and name, the files and frames bases, the
// file bases, the declared var roots and the module grants — answered behind the cookie (the 03:45 revision) and
// carrying no workspace root path (reading 2: a var root keeps its `path`, which `uriForPath` maps from).
import fs from 'node:fs';
import path from 'node:path';
import { readModuleGrantResult } from '@dreamteamer/protocol/module-grant';
import { listQueue, newQueueItem, QUEUE_TTL_MS } from '@dreamteamer/protocol/pane';

export const CHAT_WINDOW_MS = 24 * 3_600_000;
/** How many queue items the state keeps (the page lists QUEUE_LIST_MAX of them). */
export const QUEUE_KEEP = 100;

/** The workspace's name: its package.json `name` (what GET /info answers), else the folder's. */
export function workspaceName(root) {
	try {
		const name = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name;
		if (typeof name === 'string' && name) return name;
	} catch { /* no package.json */ }
	return path.basename(root);
}

/** A hook ran for this workspace within the last 24 hours (Ask in chat draws only then). */
export const chatSeen = (state, now) => typeof state.hookSeenAt === 'string' && now - Date.parse(state.hookSeenAt) < CHAT_WINDOW_MS;

/**
 * The pane's state lives in the workspace state file (`state.pane`, state.js): the place and selection written through
 * a throttle (at most once a minute, and on `flush`), a queue change and the first hook stamp at once. `onChange(type)`
 * tells the connected pages (`dt:queue`, `dt:host`).
 * @param {{ root: string, state: object, save: () => void, filesKey: string, workspace: { id: string, name: string },
 *           fileBases?: () => { collection: string, path: string, suffix: string }[], varRoots?: () => { name: string, path: string }[],
 *           onChange?: (type: 'dt:queue' | 'dt:host') => void, now?: () => number, writeEveryMs?: number }} o
 */
export function createPaneStore({ root, state, save, filesKey, workspace, fileBases = () => [], varRoots = () => [], onChange = () => {}, now = Date.now, writeEveryMs = 60_000 }) {
	const filesBase = `/_files/${filesKey}`;
	const pane = state.pane;
	let lastWrite = -Infinity;
	let dirty = false;
	const write = () => { save(); lastWrite = now(); dirty = false; };
	const writeSoon = () => { dirty = true; if (now() - lastWrite >= writeEveryMs) write(); };
	const waiting = (t) => listQueue(pane.queue, t).filter((i) => i.state === 'waiting').map((i) => ({ ...i, refs: [...i.refs] }));
	const markDelivered = (ids, t) => {
		const at = new Date(t).toISOString();
		const want = new Set(ids);
		let n = 0;
		for (const i of pane.queue) {
			if (want.has(i.id) && i.state === 'waiting' && t - Date.parse(i.queuedAt) < QUEUE_TTL_MS) { i.state = 'delivered'; i.deliveredAt = at; n++; }
		}
		return n;
	};
	return {
		/** The boot values at `level` (the asking page's effective level; the workspace's stored one when absent). */
		host({ level = state.level } = {}) {
			const grants = readModuleGrantResult(root);
			const out = {
				level,
				chat: chatSeen(state, now()),
				workspace: { id: workspace.id, name: workspace.name },
				filesBase,
				framesBase: `/_frames/${filesKey}`,
				fileBases: fileBases().map((b) => ({ ...b, uri: `${filesBase}/w/${b.path.replace(/\\/g, '/')}` })),
				varRoots: varRoots().map((r) => ({ name: r.name, path: r.path, uri: `${filesBase}/v/${encodeURIComponent(r.name)}` })),
				moduleGrants: grants.grant,
				moduleGrantProblem: grants.problem,
			};
			if (state.raisedAt) out.raisedAt = state.raisedAt;
			return out;
		},
		getSelection: () => ({ view: pane.view ?? null, refs: [...(pane.refs ?? [])], place: pane.place ?? null, at: pane.at ?? null }),
		putSelection(s) {
			pane.view = s.view ?? null;
			pane.refs = [...(s.refs ?? [])];
			pane.place = s.place ?? null;
			pane.at = s.at ?? null;
			writeSoon();
		},
		getQueue: (t = now()) => listQueue(pane.queue, t),
		addQueue(i) {
			const item = newQueueItem(i, now());
			pane.queue = [item, ...pane.queue].slice(0, QUEUE_KEEP);
			write();
			onChange('dt:queue');
			return item;
		},
		/**
		 * What `GET /_dt/pane` answers. With `hook`, the prompt hook asks: hookSeenAt is stamped, every waiting item is
		 * handed out ONCE — marked delivered as it is answered, so two prompts close together cannot both carry it —
		 * and movedTo is answered once and cleared.
		 */
		snapshot({ hook = false, connected = false } = {}) {
			const t = now();
			// the hook prints only while a page is connected: with none, nothing is handed out and an item waits
			const queue = hook && !connected ? [] : waiting(t);
			const movedTo = pane.movedTo ?? null;
			if (hook) {
				const wasSeen = chatSeen(state, t);
				state.hookSeenAt = new Date(t).toISOString();
				const handed = markDelivered(queue.map((i) => i.id), t);
				if (movedTo) pane.movedTo = null;
				if (handed || movedTo || !wasSeen) write(); else writeSoon();
				if (handed) onChange('dt:queue');
				if (!wasSeen) onChange('dt:host');
			}
			return { connected, place: pane.place ?? null, view: pane.view ?? null, refs: [...(pane.refs ?? [])], queue, movedTo };
		},
		/** `POST /_dt/pane/delivered`: these waiting items were printed. → how many changed. */
		delivered(ids) {
			const n = markDelivered(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [], now());
			if (n) { write(); onChange('dt:queue'); }
			return n;
		},
		/** `dt web open` in another workspace took the pane (task 13). */
		moved(to) { pane.movedTo = to; write(); },
		flush() { if (dirty) write(); },
	};
}
