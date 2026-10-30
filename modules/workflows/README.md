# @dreamteamer/workflows

A workflow is a chain of commands written down: each step names a command, the records it walks and
whether a person decides before it runs. `/workflow:run <id>` walks one. It records nothing about the
run — the records the commands touch are the progress, so running a workflow again is resuming it.

```bash
npm install @dreamteamer/workflows
npx dreamteamer compile
npx dt-workflows install customer-factory
```

`@dreamteamer/core` carries this module, so a workspace on core already has it — install core OR this
module, never both.

## what a workflow is

A `workflows` record, at `data/workflows/<id>.workflow.md`:

```yaml
name: customer factory
status: active                      # draft · active · retired
steps:
  - name: summarize the client calls
    command: commands/summarize-meeting
    collection: collections/meetings
    where: '{"starts":{"_gte":"$from","_lte":"$now"},"company":{"_nempty":true},"summary":{"_empty":true}}'
  - name: suggested engagements     # no command: the set is shown to a person, who acts on it
    collection: collections/meetings
    where: '{"starts":{"_gte":"$from","_lte":"$now"},"company":{"engagements":{"_empty":true}}}'
    stop: for each company here, a new lead or nothing
```

and a body with one `## <n>. <name>` section per step, saying why it is there. `command` and
`collection` are references, so `dt check` refuses a workflow naming a command or a collection the
workspace does not have; a step with no command must carry a `stop`. `where` is one filter object
exactly as `dt list <collection> --where` takes it; `$today` and `$now` are the engine's tokens, and
`$from` and `$to` are the run's range, which the runner fills in before listing (seven days back to
seven days ahead unless the run names one). There is no run record, no trigger and no cursor: what a
step has done is whatever its command wrote on its records, and the command's binding says what is
left (`dt next`).

## running one

`/workflow:run customer-factory [YYYY-MM-DD..YYYY-MM-DD] [--from-step N] [--dry-run]` loads the
`running-workflows` skill and walks the steps in order. A collection-bound command runs once. A record
step lists its set (`dt list <collection> --where …`), asks `dt next <collection> --ids …` which of
those its command is available for, and runs the invocation `dt next` prints. At a `stop` the runner
shows the set and waits for the person. The report is one line per step: set, eligible, run, skipped,
and the stop holding the run.

## shipped workflows

An npm module cannot keep records — `node_modules/` is never committed — and a workflow is the
workspace's own to edit. So a module ships its workflows at `data/workflows/<id>.workflow.md` inside
its package, a folder compile does not read, and `dt-workflows` copies one in:

```bash
npx dt-workflows list                      # every shipped workflow: missing · installed · edited
npx dt-workflows install customer-factory  # refuses if it names a command or collection not compiled here
npx dt-workflows install --all --dry-run
```

`install` never overwrites the workspace's copy unless `--force` is given. Commit what it writes like
any record: `dt commit workflows/<id>`.

- `customer-factory` (this module) — from the week's calls to its leads: calendar, recordings,
  transcripts, summaries of client calls, contacts stamped and new people enriched, selling calls
  critiqued, engagements brought level, companies met with no engagement offered as **suggested
  engagements**, and the coming client calls prepped. Every command it names is in core.
- `software-factory` ships with `@dreamteamer/rnd`, whose commands it mostly runs: the same meeting
  intake, then references, change requests, design, review, prototype, plan, build, test and deploy.
