// core's sessions — the half of core's extension that is core's own (src/entry.js merges it with the
// files origin's). It contributes the `session` verb (bind · end · send), the sessions a record was
// worked on in `dt next`, and the RETIRED session-bindings kind: core 0.9.0 removed live sessions, so a
// session-bindings folder a layer or an older package still ships compiles with one line and is ignored.
import { sessionCommand, nextNotes, SESSION_USAGE } from './cli.js';

const PREFIX = 'session-bindings/';

/** The compile-time half: one warning per staged session-bindings file, nothing refused. */
export function retiredBindings(draft) {
	const files = [...draft.entries.keys()].filter((k) => k.startsWith(PREFIX));
	return { errors: [], warnings: files.map((f) => `${f}: retired in core 0.9.0, ignored — sessions are plain records now (dt session bind); node node_modules/@dreamteamer/core/bin/sessions-migrate.mjs removes a workspace's own`), notes: [] };
}

export function activateSessions(dt) {
	const c = {
		commands: {
			session: { usage: SESSION_USAGE, run: (ws, argv) => { dt.warnIfStale?.(ws.root); return sessionCommand(ws, argv, dt); } },
		},
		sourceKinds: ['session-bindings'],
		analyze: (draft) => retiredBindings(draft),
	};
	// `next` exists from engine 0.42.0, core's floor; the guard keeps an older engine from refusing core
	if (typeof dt.contributedNotes === 'function') c.next = (ctx) => nextNotes(ctx.ws, dt, ctx);
	return c;
}
