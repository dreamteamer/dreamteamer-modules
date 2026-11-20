// The nav's gestures as NavOps (lib/navTree.ts) — the expectations of the Vue ui's render-tier
// test/webview/nav-sidebar-gestures.test.ts, over the same model, asked of the pure decision instead of a rendered
// NavSidebar: a drop and a menu entry are ONE op built from the nodes' own targets; a row that is not arranged means nothing.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  TAIL,
  dropOp,
  dropWhere,
  hiddenIn,
  hoverHint,
  navIndex,
  rowActive,
  rowMenu,
  tailLine,
  tailOp,
  toolbarMenu,
  type NavNode,
} from "../src/lib/navTree.ts"

const col = (name: string, label: string): NavNode => ({
  kind: "collection",
  key: `c/${name}`,
  label,
  target: { name },
  route: `/content/${encodeURIComponent(name)}`,
})
const MODEL = (): NavNode[] => [
  {
    kind: "workspace",
    key: "workspace",
    label: "northwind-hq",
    route: "/settings/schema/activity",
    children: [
      col("tasks", "Tasks"),
      col("contacts", "Contacts"),
      { ...col("companies", "Companies"), children: [{ kind: "view", key: "v/companies-map", label: "Map" }] },
      {
        kind: "namespace",
        key: "n/ns%3Arnd",
        label: "R&D",
        target: { name: "rnd" },
        children: [
          col("rnd/issues", "Issues"),
          {
            kind: "folder",
            key: "f/ns%3Arnd/Product",
            label: "Product",
            target: { folder: ["ns:rnd", "Product"] },
            children: [col("rnd/user-stories", "User stories")],
          },
        ],
      },
      { kind: "message", key: "message", label: "a notice drawn below the rows" },
    ],
  },
]
const ix = navIndex(MODEL())
const closed = () => false
const open =
  (...keys: string[]) =>
  (k: string) =>
    keys.includes(k)

test("the workspace node is the toolbar's name: its children are the top level", () => {
  assert.equal(ix.workspace?.label, "northwind-hq")
  assert.deepEqual(
    ix.top.map(n => n.key),
    ["c/tasks", "c/contacts", "c/companies", "n/ns%3Arnd", "message"]
  )
})

test("dropWhere: a container's top quarter, middle half, bottom quarter; any other row's halves", () => {
  const folder = { kind: "folder" }
  const row = { kind: "collection" }
  assert.equal(dropWhere(folder, 0.1), "before")
  assert.equal(dropWhere(folder, 0.5), "into")
  assert.equal(dropWhere(folder, 0.9), "after")
  assert.equal(dropWhere(row, 0.1), "before")
  assert.equal(dropWhere(row, 0.9), "after")
  assert.equal(dropWhere(folder, Number.NaN), "into")
  assert.equal(dropWhere(row, Number.NaN), "after")
})

test("a drop of contacts after tasks is one move with the two targets", () => {
  assert.deepEqual(dropOp(ix, "c/contacts", "c/tasks", "after", closed), {
    op: "move",
    target: { name: "contacts" },
    after: { name: "tasks" },
  })
})

test("into a namespace's middle; into a folder inside it by its path", () => {
  assert.deepEqual(dropOp(ix, "c/tasks", "n/ns%3Arnd", "into", closed), {
    op: "move",
    target: { name: "tasks" },
    into: { name: "rnd" },
  })
  assert.deepEqual(dropOp(ix, "c/contacts", "f/ns%3Arnd/Product", "into", closed), {
    op: "move",
    target: { name: "contacts" },
    into: { folder: ["ns:rnd", "Product"] },
  })
})

test("before a row: the top of its level on a first row, else after the row above", () => {
  const at = (from: string, to: string) => dropOp(ix, from, to, "before", closed)
  assert.deepEqual(at("c/contacts", "c/tasks"), { op: "move", target: { name: "contacts" }, position: "top" })
  assert.deepEqual(at("c/tasks", "c/companies"), { op: "move", target: { name: "tasks" }, after: { name: "contacts" } })
  assert.deepEqual(at("c/tasks", "c/rnd/issues"), {
    op: "move",
    target: { name: "tasks" },
    into: { name: "rnd" },
    position: "top",
  })
  assert.deepEqual(at("c/tasks", "f/ns%3Arnd/Product"), {
    op: "move",
    target: { name: "tasks" },
    after: { name: "rnd/issues" },
  })
  assert.deepEqual(at("c/tasks", "n/ns%3Arnd"), { op: "move", target: { name: "tasks" }, after: { name: "companies" } })
})

test("before the row just below the dragged one is nothing — the row is already there", () => {
  assert.equal(dropOp(ix, "c/tasks", "c/contacts", "before", closed), null)
})

test("before the first row of a folder is the top of that folder — a folder dragged there too (the host refuses)", () => {
  assert.deepEqual(dropOp(ix, "c/tasks", "c/rnd/user-stories", "before", closed), {
    op: "move",
    target: { name: "tasks" },
    into: { folder: ["ns:rnd", "Product"] },
    position: "top",
  })
  assert.deepEqual(dropOp(ix, "f/ns%3Arnd/Product", "c/rnd/user-stories", "before", closed), {
    op: "move",
    target: { folder: ["ns:rnd", "Product"] },
    into: { folder: ["ns:rnd", "Product"] },
    position: "top",
  })
})

test("the lower edge of an OPEN folder is the top inside it; of a closed one, after it", () => {
  assert.deepEqual(dropOp(ix, "c/tasks", "n/ns%3Arnd", "after", closed), {
    op: "move",
    target: { name: "tasks" },
    after: { name: "rnd" },
  })
  assert.deepEqual(dropOp(ix, "c/tasks", "n/ns%3Arnd", "after", open("n/ns%3Arnd")), {
    op: "move",
    target: { name: "tasks" },
    into: { name: "rnd" },
    position: "top",
  })
})

test("a drop on a view row — upper part or lower — is a drop after its collection", () => {
  const after = { op: "move", target: { name: "tasks" }, after: { name: "companies" } }
  assert.deepEqual(dropOp(ix, "c/tasks", "v/companies-map", "after", closed), after)
  assert.deepEqual(dropOp(ix, "c/tasks", "v/companies-map", "before", closed), after)
})

test("a drop on a row that is not arranged, on itself, or of a row with no target, is nothing", () => {
  assert.equal(dropOp(ix, "c/tasks", "message", "into", closed), null)
  assert.equal(dropOp(ix, "c/tasks", "message", "after", closed), null)
  assert.equal(dropOp(ix, "c/tasks", "c/tasks", "after", closed), null)
  assert.equal(dropOp(ix, "v/companies-map", "c/tasks", "after", closed), null)
  assert.equal(dropOp(ix, null, "c/tasks", "after", closed), null)
})

test("the drop line: none over a row that is not arranged, after its collection over a view row, else where the pointer is", () => {
  assert.equal(hoverHint(ix, { key: "message", where: "into" }), null)
  assert.deepEqual(hoverHint(ix, { key: "v/companies-map", where: "before" }), { key: "c/companies", where: "after" })
  assert.deepEqual(hoverHint(ix, { key: "c/tasks", where: "before" }), { key: "c/tasks", where: "before" })
})

test("the empty area under the last row: the bottom of the top level, its line above a row that is not arranged", () => {
  assert.deepEqual(tailOp(ix, "c/tasks"), { op: "move", target: { name: "tasks" }, position: "bottom" })
  assert.equal(tailOp(ix, "n/ns%3Arnd"), null, "already the last arranged top-level row")
  assert.equal(tailOp(ix, "message"), null)
  assert.deepEqual(tailLine(ix), { key: "message", where: "before" })
  assert.deepEqual(tailLine(navIndex([col("tasks", "Tasks")])), { key: TAIL, where: "after" })
})

test("the row menu: New folder, Hide, Move up on the second row, Move down, Move to bottom", () => {
  const act = (key: string, id: string, value?: string) => rowMenu(ix, key)!.act(id, value)
  assert.deepEqual(act("n/ns%3Arnd", "new-folder", "Plans"), {
    op: "new-folder",
    label: "Plans",
    into: { name: "rnd" },
  })
  assert.deepEqual(act("c/contacts", "hide"), { op: "hide", target: { name: "contacts" } })
  assert.deepEqual(act("c/contacts", "move-up"), { op: "move", target: { name: "contacts" }, position: "top" })
  assert.deepEqual(act("c/contacts", "move-down"), {
    op: "move",
    target: { name: "contacts" },
    after: { name: "companies" },
  })
  assert.deepEqual(act("c/companies", "move-up"), {
    op: "move",
    target: { name: "companies" },
    after: { name: "tasks" },
  })
  assert.deepEqual(act("c/tasks", "move-bottom"), { op: "move", target: { name: "tasks" }, position: "bottom" })
  assert.deepEqual(act("c/tasks", "icon", "rocket"), { op: "icon", target: { name: "tasks" }, icon: "rocket" })
  assert.deepEqual(act("c/tasks", "icon"), { op: "icon", target: { name: "tasks" }, icon: null })
})

test("which entries a row offers, and which are disabled at the ends of its level", () => {
  const ids = (key: string) => rowMenu(ix, key)!.items.map(i => i.id + (i.disabled ? "!" : ""))
  assert.deepEqual(ids("c/tasks"), ["move-up!", "move-down", "move-top!", "move-bottom", "icon", "hide"])
  assert.deepEqual(ids("n/ns%3Arnd"), [
    "new-folder",
    "move-up",
    "move-down!",
    "move-top",
    "move-bottom!",
    "icon",
    "hide",
  ])
  assert.deepEqual(ids("f/ns%3Arnd/Product").slice(0, 3), ["new-folder", "rename", "dissolve"])
  assert.equal(rowMenu(ix, "message"), null)
  assert.equal(rowMenu(ix, "v/companies-map"), null)
})

test("inside a folder: Move up on its second row is the top of that folder; Rename and Dissolve name its path", () => {
  const act = (id: string, value?: string) => rowMenu(ix, "f/ns%3Arnd/Product")!.act(id, value)
  assert.deepEqual(act("move-up"), {
    op: "move",
    target: { folder: ["ns:rnd", "Product"] },
    into: { name: "rnd" },
    position: "top",
  })
  assert.deepEqual(act("rename", "Product/UX"), {
    op: "rename",
    target: { folder: ["ns:rnd", "Product"] },
    label: "Product/UX",
  })
  assert.deepEqual(act("dissolve"), { op: "dissolve", target: { folder: ["ns:rnd", "Product"] } })
  assert.equal(act("rename", ""), null, "an empty label sends nothing")
})

test("the toolbar: New folder at the top level, Show hidden… for the name given, offering the hidden names", () => {
  const m = toolbarMenu(["contacts"])
  assert.deepEqual(m.act("new-folder", "Plans"), { op: "new-folder", label: "Plans" })
  assert.deepEqual(m.act("show-hidden", "contacts"), { op: "show", target: { name: "contacts" } })
  assert.equal(m.act("show-hidden", ""), null)
  assert.deepEqual(m.items[1]!.suggestions, ["contacts"])
})

test("Show hidden… offers the names the last write hid: hidden rows and a namespace hidden in place", () => {
  assert.deepEqual(
    hiddenIn({ tree: ["tasks", { namespace: "rnd", hidden: true, items: ["rnd/issues"] }], hidden: ["contacts"] }),
    ["contacts", "rnd"]
  )
  assert.deepEqual(hiddenIn({}), [])
})

test("the active row: on its path and below; a row naming a query only on exactly that route", () => {
  assert.equal(rowActive("/content/tasks", "/content/tasks?search=x"), true)
  assert.equal(rowActive("/content/tasks", "/content/tasks/brief-dana"), true)
  assert.equal(rowActive("/content/tasks", "/content/tasks-old"), false)
  assert.equal(rowActive("/content/projects?filter=x", "/content/projects"), false)
  assert.equal(rowActive("/content/projects?filter=x", "/content/projects?filter=x"), true)
  assert.equal(rowActive(undefined, "/"), false)
})
