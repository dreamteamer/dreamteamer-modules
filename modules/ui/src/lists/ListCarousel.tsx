/**
 * THE CAROUSEL — the built-in `carousel` List (ported from the Vue ui's ListCarousel.vue): one card per record —
 * its title, one text field, and a carousel over the images in the folder a `${env:…}/…` field on the record points
 * at (a reference product's frames, a meeting's screenshots).
 *
 * The images are NOT in a field: the record carries a folder TEMPLATE, the host renders it for this machine and
 * lists the files (`GET /folder/:collection/*id?field=…`), and `lib/var-roots.ts` maps the rendered folder onto the
 * URL of the declared-variable root it sits under. A folder that cannot be shown says WHY under the card (an unset
 * variable, an empty folder, a folder outside every root) — an empty box with no reason reads as "no screenshots".
 *
 * Options: `folder` (default: `screenshots_folder`, else the first field ending in `_folder`), `text` (default
 * `description`). ← / → step the focused card.
 */
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react"
import { getFolder, type Row } from "../api/client.ts"
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { uriForPath } from "../lib/var-roots.ts"
import { rowContext } from "../lib/vscode-context.ts"
import type { ListProps } from "../registry/props.ts"
import { ListEmpty } from "./ListEmpty.tsx"

interface Slides {
  files: string[]
  path: string | null
  reason: string | null
  loading: boolean
}

const LOADING: Slides = { files: [], path: null, reason: null, loading: true }

/** The folder a record's slides come from, read once per record, field and version. */
function useSlides(collection: string, id: string, field: string | null): Slides {
  const { version } = useApp()
  const [slides, setSlides] = useState<Slides>(LOADING)
  useEffect(() => {
    if (!field) {
      setSlides({
        files: [],
        path: null,
        reason: "no folder field on this collection — set the Folder option",
        loading: false,
      })
      return
    }
    let live = true
    setSlides(LOADING)
    getFolder(collection, id, field).then(
      data => {
        if (!live) return
        const files = data.files ?? []
        const folder = data.path ?? null
        // a folder the host listed but no declared root contains has no URL here: say so, and say the fix
        const unreachable = !!folder && files.length > 0 && uriForPath(folder) === null
        setSlides({
          files: unreachable ? [] : files,
          path: folder,
          reason: unreachable
            ? `${folder} is outside every folder this page may read — if a declared variable changed in .env, reload`
            : (data.reason ?? null),
          loading: false,
        })
      },
      e =>
        live && setSlides({ files: [], path: null, reason: e instanceof Error ? e.message : String(e), loading: false })
    )
    return () => {
      live = false
    }
  }, [collection, id, field, version])
  return slides
}

export function ListCarousel({ state }: ListProps) {
  const options = state.listOptions["carousel"] ?? {}
  const named = options["folder"]
  const names = state.fields.map(f => f.field)
  const folderField =
    typeof named === "string" && named
      ? named
      : (names.find(f => f === "screenshots_folder") ?? names.find(f => f.endsWith("_folder")) ?? null)
  const text = typeof options["text"] === "string" && options["text"] ? (options["text"] as string) : "description"

  if (!state.records.length) return <ListEmpty state={state} />
  return (
    <div className="dt-carousel-list">
      {state.records.map(r => (
        <CarouselCard
          key={`${String(r["$source"] ?? "")}/${r.id}`}
          state={state}
          record={r}
          folder={folderField}
          text={text}
        />
      ))}
    </div>
  )
}

function CarouselCard({
  state,
  record,
  folder,
  text,
}: {
  state: ListProps["state"]
  record: Row
  folder: string | null
  text: string
}) {
  const slides = useSlides(state.collection, record.id, folder)
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [slides])
  const n = slides.files.length
  const src = (i: number) => (slides.path && slides.files[i] ? uriForPath(`${slides.path}/${slides.files[i]}`) : null)
  const go = (delta: number, e?: MouseEvent) => {
    e?.stopPropagation()
    if (n) setIndex(i => (i + delta + n) % n)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") go(-1)
    else if (e.key === "ArrowRight") go(1)
    else return
    e.preventDefault()
  }
  const blurb = typeof record[text] === "string" ? (record[text] as string) : ""
  const current = src(index)

  return (
    <article
      className="dt-record-card dt-carousel-card"
      data-vscode-context={rowContext(state.collection, record.id)}
      tabIndex={0}
      onKeyDown={onKey}
    >
      <header className="dt-carousel-head" onClick={() => state.openRecord(record)}>
        <h3 className="dt-cards-title">{state.recordTitleOf(record) || "—"}</h3>
        {blurb && <p className="dt-carousel-text">{blurb}</p>}
      </header>
      <div className="dt-carousel-stage">
        {n ? (
          <>
            <button type="button" className="dt-carousel-nav is-prev" title="Previous" onClick={e => go(-1, e)}>
              <Icon name="chevron-left" />
            </button>
            {current && <img src={current} alt="" className="dt-carousel-img" />}
            <button type="button" className="dt-carousel-nav is-next" title="Next" onClick={e => go(1, e)}>
              <Icon name="chevron-right" />
            </button>
            <span className="dt-carousel-counter">
              {index + 1} / {n} · {slides.files[index]}
            </span>
          </>
        ) : slides.loading ? (
          <div className="dt-carousel-empty">
            <Icon name="loading" />
          </div>
        ) : (
          <div className="dt-carousel-empty">
            <Icon name="device-camera" />
            <span>{slides.reason ?? "no images"}</span>
          </div>
        )}
      </div>
      {n > 1 && (
        <div className="dt-carousel-strip">
          {slides.files.map((f, i) => (
            <button
              key={f}
              type="button"
              className={`dt-carousel-thumb${i === index ? " is-current" : ""}`}
              title={f}
              onClick={e => {
                e.stopPropagation()
                setIndex(i)
              }}
            >
              {src(i) && <img src={src(i)!} alt="" loading="lazy" />}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}
