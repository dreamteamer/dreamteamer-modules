// The settings pages' pure parts: the routes under /settings, the modules merge, the remote mark's words, the
// activity's days, the sources sums and the field drawer's draft changes. Fixtures are invented here.
import assert from "node:assert/strict"
import test from "node:test"
import { byDay, entryRest, type ActivityEntry } from "../src/lib/activity.ts"
import {
  atMostOne,
  farFieldError,
  isTwoWay,
  suggestedFarField,
  typeOf,
  withAtMostOne,
  withEditor,
  withRelation,
  withSide,
  withTwoWay,
  withType,
  withViewer,
} from "../src/lib/fieldDrawer.ts"
import { moduleEntries, shipsOf } from "../src/lib/modules.ts"
import { remoteMark } from "../src/lib/remoteAccess.ts"
import { createRoute, listRoute, pageOf, recordRoute, settingsRedirect } from "../src/lib/createRoute.ts"
import { recordCount, recordsIn } from "../src/lib/sourcesStack.ts"
import type { FieldRow } from "../src/api/types.ts"

const NAMES = ["projects", "lab/samples", "skills"]

test("the routes under /settings: the Schema tab's tail, the system browse, the old data-model address", () => {
  assert.deepEqual(pageOf("/settings/schema", NAMES), { kind: "settings", tail: "" })
  assert.deepEqual(pageOf("/settings", NAMES), { kind: "settings", tail: "" })
  assert.deepEqual(pageOf("/settings/schema/collections/lab/samples?field=name", NAMES), {
    kind: "settings",
    tail: "collections/lab/samples",
  })
  assert.deepEqual(pageOf("/settings/system/skills/reviewing", NAMES), {
    kind: "record",
    collection: "skills",
    id: "reviewing",
    base: "/settings/system",
  })
  assert.deepEqual(pageOf("/settings/system/skills", NAMES), {
    kind: "list",
    collection: "skills",
    base: "/settings/system",
  })
  assert.equal(settingsRedirect("/settings/data-model"), "/settings/schema/collections")
  assert.equal(
    settingsRedirect("/settings/data-model/lab/samples?field=name"),
    "/settings/schema/collections/lab/samples?field=name"
  )
  assert.equal(settingsRedirect("/settings/data-models"), null)
  assert.equal(settingsRedirect("/content/projects"), null)
})

test("route builders take the base the page lives under", () => {
  assert.equal(listRoute("skills"), "/content/skills")
  assert.equal(recordRoute("skills", "a/b", "/settings/schema"), "/settings/schema/skills/a/b")
  assert.equal(createRoute("skills", "/settings/schema"), "/settings/schema/skills/+")
})

test("modules: location and path from the manifest, `channel` as the old spelling; what each ships", () => {
  const records = [
    { id: "default", name: "default", title: "Default", collections: ["collections/notes", "collections/lab/samples"] },
    { id: "northwind", name: "@northwind/core", namespaces: "nw", location: "git_modules" },
  ]
  const info = {
    modules: [
      { name: "default", location: "modules", root: "modules/default" },
      { name: "@northwind/core", channel: "npm", path: "node_modules/@northwind/core" },
    ],
  }
  const [a, b] = moduleEntries(records, info)
  assert.equal(a!.location, "modules")
  assert.equal(a!.path, "modules/default")
  assert.equal(shipsOf(a!), "notes, lab/samples")
  assert.equal(b!.title, "northwind")
  assert.equal(b!.location, "npm")
  assert.deepEqual(b!.namespaces, ["nw"])
  assert.equal(moduleEntries(records, null)[1]!.location, "git_modules")
})

test("the remote mark warns only when a push would be refused for sure", () => {
  const remote = { provider: "github" as const, host: "github.com", owner: "northwind", repo: "archive" }
  assert.equal(remoteMark(undefined).state, "checking")
  const refused = remoteMark({ state: "ok", level: "read", account: "dana-oren", tiedToPushKey: true, remote }, "write")
  assert.equal(refused.warning, true)
  assert.equal(refused.words, "push refused — dana-oren has read on northwind/archive")
  const untied = remoteMark({ state: "ok", level: "read", account: "dana-oren", remote }, "edit")
  assert.equal(untied.warning, false)
  assert.match(untied.words, /could not be confirmed/)
  assert.equal(
    remoteMark({ state: "ok", level: "write", account: "sam-diaz", remote }, "write").words,
    "remote write · as sam-diaz"
  )
  assert.equal(remoteMark({ state: "no-access", reason: "private" }).warning, true)
  assert.equal(remoteMark({ state: "not-checked", reason: "no provider" }).words, "remote not checked — no provider")
})

test("activity groups by day in arrival order; the rest of an entry is counted", () => {
  const e = (sha: string, date: string, records = 0, files = 0): ActivityEntry => ({
    sha,
    repo: ".",
    source: "lab",
    author: "Dana Oren",
    date,
    subject: sha,
    records: Array.from({ length: records }, (_, i) => ({ collection: "tasks", id: `t${i}` })),
    files,
  })
  const days = byDay([e("a", "2026-11-15T10:00"), e("b", "2026-11-15T09:00"), e("c", "2026-11-14T09:00")], iso =>
    iso.slice(0, 10)
  )
  assert.deepEqual(
    days.map(d => [d.day, d.entries.map(x => x.sha)]),
    [
      ["2026-11-15", ["a", "b"]],
      ["2026-11-14", ["c"]],
    ]
  )
  assert.deepEqual(entryRest(e("d", "x", 10, 13), 8), { more: 2, other: 3 })
  assert.deepEqual(entryRest(e("d", "x", 2, 1), 8), { more: 0, other: 0 })
})

test("sources: records read per root", () => {
  const entry = {
    collections: [
      { collection: "projects", path: "data/projects", count: 2 },
      { collection: "tasks", path: "data/tasks", count: 1 },
    ],
  }
  assert.equal(recordsIn(entry), 3)
  assert.equal(recordCount(1, " read"), "1 record read")
  assert.equal(recordCount(3), "3 records")
})

test("the drawer: a type change drops what no longer applies; a new list relation keeps its key on the target", () => {
  const rel = withType({ type: "string" }, "relation-list", { editing: false, sideTouched: false })
  assert.deepEqual(rel, { type: "list", of: "relation", link_side: "target" })
  assert.equal(typeOf(rel), "relation-list")
  const back = withType(
    {
      type: "relation",
      target: "/projects",
      link_side: "here",
      far_field: "tasks",
      viewer_options: { template: "{{ name }}", x: 1 },
    },
    "string",
    { editing: false, sideTouched: false }
  )
  assert.deepEqual(back, { type: "string", viewer_options: { x: 1 } })
  assert.deepEqual(withEditor({ type: "string", editor: "input", editor_options: { a: 1 } }, "select-dropdown"), {
    type: "string",
    editor: "select-dropdown",
  })
  assert.deepEqual(withViewer({ viewer: "label", viewer_options: { template: "{{ name }}", y: 2 } }, ""), {
    viewer_options: { template: "{{ name }}" },
  })
})

test("the drawer: the far field's name follows the suggestion until the operator types one", () => {
  const here = "tasks"
  let def: Record<string, unknown> = { type: "relation", link_side: "here" }
  def = withRelation(def, { target: "/projects" }, here)
  assert.equal(isTwoWay(def), false, "a new key is one-way until asked")
  def = withTwoWay(def, true, here)
  assert.equal(def["far_field"], "tasks")
  def = withAtMostOne(def, true, here)
  assert.equal(def["unique"], true)
  assert.equal(def["far_field"], "task", "one-to-one singularizes the suggestion")
  def = { ...def, far_field: "work_items" }
  def = withAtMostOne(def, false, here)
  assert.equal(def["far_field"], "work_items", "a typed name stays")
  const target = withSide({ type: "relation", target: "/projects" }, "target", here)
  assert.equal(target["far_field"], "task")
  assert.equal(atMostOne(target), true)
  assert.equal(atMostOne(withAtMostOne(target, false, here)), false)
  assert.equal(suggestedFarField({ type: "relation", target: "*" }, here), null)
})

test("the drawer: the far field is checked against the other collection's real fields", () => {
  const f = (field: string, over: Partial<FieldRow> = {}) =>
    ({ field, type: "string", title: field, required: false, editable: true, nullable: true, ...over }) as FieldRow
  const far = [f("name"), f("tasks", { kind: "mirror", mirror_of: "project" }), f("owner", { role: "reference" })]
  const def = (over: Record<string, unknown>) => ({ type: "relation", target: "/projects", ...over })
  assert.equal(
    farFieldError(def({ link_side: "here", far_field: "" }), "tasks", far, "project"),
    "Name the field this adds on projects."
  )
  assert.equal(
    farFieldError(def({ link_side: "here", far_field: "a.b" }), "tasks", far, "project"),
    "A field name carries no dots, slashes or spaces."
  )
  assert.equal(
    farFieldError(def({ link_side: "here", far_field: "name" }), "tasks", far, "project"),
    "projects already has a field called name."
  )
  assert.equal(
    farFieldError(def({ link_side: "here", far_field: "tasks" }), "tasks", far, "project"),
    "",
    "its own mirror is no collision"
  )
  assert.match(farFieldError(def({ link_side: "target", far_field: "name" }), "tasks", far, "x"), /not a reference/)
  assert.equal(farFieldError(def({ link_side: "target", far_field: "owner" }), "tasks", far, "x"), "")
  assert.equal(
    farFieldError(def({ link_side: "here" }), "tasks", far, "project"),
    "",
    "one-way has no far field to check"
  )
})
