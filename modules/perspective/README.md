# @dreamteamer/perspective

Reads a person's own past work — git history, coding-agent sessions, tickets, mail, documents — and
builds the operating model it actually runs on: what they do, decide and keep re-finding, and what the
workspace should keep for them. It asks before it concludes. What it FINDS lives in the
`perspective` namespace, apart from what anyone WROTE, each record pointing at the one it thinks it matches.

```bash
npm install @dreamteamer/perspective
npx dreamteamer compile
```

Start with `/run-retrospective`; the `running-retrospectives` skill carries the thirteen stages. Every
source is optional and a run says which it could not reach. Chain the record guard into
`npm run check` — add it to the `check` script:
`node node_modules/@dreamteamer/perspective/bin/check-records.mjs`.

## 0.4.0 — on engine 0.48.0: the engine writes `.env` (CR-dt-007)

Nothing to do but `dt update @dreamteamer/perspective` on dreamteamer 0.48.0 or later, then `dt compile`; nothing a
workspace's records do changes. `ASANA_PAT` is now an env action the engine writes into `.env`; the module carries no copy of the setup kit and no `apply`.

## 0.3.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/perspective` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: the `perspective` setup unit (`dt setup perspective`): its folders recorded in `.env`.
