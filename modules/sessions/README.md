# @dreamteamer/sessions

One sitting of work — a coding-agent session, an agent run, a person's focused block — on a project:
who did it, when, how long, what it cost and what came out of it. The event, never the plan
(`projects`) and never the commitment (`tasks`). Also draws the workspace's `agents` in the nav beside
users, as the workers tasks and sessions name.

```bash
npm install @dreamteamer/sessions @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| sessions saved from the transcript, analysed, bound to any record and listed back by `dt next` | **projects** lets a session name the project it served · **tasks** lists the tasks it produced or closed |

Until core 0.12.0 this shipped inside `@dreamteamer/core`; the records, their folder (`data/sessions/`) and
their ids are unchanged. A `Stop` hook written for core names core's copy of `session-save.mjs` —
repoint it at `@dreamteamer/sessions/bin/session-save.mjs` (below).

## sessions: save and analyze

`/session:save` reads the transcript the harness keeps for the current session and upserts
`sessions/<session id>` with what it holds — turns, tool calls, input and output tokens, cache read
and written, cost at list price, wall and API minutes, the models that answered, lines added and
removed — and keeps a copy of the transcript under `${env:SESSIONS_FOLDER}/`, since the harness
sweeps its own after a month. `/session:analyze` reads that transcript as a reviewer and writes
`analysis` and a one-line `description` onto the record. Both are the `managing-sessions` skill; the
reader is `bin/session-save.mjs` (`--json` prints the fields and writes nothing).

A session record is an ordinary record under `data/sessions/`, committed like any other — a
colleague who pulls the workspace lists it. `SESSIONS_FOLDER` (sessions requests it in `dreamteamer.vars`;
the workspace declares it and `.env` sets it per machine) names only where transcript copies go:
`transcript` reads `${env:SESSIONS_FOLDER}/<yyyy>/<mm>/<session id>.jsonl`. Unset, every record verb
still works and the record points at the harness's own copy. To keep the
metrics current without anyone remembering, bind the reader to the harness's `Stop` hook in the
workspace's `.claude/settings.json` — the module ships the reader, not the binding:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/@dreamteamer/sessions/bin/session-save.mjs --write --hook --quiet",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

The hook writes metrics only; `outcome`, `analysis` and `description` stay the session's and the
reviewer's words. Namespaced commands (`commands/session/save.command.md` typed as `/session:save`)
need engine 0.38; a record's sessions in `dt next` need 0.42. The floor is 0.48.0, the one core 0.11 shipped
this code under.

## binding records to a session, and asking one

```bash
dt session bind <collection>/<id>… [--session <id>]   # add records to the current session's `records` (/session:bind)
dt next <collection>/<id>                             # "worked on in sessions/<id> — …", one line per session
dt session end [<session>] [--outcome <text>]         # stamp `ended` once; the outcome is the body
dt session send <session> "<question>"                # ask a past session, through a fork with no tools
```

`records` takes any number of references to records of any collection. A session record is written to
the workspace the session runs in — never inside a `git_modules/` layer — so one harness session is
one record, and a layer's record is bound from the workspace that reads the layer. Binding again changes
nothing. There is no claim and no lock: when another session already lists a record, `bind` names it
in one line and binds anyway. A record's sessions are read when `dt next` asks, from every root the
open workspace reads; nothing is written to the bound record, so a layer opened on its own sees only
its own sessions.

`dt session send` resumes the session's transcript by its stored `session_id` with
`claude -p --resume <id> --fork-session`, with no tools, no MCP servers and no hooks, from a temporary
folder, the question on stdin: the session's own history is untouched and the fork can only answer. It
needs the transcript on this machine and a claude-code session, and refuses naming which otherwise.

Core 0.8.0's live sessions (session-bindings, `dt session start`, `dt sessions open`, the heartbeat
and the claim) are gone; a `session-bindings/` folder a layer or an older package still ships compiles
with one `retired … ignored` line. `bin/sessions-migrate.mjs` (`npx dt-sessions-migrate`) moves a core 0.8.0 workspace (core's UPDATING 0.9.0).
