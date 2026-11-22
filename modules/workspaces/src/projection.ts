import type { DesiredAccess, DesiredState, TemplateLineage } from "./desired-state.ts"

function lookup<T>(ref: string, kind: string, rows: Record<string, T>): T | undefined {
  const prefix = `workspaces/${kind}/`
  if (!ref.startsWith(prefix)) return undefined
  const id = ref.slice(prefix.length)
  return Object.hasOwn(rows, id) ? rows[id] : undefined
}

export function splitTemplates<T extends TemplateLineage>(rows: Record<string, T>) {
  return {
    templates: Object.entries(rows).filter(([, row]) => row.is_template === true),
    instances: Object.entries(rows).filter(([, row]) => row.is_template === false),
  }
}

/** Derived from validated desired state; never treat returned rows as provider access or identity. */
export function deriveOperatorInventory(state: DesiredState, organization: string, operatorId: string) {
  const operatorRef = `workspaces/operators/${operatorId}`
  const operator = lookup(operatorRef, "operators", state.operators)
  if (!operator || operator.organization !== organization || operator.configured === false) return []
  return Object.values(state.assignments)
    .filter(row => {
      if (row.organization !== organization || row.operator !== operatorRef || row.state !== "present") return false
      const target = lookup(row.workspace, "workspaces", state.workspaces)
      return target?.organization === organization && target.is_template === false && target.configured !== false
    })
    .map(({ workspace, desired_access }) => ({ workspace, desired_access }))
    .sort((a, b) => a.workspace.localeCompare(b.workspace))
}

export type Grant = DesiredAccess | "none"
export type ProviderObservation = {
  organization: string
  operator: string
  repository: string
  observed_at: string
  grant: Grant | "unknown"
}
export type GrantDrift = {
  operator: string
  repository: string
  desired: Grant
  observed: ProviderObservation["grant"]
  observed_at?: string
  status: "matches" | "drift" | "unknown" | "stale" | "conflict"
}

/** Pure comparison of validated desired state with separately supplied, untrusted samples. Never applies grants.
 * Out-of-scope samples are ignored. Unmanaged repositories are not presumed revoked.
 */
export function compareProviderGrants(
  state: DesiredState,
  organization: string,
  observations: readonly ProviderObservation[],
  now: number,
  maxAgeMs: number
): GrantDrift[] {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new Error("Invalid freshness window")
  const keyOf = (operator: string, repository: string) => JSON.stringify([operator, repository])
  const wanted = new Map<string, Pick<GrantDrift, "operator" | "repository" | "desired">>()
  for (const row of Object.values(state.assignments)) {
    const operator = lookup(row.operator, "operators", state.operators)
    if (row.organization !== organization || operator?.organization !== organization || operator.configured === false)
      continue
    const workspace = lookup(row.workspace, "workspaces", state.workspaces)
    if (
      !workspace ||
      workspace.organization !== organization ||
      workspace.is_template !== false ||
      workspace.configured === false
    )
      continue
    for (const repository of workspace.repositories ?? []) {
      const repo = lookup(repository, "repositories", state.repositories)
      if (repo?.organization !== organization || repo.purpose !== "content") continue
      const key = keyOf(row.operator, repository)
      const grant = row.state === "present" ? row.desired_access : "none"
      const previous = wanted.get(key)
      if (!previous || grant === "write" || (grant === "read" && previous.desired === "none"))
        wanted.set(key, { operator: row.operator, repository, desired: grant })
    }
  }
  const latest = new Map<string, { sample: ProviderObservation; time: number; conflict: boolean }>()
  for (const sample of observations) {
    if (!sample || sample.organization !== organization || typeof sample.observed_at !== "string") continue
    const key = keyOf(sample.operator, sample.repository)
    const time = Date.parse(sample.observed_at)
    if (
      !wanted.has(key) ||
      !/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(sample.observed_at) ||
      !Number.isFinite(time) ||
      time > now ||
      !["read", "write", "none", "unknown"].includes(sample.grant)
    )
      continue
    const previous = latest.get(key)
    if (!previous || time > previous.time) latest.set(key, { sample, time, conflict: false })
    else if (time === previous.time && sample.grant !== previous.sample.grant) previous.conflict = true
  }
  return [...wanted]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, row]): GrantDrift => {
      const data = latest.get(key)
      if (!data) return { ...row, observed: "unknown", status: "unknown" }
      const status = data.conflict
        ? "conflict"
        : now - data.time > maxAgeMs
          ? "stale"
          : data.sample.grant === "unknown"
            ? "unknown"
            : data.sample.grant === row.desired
              ? "matches"
              : "drift"
      return {
        ...row,
        observed: data.conflict ? "unknown" : data.sample.grant,
        observed_at: data.sample.observed_at,
        status,
      }
    })
}
