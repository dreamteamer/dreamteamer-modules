// The persisted PaneStore (cr-modules-017 §2, §4, §5): what the protocol's five pane routes answer from in dt web.
// `host()` is the page's boot values — level, chat, the workspace's id and name, the files and frames bases, the
// file bases, the declared var roots and the module grants — answered behind the cookie (the 03:45 revision) and
// carrying no workspace root path (reading 2: a var root keeps its `path`, which `uriForPath` maps from).
import fs from 'node:fs';
import path from 'node:path';
import { readModuleGrantResult } from '@dreamteamer/protocol/module-grant';
import { memoryPane } from '@dreamteamer/protocol/pane';

export const CHAT_WINDOW_MS = 24 * 3_600_000;

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
 * @param {{ root: string, state: object, save: () => void, filesKey: string, workspace: { id: string, name: string },
 *           fileBases: () => { collection: string, path: string, suffix: string }[], varRoots: () => { name: string, path: string }[],
 *           now?: () => number }} o
 */
export function createPaneStore({ root, state, filesKey, workspace, fileBases = () => [], varRoots = () => [], now = Date.now }) {
	const filesBase = `/_files/${filesKey}`;
	const memory = memoryPane({ host: () => null, now });
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
		getSelection: memory.getSelection,
		putSelection: memory.putSelection,
		getQueue: memory.getQueue,
		addQueue: memory.addQueue,
	};
}
