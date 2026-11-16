/**
 * `relation` — a reference reads as its TARGET's name: the target collection's `record_title`, fetched once per
 * record through the shared cache (`lib/record-cache.ts`), so a column of 90 rows naming 20 records costs 20
 * requests, and a relation cell, the picker and the record header never name one record two ways. Until a title
 * lands — and for a reference that resolves to nothing — the de-slugged last segment stands.
 *
 * On the record page each reference is a link to its record. In a cell it stays text, because the row is
 * already the click target — EXCEPT an untargeted list reference (refs into any collection), whose row opens
 * something else entirely, so each title links to its own record (the click does not reach the row).
 *
 * A reference to a FILE-CODEC record (`lib/file-record.ts`) draws its picture when the bytes are an image — the
 * picture IS the value, the title its alt text. Hovering a reference opens an instant card: the title, the
 * collection it lives in, the reference itself.
 */
import { useEffect, useState } from "react"
import { useApp, useSignal } from "../app-context.tsx"
import { HoverCard } from "../components/HoverCard.tsx"
import { Link } from "../components/Link.tsx"
import { refsOf } from "../lib/edit-values.ts"
import { fileRecordRef, isImageExt, srcForRecord } from "../lib/file-record.ts"
import { askTitles, fetchRecord, knownTitle, referenceTitlesChanged, refStem } from "../lib/record-cache.ts"
import { recordRoute } from "../lib/route.ts"
import { splitRef } from "../lib/schema.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

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

function Reference({ refValue, linked }: { refValue: string; linked: boolean }) {
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
  const body = src ? <img className="dt-ref-image" src={src} alt={label} /> : <span dir="auto">{label}</span>
  return (
    <HoverCard lines={lines} className="dt-ref">
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
    <span className={`dt-refs${context === "record" ? " is-record" : ""}`}>
      {refs.map((ref, i) => (
        <span key={`${ref}-${i}`}>
          <Reference refValue={ref} linked={linked} />
          {i < refs.length - 1 && <span className="dt-subtle">, </span>}
        </span>
      ))}
    </span>
  )
}
