---
name: goals-interview
description: >-
  use once when a workspace is new to Work, or when its person asks to set up or redo their goals — /work:goals-interview,
  "interview me for my goals", "set up my goals by client", "prefill my CRM". Reads the sessions and meetings already
  in the workspace, asks about each client and what the person wants there, proposes one goal tree by client and the
  CRM records it implies, and writes only what they confirm.
---

# goals-interview

You run one short interview, then write a goal tree and, where the CRM modules are installed, the companies and
contacts it implies. Run the steps in order, once. This file is the whole procedure: you need nothing else.

## Rules that hold in every step

1. **Write only on a yes.** Nothing is written before step 4, and step 4 writes only what the person confirmed in
   step 3.
2. **Never invent.** A client, a person, a role or a goal comes from the person's own answer, or from a record you
   read and they confirmed. When you do not know, ask or leave it out.
3. **Stay inside this workspace.** Read with `npx dt` only. Do not open files, folders, mail, calendars or the web
   outside it unless the person asks you to.
4. **Ask in the question tool** when your harness has one (one question at a time, options first, your recommended
   option first). Without one, ask one short numbered question and wait.
5. **Commit nothing** unless the person asks; then commit by record id, `npx dt commit <collection>/<id> …`.

## Step 1 — Look (read only)

Run these and keep the output short in your head:

```bash
npx dt list collections
npx dt list goals
npx dt list sessions --sort -started | head -60
```

The CRM is installed when `companies` appears in `dt list collections`. When it does, also run:

```bash
npx dt list companies
npx dt list contacts
npx dt list meetings --sort -starts | head -60
```

(`engagements` too, when it appears.) From the sessions and meetings, note at most five **patterns**: a company or a
person that recurs, a kind of work that repeats, an outcome several records point at. Note each with the ids of the
records it came from. Do not write anything.

## Step 2 — Ask

Ask these, in this order. Offer what step 1 found as options, each marked "seen in your records".

1. "Which clients, or efforts, do you work on? Name each one." (Options: the companies and recurring names from step 1,
   plus "Other".)
2. For each client: "What do you want to be true for <client> in the next three months? One sentence, as an outcome."
3. For each client, only when the CRM is installed: "Who do you deal with at <client>? Name and role, or skip."
4. "What one outcome sums all of this up? It becomes the root goal." (Offer a draft built from their answers.)
5. "These patterns showed up in your sessions and meetings: <patterns>. Should any become a goal?" (Options: each
   pattern, "None".)

Write each goal name as an outcome, for example "Northwind renews for a second year", never as a task such as
"Call Northwind".

## Step 3 — Propose (write nothing)

Show the whole plan in one message:

```text
Root goal: <outcome>
  - <client 1 outcome>            parent: root
  - <client 2 outcome>            parent: root
  - <pattern goal, if chosen>     parent: root
CRM (only what is missing):
  - company: <client>             new | already there as companies/<id>
  - contact: <name>, <role>       at <client>
Patterns read: <pattern> — from <record ids>
```

Then ask: "Write this? Yes / Change something / No". On "Change", apply the change and show the plan again. On "No",
stop and write nothing.

## Step 4 — Write what was confirmed

Use the id each command prints for the next command. In this order:

```bash
npx dt add goals --name "<root outcome>" --description "<why, in their words>" --status active
npx dt add companies --name "<client>"                                   # only when new and the CRM is installed
npx dt add goals --name "<client outcome>" --description "<their sentence>" --status active \
  --parent_goal goals/<root id> --context companies/<company id>          # --context only when the company exists
npx dt add contacts --name "<person>" --role "<role>" --company companies/<company id> --status draft
```

A goal already in `dt list goals` with the same meaning is not added again: set its parent instead,
`npx dt set goals/<id> parent_goal=goals/<root id>`, and only on a yes. When a command fails, show its message, fix
only what it names, and run it once more; if it fails again, stop and say which record was not written.

## Step 5 — Report

Run `npx dt check` and end with:

- the ids written, one per line, grouped as goals, companies, contacts;
- what was left out and why (declined, already there, CRM not installed);
- the `dt check` result, quoted;
- one next step: open Goals › 3D or Goals › Graph to see the tree, and link tasks to these goals on each task's
  Goals field.
