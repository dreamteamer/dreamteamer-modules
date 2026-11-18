/**
 * `relation` — a reference reads as its TARGET's name: the target collection's `record_title`, fetched once per
 * record through the shared cache (`lib/recordCache.ts`), so a column of 90 rows naming 20 records costs 20
 * requests, and a relation cell, the picker and the record header never name one record two ways. Until a title
 * lands — and for a reference that resolves to nothing — the de-slugged last segment stands.
 *
 * On the record page each reference is a link to its record. In a cell it stays text, because the row is
 * already the click target — EXCEPT an untargeted list reference (refs into any collection), whose row opens
 * something else entirely, so each title links to its own record (the click does not reach the row).
 *
 * A reference to a FILE-CODEC record (`lib/fileRecord.ts`) draws its picture when the bytes are an image — the
 * picture IS the value, the title its alt text. Hovering a reference opens an instant card: the title, the
 * collection it lives in, the reference itself.
 */
import { useEffect, useState } from "react"
import { useApp, useSignal } from "../AppContext.tsx"
import { HoverCard } from "../components/HoverCard.tsx"
import { Link } from "../components/Link.tsx"
import { refsOf } from "../lib/editValues.ts"
import { fileRecordRef, isImageExt, srcForRecord } from "../lib/fileRecord.ts"
import { askTitles, fetchRecord, knownTitle, referenceTitlesChanged, refStem } from "../lib/recordCache.ts"
import { recordRoute } from "../lib/createRoute.ts"
import { splitRef } from "../lib/schema.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./Empty.tsx"
import { cx, subtle } from "../styles/classes.ts"

/** A file-codec reference's image src, once its record (and so its extension) has landed. */
function useFileSrc(ref: string, version: number): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    const at = fileRecordRef(ref)
    if (!at) return
    let live = true
    void fetchRecord(at.collection, at.id, version).then(rec => {
      const ext = rec?.fields["ext"]
      // the reference may have changed while the request was in the air: never draw one record's picture on another
      if (live && typeof ext === "string" && isImageExt(ext)) setSrc(srcForRecord(at.collection, at.id, ext))
    })
    return () => {
      live = false
    }
  }, [ref, version])
  return src
}

function Reference({ refValue, linked, record }: { refValue: string; linked: boolean; record: boolean }) {
  const { schema, version } = useApp()
  const at = splitRef(refValue, schema.names)
  const label = knownTitle(refValue) ?? refStem(refValue)
  const src = useFileSrc(refValue, version)
  const collectionTitle = at ? (schema.collection(at.collection)?.title ?? at.collection) : ""
  const lines = [
    { text: label, kind: "title" as const },
    { text: at ? `in ${collectionTitle}` : "" },
    { text: refValue, kind: "code" as const },
  ]
  const body = src ? (
    <img
      className={cx(
        "w-auto object-contain align-text-bottom",
        record ? "h-[2.4em] max-w-[240px]" : "h-[1.35em] max-w-[120px]"
      )}
      src={src}
      alt={label}
    />
  ) : (
    <span dir="auto">{label}</span>
  )
  return (
    <HoverCard lines={lines} className="inline-flex items-center">
      {linked && at ? (
        <span onClick={e => e.stopPropagation()}>
          <Link to={recordRoute(at.collection, at.id)}>{body}</Link>
        </span>
      ) : (
        body
      )}
    </HoverCard>
  )
}

export function ViewRelation({ field, value, context }: ViewProps) {
  const { schema, version } = useApp()
  useSignal(referenceTitlesChanged)
  const refs = refsOf(value)
  useEffect(() => askTitles(refs, schema, version), [refs.join("\n"), schema, version])
  if (!refs.length) return <Empty />
  const anyCollection = (field.many === true || field.role === "reference_many") && !schema.target(field)
  const linked = context === "record" || anyCollection
  return (
    <span className={cx("inline-flex flex-wrap gap-1.5", context === "record" && "whitespace-normal")} data-items>
      {refs.map((ref, i) => (
        <span key={`${ref}-${i}`}>
          <Reference refValue={ref} linked={linked} record={context === "record"} />
          {i < refs.length - 1 && <span className={subtle}>, </span>}
        </span>
      ))}
    </span>
  )
}
