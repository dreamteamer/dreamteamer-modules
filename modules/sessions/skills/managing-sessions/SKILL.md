---
name: managing-sessions
description: >-
  use when a coding-agent session should be accounted for — "save this session", "what did that session cost", "write up what we did", a `sessions` record for the sitting that just happened, or a Stop hook that keeps one current; and when a session should name the records it works on — `dt session bind`, /session:bind, "worked on in sessions/…" in `dt next`, `dt session end`, or asking a past session a question with `dt session send`. The mechanics behind /session:save and /session:analyze: the metrics come from the transcript, the recap and the analysis from reading it.
---

# managing-sessions

## What you are doing

You turn one sitting of agent work into a `sessions` record, in two steps that a person can run apart. **Save** reads the transcript the harness keeps and upserts the record's metrics — turns, tool calls, tokens in and out, cache read and written, cost at list price, wall and API minutes, models, lines added and removed — plus a pointer to a kept copy of the transcript and a recap in the session's own words. **Analyze** reads the transcript as a reviewer and writes `analysis` and `description` onto the same record. The record's id is the harness's session id, so a save is idempotent and a hook can run it every turn.

## Before you start

```bash
echo $CLAUDE_CODE_SESSION_ID                                  # the session you are in — every Bash and hook subprocess has it
node node_modules/@dreamteamer/sessions/bin/session-save.mjs --json   # the fields, read from the transcript, written nowhere
dt get sessions/$CLAUDE_CODE_SESSION_ID                       # whether a record exists already (a hook may have written it)
dt resolve '${env:SESSIONS_FOLDER}'                           # where the transcript copy will go; unset, the record points at the harness's own file
```

Session records are ordinary records under `data/sessions/`, committed like any other — a colleague who pulls the workspace lists them. `SESSIONS_FOLDER` names only where transcript copies are kept: set it in `.env` and declare it in the workspace's `dreamteamer.vars`; unset, every record verb still works and `transcript` points at the harness's own file.

The reader takes `--session <id>` for another session and `--transcript <path>` for a file that is not where the harness keeps it. Nothing here needs the network.

## Do this

**Save** (`/session:save`):

1. `node node_modules/@dreamteamer/sessions/bin/session-save.mjs --write` — adds `sessions/<session id>` or updates it, copies the transcript to `${env:SESSIONS_FOLDER}/<yyyy>/<mm>/<id>.jsonl` when `SESSIONS_FOLDER` resolves, and prints `added|updated sessions/<id>: N turns · M tool calls · $ USD`. Quote that line.
2. Set what the transcript cannot know, as `--set` pairs on the same call or a `dt set` after it: `worker=users/<me>` (or `agents/<id>` for an unattended run), `project=projects/<id>`, `repo=repos/<id>`, `tasks=tasks/<id>` for each task the session produced or closed.
3. Write `outcome` — the body — in the session's own words: what was asked, what landed (commits by subject, records by id, decisions by id), what is left. Short, and from what you actually did, not from the plan. `dt set sessions/<id> outcome="…"`.
4. Commit it by id — `dt commit sessions/<id>` — when the person keeps sessions in the shared workspace; it is a record like any other.

**Analyze** (`/session:analyze`):

1. Save first if no record exists. Read the transcript the record points at (`dt resolve sessions/<id> transcript`), not your memory of the session.
2. Write `analysis` as a reviewer would: the ask in one line; what was done, in order; where turns were spent — restated problems, reverted edits, a tool that failed and was retried, a question that reading a record would have answered; what the session cost against what it produced; what a next session should do differently. Name turn numbers and tool calls so a claim can be checked.
3. Write `description`: the session in one or two sentences, 400 characters at most — what a list row shows.
4. `dt set sessions/<id> analysis="…" description="…"`, then step 4 of save.

**A hook** keeps the metrics current without anyone remembering: bind `session-save.mjs --write --hook --quiet` to `Stop` in the workspace's harness settings (the README shows the block). The hook upserts metrics only; `outcome`, `analysis` and `description` are the session's and the reviewer's words, and only a person or a command writes them.

**Bind** (`/session:bind`, `dt session bind`) — name the records this session works on:

1. `dt session bind <collection>/<id>…` — adds each to `sessions/$CLAUDE_CODE_SESSION_ID` (`--session <id>` for another), writing the record when absent. Run it from anywhere: the record is written to the workspace the session runs in — never inside a `git_modules/` layer — so a record of a layer is bound from the HQ that reads it. Binding again changes nothing; an unknown ref is refused and nothing is written. Quote the `✔` line.
2. A line `… is also bound to sessions/<id>` names another session working on the same record. It is said, not refused: there is no lock. Read that session (`dt get sessions/<id>`) before you write over its work.
3. A record's own `dt next` lists the sessions that bound it ("worked on in sessions/<id> — …"), read when asked, from every workspace the open one reads. Nothing is written to the record.
4. When you stop: `dt session end [--outcome "<what landed, what is left>"]` — stamps `ended` once; again, it changes nothing.

**Ask a past session** — `dt session send <session> "<question>"` resumes the session's transcript as a FORK, with no tools, no MCP servers and no hooks, and prints its answer. The session's own history is untouched and the fork can only answer. It needs the transcript on this machine (a session resumes only where it ran) and a claude-code session; it refuses, naming which, otherwise. A session open in an editor right now is reached through the harness's own messaging, not this.

## Don't

- Don't compute the metrics yourself from the transcript — the reader does, and `cost-state` is the harness's own figure. A session with no `cost-state` line gets the usage sum at the list prices the reader carries, and a model it does not price leaves `cost_usd` empty rather than guessed.
- Don't write `outcome` or `analysis` from memory when the transcript is there. Memory is what the session already believed about itself.
- Don't look for session records under `SESSIONS_FOLDER`: since core 0.9.0 they are under `data/sessions/`; a workspace that still has some there runs `node node_modules/@dreamteamer/sessions/bin/sessions-migrate.mjs` (dry run first).
- Don't put a machine path in `transcript`. The reader writes a `${env:SESSIONS_FOLDER}` or `${userHome}` template; keep it that way.
- Don't treat a binding as a claim. It says who worked on a record; it holds nothing.
- Don't `dt session send` to change anything: the fork has no tools on purpose.
- Don't bind the save to `SessionEnd`: its default budget is 1.5 seconds and a refused write is silent. `Stop` fires every turn and has the time.

## Done when

Bound: each record you worked shows your session in its `dt next`, and `dt session end` printed `ended` when you stopped.

Saved: `sessions/<session id>` exists with `turns`, `tool_calls`, `cost_usd`, `models` and `transcript` set by the reader, `worker` and `outcome` set by you — and after an analysis, `analysis` and a `description` under 400 characters — and `dt get sessions/<id>` shows it.
