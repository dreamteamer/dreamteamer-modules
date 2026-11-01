// core's live sessions — the half of core's extension that is core's own (src/entry.js merges it with
// the files origin's). It contributes the session-bindings source kind and its compile analysis, the
// `session` and `sessions` verbs, the claim in `dt next`, the orientation paragraph, and the Stop hook
// that keeps a Claude Code session's heartbeat fresh.
import { analyzeBindings, orientation } from './bindings.js';
import { sessionCommand, sessionsCommand, nextNotes, SESSION_USAGE, SESSIONS_USAGE } from './cli.js';

export function activateSessions(dt) {
	const c = {
		commands: {
			session: { usage: SESSION_USAGE, run: (ws, argv) => { dt.warnIfStale?.(ws.root); return sessionCommand(ws, argv, dt); } },
			sessions: { usage: SESSIONS_USAGE, run: (ws, argv) => { dt.warnIfStale?.(ws.root); return sessionsCommand(ws, argv, dt); } },
		},
		sourceKinds: ['session-bindings'],
		analyze: (draft) => analyzeBindings(draft, dt),
		orientation: ({ entries }) => orientation(entries, dt),
		hooks: { Stop: 'session heartbeat --hook' },
	};
	// `next` exists from the engine that exports contributedNotes; an older engine refuses an unknown
	// contribution key, so core contributes it only where it is read — every verb works either way
	if (typeof dt.contributedNotes === 'function') c.next = (ctx) => nextNotes(ctx.ws, dt, ctx);
	return c;
}
