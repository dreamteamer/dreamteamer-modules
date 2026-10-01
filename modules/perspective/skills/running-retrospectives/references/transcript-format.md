<!-- Ported from an earlier conversation analyzer (decision 310). The layout note below was updated for this module; everything else is as established there by reading files on disk. -->
# the JSONL format, and the traps in it

Everything here was established by reading the files on this machine, not from documentation. It is
undocumented and versioned only by the `version` field, so **re-check before trusting any of it** if
a scan starts returning nonsense.

## on-disk layout

```
~/.claude/                                       account `default`
~/.claude-<name>/                                account `<name>`  (cswap targets)
    projects/
        <cwd with '/' → '-'>/                    a HINT at the cwd, not the truth
            <session-uuid>.jsonl                 ← A CONVERSATION
            <session-uuid>/subagents/*.jsonl     ← its subagent runs, recursively nested
            agent-<hex>.jsonl                    ← older flat layout, same thing
            memory/                              not transcripts
```

**Only `<session-uuid>.jsonl` is a conversation.** Everything named `agent-*` is subagent traffic:
no operator turns, no independent existence. Folding those into the parent is what makes the count
876 rather than 5,155.

**The account is knowable only from the tree.** Nothing inside a record says which account was
active. The operator switches accounts mid-conversation, so the *same project folder* appears under
several account dirs with different sessions in each.

## line types

| `type` | what it is |
|---|---|
| `user` | the operator **or** a tool result **or** harness noise — see below |
| `assistant` | one API message, possibly one of several lines sharing a `message.id` |
| `summary` | a `/compact` checkpoint, carrying `summary` + `leafUuid` |
| `queue-operation`, `last-prompt`, `attachment` | harness bookkeeping, skip |

Common line fields: `cwd`, `gitBranch`, `version`, `sessionId`, `uuid`, `parentUuid`, `timestamp`,
`isSidechain`, `userType`. Sometimes: `entrypoint` (`cli` / `claude-vscode`), `aiTitle` (a generated
title — the best `title` source available), `slug`, `permissionMode`, `toolUseResult`.

## trap 1 — an assistant turn spans several lines

Thinking, text and each `tool_use` block can arrive as **separate JSONL records sharing one
`message.id`**. Counting lines overcounts assistant turns by 2–3×. Fold on `message.id`
(`assistantMessageId()`); `usage` must be summed once per id or tokens triple.

## trap 2 — most `user` lines are not the user

A line with `type: "user"` is the operator only if none of these apply:

- `message.content` contains a `tool_result` block → it is a tool result
- the text is entirely `<system-reminder>` / `<local-command-stdout>` / `<command-message>` /
  hook output → harness noise
- `isMeta: true` → harness noise

`classifyUserLine()` is the only correct way to make this call. Getting it wrong makes every ratio
in the module lie, and it lies *plausibly*, which is worse.

A `<command-name>` envelope IS a real turn — the operator typed `/something`.

## trap 3 — thinking text is not on disk

Recent models persist:

```json
{"type": "thinking", "thinking": "", "signature": "CAISkxAK…"}
```

The block is there; the reasoning is not. So:

- count presence with `countBlocks(content, 'thinking')`, never by testing the string
- `--thinking` on the exporter will produce almost nothing for recent sessions
- **never conclude from a transcript that the agent did not reason.** Say the text is unavailable.

## trap 4 — `cwd` is where it ran, not what it was about

An operator regularly opens a session in a parent vault folder and works on a child or sibling repo, with
or without `cd`. A session can also change `cwd` mid-flight (hence `cwds`). `repo` records where it
ran; `subject_repos` infers what it touched. Expect them to differ.

## trap 5 — size

The largest single transcript here is **156 MB**. Never `JSON.parse` a whole file, never build an
array of all lines, never `Read` one into a context window. Everything in `lib/` streams via
`eachLine()`; keep it that way.

## tool results

They arrive as `user` lines whose content holds `tool_result` blocks:

```json
{"type": "tool_result", "tool_use_id": "toolu_…", "is_error": true, "content": "…"}
```

`is_error` is the error signal. A **permission denial** is a specific error body — "the user doesn't
want to proceed with this tool use" — matched by `DENIAL_RE` and counted separately, because a
refusal is an operator act and an error is not.

An interrupt appears as literal text: `[Request interrupted by user…`.
