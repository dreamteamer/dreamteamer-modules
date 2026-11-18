// the sessions extension — what src/activate.js activates (until core 0.12.0 it was core's own half of core's
// entry, merged there with the files origin's). It contributes the `session` verb (bind · end · send), the sessions a record was
// worked on in `dt next`, and the RETIRED session-bindings kind: core 0.9.0 removed live sessions, so a
// session-bindings folder a layer or an older package still ships compiles with one line and is ignored.
import type { CompileDraft, Contribution } from "dreamteamer"
import { sessionCommand, nextNotes, SESSION_USAGE, type Api } from "./cli.ts"

export type { Api }

const PREFIX = "session-bindings/"

/** The compile-time half: one warning per staged session-bindings file, nothing refused. */
export function retiredBindings(draft: CompileDraft) {
  const files = [...draft.entries.keys()].filter(k => k.startsWith(PREFIX))
  return {
    errors: [] as string[],
    warnings: files.map(
      f =>
        `${f}: retired in core 0.9.0, ignored — sessions are plain records now (dt session bind); npx dreamteamer run @dreamteamer/sessions sessions-migrate removes a workspace's own`
    ),
    notes: [] as string[],
  }
}

export function activateSessions(dt: Api): Contribution {
  const c: Contribution = {
    commands: {
      session: {
        usage: SESSION_USAGE,
        run: (ws, argv) => {
          dt.warnIfStale?.(ws.root)
          return sessionCommand(ws, argv, dt)
        },
      },
    },
    sourceKinds: ["session-bindings"],
    analyze: draft => retiredBindings(draft),
  }
  // `next` exists from engine 0.42.0, core's floor; the guard keeps an older engine from refusing core
  if (typeof dt.contributedNotes === "function") c.next = ctx => nextNotes(ctx.ws, dt, ctx)
  return c
}
