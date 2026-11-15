// The designer's SAVE, as the host sees it (ported from @dreamteamer/ui's webview/designer-save.test.ts, now over the
// pure lib/designer-state.ts): what the write path sends is the contract. Every fixture is invented here
// (`patients`, `visits`, `samples`).
import assert from "node:assert/strict"
import test, { beforeEach } from "node:test"
import { setTransport } from "../src/api/client.ts"
import {
  applyStaged,
  enumValues,
  farSideOf,
  isDirty,
  loadDesigner,
  moveStaged,
  patchStaged,
  renameProblem,
  saveDesigner,
} from "../src/lib/designer-state.ts"

const row = (collection: string) => ({
  collection,
  title: collection,
  nav: {},
  display: { list: { layout: "table" }, record: { layout: "page" } },
  form: { sections: [] },
  record_title: "{{ name }}",
  record_type: collection,
  runtime: false,
  internal: false,
})
const field = (name: string, over: Record<string, unknown> = {}) => ({
  field: name,
  type: "string",
  title: name,
  required: false,
  editable: true,
  nullable: true,
  ...over,
})
const SCALAR_LISTS = ["integer", "number", "boolean", "date", "datetime"] as const
const ID = field("id", { kind: "virtual", editable: false, hidden: ["list", "form", "record"] })

const PRESENTATION = {
  collections: [row("patients"), row("visits"), row("samples")],
  fields: {
    patients: [ID, field("name", { required: true, nullable: false })],
    visits: [
      ID,
      field("reason"),
      field("copay", { type: "number", form_section: "Billing" }),
      field("old_fee", { type: "number", deprecated: true }),
    ],
    samples: [ID, ...SCALAR_LISTS.map(t => field(`${t}s`, { type: t, many: true }))],
  },
  relations: [],
}
const SOURCES: Record<string, unknown> = {
  patients: {
    name: "patients",
    fields: { name: { type: "string", required: true, sensitive: true, pattern: "^.+$" } },
  },
  samples: { name: "samples", fields: Object.fromEntries(SCALAR_LISTS.map(t => [`${t}s`, { type: t, many: true }])) },
  visits: {
    name: "visits",
    fields: {
      reason: { type: "string" },
      old_fee: { type: "number", deprecated: true, display: { form_section: "Billing" } },
    },
  },
}

let writes: Array<{ method: string; path: string; body: unknown }> = []
beforeEach(() => {
  writes = []
  setTransport({
    request: async (method, path, body) => {
      if (path === "/presentation") return PRESENTATION
      const m = /^\/collections\/collections\/records\/(.+)$/.exec(path)
      if (method === "GET" && m) return { id: m[1], fields: SOURCES[m[1]!] }
      if (method !== "GET" && path.startsWith("/fields/")) {
        writes.push({ method, path, body })
        return method === "DELETE" ? { cleared: 2 } : {}
      }
      throw new Error(`unstubbed ${method} ${path}`)
    },
    notify: () => {},
  })
})

test("an edited field is PATCHed whole, over the authored field, with its display key", async () => {
  const loaded = await loadDesigner("patients")
  const out = await saveDesigner(
    "patients",
    loaded,
    patchStaged(loaded.fields, "name", { placeholder: "as on the card" })
  )
  assert.deepEqual(out.errors, [])
  assert.deepEqual(writes, [
    {
      method: "PATCH",
      path: "/fields/patients/name",
      body: {
        field: {
          type: "string",
          required: true,
          sensitive: true,
          pattern: "^.+$",
          display: { placeholder: "as on the card" },
        },
      },
    },
  ])
})

test("a relation kept on the other collection: the key first, as flags; then the mirror, naming it", async () => {
  const loaded = await loadDesigner("patients")
  const fields = applyStaged(loaded.fields, {
    key: "visits",
    def: { type: "list", of: "relation", target: "/visits", link_side: "target", far_field: "patient" },
    implicit: false,
  })
  const out = await saveDesigner("patients", loaded, fields)
  assert.deepEqual(out.errors, [])
  assert.deepEqual(writes, [
    { method: "POST", path: "/fields/visits", body: { name: "patient", type: "patients" } },
    {
      method: "POST",
      path: "/fields/patients",
      body: { name: "visits", field: { type: "visits", many: true, mirror_of: "patient" } },
    },
  ])
  assert.match(out.notices.join(" "), /patients\.visits ↔ visits\.patient/)
})

test("a relation kept HERE: this key first, then the far mirror as flags the engine completes", async () => {
  const loaded = await loadDesigner("patients")
  const fields = applyStaged(loaded.fields, {
    key: "clinic_visit",
    def: { type: "relation", target: "/visits", link_side: "here", far_field: "patient", unique: true },
    implicit: false,
  })
  await saveDesigner("patients", loaded, fields)
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/fields/patients",
      body: { name: "clinic_visit", field: { type: "visits", unique: true } },
    },
    {
      method: "POST",
      path: "/fields/visits",
      body: { name: "patient", type: "patients", "mirror-of": "clinic_visit" },
    },
  ])
})

test("an overlay's field keeps the row's form section; a deprecated one keeps its source's", async () => {
  const loaded = await loadDesigner("visits")
  assert.equal(loaded.fields.find(f => f.key === "copay")?.def["form_section"], "Billing")
  let fields = patchStaged(loaded.fields, "copay", { placeholder: "in the clinic's currency" })
  fields = patchStaged(fields, "old_fee", { description: "Replaced by copay." })
  const out = await saveDesigner("visits", loaded, fields)
  assert.deepEqual(out.errors, [])
  assert.deepEqual(writes, [
    {
      method: "PATCH",
      path: "/fields/visits/copay",
      body: {
        field: { type: "number", display: { form_section: "Billing", placeholder: "in the clinic's currency" } },
      },
    },
    {
      method: "PATCH",
      path: "/fields/visits/old_fee",
      body: {
        field: {
          type: "number",
          deprecated: true,
          display: { form_section: "Billing" },
          description: "Replaced by copay.",
        },
      },
    },
  ])
})

for (const t of SCALAR_LISTS) {
  test(`a list of ${t} keeps its type and many through a metadata edit`, async () => {
    const loaded = await loadDesigner("samples")
    const out = await saveDesigner("samples", loaded, patchStaged(loaded.fields, `${t}s`, { width: 14 }))
    assert.deepEqual(out.warnings, [])
    assert.deepEqual(writes, [
      {
        method: "PATCH",
        path: `/fields/samples/${t}s`,
        body: { field: { type: t, many: true, display: { width: 14 } } },
      },
    ])
  })
}

test("a removed field is DELETEd first, and what it cleared is a notice", async () => {
  const loaded = await loadDesigner("visits")
  const out = await saveDesigner(
    "visits",
    loaded,
    loaded.fields.filter(f => f.key !== "reason")
  )
  assert.deepEqual(writes, [{ method: "DELETE", path: "/fields/visits/reason", body: undefined }])
  assert.match(out.notices[0]!, /visits\.reason removed; its values went with it from 2 visits records/)
})

test("an untouched load is clean; a reorder alone is dirty and warns it is not stored", async () => {
  const loaded = await loadDesigner("visits")
  assert.equal(isDirty(loaded.fields, loaded), false)
  const moved = moveStaged(loaded.fields, 1, 2)
  assert.equal(isDirty(moved, loaded), true)
  const out = await saveDesigner("visits", loaded, moved)
  assert.deepEqual(writes, [])
  assert.match(out.warnings[0]!, /order isn’t persisted/)
})

test("a write refused for one field is reported against it; the others still land", async () => {
  const loaded = await loadDesigner("visits")
  setTransport({
    request: async (method, path, body) => {
      if (path === "/presentation") return PRESENTATION
      if (path === "/fields/visits/reason") throw new Error("compile refused")
      writes.push({ method, path, body })
      return {}
    },
    notify: () => {},
  })
  let fields = patchStaged(loaded.fields, "reason", { placeholder: "why" })
  fields = patchStaged(fields, "copay", { placeholder: "money" })
  const out = await saveDesigner("visits", loaded, fields)
  assert.deepEqual(out.errors, ["'reason': compile refused"])
  assert.deepEqual(
    writes.map(w => w.path),
    ["/fields/visits/copay"]
  )
})

test("the far side of a def: none without a named target, the key's side otherwise", () => {
  assert.equal(farSideOf({ type: "string" }), null)
  assert.equal(farSideOf({ type: "relation", target: "*" }), null)
  assert.equal(farSideOf({ type: "relation", target: "/visits", link_side: "target" }), null)
  assert.deepEqual(farSideOf({ type: "relation", target: "/visits", far_field: "", unique: true }), {
    target: "visits",
    field: "",
    side: "here",
    list: false,
    unique: true,
    onDelete: "restrict",
  })
})

test("enum values and rename problems", () => {
  assert.deepEqual(enumValues({ editor_options: { choices: [{ value: "active" }, "paused", { label: "x" }] } }), [
    "active",
    "paused",
  ])
  assert.deepEqual(enumValues({}), [])
  assert.equal(renameProblem("a", " ", [], "field"), "Name the field.")
  assert.equal(renameProblem("a", "a", [], "value"), "That is the value's name now.")
  assert.equal(renameProblem("a", "b.c", [], "field"), "A field name carries no dots, slashes or spaces.")
  assert.equal(renameProblem("a", "b", ["b"], "field"), "A field named b already exists.")
  assert.equal(renameProblem("a", "b", ["b"], "value"), "b is already a value.")
  assert.equal(renameProblem("a", "b", [], "field"), null)
})

test("a rename plan reads as one sentence and its files", async () => {
  const { planFiles, renamePlanLine } = await import("../src/lib/designer-state.ts")
  const plan = {
    records: 3,
    positions: [
      { rel: "modules/default/collections/projects.collection.yaml", at: "fields.status" },
      { rel: "modules/default/ui-views/projects-board.ui-view.yaml", at: "display.list.options.lanes_by" },
      { rel: "modules/default/collections/projects.collection.yaml", at: "fields.status.enum" },
    ],
  }
  assert.equal(renamePlanLine(plan), "Rewrites 3 records and 3 places in 2 source files.")
  assert.deepEqual(planFiles(plan), [
    "modules/default/collections/projects.collection.yaml",
    "modules/default/ui-views/projects-board.ui-view.yaml",
  ])
  assert.equal(renamePlanLine({ records: 1 }), "Rewrites 1 record.")
  assert.equal(renamePlanLine(null), "Nothing to rewrite.")
})

test("a reference nothing mirrors loads one-way — no far field the drawer would ask to name", async () => {
  setTransport({
    request: async (_m, path) => {
      if (path === "/presentation")
        return {
          collections: [row("visits"), row("patients")],
          fields: { visits: [ID, field("patient", { role: "reference" })], patients: [ID] },
          relations: [{ collection: "visits", field: "patient", related_collection: "patients", list: false }],
        }
      return { id: "visits", fields: { fields: { patient: { type: "patients" } } } }
    },
    notify: () => {},
  })
  const loaded = await loadDesigner("visits")
  const def = loaded.fields.find(f => f.key === "patient")!.def
  assert.equal(def["target"], "/patients")
  assert.equal(def["link_side"], "here")
  assert.equal("far_field" in def, false)
})
