/**
 * A picture value, resolved — `useImageSrc` is the one resolver ViewImage, a card's cover and a display template's
 * file token share, so the three cannot disagree about where a reference's bytes are (ported from
 * the Vue ui's lib/use-file-src.ts and components/render/FileThumb.vue).
 *
 * A URL (`https:`, `data:image/`) is its own source. A FILE-CODEC reference (`lib/file-record.ts`) is decided by
 * the value against the host's file-base list, then the record is read for its `ext`: only an image extension
 * yields a source, so a PDF in the same collection keeps its reference as text instead of a broken `<img>`.
 * Anything else has no source. A result that lands after the value changed is dropped.
 */
import { useEffect, useState } from "react"
import { useApp } from "../AppContext.tsx"
import { fileRecordRef, isImageExt, srcForRecord } from "../lib/file-record.ts"
import { fetchRecord } from "../lib/record-cache.ts"
import { subtle } from "../styles/classes.ts"

const URL_RE = /^(https?:\/\/|data:image\/)/i

export function useImageSrc(value: unknown): string | null {
  const { version } = useApp()
  const raw = typeof value === "string" ? value.trim() : ""
  const [src, setSrc] = useState<string | null>(URL_RE.test(raw) ? raw : null)
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
  return src
}

/** A file-codec reference drawn as the picture it is — or its text, when it is not an image. */
export function FileThumb({ value, alt = "" }: { value: string; alt?: string }) {
  const src = useImageSrc(value)
  return src ? (
    <img src={src} alt={alt} className="max-w-full max-h-[120px] rounded align-middle" />
  ) : (
    <span className={subtle}>{value}</span>
  )
}
