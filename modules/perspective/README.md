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
`npm run check` (`npx dt-setup setup` offers to):
`node node_modules/@dreamteamer/perspective/bin/check-records.mjs`.

