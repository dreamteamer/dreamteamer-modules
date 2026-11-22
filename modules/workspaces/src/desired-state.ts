/** Configuration only. These types cannot represent credentials, applied grants or running processes. */
export type ProviderKind = "github" | "bitbucket"
export type DeploymentRole = "super-admin" | "ai-ops" | "end-user"
export type DesiredAccess = "read" | "write"
export interface Provider {
  name: string
  kind: ProviderKind
  host: string
}
export interface Organization {
  name: string
  provider: string
  provider_namespace: string
  management_repository: string
}
export interface Repository {
  name: string
  organization: string
  slug: string
  ref: string
  purpose: "configuration" | "content"
}
export interface User {
  name: string
  subject: string
}
export interface TemplateLineage {
  is_template: boolean
  template?: string
  template_revision?: string
}
export interface Workspace extends TemplateLineage {
  name: string
  organization: string
  repositories?: string[]
  configured?: boolean
}
export interface Operator {
  name: string
  organization: string
  user: string
  work_area?: string
  configured?: boolean
  business_roles?: string[]
  responsibilities?: string[]
  source_person?: string
}
export interface WorkArea extends TemplateLineage {
  name: string
  organization: string
  configuration_repository?: string
  configuration_revision?: string
  configured?: boolean
  workspaces?: string[]
  workspace_display: "list" | "grid"
  marketplace_policy: "disabled" | "allowlist"
  marketplace_allowlist?: string[]
}
/** Reserved vocabulary only. No secret identifiers, values, storage or resolution in v2. */
export type FutureSecretReferenceKind = "os-keychain" | "external-vault"
export interface Role {
  name: string
  organization: string
  user: string
  role: DeploymentRole
  configuration_repository: string
}
export interface Assignment {
  name: string
  organization: string
  operator: string
  workspace: string
  assigned_by: string
  desired_access: DesiredAccess
  state: "present" | "absent"
  revision: string
}
export interface Team {
  name: string
  organization: string
  operators?: string[]
  workspaces?: string[]
  source_record?: string
  read_workspaces?: string[]
  write_workspaces?: string[]
}
export interface DesiredState {
  teams?: Record<string, Team>
  providers: Record<string, Provider>
  organizations: Record<string, Organization>
  repositories: Record<string, Repository>
  users: Record<string, User>
  workspaces: Record<string, Workspace>
  operators: Record<string, Operator>
  "work-areas": Record<string, WorkArea>
  roles: Record<string, Role>
  assignments: Record<string, Assignment>
}
export const kinds = [
  "providers",
  "organizations",
  "repositories",
  "users",
  "workspaces",
  "roles",
  "operators",
  "teams",
  "business-roles",
  "responsibilities",
  "work-areas",
  "assignments",
] as const
const slug = /^[a-z0-9][a-z0-9-]*$/
const gitCommit = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) && !/^0+$/.test(value)
export type Kind = (typeof kinds)[number]
export type Records = Record<Kind, Record<string, Record<string, unknown>>>
export interface Field {
  type: string
  required?: boolean
  many?: boolean
  enum?: string[]
}
export type Schemas = Record<Kind, { fields: Record<string, Field>; storage: { suffix: string } }>

/** Fail closed on unknown fields, invalid references and cross-organization assignments. Never echoes field values. */
export function validate(records: Records, schemas: Schemas): string[] {
  const errors: string[] = []
  const roles = Object.values(records.roles)
  const operators = Object.values(records.operators)
  const lookup = (value: unknown, kind: Kind) => {
    if (typeof value !== "string" || !value.startsWith(`workspaces/${kind}/`)) return undefined
    const id = value.slice(`workspaces/${kind}/`.length)
    return Object.hasOwn(records[kind], id) ? records[kind][id] : undefined
  }
  for (const kind of kinds)
    for (const [id, row] of Object.entries(records[kind])) {
      const validId = slug.test(id)
      const label = validId ? `workspaces/${kind}/${id}` : `workspaces/${kind}/[invalid-id]`
      if (!validId) errors.push(`${kind}: invalid record id`)
      for (const key of Object.keys(row))
        if (key !== "created" && !Object.hasOwn(schemas[kind].fields, key)) errors.push(`${label}: unknown field`)
      if (
        row.created !== undefined &&
        (typeof row.created !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T/.test(row.created) ||
          !Number.isFinite(Date.parse(row.created)))
      )
        errors.push(`${label}: invalid created timestamp`)
      for (const [field, spec] of Object.entries(schemas[kind].fields)) {
        const value = row[field]
        if (value === undefined && !spec.required) continue
        if (spec.type === "boolean") {
          if (typeof value !== "boolean") errors.push(`${label}: ${field} must be a boolean`)
          continue
        }
        const values = spec.many ? value : [value]
        if (!Array.isArray(values) || values.length === 0 || values.some(v => typeof v !== "string" || !v.trim())) {
          errors.push(`${label}: ${field} must be ${spec.many ? "a nonempty string list" : "a nonempty string"}`)
          continue
        }
        if (spec.many && new Set(values).size !== values.length) errors.push(`${label}: duplicate ${field}`)
        if (spec.enum && values.some(v => !spec.enum!.includes(v))) errors.push(`${label}: invalid ${field}`)
        if (spec.type.startsWith("workspaces/")) {
          const target = spec.type.slice("workspaces/".length) as Kind
          for (const v of values) if (!lookup(v, target)) errors.push(`${label}: unresolved ${field}`)
        }
      }
      if (
        kind === "providers" &&
        (typeof row.host !== "string" || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(row.host))
      )
        errors.push(`${label}: host must be a bare hostname`)
      if (
        (kind === "repositories" || kind === "organizations") &&
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(row[kind === "repositories" ? "slug" : "provider_namespace"] ?? ""))
      )
        errors.push(`${label}: invalid provider slug`)
      if (kind === "workspaces") {
        if (row.configured !== false && (!Array.isArray(row.repositories) || row.repositories.length === 0))
          errors.push(`${label}: a configured workspace requires repositories`)
        if (row.configured === false && (row.is_template !== false || row.repositories !== undefined))
          errors.push(`${label}: an unconfigured workspace must be an instance without repository binding`)
      }
      if (kind === "workspaces" && Array.isArray(row.repositories))
        for (const ref of row.repositories) {
          const repo = lookup(ref, "repositories")
          if (repo && (repo.organization !== row.organization || repo.purpose !== "content"))
            errors.push(`${label}: content repository outside workspace scope`)
        }
      if (kind === "organizations") {
        const repo = lookup(row.management_repository, "repositories")
        if (repo && (repo.organization !== label || repo.purpose !== "configuration"))
          errors.push(`${label}: management repository outside organization scope`)
      }
      if (kind === "workspaces" || kind === "work-areas") {
        const template = lookup(row.template, kind)
        if ((row.template === undefined) !== (row.template_revision === undefined))
          errors.push(`${label}: template and template_revision must be set together`)
        if (row.template_revision !== undefined && !gitCommit(row.template_revision))
          errors.push(`${label}: template_revision must pin a full Git commit`)
        if (row.is_template === true && (row.template !== undefined || row.template_revision !== undefined))
          errors.push(`${label}: templates cannot have source lineage`)
        if (template && (template.organization !== row.organization || template.is_template !== true))
          errors.push(`${label}: source must be a same-organization template of the same type`)
      }
      if (kind === "roles") {
        const repo = lookup(row.configuration_repository, "repositories")
        const org = lookup(row.organization, "organizations")
        if (repo && (repo.organization !== row.organization || repo.purpose !== "configuration"))
          errors.push(`${label}: configuration repository outside role scope`)
        if (org && row.role === "ai-ops" && row.configuration_repository !== org.management_repository)
          errors.push(`${label}: AI Ops role must use the organization management repository`)
        if (row.role === "end-user") {
          const operator = operators.find(o => o.organization === row.organization && o.user === row.user)
          const area = lookup(operator?.work_area, "work-areas")
          if (
            !area ||
            operator?.configured === false ||
            area.configured === false ||
            area.configuration_repository !== row.configuration_repository
          )
            errors.push(`${label}: end-user role must use its operator Work Area configuration repository`)
        }
      }
      if (kind === "operators") {
        const area = lookup(row.work_area, "work-areas")
        if (area && (area.organization !== row.organization || area.is_template !== false))
          errors.push(`${label}: operator Work Area must be a same-organization instance`)
        for (const [refs, taxonomy] of [
          [row.business_roles, "business-roles"],
          [row.responsibilities, "responsibilities"],
        ] as const)
          if (Array.isArray(refs) && refs.some(ref => lookup(ref, taxonomy)?.organization !== row.organization))
            errors.push(`${label}: taxonomy reference must be in operator organization`)
        if (row.configured === false && area && area.configured !== false)
          errors.push(`${label}: unconfigured operator cannot bind a configured Work Area`)
        if (row.configured !== false && (!area || area.configured === false))
          errors.push(`${label}: configured operator requires a configured Work Area`)
        if (
          row.configured !== false &&
          !roles.some(r => r.user === row.user && r.organization === row.organization && r.role === "end-user")
        )
          errors.push(`${label}: operator requires same-organization end-user role`)
      }
      if (kind === "work-areas") {
        const repo = lookup(row.configuration_repository, "repositories")
        const org = lookup(row.organization, "organizations")
        if (
          row.is_template === true &&
          (row.configuration_repository !== undefined || row.configuration_revision !== undefined)
        )
          errors.push(`${label}: template cannot bind an operator configuration repository or revision`)
        if (row.configured === false) {
          if (
            row.is_template !== false ||
            row.configuration_repository !== undefined ||
            row.configuration_revision !== undefined
          )
            errors.push(`${label}: unconfigured Work Area must be an unpinned instance`)
          if (operators.filter(o => o.work_area === label && o.configured === false).length !== 1)
            errors.push(`${label}: unconfigured Work Area must belong to exactly one unconfigured operator`)
        }
        if (Array.isArray(row.workspaces))
          for (const ref of row.workspaces) {
            const target = lookup(ref, "workspaces")
            if (target && (target.organization !== row.organization || target.is_template !== false))
              errors.push(`${label}: workspace outside area scope`)
          }
        if (row.is_template === false && row.configured !== false) {
          if (
            !repo ||
            repo.organization !== row.organization ||
            repo.purpose !== "configuration" ||
            row.configuration_repository === org?.management_repository
          )
            errors.push(`${label}: instance requires a dedicated same-organization configuration repository`)
          if (!gitCommit(row.configuration_revision))
            errors.push(`${label}: instance configuration_revision must pin a full Git commit`)
          if (operators.filter(o => o.work_area === label).length !== 1)
            errors.push(`${label}: instance must belong to exactly one operator`)
        }
        if (row.marketplace_policy === "allowlist" && !Array.isArray(row.marketplace_allowlist))
          errors.push(`${label}: allowlist policy requires a marketplace allowlist`)
        if (row.marketplace_policy === "disabled" && row.marketplace_allowlist !== undefined)
          errors.push(`${label}: disabled marketplace cannot have an allowlist`)
        if (
          Array.isArray(row.marketplace_allowlist) &&
          row.marketplace_allowlist.some(v => typeof v !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(v))
        )
          errors.push(`${label}: invalid marketplace item identifier`)
      }
      if (kind === "teams") {
        const members = Array.isArray(row.operators) ? row.operators : []
        const layout = Array.isArray(row.workspaces) ? row.workspaces : []
        const read = Array.isArray(row.read_workspaces) ? row.read_workspaces : []
        const write = Array.isArray(row.write_workspaces) ? row.write_workspaces : []
        if (
          members.some(ref => {
            const member = lookup(ref, "operators")
            return member && member.organization !== row.organization
          })
        )
          errors.push(`${label}: operator outside team organization`)
        if (
          [...layout, ...read, ...write].some(ref => {
            const workspace = lookup(ref, "workspaces")
            return workspace && (workspace.organization !== row.organization || workspace.is_template !== false)
          })
        )
          errors.push(`${label}: access target or layout must be a same-organization workspace instance`)
        if ([...read, ...write].some(ref => lookup(ref, "workspaces")?.configured === false))
          errors.push(`${label}: an unconfigured workspace cannot carry a team access policy`)
        if (read.some(ref => write.includes(ref))) errors.push(`${label}: set only one permission for each workspace`)
      }
      if (kind === "assignments") {
        const workspace = lookup(row.workspace, "workspaces")
        const operator = lookup(row.operator, "operators")
        const author = lookup(row.assigned_by, "roles")
        if (workspace?.configured === false)
          errors.push(`${label}: an unconfigured workspace cannot have an access assignment`)
        if (workspace && (workspace.organization !== row.organization || workspace.is_template !== false))
          errors.push(`${label}: assignment requires a same-organization workspace instance`)
        if (operator?.configured === false)
          errors.push(`${label}: unconfigured operator cannot have an access assignment`)
        if (operator && operator.organization !== row.organization)
          errors.push(`${label}: workspace operator outside assignment scope`)
        if (author && (author.organization !== row.organization || author.role !== "ai-ops"))
          errors.push(`${label}: assignment requires same-organization AI Ops role`)
      }
    }
  const unique = (kind: Kind, keyOf: (row: Record<string, unknown>) => unknown) => {
    const seen = new Set<string>()
    for (const row of Object.values(records[kind])) {
      const key = keyOf(row)
      if (key === undefined) continue
      const encoded = JSON.stringify(key)
      if (seen.has(encoded)) errors.push(`${kind}: duplicate scoped relationship`)
      seen.add(encoded)
    }
  }
  unique("roles", r => [r.organization, r.user, r.role])
  unique("operators", r => [r.organization, r.user])
  unique("assignments", r => [r.organization, r.operator, r.workspace])
  unique("work-areas", r => r.configuration_repository)
  return errors
}

export {
  deriveOperatorInventory,
  splitTemplates,
  compareProviderGrants,
  type ProviderObservation,
  type GrantDrift,
} from "./projection.ts"
