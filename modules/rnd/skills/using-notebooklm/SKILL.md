---
name: using-notebooklm
description: use for any NotebookLM work in this workspace — creating notebooks, adding sources, asking questions, generating podcasts/video/slides/reports/quizzes, downloading artifacts, exporting the workspace into a notebook, applying a persona, restoring a notebook on another Google account from its record, capturing a live notebook's sources onto its record. load this BEFORE the vendor `notebooklm` skill, which owns the command syntax but not this workspace's rules.
---

# using notebooklm

**core principle:** the `notebooklm` CLI is a **dependency we don't own**. The vendor skill at
`~/.claude/skills/notebooklm/SKILL.md` (written by `notebooklm skill install`) is the authority on
every command, flag, option and JSON schema — read it for syntax. This file adds only what the vendor
can't know: this workspace's rules, and the vendor's silent traps.

## when to use

any NotebookLM task. **not for:** command syntax — that's the vendor skill, and copying its tables
in here is how they go stale.

**And not for a corpus you only need to READ.** NotebookLM is the EXTRA adapter here: it costs an
account, a login and a network call, and it is worth that when you need what only it can do — a
generated podcast, a video, a slide deck, a web research pass, or an answer from its own model. When
the job is "read this material and cite it", the `wikis` collection is a folder of markdown on disk
with none of those costs, and `working-with-wikis` is the skill. `npx dt-wiki pull
<notebook-record>` mirrors a live notebook's sources into one, so the two are a command apart.

## the lib, and how it is set up

`notebooklm-py` is a Python CLI. Install it as a tool, not into a project:

```bash
uv tool install notebooklm-py            # or: pip install "notebooklm-py[browser]"
notebooklm skill install                 # writes the vendor skill for Claude Code and Agent Skills
notebooklm --version                     # want >= 0.7.3 — the release these rules hold for
```

Auth is machine state under **`~/.notebooklm/profiles/<profile>/storage_state.json`**. It is never committed and never goes in `.env`. A second Google
account is a second home: `NOTEBOOKLM_HOME=~/.notebooklm-work notebooklm login`. Behind on version?
`uv tool upgrade notebooklm-py && notebooklm skill install` — the second command regenerates the
vendor skill, which is why we never edit it.

`npx dt-setup doctor` reports all of this under **notebooklm**, offline.

## preflight

```bash
notebooklm auth check --test   # --test is NOT optional, see below
```

**Always `--test`.** Bare `auth check` only inspects cookie *shape* and reports a valid session
against one Google has already expired — the next write then fails with
`UNEXPECTED_ERROR / Authentication expired`. `--test` actually fetches a token and catches it.

Expired means `notebooklm login`, which opens a browser: **a person must run it.** An agent in
a non-interactive session cannot, and no flag works around it — stop and ask.

## the rules

**1. downloads go to `.cache/notebooklm/`, never the working directory.** The vendor skill's examples
are relative (`notebooklm download audio ./podcast.mp3`) and following them literally stages a 40 MB
file for commit. Always:

```bash
notebooklm download audio .cache/notebooklm/<notebook>/overview.mp3 -a <artifact_id> -n <notebook_id>
```

`.cache/` is gitignored (`dreamteamer init` writes the line; `npx dt-setup setup` adds it to an
older workspace) — the materialised-remote-artifact convention: a copy of something whose home is
elsewhere, rebuilt on demand. Prose artifacts (report, mind-map, data-table, quiz as markdown) are
text and may land in `data/` as records — but only where a real collection fits, never invented on
the spot.

**2. pass `-n <notebook_id>` explicitly. Never `notebooklm use`.** `use` writes single-slot
`~/.notebooklm/context.json`; a workspace that spawns subagents would have them overwrite each
other's context. Same reason: prefer full UUIDs over partial ids in anything scripted.

**3. every notebook gets a record, in `notebooks`.** Rule 2 means the id has to live somewhere
greppable, and `notebooklm list | grep <title>` is a network call that breaks on duplicate titles.

```bash
notebooklm create "<title>" --json      # → {"notebook": {"id": "<uuid>", …}}
npx dreamteamer add notebooks --name "<title>" --notebook_id "<uuid>" \
  --description "<what it is for>" --account "dana.o@northwind.example" \
  [--company companies/<id>] [--tags purpose:<…>]
```

Write it the moment the notebook exists, not later. **The record is the SPEC the notebook can be
rebuilt from, not just its handle** — so once it exists, capture what it holds:

```bash
npx dt-notebook capture <id>          # writes `sources` from the live list, names what it cannot recover
```

Four things about the shape: **`account`** says which Google login opens it — not derivable from
anything, and a notebook is invisible from the wrong one; **`sources`** is the ordered restore list
(`kind` · `ref` · `title` · `source_id`), where a `file` is a `${env:FILES_FOLDER}/…` template and a
`text` source carries its content inline because the live list cannot recover it; **`chat`** is the
one `configure` call — `persona` (or `persona_file`) OR `mode`, never both, plus `response_length`;
and **`status: throwaway`** is a real value, for smoke tests and spikes nobody maintains. The body is
what it is for and what it answers badly — the source list is `sources`, where `restore` reads it.

**`dt notebooklm --create "<title>"` makes a notebook too, and writes NO record.** It renders the
workspace into a notebook — one source per collection, sensitivity honoured from the schema — and
keeps the id in `.cache/dreamteamer/notebooklm/notebook.json`. Read the id out of `notebook.json` and
add the record the same way. The `exporting-to-notebooklm` skill carries the export's judgment: what
travels, the plan budget, syncing.

**4. `notebooklm configure` REPLACES the whole configuration, and `--mode` DISCARDS the persona.**
Three things, all silent at exit 0:

- **`--mode` and `--persona` are mutually exclusive and nothing says so.** `configure --persona … --response-length longer --mode default` answers `{mode: "default", configured: true}` — persona gone, response length gone, no error. Drop `--mode` and the identical call returns `{goal: "custom", persona: "…", response_length: "longer"}`.
- **Every call replaces the whole config.** `configure --response-length longer` alone wipes the persona. Send every setting you want in ONE call.
- **There is no read-only inspection.** A bare `configure`, the obvious way to check the settings, CLEARS them.

So the persona lives in a file under git, never only in the notebook. That file is **`NOTEBOOKLM.md`**,
written by `npx dreamteamer compile` when `package.json` declares this module's `notebooklm` harness
(`dreamteamer.harnesses`): a generated block that cannot go stale, and an optional hand-written
`## custom instructions — this workspace's additions` section above it for what a descriptor cannot
know. Apply it with **one** call:

```bash
npx dt-notebook persona <notebook-id>          # --print to see it without sending
```

It FAILS if the notebook does not echo back the same length. Never `configure` by hand.

**5. an answer is real only with TEXT and at least one REFERENCE.** `notebooklm ask` has a third
outcome besides success and failure: **exit 0 with `{"answer": "\n", "references": []}`**, reached by
scoping a broad question with `-s` — and it takes several times longer than a good answer, so a slow
call is a warning sign rather than a sign of effort. Never trust `$?` alone; check both fields. Ask
one narrow, single-fact question per call, and do NOT reach for `-s` to escape
`RPCResponseTooLargeError` — that is what converts a loud failure into a silent one. `ask` also
carries conversation state across invocations unasked, so a prior failure can contaminate the next
answer; `--new --yes` starts clean.

**6. a notebook is rebuilt from its record, never by hand.** A login is lost, a client wants the
corpus under their own Google account, a spike notebook is wanted again: the record already says what
to add and how the chat is configured, so the verb plays it —

```bash
npx dt-notebook restore <id> --dry-run                  # the plan, one line per call; touches no network
npx dt-notebook restore <id> --account <label>          # a copy on another login (auth must BE that login)
npx dt-notebook restore <id> --replace                  # re-create on the same login
```

It creates, adds every source in order (`add` → `wait` → `rename`, or `dt notebooklm` for an
`export` entry), sends ONE `configure`, and writes `notebook_id`, `account` and
each `source_id` back onto the record. It refuses — naming the field — rather than restore a record
that is not restorable as written, and a record with a live uuid needs `--account` or `--replace` to
say which you mean. The previous uuid is git history, never a second record. `dt next notebooks/<id>`
answers whether a record is waiting to be restored (no uuid) or to be captured (uuid, no sources).

## generation, briefly

Long jobs (audio 10-20 min, video 15-45 min) are fire-and-forget: start with `--json`, keep the
artifact id, and either check `artifact list` later or hand `artifact wait` to a subagent. Don't
poll in the main conversation. Audio, video, quiz, flashcards, infographic and slides rate-limit
on Google's side — that's expected, not a bug; the vendor skill's error table covers it.

## common mistakes

| mistake | why it bites |
|---|---|
| `notebooklm download audio ./out.mp3` | stages a binary for commit — use `.cache/notebooklm/` |
| `notebooklm use <id>` then a subagent | shared context file; the subagent retargets your notebook |
| creating a notebook and not recording it | the uuid survives only in scrollback — `dt notebooklm --create` included |
| a record with a uuid and no `sources` | a handle, not a spec — lose the login and the corpus is gone; `npx dt-notebook capture <id>` |
| rebuilding a notebook by hand from memory | the record is the restore list; `npx dt-notebook restore <id>` plays it and writes the ids back |
| copying the vendor skill's command tables into this file | they drift on every upgrade |
| `pip install git+…notebooklm-py` (main branch) | unreleased; use PyPI or a release tag |
| reading `$?` after `ask` and moving on | exit 0 with an empty answer is a real outcome — check text AND references |
| `configure --mode default` alongside a persona | the persona and the response length are discarded, exit 0, no error |
| a bare `configure` to see current settings | it CLEARS them — there is no read-only inspection |
| finding a source by its title | `source add --title` keeps the FILE NAME instead on most file uploads — keep the id `add` returns, and `source rename <id> <title>` afterwards |
| `harnesses: ["notebooklm"]` alone in package.json | the engine's default when the list is unset is `["claude-code"]`; naming only the new one switches the coding-agent harness off — list both |
