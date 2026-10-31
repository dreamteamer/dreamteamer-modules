---
name: managing-sessions
description: >-
  use when a coding-agent session should be accounted for — "save this session", "what did that session cost", "write up what we did", a `sessions` record for the sitting that just happened, or a Stop hook that keeps one current; and when work STARTS on a record that should be claimed first — `dt session start`, `dt sessions open`, `dt session end`, a `session-bindings` file, "in session by" in `dt next`, two agents on one record. The mechanics behind /session:save and /session:analyze: the metrics come from the transcript, the recap and the analysis from reading it.
---

# managing-sessions

## What you are doing

You turn one sitting of agent work into a `sessions` record, in two steps that a person can run apart. **Save** reads the transcript the harness keeps and upserts the record's metrics — turns, tool calls, tokens in and out, cache read and written, cost at list price, wall and API minutes, models, lines added and removed — plus a pointer to a kept copy of the transcript and a recap in the session's own words. **Analyze** reads the transcript as a reviewer and writes `analysis` and `description` onto the same record. The record's id is the harness's session id, so a save is idempotent and a hook can run it every turn.

## Before you start

```bash
echo $CLAUDE_CODE_SESSION_ID                                  # the session you are in — every Bash and hook subprocess has it
node node_modules/@dreamteamer/core/bin/session-save.mjs --json   # the fields, read from the transcript, written nowhere
dt get sessions/$CLAUDE_CODE_SESSION_ID                       # whether a record exists already (a hook may have written it)
dt resolve '${env:FILES_FOLDER}'                              # where the transcript copy will go; unset, the record points at the harness's own file
dt status                                                     # the storage: block names the folder sessions records live in (${env:SESSIONS_FOLDER}), or why it cannot render
```

Session records live in `${env:SESSIONS_FOLDER}` — a per-machine folder outside the repo, never committed. With the var unset, `dt add sessions` and `dt get sessions/<id>` refuse, naming it: set `SESSIONS_FOLDER` in the workspace's `.env`, declare it in the workspace's `dreamteamer.vars` beside `FILES_FOLDER`, and `dt compile` before saving.

The reader takes `--session <id>` for another session and `--transcript <path>` for a file that is not where the harness keeps it. Nothing here needs the network.

## Do this

**Save** (`/session:save`):

1. `node node_modules/@dreamteamer/core/bin/session-save.mjs --write` — adds `sessions/<session id>` or updates it, copies the transcript to `${env:FILES_FOLDER}/sessions/<yyyy>/<mm>/<id>.jsonl` when `FILES_FOLDER` resolves, and prints `added|updated sessions/<id>: N turns · M tool calls · $ USD`. Quote that line.
2. Set what the transcript cannot know, as `--set` pairs on the same call or a `dt set` after it: `worker=users/<me>` (or `agents/<id>` for an unattended run), `project=projects/<id>`, `repo=repos/<id>`, `tasks=tasks/<id>` for each task the session produced or closed.
3. Write `outcome` — the body — in the session's own words: what was asked, what landed (commits by subject, records by id, decisions by id), what is left. Short, and from what you actually did, not from the plan. `dt set sessions/<id> outcome="…"`.
4. Say where the record is: `<SESSIONS_FOLDER>/<yyyy>/<mm>/<id>.session.md`, on this machine only. It is never committed — `dt commit sessions/<id>` reports the folder as outside every git repo here, and that is the point.

**Analyze** (`/session:analyze`):

1. Save first if no record exists. Read the transcript the record points at (`dt resolve sessions/<id> transcript`), not your memory of the session.
2. Write `analysis` as a reviewer would: the ask in one line; what was done, in order; where turns were spent — restated problems, reverted edits, a tool that failed and was retried, a question that reading a record would have answered; what the session cost against what it produced; what a next session should do differently. Name turn numbers and tool calls so a claim can be checked.
3. Write `description`: the session in one or two sentences, 400 characters at most — what a list row shows.
4. `dt set sessions/<id> analysis="…" description="…"`, then step 4 of save.

**A hook** keeps the metrics current without anyone remembering: bind `session-save.mjs --write --hook --quiet` to `Stop` in the workspace's harness settings (the README shows the block). The hook upserts metrics only; `outcome`, `analysis` and `description` are the session's and the reviewer's words, and only a person or a command writes them.

**Live** — a session that STARTS on a record and claims it (`dt session`, core's extension):

1. Before working a record a `session-bindings` binds, `dt next <collection>/<id>`. A line "in session by <worker> since <time> (sessions/<id>)" means another session holds it: pick another (`dt sessions open` lists what is ready and free), or work beside it with `--join` when the person or the plan says so.
2. Claim it: `dt session start <collection>/<id> [--agent <id>]`. It writes a `running` sessions record from the binding — `records`, `binding`, `worker`, `harness`, `host`, `heartbeat`, and `session_id` from `$CLAUDE_CODE_SESSION_ID` — prints its id and the command to start with. Quote the `✔ sessions/<id>` line; keep the id. A refusal names the holder and exits 1: do not work the record.
3. Stay alive: the `Stop` hook from `dt install --print-adapters` runs `dt session heartbeat --hook` after every turn, keyed by your harness session id. Without it, `dt session heartbeat <id>` at least every `stale_after` minutes (the binding's, 30 by default). A session silent longer is `abandoned` by the next `dt session`/`dt sessions` verb, its claim lapses, and a heartbeat on it refuses — start again.
4. End it when the work stops, done or not: `dt session end <id> --outcome "<what landed, what is left>"`. A subagent ends its own session before it hands back: its Stop hook is its parent's, so a forgotten session stays fresh until the parent stops. When `dt next` says "stage done — … end the session", the record's fields have moved past your binding: end it, and the next stage's agent can start beside it meanwhile (`dt sessions open` lists the record as "held by a finished stage").
5. Only your own session: `end` and `heartbeat <id>` act on a session whose harness session id is yours (`$CLAUDE_CODE_SESSION_ID`, or `--session-id`), or, where it stored none, whose worker is your `--agent`. Another's is refused, naming its holder. A person who must free a stuck claim runs `dt session end <id> --force`: it prints whose claim it freed, tags the session `ended-by:<who>`, and the holder's Stop hook says so once. Never `--force` as an agent.
6. Who is working on what: `dt list sessions --filter status=running`.

A binding, in a module's `session-bindings/change-requests.session-binding.yaml`:

```yaml
collection: collections/rnd/change-requests
available_when: { status: accepted }
done_when: { verified_on: { _nnull: true } }
harness: claude-code
agent: agents/rnd-agent
command: commands/rnd/design
concurrency: one        # one: a second start is refused unless --join · many
stale_after: 30         # minutes without a heartbeat
```

## Don't

- Don't compute the metrics yourself from the transcript — the reader does, and `cost-state` is the harness's own figure. A session with no `cost-state` line gets the usage sum at the list prices the reader carries, and a model it does not price leaves `cost_usd` empty rather than guessed.
- Don't write `outcome` or `analysis` from memory when the transcript is there. Memory is what the session already believed about itself.
- Don't look for session records under `data/`, and don't try to commit them: they live under `${env:SESSIONS_FOLDER}`, outside every repo, and a refusal naming that var means the folder is not set on this machine.
- Don't put a machine path in `transcript`. The reader writes a `${env:FILES_FOLDER}` or `${userHome}` template; keep it that way.
- Don't work a record `dt next` says is in session, and don't `--join` on your own judgment alone — the holder may be mid-write.
- Don't leave a live session running when you stop: `dt session end`, or it reads as held until it goes stale.
- Don't end or heartbeat another session's id, and don't reach for `--force` — that is a person's, for a claim whose holder is gone.
- Don't bind the save to `SessionEnd`: its default budget is 1.5 seconds and a refused write is silent. `Stop` fires every turn and has the time.

## Done when

Live: the record you worked showed your session in `dt next` while you worked, and `dt session end` printed `ended` when you stopped.

Saved: `sessions/<session id>` exists with `turns`, `tool_calls`, `cost_usd`, `models` and `transcript` set by the reader, `worker` and `outcome` set by you — and after an analysis, `analysis` and a `description` under 400 characters — and `dt get sessions/<id>` shows it.
