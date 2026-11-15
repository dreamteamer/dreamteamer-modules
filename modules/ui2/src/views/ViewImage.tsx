/**
 * `image` — a picture field drawn as a thumbnail that opens the full picture. The value is a FILE-CODEC
 * reference (`lib/file-record.ts`: its bytes are served under the host's file base, the extension read from the
 * record), or a URL. Anything else — a value no `<img>` can load — reads as its text, never a broken icon.
 * Opt-in only: an image id is a string like any other. Square pictures get a circle in a comfortable table
 * (`lib/row-size.ts#isSquarish`), decided by the picture's own size once loaded.
 */
import { useEffect, useState } from "react"
import { useApp } from "../app-context.tsx"
import { fetchRecord } from "../lib/record-cache.ts"
import { fileRecordRef, isImageExt, srcForRecord } from "../lib/file-record.ts"
import { isSquarish } from "../lib/row-size.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

const URL_RE = /^(https?:\/\/|data:image\/)/i

export function ViewImage({ value, context }: ViewProps) {
  const { version } = useApp()
  const raw = typeof value === "string" ? value.trim() : ""
  const [src, setSrc] = useState<string | null>(URL_RE.test(raw) ? raw : null)
  const [square, setSquare] = useState(false)

  useEffect(() => {
    if (URL_RE.test(raw)) return setSrc(raw)
    setSrc(null)
    const at = fileRecordRef(raw)
    if (!at) return
    let live = true
    void fetchRecord(at.collection, at.id, version).then(rec => {
      const ext = rec?.fields["ext"]
      if (live && typeof ext === "string" && isImageExt(ext)) setSrc(srcForRecord(at.collection, at.id, ext))
    })
    return () => {
      live = false
    }
  }, [raw, version])

  if (!raw) return <Empty />
  if (!src) return <span className="ui2-subtle">{raw}</span>
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="ui2-image-link"
      onClick={e => e.stopPropagation()}
    >
      <img
        src={src}
        alt=""
        className={`ui2-image${context === "record" ? " is-record" : ""}${square ? " is-square" : ""}`}
        onLoad={e => setSquare(isSquarish(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
      />
    </a>
  )
}
