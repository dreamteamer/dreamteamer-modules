/**
 * Render tier — cr-modules-017 task 15 (rnd/tests/dreamteamer-modules/pane-s2-level-shown-and-lowered), as the
 * 2026-11-14 16:30 revision placed it: no bar above the page; the pane's controls are in the nav's toolbar. The
 * workspace name is the switcher (a menu of the workspaces `dt web open` registered, a pick handing the pane over);
 * the level is an icon at the toolbar's right end, after the arrange lock, whose menu only LOWERS — the last line sends
 * a person to the chat for a raise. Arranging needs Edit. The controls talk to the server's own /_dt/ routes through
 * the browser's fetch (they are not protocol routes), so this tier stubs fetch.
 */
import assert from "node:assert/strict"
import test, { afterEach, beforeEach } from "node:test"
import { createMemoryHistory, createRouter } from "vue-router"
import { onHostRequest, resetHost } from "./host-stub"
import { all, find, flush, focused, hasClass, render, text, unmountAll, type TestNode } from "./render"
import AppNav from "../../src/components/AppNav.vue"
import { hostInfo, paneHost } from "../../src/lib/host-boot"
import { paneMenu } from "../../src/lib/pane-api"

const w = ((globalThis as { window?: any }).window ??= { addEventListener() {}, removeEventListener() {} })
w.location = { href: "http://127.0.0.1:4100/app/#/content/tasks" }
;(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} }

type Call = { url: string; method: string; body?: unknown; credentials?: string; type?: string }
let calls: Call[] = []
let answers: Record<string, () => { status: number; body: unknown }> = {}
const fetchStub = async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? "GET"
  calls.push({
    url,
    method,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    credentials: init.credentials,
    type: (init.headers as Record<string, string> | undefined)?.["Content-Type"],
  })
  const a = answers[`${method} ${url}`]?.() ?? { status: 404, body: { error: `no route ${method} ${url}` } }
  return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } })
}
;(globalThis as { fetch?: unknown }).fetch = fetchStub
w.fetch = fetchStub

const NAV = [
  {
    kind: "workspace",
    key: "workspace",
    label: "northwind-hq",
    children: [
      { kind: "collection", key: "c/tasks", label: "Tasks", target: { name: "tasks" }, route: "/content/tasks" },
    ],
  },
]
let hostLevel = "edit"
beforeEach(() => {
  resetHost()
  calls = []
  hostLevel = "edit"
  paneMenu.value = null
  delete w.innerWidth
  hostInfo.value = { level: "edit", chat: true, workspace: { id: "a1b2c3d4e5f60718", name: "Northwind" } }
  onHostRequest((method, path) => {
    if (method === "GET" && path === "/host")
      return { level: hostLevel, chat: true, workspace: { id: "a1b2c3d4e5f60718", name: "Northwind" } }
    if (method === "GET" && path === "/nav") return NAV
    throw new Error(`unexpected ${method} ${path}`)
  })
  answers = {
    "GET /_dt/workspaces": () => ({
      status: 200,
      body: [
        { id: "a1b2c3d4e5f60718", name: "Northwind", running: true, current: true },
        { id: "ffeeddccbbaa0011", name: "Harbor", running: false, current: false },
      ],
    }),
    "POST /_dt/level": () => {
      hostLevel = "read"
      return { status: 200, body: { level: "read" } }
    },
    "POST /_dt/handoff": () => ({ status: 200, body: { url: "http://127.0.0.1:4200/sign-in/abc" } }),
  }
})
afterEach(() => unmountAll())

const router = () =>
  createRouter({ history: createMemoryHistory(), routes: [{ path: "/:path(.*)*", component: { render: () => null } }] })
const mount = () => render(AppNav, {}, [router()])
const byClass = (root: TestNode, c: string) => all(root, n => hasClass(n, c))
const click = async (n: TestNode, e: Record<string, unknown> = {}) => {
  ;(n.props["onClick"] as (e?: unknown) => void)({ stopPropagation() {}, ...e })
  await flush()
}
const words = (n: TestNode | null) => (n ? text(n).replace(/\s+/g, " ").trim() : "")
const levelIcon = (root: TestNode) => {
  const b = byClass(root, "dt-pane-level")[0]
  assert.ok(b, "no level icon in the toolbar")
  return b
}
const glyph = (n: TestNode) => String(all(n, x => hasClass(x, "codicon"))[0]?.props["class"] ?? "")
const srcOf = async (file: string) =>
  (await import("node:fs")).readFileSync(
    new URL(`../../src/${file}`, import.meta.url).pathname.replace("/.test-build/webview", ""),
    "utf8"
  )
const lockOf = (root: TestNode) => all(root, n => n.tag === "button" && n.props["data-tool"] === "arrange")[0]

test("the level is an icon with no text at the toolbar's right end, after the arrange lock; its menu offers only lower levels", async () => {
  const root = await mount()
  const icon = levelIcon(root)
  assert.equal(words(icon), "", "the level icon has text")
  assert.equal(icon.props["data-level"], "edit")
  assert.equal(icon.props["aria-label"], "Level: Edit")
  assert.equal(icon.props["title"], "Level: Edit")
  assert.match(glyph(icon), /codicon-edit/)
  const buttons = byClass(root, "dt-nav-toolbar__buttons")[0].children.filter(
    (c): c is TestNode => typeof c !== "string" && c.tag === "button"
  )
  assert.deepEqual(
    buttons.map(b => (hasClass(b, "dt-pane-level") ? "level" : b.props["data-tool"])),
    ["arrange", "level"],
    "the level is not right after the lock"
  )
  await click(icon)
  const lowers = byClass(root, "dt-pane-level__lower")
  assert.deepEqual(lowers.map(words), ["Read"])
  assert.equal(
    lowers.some(n => /Admin/.test(words(n))),
    false,
    "no raise item"
  )
  assert.equal(words(byClass(root, "dt-pane-menu__hint")[0]), "To raise it, ask in the chat")
})

test('choosing Read posts { level: "read" } to /_dt/level, reloads GET /host, and the icon becomes the eye', async () => {
  const root = await mount()
  await click(levelIcon(root))
  await click(byClass(root, "dt-pane-level__lower")[0])
  const post = calls.find(c => c.method === "POST" && c.url === "/_dt/level")
  assert.deepEqual(post?.body, { level: "read" })
  assert.equal(post?.credentials, "same-origin")
  assert.equal(post?.type, "application/json")
  assert.equal(hostInfo.value?.level, "read", "GET /host asked again")
  assert.equal(levelIcon(root).props["data-level"], "read")
  assert.equal(levelIcon(root).props["title"], "Level: Read")
  assert.match(glyph(levelIcon(root)), /codicon-eye\b/)
  assert.equal(byClass(root, "dt-pane-level__menu").length, 0, "the menu stayed open")
})

test("a raised level: the shield in the warning colour, its notice in the tooltip and at the top of the menu", async () => {
  hostInfo.value = {
    level: "admin",
    chat: true,
    workspace: { id: "a1b2c3d4e5f60718", name: "Northwind" },
    raisedAt: new Date().toISOString(),
  }
  const root = await mount()
  const icon = levelIcon(root)
  assert.equal(icon.props["data-level"], "admin")
  assert.match(glyph(icon), /codicon-shield/)
  assert.match(String(icon.props["title"]), /^Level: Admin — Admin since \d\d:\d\d — opened from the chat$/)
  await click(icon)
  const menu = byClass(root, "dt-pane-level__menu")[0]
  const first = menu.children.filter(
    (c): c is TestNode => typeof c !== "string" && c.tag !== "#comment" && c.tag !== "#text"
  )[0]
  assert.ok(hasClass(first, "dt-pane-menu__notice"), "the notice is not at the top of the menu")
  assert.match(words(first), /^Admin since \d\d:\d\d — opened from the chat$/)
  assert.deepEqual(byClass(root, "dt-pane-level__lower").map(words), ["Edit", "Read"])
  const src = (await import("node:fs")).readFileSync(
    new URL("../../src/components/PaneLevel.vue", import.meta.url).pathname.replace("/.test-build/webview", ""),
    "utf8"
  )
  assert.match(
    src,
    /\.dt-pane-level\[data-level='admin'\], \.dt-pane-level\[data-level='admin'\]:hover:not\(:disabled\) \{ color: var\(--dt-warning\); \}/
  )
})

test("a refused lower shows its sentence inside the level menu", async () => {
  answers["POST /_dt/level"] = () => ({ status: 403, body: { error: "the page cannot raise the level" } })
  const root = await mount()
  await click(levelIcon(root))
  await click(byClass(root, "dt-pane-level__lower")[0])
  const menu = byClass(root, "dt-pane-level__menu")[0]
  assert.ok(menu, "the menu closed on a refusal")
  assert.equal(words(find(menu, n => hasClass(n, "dt-pane-menu__error"))), "the page cannot raise the level")
})

test("the workspace name is the switcher at the toolbar's left; choosing another posts /_dt/handoff and goes to its URL", async () => {
  const root = await mount()
  const name = byClass(root, "dt-nav-toolbar__name")[0]
  const ws = byClass(name, "dt-pane-switch")[0]
  assert.ok(ws, "the name is not the switcher")
  assert.equal(
    words(ws),
    "Northwind",
    "the switcher names the workspace as its list does (the host's name), not by the nav label"
  )
  assert.equal(byClass(root, "dt-nav-toolbar__label").length, 0, "the name is drawn twice")
  await click(ws)
  const items = byClass(root, "dt-pane-switch__item")
  assert.equal(items.length, 2)
  assert.equal(items[0].props["aria-checked"], "true", "the current one is checked")
  assert.match(words(items[1]), /^Harbor starts when opened$/, "a stopped one is marked")
  await click(items[1])
  const post = calls.find(c => c.method === "POST" && c.url === "/_dt/handoff")
  assert.deepEqual(post?.body, { id: "ffeeddccbbaa0011" })
  assert.equal(w.location.href, "http://127.0.0.1:4200/sign-in/abc")
})

test("a refused handoff shows its sentence inside the switcher menu", async () => {
  answers["POST /_dt/handoff"] = () => ({ status: 409, body: { error: "Harbor: its folder is gone" } })
  w.location.href = "unchanged"
  const root = await mount()
  await click(byClass(root, "dt-pane-switch")[0])
  await click(byClass(root, "dt-pane-switch__item")[1])
  const menu = byClass(root, "dt-pane-switch__menu")[0]
  assert.ok(menu, "the menu closed on a refusal")
  assert.equal(words(find(menu, n => hasClass(n, "dt-pane-menu__error"))), "Harbor: its folder is gone")
  assert.equal(w.location.href, "unchanged")
})

test("one menu at a time: opening the level closes the switcher", async () => {
  const root = await mount()
  await click(byClass(root, "dt-pane-switch")[0])
  assert.equal(byClass(root, "dt-pane-switch__menu").length, 1)
  await click(levelIcon(root))
  assert.equal(byClass(root, "dt-pane-switch__menu").length, 0)
  assert.equal(byClass(root, "dt-pane-level__menu").length, 1)
})

test("a host answering no workspace id (the editor, a plain dt web): the name is plain text and there is no level", async () => {
  hostInfo.value = { level: "admin", chat: false, workspace: { name: "x" } }
  assert.equal(paneHost(), false)
  const root = await mount()
  assert.equal(byClass(root, "dt-pane-switch").length, 0)
  assert.equal(byClass(root, "dt-pane-level").length, 0)
  assert.equal(words(byClass(root, "dt-nav-toolbar__label")[0]), "northwind-hq")
  assert.equal(lockOf(root).props["disabled"], undefined, "off a pane host arranging is not gated on a level")
  const src = (await import("node:fs")).readFileSync(
    new URL("../../src/App.vue", import.meta.url).pathname.replace("/.test-build/webview", ""),
    "utf8"
  )
  assert.match(src, /<AppNav v-if="appNav" \/>/)
  assert.doesNotMatch(src, /PaneBar/, "App still draws a bar above the page")
  assert.match(src, /dt:host/, "App refetches GET /host on dt:host")
})

test("with only the current workspace registered the switcher shows it checked and says no other was opened", async () => {
  answers["GET /_dt/workspaces"] = () => ({
    status: 200,
    body: [{ id: "a1b2c3d4e5f60718", name: "Northwind", running: true, current: true }],
  })
  const root = await mount()
  await click(byClass(root, "dt-pane-switch")[0])
  const items = byClass(root, "dt-pane-switch__item")
  assert.deepEqual(items.map(words), ["Northwind"])
  assert.equal(items[0].props["aria-checked"], "true")
  assert.deepEqual(byClass(root, "dt-pane-menu__hint").map(words), ["No other workspace was opened on this machine"])
})

test("with another workspace in the list there is no such line", async () => {
  const root = await mount()
  await click(byClass(root, "dt-pane-switch")[0])
  assert.equal(byClass(root, "dt-pane-switch__item").length, 2)
  assert.deepEqual(byClass(root, "dt-pane-menu__hint").map(words), [])
})

test("at 320 px both menus open inside the window: the switcher under the name, the level menu not off the left edge", async () => {
  w.innerWidth = 320
  const root = await mount()
  // the nav is ~102 px wide at 320: the name starts at 10, the level icon ends at 100
  await click(byClass(root, "dt-pane-switch")[0], {
    currentTarget: { getBoundingClientRect: () => ({ left: 10, right: 60, top: 4, bottom: 28 }) },
  })
  const sw = byClass(root, "dt-pane-switch__menu")[0].props["style"] as Record<string, string>
  assert.deepEqual(sw, { left: "10px", top: "30px" })
  await click(levelIcon(root), {
    currentTarget: { getBoundingClientRect: () => ({ left: 76, right: 100, top: 4, bottom: 28 }) },
  })
  const lv = byClass(root, "dt-pane-level__menu")[0].props["style"] as Record<string, string>
  assert.deepEqual(
    lv,
    { left: "4px", top: "30px" },
    "a 220 px menu hung from the right end of a 102 px nav would open off-screen"
  )
  // wide: the level menu's end lines up with the icon's
  paneMenu.value = null
  await flush()
  w.innerWidth = 1200
  await click(levelIcon(root), {
    currentTarget: { getBoundingClientRect: () => ({ left: 232, right: 256, top: 4, bottom: 28 }) },
  })
  assert.deepEqual(byClass(root, "dt-pane-level__menu")[0].props["style"], { left: "36px", top: "30px" })
})

test("arranging needs Edit: at Read the lock is disabled saying so; a lower to Read while unlocked locks the nav", async () => {
  const root = await mount()
  await click(lockOf(root))
  assert.equal(lockOf(root).props["aria-pressed"], "true", "at Edit the nav unlocks")
  const row = () => all(root, n => n.tag === "li" && n.props["data-key"] === "c/tasks")[0]
  assert.equal(row().props["draggable"], "true")
  await click(levelIcon(root))
  await click(byClass(root, "dt-pane-level__lower")[0])
  assert.equal(hostInfo.value?.level, "read")
  assert.equal(lockOf(root).props["aria-pressed"], "false", "lowering to Read left the nav unlocked")
  assert.equal(lockOf(root).props["disabled"], true)
  assert.equal(lockOf(root).props["title"], "Arranging the nav needs Edit")
  assert.equal(row().props["draggable"], undefined)
  await click(lockOf(root))
  assert.equal(lockOf(root).props["aria-pressed"], "false", "a Read pane unlocked the nav")
  assert.equal(byClass(root, "dt-nav-tool").filter(b => b.props["data-tool"] === "new-folder").length, 0)
})

test("a page opened at Read starts with the lock disabled", async () => {
  hostInfo.value = { level: "read", chat: true, workspace: { id: "a1b2c3d4e5f60718", name: "Northwind" } }
  const root = await mount()
  assert.equal(lockOf(root).props["disabled"], true)
  assert.equal(lockOf(root).props["title"], "Arranging the nav needs Edit")
  assert.match(glyph(levelIcon(root)), /codicon-eye\b/)
})

// ---- the review of the pane branch (round 1) ------------------------------------------------------------------------

const key = (k: string, shiftKey = false) => ({ key: k, shiftKey, preventDefault() {}, stopPropagation() {} })
const keydown = async (menu: TestNode, k: string, shift = false) => {
  ;(menu.props["onKeydown"] as (e: unknown) => void)(key(k, shift))
  await flush()
}
const openRowMenu = async (root: TestNode) => {
  const row = all(root, n => n.tag === "li" && n.props["data-key"] === "c/tasks")[0]
  ;(row.props["onContextmenu"] as (e: unknown) => void)({
    clientX: 40,
    clientY: 60,
    preventDefault() {},
    stopPropagation() {},
  })
  await flush()
}
const navMenus = (root: TestNode) => all(root, n => n.props["class"] === "dt-nav-menu").length

test("the switcher's last entry is Settings, which opens the workspace settings; in the pane the name opens the switcher", async () => {
  const r = router()
  const root = await render(AppNav, {}, [r])
  await click(byClass(root, "dt-pane-switch")[0])
  assert.equal(r.currentRoute.value.fullPath, "/", "the name navigated instead of opening the switcher")
  const menu = byClass(root, "dt-pane-switch__menu")[0]
  const buttons = all(menu, n => n.tag === "button")
  assert.equal(words(buttons[buttons.length - 1]), "Settings", "Settings is not the last entry")
  await click(buttons[buttons.length - 1])
  assert.equal(r.currentRoute.value.fullPath, "/settings/schema/activity")
  assert.equal(byClass(root, "dt-pane-switch__menu").length, 0, "the menu stayed open")
  assert.equal(
    byClass(root, "dt-nav-toolbar__settings").length,
    0,
    "the plain settings name is drawn beside the switcher"
  )
})

test("narrow and unlocked, the switcher keeps its minimum (the buttons wrap instead) and still opens", async () => {
  w.innerWidth = 320
  const root = await mount()
  await click(lockOf(root))
  assert.equal(lockOf(root).props["aria-pressed"], "true")
  const name = byClass(root, "dt-nav-toolbar__name")[0]
  const sw = byClass(name, "dt-pane-switch")[0]
  assert.ok(sw, "the switcher left the name slot")
  assert.equal(byClass(name, "dt-nav-tool").length, 0, "a toolbar button is drawn over the name")
  await click(sw, { currentTarget: { getBoundingClientRect: () => ({ left: 10, right: 46, top: 4, bottom: 28 }) } })
  assert.equal(byClass(root, "dt-pane-switch__menu").length, 1, "unlocked at 320 px the switcher does not open")
  const css = await srcOf("components/PaneSwitcher.vue")
  // 30 px: some of the name, the chevron and a hit target (the held-out walk asks ≥ 24) — and small enough that a
  // 320 px pane keeps one 32 px toolbar line when locked (name, lock, level); the pane walk measures that line
  assert.match(css, /\.dt-pane-switch \{[^}]*flex: 0 1 auto; min-width: 30px;/, "the switcher has no minimum")
  assert.match(
    css,
    /\.dt-nav \.dt-nav-toolbar__name:has\(> \.dt-pane-switch\) \{ flex: 1 0 30px; min-width: 30px; \}/,
    "the name slot does not keep the switcher's minimum"
  )
  assert.match(
    css,
    /\.dt-nav \.dt-nav-toolbar:has\(> \.dt-nav-toolbar__name > \.dt-pane-switch\) \{ flex-wrap: wrap;[^}]*padding-left: 6px; \}/,
    "the toolbar does not wrap its buttons one by one"
  )
  assert.match(
    css,
    /> \.dt-nav-toolbar__buttons \{ display: contents; \}/,
    "the buttons wrap as a group, not one by one"
  )
})

test("one menu at a time across all of them: switcher, level, row menus and the toolbar asks", async () => {
  const root = await mount()
  await click(lockOf(root))
  const state = () => ({
    sw: byClass(root, "dt-pane-switch__menu").length,
    lv: byClass(root, "dt-pane-level__menu").length,
    nav: navMenus(root),
  })
  await click(byClass(root, "dt-pane-switch")[0])
  await click(levelIcon(root))
  assert.deepEqual(state(), { sw: 0, lv: 1, nav: 0 }, "level after switcher")
  await click(byClass(root, "dt-pane-switch")[0])
  assert.deepEqual(state(), { sw: 1, lv: 0, nav: 0 }, "switcher after level")
  await openRowMenu(root)
  assert.deepEqual(state(), { sw: 0, lv: 0, nav: 1 }, "row menu after switcher")
  await click(byClass(root, "dt-pane-switch")[0])
  assert.deepEqual(state(), { sw: 1, lv: 0, nav: 0 }, "switcher after row menu")
  await click(levelIcon(root))
  await click(all(root, n => n.props["data-tool"] === "new-folder")[0], { currentTarget: null })
  assert.deepEqual(state(), { sw: 0, lv: 0, nav: 1 }, "toolbar ask after level")
  await click(levelIcon(root))
  assert.deepEqual(state(), { sw: 0, lv: 1, nav: 0 }, "level after toolbar ask")
  await openRowMenu(root)
  assert.deepEqual(state(), { sw: 0, lv: 0, nav: 1 }, "row menu after level")
  await click(all(root, n => n.props["data-tool"] === "show-hidden")[0], { currentTarget: null })
  assert.deepEqual(state(), { sw: 0, lv: 0, nav: 1 }, "a toolbar ask after a row menu replaces it")
  await click(byClass(root, "dt-pane-switch")[0])
  assert.deepEqual(state(), { sw: 1, lv: 0, nav: 0 }, "switcher after toolbar ask")
})

test("the switcher menu takes focus on open; Tab cycles inside it; Escape closes it and gives focus back to the name", async () => {
  const root = await mount()
  focused.length = 0
  const button = byClass(root, "dt-pane-switch")[0]
  await click(button)
  const menu = byClass(root, "dt-pane-switch__menu")[0]
  const items = all(menu, n => n.tag === "button")
  assert.deepEqual(items.map(words), ["Northwind", "Harbor starts when opened", "Settings"])
  assert.equal(focused[focused.length - 1], items[0], "focus did not move to the first item")
  await keydown(menu, "Tab")
  assert.equal(focused[focused.length - 1], items[1])
  await keydown(menu, "Tab")
  await keydown(menu, "Tab")
  assert.equal(focused[focused.length - 1], items[0], "Tab left the menu after its last item")
  await keydown(menu, "Tab", true)
  assert.equal(focused[focused.length - 1], items[2], "Shift+Tab left the menu before its first item")
  await keydown(menu, "Escape")
  assert.equal(byClass(root, "dt-pane-switch__menu").length, 0, "Escape left the menu open")
  assert.equal(focused[focused.length - 1], button, "focus did not return to the name")
})

test("the level menu takes focus on open (its first lower, or the menu itself at Read); Escape returns focus to the icon", async () => {
  const root = await mount()
  focused.length = 0
  await click(levelIcon(root))
  let menu = byClass(root, "dt-pane-level__menu")[0]
  assert.equal(
    focused[focused.length - 1],
    byClass(menu, "dt-pane-level__lower")[0],
    "focus did not move to the first lower"
  )
  await keydown(menu, "Tab")
  assert.equal(focused[focused.length - 1], byClass(menu, "dt-pane-level__lower")[0], "Tab left a one-item menu")
  await keydown(menu, "Escape")
  assert.equal(byClass(root, "dt-pane-level__menu").length, 0)
  assert.equal(focused[focused.length - 1], levelIcon(root), "focus did not return to the level icon")
  hostInfo.value = { level: "read", chat: true, workspace: { id: "a1b2c3d4e5f60718", name: "Northwind" } }
  await flush()
  await click(levelIcon(root))
  menu = byClass(root, "dt-pane-level__menu")[0]
  assert.equal(menu.props["tabindex"], "-1")
  assert.equal(focused[focused.length - 1], menu, "at Read (no lower level) the menu itself is not focused")
})

test("the Admin shield keeps the warning colour on hover: its rule out-specifies the nav tool hover", async () => {
  const level = await srcOf("components/PaneLevel.vue")
  const nav = await srcOf("components/NavSidebar.vue")
  assert.match(nav, /:deep\(\.dt-nav-tool:hover:not\(:disabled\)\)/, "the nav hover rule this guards against changed")
  // scoped: `.dt-pane-level[data-level='admin']:hover:not(:disabled)[data-v-…]` is 0,5,0 against `[data-v-…] .dt-nav-tool:hover:not(:disabled)` at 0,4,0
  assert.match(
    level,
    /\.dt-pane-level\[data-level='admin'\]:hover:not\(:disabled\) \{|\.dt-pane-level\[data-level='admin'\]:hover:not\(:disabled\)[^{]*\{ color: var\(--dt-warning\); \}/
  )
  assert.match(level, /<style scoped>/)
})

// ---- the review of the pane branch (round 2) ------------------------------------------------------------------------

test('while the list loads the switcher says Loading…, and "no other workspace" only once the list has answered', async () => {
  let answer: (v: { status: number; body: unknown }) => void = () => {}
  const pending = new Promise<{ status: number; body: unknown }>(r => {
    answer = r
  })
  const realFetch = w.fetch
  const slow = async (url: string, init: RequestInit = {}) =>
    url === "/_dt/workspaces"
      ? pending.then(
          a =>
            new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } })
        )
      : realFetch(url, init)
  ;(globalThis as { fetch?: unknown }).fetch = slow
  w.fetch = slow
  try {
    const root = await mount()
    await click(byClass(root, "dt-pane-switch")[0])
    assert.deepEqual(
      byClass(root, "dt-pane-menu__hint").map(words),
      ["Loading…"],
      "the loading list says something else"
    )
    assert.equal(byClass(root, "dt-pane-switch__item").length, 0)
    answer({ status: 200, body: [{ id: "a1b2c3d4e5f60718", name: "Northwind", running: true, current: true }] })
    await flush()
    assert.deepEqual(byClass(root, "dt-pane-menu__hint").map(words), ["No other workspace was opened on this machine"])
  } finally {
    ;(globalThis as { fetch?: unknown }).fetch = realFetch
    w.fetch = realFetch
  }
})

test("a pick that stays on the page gives focus back to its button: a lower level, the current workspace", async () => {
  const root = await mount()
  await click(levelIcon(root))
  focused.length = 0
  await click(byClass(root, "dt-pane-level__lower")[0])
  assert.equal(byClass(root, "dt-pane-level__menu").length, 0)
  assert.equal(focused[focused.length - 1], levelIcon(root), "after a lower, focus is not on the level icon")
  const sw = byClass(root, "dt-pane-switch")[0]
  await click(sw)
  focused.length = 0
  await click(byClass(root, "dt-pane-switch__item")[0])
  assert.equal(byClass(root, "dt-pane-switch__menu").length, 0)
  assert.equal(focused[focused.length - 1], sw, "after picking the current workspace, focus is not on the name")
})
