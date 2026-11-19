// The contract runner: every case against ONE host, in order, on one fixture (writes accumulate, so the
// order in cases.js is part of the contract). A host is a function `request(method, path, body)` that
// resolves `{ status, body }` — the extension's in-process handler, or an HTTP client of dt serve.
import { cases, type ContractContext } from "./cases.ts"
import type { Fixture } from "./fixture.ts"
import type { HostRequest } from "./shape.ts"

export type { Case, ContractContext } from "./cases.ts"
export type { Fixture } from "./fixture.ts"
export type { HostRequest, HostResponse } from "./shape.ts"

export async function runContract({
  request,
  fixture,
  only,
}: {
  request: HostRequest
  fixture: Fixture
  only?: string[]
}): Promise<{ passed: string[]; failed: Array<{ id: string; why: string }>; skipped: string[] }> {
  const passed: string[] = []
  const failed: Array<{ id: string; why: string }> = []
  const skipped: string[] = []
  const ctx: ContractContext = { fixture, request, state: {} }
  for (const c of cases) {
    if (only && !only.includes(c.id)) continue
    try {
      const snap = c.before ? await c.before(ctx) : undefined
      const path = typeof c.path === "function" ? c.path(ctx) : c.path
      const body = typeof c.body === "function" ? c.body(ctx) : c.body
      const res = await request(c.method, path, body)
      // an optional route a host does not serve is skipped; one it serves must answer to its shape
      if (c.optional && res?.status === 404) {
        skipped.push(c.id)
        continue
      }
      await c.expect(res, ctx, snap)
      passed.push(c.id)
    } catch (e) {
      failed.push({ id: c.id, why: String(e?.message ?? e).split("\n")[0] })
    }
  }
  return { passed, failed, skipped }
}

export { cases }
