/**
 * THE RECORD PAGE'S HEADER — three bands, each one idea (ported from the Vue ui's PageHeader.vue and
 * RecordHeaderDisplay.vue):
 *
 *   row 1   tasks / 2026 / 07 / kickoff                       ↻   where you are: the collection, then the id's path
 *   row 2   ⬤ Kickoff with Northwind      [dup]     actions      what this is, and what you can do to it
 *   ─────
 *           DO  Dana Oren   fixture: Northwind   2 hours ago   ● lab · uncommitted
 *
 * The third band is a footnote about the file: the last commit touching it, then where the record is READ FROM
 * and its repo state (`lib/recordOrigin.ts`) — the one place a record page says its source; a read-only root
 * says why there, and a stub says what it shadows. Under it, the collection's `display.record` line: the
 * `subtitle` template (a reference in it reads as the target's title), the `badge` field as chips decorated by
 * their enum choice, and the `color_by` tint as a rail — nothing at all for a collection that asks for none.
 */
import type { CSSProperties, ReactNode } from "react"
import type { CollectionRow, FieldRow, SourceEntry } from "../api/types.ts"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { SourceMark, StubNote } from "../components/SourceMark.tsx"
import { badgeChips, themeColor, tintOf, tintStyle } from "../lib/collection-display.ts"
import { initialsOf } from "../lib/initialsOf.ts"
import { originClassWord, type RecordOrigin } from "../lib/recordOrigin.ts"
import type { CommitInfo, Crumb } from "../lib/record-page.ts"
import { relativeTime } from "../lib/relativeTime.ts"
import { cx, iconButton, subtle, toolbar } from "../styles/classes.ts"

// ---- the header's bands: fixed at the top of the page while the body scrolls under them ----
const header = "flex-[0_0_auto] border-b border-border"
const navRow = "flex items-center gap-2 pt-2 px-6 pb-0 text-small"
const titleRow = "flex items-center justify-between gap-4 flex-wrap pt-1.5 px-6 pb-2.5"
const titleBox = "flex items-center gap-2.5 min-w-0"
const titleText = "m-0 text-[20px] truncate"
const titleIcon =
  "inline-flex items-center justify-center w-7 h-7 flex-[0_0_auto] rounded-dt bg-bg-subtle text-fg-subtle"
const commitRow = "flex items-center gap-2 py-1.5 px-6 border-t border-border text-small min-w-0"
/** A person's initials in a round chip. (was dt-avatar) */
export const avatar =
  "inline-flex items-center justify-center w-5 h-5 rounded-full bg-bg-active text-[9px] font-semibold"
const commitMessage = "flex-1 min-w-0 truncate"
const originBox = "inline-flex items-center gap-1.5 flex-wrap"
const warm = "text-chart-orange"

// ---- the display line under the header ----
const displayLine = "flex items-center flex-wrap gap-2 py-1.5 px-6 border-l-[3px] text-fg-subtle"
const displayTinted = "border-l-(--dt-tint) bg-[color-mix(in_srgb,var(--dt-tint-bg)_8%,transparent)]"
const badgeChip = "inline-flex items-center gap-1 h-5 px-2 rounded-full border text-small whitespace-nowrap"
const badgePlain = "border-border text-fg"
const badgeColored = "border-[color-mix(in_srgb,var(--dt-chip-color)_45%,transparent)] text-(--dt-chip-color)"
const badgeFilled = "bg-[color-mix(in_srgb,var(--dt-chip-bg)_15%,transparent)]"

export type HeaderOrigin = RecordOrigin & {
  record?: string | null
  access?: SourceEntry["access"]
  via?: SourceEntry["via"]
  note?: string
  stub?: { stubs: string[]; self: boolean; winner: string | null } | null
  stubSources?: readonly SourceEntry[]
}

export function RecordHeader({
  icon,
  title,
  crumbs,
  commit,
  origin,
  badge,
  actions,
  onRefresh,
}: {
  icon?: string
  title: string
  crumbs: Crumb[]
  commit: CommitInfo | null
  origin: HeaderOrigin | null
  /** Beside the title — the duplicate-id badge. */
  badge?: ReactNode
  actions?: ReactNode
  onRefresh?: () => void
}) {
  const when = commit ? new Date(commit.date) : null
  const whenText = commit ? (when && !Number.isNaN(when.getTime()) ? relativeTime(when) : commit.date) : ""
  const classWord = origin ? originClassWord(origin.kind, origin.via) : ""
  return (
    <header className={header}>
      <div className={navRow}>
        <nav className="flex-1 min-w-0 truncate" aria-label="Path">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && (
                <span className={subtle} aria-hidden="true">
                  {" / "}
                </span>
              )}
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
        {onRefresh && (
          <button type="button" className={iconButton} title="Refresh" onClick={onRefresh}>
            <Icon name="refresh" />
          </button>
        )}
      </div>
      <div className={titleRow}>
        <div className={titleBox}>
          <span className={titleIcon}>
            <Icon name={icon || "file"} />
          </span>
          <h1 className={titleText} title={title}>
            {title}
          </h1>
          {badge}
        </div>
        <div className={toolbar}>{actions}</div>
      </div>
      {(commit || origin) && (
        <div className={commitRow}>
          {commit ? (
            <>
              <span className={avatar} title={commit.author}>
                {initialsOf(commit.author)}
              </span>
              <span>{commit.author}</span>
              <span className={cx(commitMessage, subtle)} title={commit.message}>
                {commit.message}
              </span>
              <span className={subtle} title={commit.date}>
                {whenText}
              </span>
            </>
          ) : (
            <span className={cx(commitMessage, subtle)}>{origin?.inRepo ? "no commit holds this record yet" : ""}</span>
          )}
          {origin && (
            <span className={originBox} title={origin.tooltip} data-origin-kind={origin.kind}>
              {origin.name && (
                <SourceMark
                  name={origin.name}
                  record={origin.record ?? null}
                  context="record"
                  access={origin.access}
                  via={origin.via}
                  note={origin.note}
                />
              )}
              {classWord && <span className={subtle}>{classWord}</span>}
              {origin.access === "read" && (
                <>
                  <span className={subtle} aria-hidden="true">
                    ·
                  </span>
                  <span className={warm} data-read-only>
                    read-only{origin.note ? ` — ${origin.note}` : ""}
                  </span>
                </>
              )}
              {origin.stub && (
                <>
                  <span className={subtle} aria-hidden="true">
                    ·
                  </span>
                  <StubNote
                    stubs={origin.stub.stubs}
                    self={origin.stub.self}
                    winner={origin.stub.winner}
                    sources={origin.stubSources}
                  />
                </>
              )}
              {origin.state.map(part => (
                <span key={part} className={cx(["uncommitted", "never"].includes(part.split(" ")[0]!) && warm)}>
                  <span className={subtle} aria-hidden="true">
                    ·{" "}
                  </span>
                  {part}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </header>
  )
}

/** The collection's `display.record` line under the header: subtitle, badge chips, `color_by` tint. */
export function RecordDisplayLine({
  row,
  fields,
  record,
  subtitle,
}: {
  row: CollectionRow | undefined
  fields: readonly FieldRow[]
  record: Record<string, unknown> | null
  /** The `subtitle` template, already rendered (references resolved by the page). */
  subtitle: string
}) {
  const chips = badgeChips(row, fields, record)
  const tint = tintStyle(tintOf(row?.record.color_by, fields, record))
  if (!subtitle && !chips.length && !tint) return null
  return (
    <div className={cx(displayLine, tint ? displayTinted : "border-l-transparent")} style={tint} data-record-display>
      {subtitle && (
        <span className="min-w-0 truncate" title={subtitle}>
          {subtitle}
        </span>
      )}
      {chips.map(chip => (
        <span
          key={chip.value}
          className={cx(badgeChip, chip.color ? badgeColored : badgePlain, chip.background && badgeFilled)}
          style={
            chip.color || chip.background
              ? ({
                  ...(chip.color ? { "--dt-chip-color": themeColor(chip.color) } : {}),
                  ...(chip.background ? { "--dt-chip-bg": themeColor(chip.background) } : {}),
                } as CSSProperties)
              : undefined
          }
        >
          {chip.icon && <Icon name={chip.icon} />}
          {chip.label}
        </span>
      ))}
    </div>
  )
}
