import { ApiFailure } from "../api.ts"

export function revisionParam(value: unknown): string {
  const v = typeof value === "string" ? value : ""
  if (v === "HEAD" || /^[0-9a-f]{4,40}$/.test(v)) return v
  throw new ApiFailure(
    `${JSON.stringify(String(value ?? "")).slice(0, 60)} is not a commit id — a revision is HEAD or a commit id of 4 to 40 hex characters; nothing was run`,
    400
  )
}
