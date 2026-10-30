---
name: managing-sessions
description: >-
  use when a coding-agent session should be accounted for — "save this session", "what did that session cost", "write up what we did", a `sessions` record for the sitting that just happened, or a Stop hook that keeps one current. The mechanics behind /session:save and /session:analyze: the metrics come from the transcript, the recap and the analysis from reading it.
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
```

The reader takes `--session <id>` for another session and `--transcript <path>` for a file that is not where the harness keeps it. Nothing here needs the network.

## Do this

**Save** (`/session:save`):

1. `node node_modules/@dreamteamer/core/bin/session-save.mjs --write` — adds `sessions/<session id>` or updates it, copies the transcript to `${env:FILES_FOLDER}/sessions/<yyyy>/<mm>/<id>.jsonl` when `FILES_FOLDER` resolves, and prints `added|updated sessions/<id>: N turns · M tool calls · $ USD`. Quote that line.
2. Set what the transcript cannot know, as `--set` pairs on the same call or a `dt set` after it: `worker=users/<me>` (or `agents/<id>` for an unattended run), `project=projects/<id>`, `repo=repos/<id>`, `tasks=tasks/<id>` for each task the session produced or closed.
3. Write `outcome` — the body — in the session's own words: what was asked, what landed (commits by subject, records by id, decisions by id), what is left. Short, and from what you actually did, not from the plan. `dt set sessions/<id> outcome="…"`.
4. Say where the record is and whether it is committed. Where `data/sessions/` is gitignored it never will be, and that is the point; where it is not, commit by id: `dt commit sessions/<id>`.

**Analyze** (`/session:analyze`):

1. Save first if no record exists. Read the transcript the record points at (`dt resolve sessions/<id> transcript`), not your memory of the session.
2. Write `analysis` as a reviewer would: the ask in one line; what was done, in order; where turns were spent — restated problems, reverted edits, a tool that failed and was retried, a question that reading a record would have answered; what the session cost against what it produced; what a next session should do differently. Name turn numbers and tool calls so a claim can be checked.
3. Write `description`: the session in one or two sentences, 400 characters at most — what a list row shows.
4. `dt set sessions/<id> analysis="…" description="…"`, then step 4 of save.

**A hook** keeps the metrics current without anyone remembering: bind `session-save.mjs --write --hook --quiet` to `Stop` in the workspace's harness settings (the README shows the block). The hook upserts metrics only; `outcome`, `analysis` and `description` are the session's and the reviewer's words, and only a person or a command writes them.

## Don't

- Don't compute the metrics yourself from the transcript — the reader does, and `cost-state` is the harness's own figure. A session with no `cost-state` line gets the usage sum at the list prices the reader carries, and a model it does not price leaves `cost_usd` empty rather than guessed.
- Don't write `outcome` or `analysis` from memory when the transcript is there. Memory is what the session already believed about itself.
- Don't commit `data/sessions/` into a shared repo by habit. Decide once per workspace — a `.gitignore` line keeps them local — and say which it is.
- Don't put a machine path in `transcript`. The reader writes a `${env:FILES_FOLDER}` or `${userHome}` template; keep it that way.
- Don't bind the save to `SessionEnd`: its default budget is 1.5 seconds and a refused write is silent. `Stop` fires every turn and has the time.

## Done when

`sessions/<session id>` exists with `turns`, `tool_calls`, `cost_usd`, `models` and `transcript` set by the reader, `worker` and `outcome` set by you — and after an analysis, `analysis` and a `description` under 400 characters — and `dt get sessions/<id>` shows it.
