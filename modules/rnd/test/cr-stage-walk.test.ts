// THE WALK — a change request moved from filed to done by the lifecycle, each step run with the command
// line its skill spells (extracted from the skill text, so a skill edit that breaks the walk breaks this
// test), and after every step the request shows the right column and `dt check` has no stage line. Then
// the send-back.
import { test, describe, after } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { rndWorkspace, put, run, cleanupAll } from "./helpers/rnd-workspace.ts"
import { seedStates, settleAll, T } from "./helpers/cr-stage-fixtures.ts"

after(() => cleanupAll())

const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const { GATES, STAGES } = await import(path.join(RND, "lib", "crStage.ts"))
const skill = s => fs.readFileSync(path.join(RND, "skills", s, "SKILL.md"), "utf8")

/** The backticked `dt set rnd/change-requests/<…> …` command in a skill that contains `has`. */
function line(s, has) {
  const all = [...skill(s).matchAll(/`(dt set rnd\/change-requests\/<(?:id|cr)> [^`]*)`/g)].map(m => m[1])
  const found = all.filter(c => c.includes(has))
  assert.equal(found.length >= 1, true, `${s} spells a dt set with ${has}:\n${all.join("\n")}`)
  return found[0]
}
const fields = (root, id, w = []) => {
  const r = run(root, ["get", `rnd/change-requests/${id}`, "--json", ...w])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  return JSON.parse(r.stdout)
}
/** Run a skill's line on a request: placeholders filled, `<each existing>` expanded from the record. */
function apply(root, id, cmd, { w = [], runner = run } = {}) {
  const f = fields(root, id, w)
  const existing = (f.tags ?? []).filter(t => !new RegExp(`tags=${t}\\b`).test(cmd.replace("tags=<each existing>", "")))
  let c = cmd
    .replace(/^dt set rnd\/change-requests\/<(?:id|cr)> /, "")
    .replace("tags=<each existing>", existing.map(t => `tags=${t}`).join(" "))
    .replaceAll("<now>", T)
    .replaceAll("<published_on>", T)
    .replaceAll("<you>", "agents/qa-manager")
  const args = c.split(/\s+/).filter(Boolean)
  const r = runner(root, ["set", `rnd/change-requests/${id}`, ...args, ...w])
  assert.equal(r.status, 0, `${c}\n${r.stderr}${r.stdout}`)
  return args
}
const stageOf = (root, id, w = []) => fields(root, id, w).stage
const stageLines = out => out.split("\n").filter(l => /— stage /.test(l))
function clean(root, label) {
  const r = run(root, ["check"])
  assert.equal(r.status, 0, `${label}: ${r.stdout}${r.stderr}`)
  assert.deepEqual(stageLines(r.stdout), [], `${label}: stage warnings`)
}
/** The send-back: dt next --json, the available bindings mapped through the table, the earliest written. */
function sendBack(root, id) {
  const r = run(root, ["next", `rnd/change-requests/${id}`, "--json"])
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  const avail = (j.commands ?? j)
    .filter(c => c.states?.[id] === "available")
    .map(c => String(c.binding).replace(/^command-bindings\//, ""))
  const stages = avail
    .map(b => GATES[b])
    .filter(Boolean)
    .sort((a, b) => STAGES.indexOf(a) - STAGES.indexOf(b))
  assert.ok(stages.length, `a gate is open: ${avail}`)
  assert.equal(run(root, ["set", `rnd/change-requests/${id}`, `stage=${stages[0]}`]).status, 0)
  return stages[0]
}

describe("a request walked by the lifecycle, design to done", () => {
  test("every step writes the column, and dt check stays clean", () => {
    const root = rndWorkspace()
    put(root, "data/rnd/products/p.product.md", "---\nname: P\n---\n")
    const id = "cr-walk"
    const ok = (want, label) => {
      assert.equal(stageOf(root, id), want, label)
      clean(root, label)
    }

    // filed — rnd-change-request's --stage, into the workspace's own root
    assert.match(skill("rnd-change-request"), /--stage design/)
    assert.equal(
      run(root, [
        "add",
        "rnd/change-requests",
        "--key",
        id,
        "--name",
        "walk",
        "--products",
        "rnd/products/p",
        "--acceptance",
        "a person sees it",
        "--stage",
        "design",
      ]).status,
      0
    )
    ok("design", "filed")

    // designed — the doc linked, then rnd-design's line
    put(root, "data/rnd/design-docs/2026-01-01--walk.design-doc.md", "---\nname: walk\nstatus: draft\n---\n")
    assert.equal(
      run(root, ["set", `rnd/change-requests/${id}`, "design_docs=rnd/design-docs/2026-01-01--walk"]).status,
      0
    )
    apply(root, id, line("rnd-design", "stage=design-review"))
    ok("design-review", "designed")

    // the design approved — the doc active, then the request's stage (still suggested)
    assert.equal(run(root, ["set", "rnd/design-docs/2026-01-01--walk", "status=active"]).status, 0)
    apply(root, id, line("recording-reviews", "stage=acceptance"))
    ok("acceptance", "design approved")

    // the acceptance approved
    apply(root, id, line("recording-reviews", "status=accepted"))
    ok("plan", "accepted")

    // planned — the plan written, then rnd-plan's line
    const plan = JSON.parse(
      run(root, [
        "add",
        "rnd/implementation-plans",
        "--name",
        "walk plan",
        "--change_request",
        `rnd/change-requests/${id}`,
        "--status",
        "draft",
        "--json",
      ]).stdout || "{}"
    )
    const planRef = `rnd/implementation-plans/${plan.id ?? fs.readdirSync(path.join(root, "data/rnd/implementation-plans"))[0].replace(".implementation-plan.md", "")}`
    apply(root, id, line("rnd-plan", "stage=plan-review"))
    ok("plan-review", "planned")

    // the plan approved
    assert.equal(run(root, ["set", planRef, "status=approved"]).status, 0)
    apply(root, id, line("recording-reviews", "stage=implement"))
    ok("implement", "plan approved")

    // built — the plan done, then rnd-implement's line
    assert.equal(run(root, ["set", planRef, "status=done"]).status, 0)
    apply(root, id, line("rnd-implement", "stage=code-review"))
    ok("code-review", "built")

    // the code approved — code_approved_on on the plan, then the request
    assert.equal(run(root, ["set", planRef, `code_approved_on=${T}`]).status, 0)
    apply(root, id, line("recording-reviews", "stage=test"))
    ok("test", "code approved")

    // tested — a passing test, then rnd-test's line
    assert.equal(
      run(root, [
        "add",
        "rnd/tests",
        "--key",
        "walk-t1",
        "--name",
        "proves it",
        "--covers",
        `rnd/change-requests/${id}`,
        "--kind",
        "e2e",
        "--status",
        "passing",
      ]).status,
      0
    )
    apply(root, id, line("rnd-test", "stage=test-review"))
    ok("test-review", "tested")

    // verified
    apply(root, id, line("recording-reviews", "stage=deploy"))
    ok("deploy", "verified")

    // deployed — rnd-deploy's line
    apply(root, id, line("rnd-deploy", "stage=live-check"))
    ok("live-check", "deployed")

    // sent back after deploy: verified_on cleared — the send-back writes the earliest open gate
    assert.equal(run(root, ["set", `rnd/change-requests/${id}`, "verified_on="]).status, 0)
    assert.equal(sendBack(root, id), "test-review")
    ok("test-review", "sent back")
    // verified again, already deployed → live-check
    assert.match(skill("recording-reviews"), /`stage=live-check` when `deployed_on` is already set/)
    assert.equal(run(root, ["set", `rnd/change-requests/${id}`, `verified_on=${T}`, "stage=live-check"]).status, 0)
    ok("live-check", "re-verified")

    // live — the live acceptance review
    apply(root, id, line("recording-reviews", "stage=done"))
    ok("done", "live")
  })
})
