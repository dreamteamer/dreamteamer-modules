/**
 * `stage-checks` — a `many` tags field whose collection declared its stages (`viewer_options.stages`, read by
 * `lib/stage-checks.ts`). One slot per stage, in declared order and of one width, so the stages line up down a
 * column: empty while the stage is not tagged, one check when it is, two once a review of it exists — green when
 * it approves with no open finding, orange when it left remarks; the review's words are the hover and the slot's
 * accessible name. Tags that are not a stage follow as chips.
 *
 * It needs the ROW to place a review (`record`); without one it draws tag-only and asks the host nothing. The
 * reviews come through `lib/stage-reviews.ts` — one batched request per list, re-read on every invalidation.
 */
import { useEffect, useState } from "react"
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import {
  bareRef,
  candidateSubjects,
  freeTags,
  stageCheck,
  stageChecksSpec,
  type Review,
  type StageCheck,
} from "../lib/stage-checks.ts"
import { openFindingsFor, reviewsFor } from "../lib/stage-reviews.ts"
import type { ViewProps } from "../registry/props.ts"
import { chip, cx, subtle } from "../styles/classes.ts"

/** A check's colour by its state: approved green, approved with remarks orange, else quiet. */
const CHECK: Record<string, string> = { approved: "text-chart-green", remarks: "text-chart-orange" }

const MAX_CHIPS = 3

export function ViewStageChecks({ field, value, options, record }: ViewProps) {
  const { version } = useApp()
  const spec = stageChecksSpec(options ?? field.viewer_options)
  const id = record?.["id"]
  const self =
    record && field.collection && id !== null && id !== undefined && id !== ""
      ? `${field.collection}/${bareRef(String(id))}`
      : null
  const [reviews, setReviews] = useState<Review[]>([])
  const [findings, setFindings] = useState(new Map<string, number>())
  const [unread, setUnread] = useState(false)

  const tagged = !!spec?.stages.some(st => Array.isArray(value) && value.includes(st.tag))
  const key = JSON.stringify([value, self, spec?.reviewsFrom, spec?.findingsFrom, version])
  useEffect(() => {
    if (!spec || !spec.reviewsFrom || !record || !self || !tagged) {
      setReviews([])
      setFindings(new Map())
      return
    }
    let live = true
    const from = spec.reviewsFrom
    void (async () => {
      try {
        const found = await reviewsFor(from, candidateSubjects(spec, record, self), version)
        const counts = spec.findingsFrom
          ? await openFindingsFor(
              spec.findingsFrom,
              from,
              found.map(r => r.id),
              version
            )
          : new Map<string, number>()
        if (!live) return
        setReviews(found)
        setFindings(counts)
        setUnread(false)
      } catch {
        if (!live) return
        setReviews([])
        setFindings(new Map())
        setUnread(true)
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` carries every input
  }, [key])

  if (!spec) return null
  const readable = !!spec.reviewsFrom && !unread
  const checks: StageCheck[] = spec.stages.map(st => {
    const c = stageCheck(st, value, readable ? (record ?? null) : null, readable ? self : null, reviews, findings)
    return unread && c.state !== "none" ? { ...c, label: `${st.title} — tagged (reviews could not be read)` } : c
  })
  const chips = freeTags(value, spec)
  const icon = (c: StageCheck) => (c.state === "none" ? undefined : c.state === "done" ? "check" : "check-all")

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {checks.map(c => (
        <span
          key={c.stage.tag}
          className={cx("inline-flex justify-center w-4", CHECK[c.state] ?? "text-fg-subtle")}
          data-stage={c.stage.tag}
          data-state={c.state}
          role={c.state === "none" ? undefined : "img"}
          title={c.label || undefined}
          aria-label={c.label || undefined}
          aria-hidden={c.state === "none" ? true : undefined}
        >
          <Icon name={icon(c)} />
        </span>
      ))}
      {chips.slice(0, MAX_CHIPS).map(tag => (
        <span key={tag} className={chip}>
          {tag}
        </span>
      ))}
      {chips.length > MAX_CHIPS && <span className={subtle}>+{chips.length - MAX_CHIPS}</span>}
    </span>
  )
}
