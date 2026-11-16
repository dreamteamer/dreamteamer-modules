/**
 * THE CARD GRID — the built-in `cards` List (ported from the Vue ui's ListCards.vue): the same rows the table
 * draws, as a responsive grid of cards. A thin renderer over the browse's state; a click opens the record exactly
 * as a table row does.
 *
 * A card is the kanban's card: the same `card_title` display template (markdown, each `{{ field }}` drawn by its
 * own View — `render/DisplayTemplate.tsx`), the same tint by `color_by`, the same source mark in a footer row.
 * Blank, it is the record's title and up to three of the table's chosen columns, each through its View — so
 * switching layout needs no second "which fields matter" setting.
 *
 * THE COVER: the `image` option's field, else the first field whose View is `image` (opt-in only); its value is a
 * URL or a file-codec reference (`useImageSrc`), fitted by `image_fit`. A FILE-CODEC collection's record IS its
 * picture — no field holds it — so its cards draw the record's own bytes when its `ext` is an image, keyed off the
 * host's file-base list and never a collection's name.
 *
 * GROUPED by `group_by`, it is one band per value with the shared GroupHeader over its own grid (the table's
 * bands, `lib/grouping.ts`); collapsing a band lasts as long as the grid. The grid grows and the page scrolls —
 * it does not fill the page.
 */
import { useEffect, useMemo, useState } from "react"
import { rowContext } from "../lib/vscode-context.ts"
import type { FieldRow } from "../api/types.ts"
import type { Row } from "../api/client.ts"
import { useApp, useSignal } from "../app-context.tsx"
import { useImageSrc } from "../components/FileThumb.tsx"
import { Icon } from "../components/Icon.tsx"
import { SourceMark } from "../components/SourceMark.tsx"
import { GroupHeader } from "../browse/GroupHeader.tsx"
import { templateOption } from "../lib/display-template.ts"
import { isRelationField } from "../lib/field-row.ts"
import { fileBases, isImageExt, srcForRecord } from "../lib/file-record.ts"
import { labelOf } from "../lib/format-title.ts"
import { bucketize, UNGROUPED, type Bucket } from "../lib/grouping.ts"
import { askTitles, knownTitle, referenceTitlesChanged } from "../lib/record-cache.ts"
import type { ListProps } from "../registry/props.ts"
import { DisplayTemplate } from "../render/DisplayTemplate.tsx"
import { RenderView } from "../render/Render.tsx"

/** The cover slot is drawn even empty, so a grid's cards line up; a picture that fails to load leaves it empty
 *  rather than drawing the browser's broken-image glyph. */
function Cover({ src, fit }: { src: string | null; fit: "cover" | "contain" }) {
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <div className="dt-record-card-cover">
      {src && failed !== src && <img src={src} alt="" style={{ objectFit: fit }} onError={() => setFailed(src)} />}
    </div>
  )
}

/** A cover from a field's value — a URL or a file-codec reference. */
function FieldCover({ value, fit }: { value: unknown; fit: "cover" | "contain" }) {
  return <Cover src={useImageSrc(value)} fit={fit} />
}

export function ListCards({ state }: ListProps) {
  const { schema, version } = useApp()
  useSignal(referenceTitlesChanged)
  const options = state.listOptions["cards"] ?? {}
  const records = state.records
  const fit = options["image_fit"] === "contain" ? "contain" : "cover"
  const template = templateOption(options)

  // an explicit `image` wins; a field the schema no longer has falls back to the auto-pick, never an empty slot
  const named = options["image"]
  const imageField: FieldRow | null =
    typeof named === "string" && named
      ? (state.fields.find(f => f.field === named) ?? state.imageField)
      : state.imageField
  const selfImaged = fileBases().some(b => b.collection === state.collection)
  const selfSrc = (r: Row) => {
    const ext = r["ext"]
    return typeof ext === "string" && isImageExt(ext) ? srcForRecord(state.collection, r.id, ext) : null
  }

  const groupName = options["group_by"]
  const groupField =
    typeof groupName === "string" && groupName ? (state.fields.find(f => f.field === groupName) ?? null) : null
  const bands = useMemo<Bucket[]>(
    () =>
      groupField
        ? bucketize(groupField, records, {
            showUngrouped: options["show_ungrouped_rows"] === true,
            showEmpty: options["show_empty_rows"] === true,
          })
        : [{ value: "", label: "", records }],
    [groupField, records, options]
  )
  const byReference = groupField !== null && isRelationField(groupField)
  const bandValues = bands.map(b => b.value).filter(v => v && v !== UNGROUPED)
  useEffect(() => {
    if (byReference) askTitles(bandValues, schema, version)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [byReference, bandValues.join("\n"), schema, version])
  const bandLabel = (b: Bucket) => (byReference && b.value !== UNGROUPED ? knownTitle(b.value) : null) || b.label

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleBand = (value: string) =>
    setCollapsed(c => {
      const next = new Set(c)
      if (!next.delete(value)) next.add(value)
      return next
    })

  if (!records.length)
    return (
      <div className="dt-list-empty">
        <Icon name={state.loading ? "loading" : "inbox"} />
        <p>
          {state.loading
            ? "Loading…"
            : state.hasActiveQuery
              ? "No records match your search or filters."
              : "No records yet."}
        </p>
        {!state.loading && !state.hasActiveQuery && !state.unavailable && (
          <button type="button" className="dt-button" onClick={() => state.createRecord()}>
            Create record
          </button>
        )}
      </div>
    )

  return (
    <div className="dt-card-grid-wrap">
      {bands.map(band => (
        <section key={band.value} className="dt-card-band">
          {groupField && (
            <div className="dt-group-band dt-card-band-head">
              <button
                type="button"
                className="dt-icon-button"
                aria-expanded={!collapsed.has(band.value)}
                title={collapsed.has(band.value) ? "Expand" : "Collapse"}
                onClick={() => toggleBand(band.value)}
              >
                <Icon name={collapsed.has(band.value) ? "chevron-right" : "chevron-down"} />
              </button>
              <GroupHeader
                label={bandLabel(band)}
                count={band.records.length}
                description={band.description}
                icon={band.icon}
                color={band.color}
                background={band.background}
              />
            </div>
          )}
          {!collapsed.has(band.value) && (
            <div className={`dt-card-grid${state.loading ? " is-revalidating" : ""}`}>
              {(band.records as Row[]).map(r => {
                const tint = state.tintOf(r)
                const source = state.sourceOf(r)
                return (
                  <article
                    key={`${String(r["$source"] ?? "")}/${r.id}`}
                    className={`dt-record-card dt-cards-card${tint ? " is-tinted" : ""}`}
                    style={tint}
                    data-vscode-context={rowContext(state.collection, r.id)}
                    onClick={() => state.openRecord(r)}
                  >
                    {selfImaged ? (
                      <Cover src={selfSrc(r)} fit={fit} />
                    ) : (
                      imageField && <FieldCover value={r[imageField.field]} fit={fit} />
                    )}
                    {template ? (
                      <DisplayTemplate template={template} record={r} fields={state.fields} context="record" />
                    ) : (
                      <>
                        <h3 className="dt-cards-title">{state.recordTitleOf(r) || "—"}</h3>
                        {state.subtitleFields.length > 0 && (
                          <dl className="dt-cards-fields">
                            {state.subtitleFields.map(f => (
                              <div key={f.field}>
                                <dt>{labelOf(f)}</dt>
                                <dd>
                                  <RenderView field={f} value={r[f.field]} record={r} />
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </>
                    )}
                    {source && (
                      <footer className="dt-record-card-foot">
                        <SourceMark {...source} />
                      </footer>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
