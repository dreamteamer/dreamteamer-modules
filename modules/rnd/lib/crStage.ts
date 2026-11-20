// The change-request stage — `rnd/change-requests.stage`, the gate a request waits on — and the rule that
// keeps it honest. Two readings of a request, both from its own record:
//
//   the gate      which of rnd's change-request command bindings is AVAILABLE on it — the verb `dt next`
//                 names. Read through the engine's own evaluation (`dt.commandsFor`), never restated here,
//                 so a binding edited or overridden by id is followed. Status decides `done` and
//                 `rejected`; two gates open (a request sent back) → the earlier; none → no opinion.
//   the record    a table of facts — status, accepted_on, tested_on, verified_on, deployed_on, the linked
//                 design and plan — each excluding a range of stages. It answers where the gates do not.
//
// `dt check` WARNS (never a violation: the day a workspace upgrades every request has an empty stage) at
// most once per request: a stage that is not the open gate, else one the record contradicts, else an
// empty one.
// On an engine without the warning channel or without `commandsFor` the rule says nothing.
import path from "node:path"
import type { ExtensionContext } from "dreamteamer"
import type { Warning } from "./checkStageTags.ts"

type Store = InstanceType<ExtensionContext["dt"]["Store"]>

export const COLLECTION = "rnd/change-requests"

export const STAGES = [
  "design",
  "design-review",
  "acceptance",
  "plan",
  "plan-review",
  "implement",
  "code-review",
  "test",
  "test-review",
  "deploy",
  "live-check",
  "done",
  "rejected",
]

/** rnd's change-request bindings (ids without `command-bindings/`) → the stage their being open means. */
export const GATES: Record<string, string> = {
  "rnd--design--change-requests": "design",
  "rnd--review--change-requests--design": "design-review",
  "rnd--review--change-requests": "acceptance",
  "rnd--plan--change-requests": "plan",
  "rnd--review--change-requests--plan": "plan-review",
  "rnd--implement--change-requests": "implement",
  "rnd--review--change-requests--code": "code-review",
  "rnd--test--change-requests": "test",
  "rnd--review--change-requests--test": "test-review",
  "rnd--deploy--change-requests": "deploy",
  "rnd--release--change-requests": "deploy",
  "rnd--review--change-requests--deploy": "live-check",
}

const at = (s: string) => STAGES.indexOf(s)
const within = (s: string, from: string, to: string) => at(s) >= at(from) && at(s) <= at(to)
const set = (v: unknown) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)

/** The verb a binding id stands for, as a person reads it: `/rnd:plan`, `/rnd:review (code)`. */
export function gateCommand(binding: string | null | undefined): string {
  const m = /^rnd--([a-z]+)--change-requests(?:--([a-z]+))?$/.exec(binding ?? "")
  if (!m) return binding ?? ""
  const [, verb, which] = m
  if (verb !== "review") return `/rnd:${verb}`
  return `/rnd:review (${which ?? "acceptance"})`
}

/** The earliest open gate in GATES, or null; `implemented` and `rejected` decide by status. */
export function expectedGate({ status, available = [] }: { status?: unknown; available?: string[] }): string | null {
  if (status === "implemented" || status === "rejected") return null
  let best = null
  for (const b of available) if (GATES[b] && (best === null || at(GATES[b]) < at(GATES[best]))) best = b
  return best
}

export function expectedStage({ status, available = [] }: { status?: unknown; available?: string[] }): string | null {
  if (status === "implemented") return "done"
  if (status === "rejected") return "rejected"
  const g = expectedGate({ status, available })
  return g ? GATES[g] : null
}

/** What the request's own record says against `stage` — one message per broken row, in table order. */
export function stageContradictions(f: Record<string, any> = {}, stage: string): string[] {
  const out = []
  const s = stage
  const st = f.status ?? "(empty)"
  if (f.status === "implemented" && s !== "done") out.push(`status is implemented — the stage is done`)
  if (s === "done" && f.status !== "implemented") out.push(`done needs status implemented (status is ${st})`)
  if (f.status === "rejected" && s !== "rejected") out.push(`status is rejected — the stage is rejected`)
  if (s === "rejected" && f.status !== "rejected") out.push(`rejected needs status rejected (status is ${st})`)
  if (f.status === "suggested" && within(s, "plan", "live-check"))
    out.push(`status is suggested — ${s} comes after acceptance`)
  if (s === "acceptance" && f.status !== "suggested") out.push(`acceptance needs status suggested (status is ${st})`)
  if (set(f.accepted_on) && s === "acceptance") out.push(`accepted_on is set — the request is past acceptance`)
  if (!set(f.accepted_on) && within(s, "plan", "live-check"))
    out.push(`accepted_on is empty — ${s} comes after acceptance`)
  if (set(f.tested_on) && within(s, "design", "test")) out.push(`tested_on is set — ${s} comes before the test review`)
  if (!set(f.tested_on) && s === "test-review") out.push(`tested_on is empty — the test review needs it`)
  if (set(f.verified_on) && within(s, "design", "test-review"))
    out.push(`verified_on is set — ${s} comes before deploy`)
  if (!set(f.verified_on) && within(s, "deploy", "live-check")) out.push(`verified_on is empty — ${s} needs it`)
  if (set(f.deployed_on) && within(s, "design", "code-review"))
    out.push(`deployed_on is set — ${s} comes before the test`)
  if (!set(f.deployed_on) && s === "live-check") out.push(`deployed_on is empty — the live check needs it`)
  if (set(f.design_docs) && s === "design") out.push(`design_docs is set — the request is designed`)
  if (!set(f.design_docs) && (s === "design-review" || s === "acceptance"))
    out.push(`design_docs is empty — ${s} needs a design`)
  if (set(f.implementation_plans) && within(s, "design", "plan"))
    out.push(`implementation_plans is set — the request is planned`)
  if (!set(f.implementation_plans) && within(s, "plan-review", "live-check"))
    out.push(`implementation_plans is empty — ${s} needs a plan`)
  return out
}

/** The stages the request's own record does not contradict. */
export function allowedStages(f: Record<string, any>): string[] {
  return STAGES.filter(s => stageContradictions(f, s).length === 0)
}

/** The warnings for rows `{ id, file, stage, expected, gate, fields }` — pure; at most one per row. */
/** One change request as stageWarnings reads it. */
export interface RequestRow {
  id: string
  file: string
  fields: Record<string, any>
  stage?: unknown
  available?: string[]
  gate?: string | null
  expected?: string | null
}

export function stageWarnings(rows: RequestRow[]): Warning[] {
  const out: Warning[] = []
  const warn = (file: string, message: string) => out.push({ file, message, warning: true })
  for (const r of rows) {
    const stage = set(r.stage) ? String(r.stage) : null
    if (stage && r.expected && stage !== r.expected) {
      warn(
        r.file,
        `stage is ${stage} but the record is at ${r.expected} — dt next names ${gateCommand(r.gate) || r.expected}; set stage=${r.expected}`
      )
      continue
    }
    if (stage) {
      const [why] = stageContradictions(r.fields, stage)
      if (why)
        warn(
          r.file,
          `stage is ${stage} but ${why} — the record allows ${allowedStages(r.fields).join(" · ") || "no stage"}; set stage to one of them`
        )
      continue
    }
    if (r.expected) {
      const says = r.gate ? `dt next names ${gateCommand(r.gate)}` : `status is ${r.fields?.status}`
      warn(
        r.file,
        `stage is empty; the record is at ${r.expected} (${says}) — run migrate-change-request-stage, or set stage=${r.expected}`
      )
    } else {
      warn(
        r.file,
        `stage is empty and no gate is open — the record allows ${allowedStages(r.fields).join(" · ") || "no stage"}; set stage by hand`
      )
    }
  }
  return out
}

/** Does this workspace compile `rnd/change-requests` with a `stage` field? */
export function compilesStage(store: Store): boolean {
  try {
    return Boolean((store.descriptor(COLLECTION) as { fields?: Record<string, unknown> })?.fields?.stage)
  } catch {
    return false
  }
}

/** Every change request the store reads, with its expected stage and open gate — one `commandsFor` call. */
export function readRequests(store: Store, dt: ExtensionContext["dt"]): RequestRow[] {
  const rows = [...store.readAll(COLLECTION)]
  const ids = rows.map(r => r.id)
  const res = dt.commandsFor(store, COLLECTION, ids)
  const out: RequestRow[] = []
  for (const { id, file, fields } of rows) {
    const available: string[] = []
    for (const c of res.commands ?? [])
      if (c.states?.[id] === "available") available.push(String(c.binding).replace(/^command-bindings\//, ""))
    const gate = expectedGate({ status: fields.status, available })
    out.push({
      id,
      file,
      fields,
      stage: fields.stage,
      available,
      gate,
      expected: expectedStage({ status: fields.status, available }),
    })
  }
  return out
}

/** The extension's `check`: the warnings for every change request this workspace reads, files named
 *  relative to the root. Nothing on an engine without the warning channel or `commandsFor`, or on a
 *  workspace whose compiled descriptor has no `stage`. */
export function checkChangeRequestStage({ ws, dt }: Pick<ExtensionContext, "ws" | "dt">) {
  if (dt?.CHECK_WARNINGS !== true || typeof dt?.commandsFor !== "function") return []
  const store = new dt.Store(ws)
  if (!store.descriptors?.has?.(COLLECTION) || !compilesStage(store)) return []
  const rows = readRequests(store, dt).map(r => ({
    ...r,
    file: path.relative(ws.root, r.file).split(path.sep).join("/"),
  }))
  return stageWarnings(rows)
}
