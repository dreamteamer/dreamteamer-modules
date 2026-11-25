// WORK'S EVERYDAY SETUP: the sub-navigation each Work collection draws, the fields those views name, the open
// decision, the nav fragment and the goals interview — measured in a fresh workspace on the release engine, with Work
// installed from its packed tarball and its declared closure, the way npm delivers it. Each assertion here fails on
// Work 0.2.0, which shipped none of these.
import { test, describe, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import yaml from "js-yaml"
import {
  MODULES,
  cleanup,
  closure,
  installPacked,
  moduleIds,
  packedFiles,
  packedInto,
  pkgOf,
  releaseEngineFor,
  run,
  virginWorkspace,
} from "../../../tests/helpers/workspace.ts"

after(cleanup)
const ENGINE = releaseEngineFor("work")
const dt = (root: string, ...args: string[]) => run(root, args, {}, ENGINE)
const ok = r => {
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}`)
  return r
}
const refused = (r, why: RegExp) => {
  assert.notEqual(r.status, 0, `written, but should have been refused:\n${r.stdout}`)
  assert.match(r.stdout + r.stderr, why)
  assert.match(r.stdout + r.stderr, /nothing was written/)
}

/** The views a workspace compiled, by id, read as the host reads them: the merged display when overlaid. */
const views = (root: string) =>
  Object.fromEntries(
    fs
      .readdirSync(path.join(root, ".dreamteamer", "ui-views"))
      .filter(f => f.endsWith(".ui-view.yaml"))
      .map(f => {
        const v: any = yaml.load(fs.readFileSync(path.join(root, ".dreamteamer", "ui-views", f), "utf8"))
        return [f.replace(/\.ui-view\.yaml$/, ""), { ...v, display: v.compiled?.display ?? v.display }]
      })
  )

/** A collection's sub-navigation: every view of it with a sidebar title, as [title, order], in the host's order. */
function subnav(all, collection: string) {
  const rows = Object.values(all)
    .filter((v: any) => v.collection === `collections/${collection}` && v.display?.nav?.title)
    .map((v: any) =>
      v.display.nav.order === undefined ? [v.display.nav.title] : [v.display.nav.title, v.display.nav.order]
    )
  const key = r => (r.length > 1 ? r[1] : Number.POSITIVE_INFINITY)
  return rows.sort((a, b) => key(a) - key(b) || String(a[0]).localeCompare(String(b[0])))
}

// The setup a team runs every day, as the sidebar draws it: [title, order], an untitled order last. Statuses first,
// then the groupings, then the lists and drawings; the views a single workspace keeps for its own domains, clients or
// tooling are not part of it.
const SUBNAV = {
  goals: [["Gantt", 2], ["3D"], ["By project"], ["Graph"]],
  tasks: [
    ["All Tasks", 0],
    ["Suggested", 10],
    ["Queued", 15],
    ["To Do", 20],
    ["Doing", 30],
    ["Blocked", 40],
    ["Done", 50],
    ["Closed", 60],
    ["By goal", 70],
    ["By parent", 80],
    ["By project", 90],
    ["List", 100],
    ["Board", 110],
    ["Active", 120],
    ["Graph", 130],
  ],
  sessions: [
    ["By goal", 0],
    ["By status", 0],
    ["Needs a person", 1],
    ["Blocked", 2],
    ["Active", 3],
    ["Planned", 4],
    ["Verified done", 5],
    ["No status", 6],
    ["By project"],
    ["Recaps"],
    ["Sessions Graph"],
  ],
  decisions: [["Open decisions", 1], ["Parked decisions", 2], ["By project"], ["Decision Log"]],
  strategies: [["Catalog"], ["Conversational"], ["Operational"], ["Unblocking"]],
}

// Every collection the shipped files may name: Work's own, the closure's, and the CRM collections the interview
// reads only when they are installed. Anything else is another workspace's collection and must not ship.
const KNOWN = new Set([
  "goals",
  "strategies",
  "activities",
  "action-patterns",
  "conversation-patterns",
  "tasks",
  "sessions",
  "decisions",
  "projects",
  "deliverables",
  "risks",
  "users",
  "teams",
  "agents",
  "companies",
  "contacts",
  "meetings",
  "engagements",
  "collections",
])

describe("Work 0.3.0 installed from its tarball into a fresh workspace", () => {
  let root: string
  before(() => {
    root = virginWorkspace(ENGINE)
    installPacked(root, [...closure("work")])
    ok(dt(root, "compile"))
    const checked = ok(dt(root, "check"))
    assert.match(checked.stdout + checked.stderr, /0 violations/)
  })

  test("every view the package ships is compiled into the workspace", () => {
    const shipped = fs
      .readdirSync(path.join(MODULES, "work", "ui-views"))
      .map(f => f.replace(/\.ui-view\.yaml$/, ""))
      .sort()
    const compiled = new Set(Object.keys(views(root)))
    assert.deepEqual(
      shipped.filter(id => !compiled.has(id)),
      []
    )
  })

  for (const [collection, want] of Object.entries(SUBNAV))
    test(`${collection} draws the everyday sub-navigation, in order`, () => {
      assert.deepEqual(subnav(views(root), collection), want)
    })

  test("the overlays reach the Tasks package's own views", () => {
    const all = views(root)
    assert.deepEqual(all["tasks-board"].filter.status._in, ["suggested", "queued", "todo", "doing", "blocked"])
    assert.ok(all["tasks-list"].display.list.columns.includes("task_code"))
    assert.equal(all.inbox.display.nav, undefined, "Inbox keeps its route and leaves the sidebar")
    assert.equal(all["goals-3d-tree"].display.list.layout, "tree3d")
    assert.equal(all["goals-3d-tree"].display.list.options.root, undefined, "no root goal: every top goal is a root")
  })

  test("a task serves two goals; each goal lists it, and a decision is listed on its goal", () => {
    ok(dt(root, "add", "goals", "--name", "Northwind renews", "--description", "A second year"))
    ok(dt(root, "add", "goals", "--name", "Harbor Mutual pilot ships", "--description", "The pilot"))
    ok(
      dt(
        root,
        "add",
        "tasks",
        "--name",
        "Draft the renewal deck",
        "--task_code",
        "TASK-001",
        "--goals",
        "goals/northwind-renews",
        "--goals",
        "goals/harbor-mutual-pilot-ships"
      )
    )
    ok(
      dt(
        root,
        "add",
        "decisions",
        "--name",
        "Renewal first",
        "--decision",
        "The renewal goes first",
        "--decided_by",
        "agent",
        "--agent",
        "agents/claude-code",
        "--decided_on",
        "2026-01-15T10:00:00+02:00",
        "--alternatives",
        "The pilot first",
        "--rationale",
        "It is due sooner",
        "--reversibility",
        "easy",
        "--goals",
        "goals/northwind-renews"
      )
    )
    for (const goal of ["northwind-renews", "harbor-mutual-pilot-ships"]) {
      const got: any = yaml.load(ok(dt(root, "get", `goals/${goal}`)).stdout)
      assert.equal(got.tasks.length, 1, goal)
      assert.match(got.tasks[0], /^tasks\/.*draft-the-renewal-deck$/)
    }
    const goal: any = yaml.load(ok(dt(root, "get", "goals/northwind-renews")).stdout)
    assert.deepEqual(goal.decisions, ["decisions/2026-01-15--renewal-first"])
    refused(dt(root, "add", "tasks", "--name", "Badly coded", "--task_code", "T-1"), /task_code/)
  })

  test("an ask is a queued task with the asker's words, who asked, its sessions and its parent", () => {
    ok(dt(root, "add", "users", "--name", "Dana Oren"))
    ok(dt(root, "add", "sessions", "--name", "Planning", "--started", "2026-01-15T09:00:00Z"))
    const sessions = ok(dt(root, "list", "sessions", "--json")).stdout
    const session = JSON.parse(sessions)[0].id
    ok(dt(root, "add", "tasks", "--name", "Plan the quarter", "--task_code", "TASK-002"))
    ok(
      dt(
        root,
        "add",
        "tasks",
        "--name",
        "List the renewals",
        "--task_code",
        "TASK-003",
        "--status",
        "queued",
        "--raw_input",
        "can you list the renewals due this quarter",
        "--asked_by",
        "users/dana-oren",
        "--ask_sessions",
        `sessions/${session}`,
        "--parent_task",
        `tasks/${JSON.parse(ok(dt(root, "list", "tasks", "--json")).stdout).find(t => /plan-the-quarter$/.test(t.id)).id}`
      )
    )
    assert.match(ok(dt(root, "check")).stdout + "", /0 violations/)
  })

  test("an open decision holds a question and options and refuses a decider until it is decided", () => {
    ok(
      dt(
        root,
        "add",
        "decisions",
        "--name",
        "Which pilot first",
        "--status",
        "open",
        "--question",
        "Which pilot goes first?",
        "--options",
        "Northwind",
        "--options",
        "Harbor Mutual",
        "--severity",
        "high"
      )
    )
    for (const extra of [
      ["--decision", "Northwind"],
      ["--decided_by", "agent"],
      ["--decided_on", "2026-01-15T10:00:00+02:00"],
    ])
      refused(
        dt(
          root,
          "add",
          "decisions",
          "--name",
          "Which pilot next",
          "--status",
          "open",
          "--question",
          "Which?",
          ...extra
        ),
        /schema/
      )
    refused(dt(root, "add", "decisions", "--name", "No call made", "--decision", "Something"), /schema/)
  })

  test("a session says whether it needs a person, who takes the next step and what it is", () => {
    ok(
      dt(
        root,
        "add",
        "sessions",
        "--name",
        "Waiting for an approval",
        "--started",
        "2026-01-15T11:00:00Z",
        "--needs_operator",
        "true",
        "--next_step_owner",
        "operator",
        "--suggested_next_step",
        "Approve the renewal deck"
      )
    )
    refused(
      dt(
        root,
        "add",
        "sessions",
        "--name",
        "Unknown owner",
        "--started",
        "2026-01-15T12:00:00Z",
        "--next_step_owner",
        "boss"
      ),
      /next_step_owner/
    )
  })

  test("the goals interview compiles as /work:goals-interview and as the goals-interview skill", () => {
    const command = path.join(root, ".dreamteamer", "commands", "work", "goals-interview.command.md")
    assert.ok(fs.existsSync(command), "no compiled command work/goals-interview")
    assert.match(fs.readFileSync(command, "utf8"), /^name: work\/goals-interview$/m)
    assert.match(fs.readFileSync(command, "utf8"), /`goals-interview` skill/)
    assert.ok(fs.existsSync(path.join(root, ".dreamteamer", "skills", "goals-interview", "SKILL.md")))
    assert.ok(fs.existsSync(path.join(root, ".claude", "skills", "goals-interview", "SKILL.md")))
  })
})

describe("the goals interview is one self-contained prompt that writes only on a yes", () => {
  const skill = fs.readFileSync(path.join(MODULES, "work", "skills", "goals-interview", "SKILL.md"), "utf8")
  const body = skill.replace(/^---[\s\S]*?\n---\n/, "")

  test("it asks before it writes, writes nothing unconfirmed and invents no one", () => {
    assert.match(body, /Write only on a yes/)
    assert.match(body, /Never invent/)
    assert.match(body, /Stay inside this workspace/)
    assert.match(body, /Commit nothing/)
    const order = [
      "## Step 1 — Look",
      "## Step 2 — Ask",
      "## Step 3 — Propose",
      "## Step 4 — Write",
      "## Step 5 — Report",
    ]
    const at = order.map(h => body.indexOf(h))
    assert.ok(
      at.every(i => i >= 0),
      `missing a step: ${order.filter((_, i) => at[i] < 0)}`
    )
    assert.deepEqual(
      [...at].sort((a, b) => a - b),
      at,
      "the steps are out of order"
    )
    const writes = [...body.matchAll(/npx dt (add|set|commit)\b/g)].map(m => m.index)
    assert.ok(
      writes.every(i => i > at[3] || i < body.indexOf("## Step 1")),
      "a write appears before Step 4"
    )
  })

  test("it reads nothing outside the workspace and loads no other skill", () => {
    assert.doesNotMatch(body, /load the `/, "a light model gets one prompt: it must not depend on another skill")
    assert.doesNotMatch(body, /https?:\/\//)
    assert.doesNotMatch(body, /~\/|\/Users\/|\$HOME|\.env\b/)
  })

  test("it is short enough for a light model in one pass", () => {
    assert.ok(body.split("\n").length <= 140, `${body.split("\n").length} lines`)
    assert.ok(Buffer.byteLength(body) <= 8000, `${Buffer.byteLength(body)} bytes`)
  })
})

describe("what the tarball ships", () => {
  const files = packedFiles("work")
  const read = f => fs.readFileSync(path.join(MODULES, "work", f), "utf8")
  const text = files.filter(f => /\.(md|ya?ml|json)$/.test(f))

  test("the interview, its command, every view and the nav fragment ship; no test and no record", () => {
    for (const f of ["skills/goals-interview/SKILL.md", "commands/work/goals-interview.command.md", "nav.yaml"])
      assert.ok(files.includes(f), f)
    assert.ok(!files.some(f => /^(test|data)\//.test(f)), files.join("\n"))
  })

  test("no machine path, address, session id, task code or record id of a real workspace", () => {
    const hits = []
    const rules: [string, RegExp][] = [
      ["a home path", /\/Users\/|\/home\/[a-z]/],
      ["an e-mail address", /[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z.]{2,}/i],
      ["a session id", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
      ["a task code", /\bTASK-\d{3,}\b/],
      ["a dated record id", /\b[a-z][a-z-]*\/\d{4}-\d{2}-\d{2}--[a-z0-9-]+/],
      ["a repository URL", /github\.com\/(?!dreamteamer\/dreamteamer-modules)/],
    ]
    for (const f of text)
      for (const [n, line] of read(f).split("\n").entries())
        for (const [what, re] of rules)
          if (re.test(line)) hits.push(`${f}:${n + 1} ${what}: ${line.trim().slice(0, 90)}`)
    assert.deepEqual(hits, [])
  })

  test("every collection a shipped view, field or the nav names is Work's, its closure's or the CRM's", () => {
    const named = new Set<string>()
    for (const f of text) {
      for (const m of read(f).matchAll(/collections\/([a-z][a-z0-9/-]*)/g)) named.add(m[1])
      for (const m of read(f).matchAll(/^\s+type: ([a-z][a-z0-9/-]*)$/gm))
        if (!["string", "markdown", "date", "datetime", "boolean", "reference", "number", "integer"].includes(m[1]))
          named.add(m[1])
    }
    for (const c of (yaml.load(read("nav.yaml")) as any).tree.flatMap(function walk(e) {
      return typeof e === "string" ? [e] : (e.items ?? []).flatMap(walk)
    }))
      named.add(c)
    assert.deepEqual(
      [...named].filter(c => !KNOWN.has(c)),
      []
    )
  })

  test("UPDATING lists exactly the view ids 0.3 adds, which a workspace view of the same id now collides with", () => {
    const V020 = [
      "goals-active",
      "goals-archived",
      "goals-by-parent",
      "goals-graph",
      "goals-roadmap-gantt",
      "goals-roadmap-unscheduled",
      "sessions-goals-graph",
      "tasks-active",
      "tasks-all-records",
      "tasks-blocked",
      "tasks-closed",
      "tasks-doing",
      "tasks-done",
      "tasks-graph",
      "tasks-todo",
      "work-decisions-list",
      "work-sessions-recaps",
      "work-strategies-conversational",
      "work-strategies-list",
      "work-strategies-operational",
      "work-strategies-unblocking",
    ]
    const added = files
      .filter(f => f.startsWith("ui-views/"))
      .map(f => f.replace(/^ui-views\/|\.ui-view\.yaml$/g, ""))
      .filter(id => !V020.includes(id))
      .sort()
    const listed = /```text\n([\s\S]*?)```/.exec(read("UPDATING.md"))[1].split(/\s+/).filter(Boolean).sort()
    assert.deepEqual(listed, added)
  })

  test("the README's install line and notes name this version", () => {
    assert.equal(pkgOf("work").version, "0.3.0")
    assert.match(read("README.md"), /^# Work 0\.3$/m)
    assert.match(read("UPDATING.md"), /^# Upgrading to Work 0\.3$/m)
  })
})

describe("the nav fragment places Work's rows in the everyday order", () => {
  test("installed without the core preset: Work holds goals, tasks, sessions, decisions, then Brain with strategies", () => {
    const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), "dtm-work-nav-")), ...closure("work"))
    const root = virginWorkspace(ENGINE)
    const env = { HOME: fs.mkdtempSync(path.join(os.tmpdir(), "dtm-HOME-")) }
    const r = run(root, ["install", "@dreamteamer/work", "--from", from, "--no-input"], env, ENGINE)
    assert.ok(r.status === 0 || r.status === 3, `exit ${r.status}\n${r.stderr}`)
    const nav: any = yaml.load(fs.readFileSync(path.join(root, "nav.yaml"), "utf8"))
    const work = nav.tree.find(e => e.folder === "Work")
    assert.deepEqual(work.items, [
      "goals",
      "tasks",
      "sessions",
      "decisions",
      { folder: "Brain", items: ["strategies"] },
    ])
    assert.ok(moduleIds().includes("work"))
  })
})
