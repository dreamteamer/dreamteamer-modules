/**
 * A field's real value vocabulary, for a filter's value dropdown (ported from the Vue ui's
 * composables/field-values.ts): `status` filters with a select of the values its records hold instead of a text
 * box whose vocabulary you must know by heart. The engine derives it from the records (`GET …/values/:field`,
 * as `dreamteamer <c> values <field>`), so nothing has to be declared an enum.
 *
 * Cached per collection and field for the session — the filter panel mounts on every open, and a vocabulary that
 * gains a value mid-session is not worth a refetch. Null while loading, and null for good when the engine says
 * `truncated`: a 50-of-800 dropdown would hide more than it offers.
 */
import { useEffect, useState } from "react"
import { fieldValues } from "../api/client.ts"

export interface ValueChoice {
  text: string
  value: unknown
}

const cache = new Map<string, Promise<ValueChoice[] | null>>()
const settled = new Map<string, ValueChoice[] | null>()

function load(collection: string, field: string): Promise<ValueChoice[] | null> {
  const key = `${collection}::${field}`
  let p = cache.get(key)
  if (!p) {
    p = fieldValues(collection, field).then(
      d =>
        d.skipped || d.truncated || !d.values?.length
          ? null
          : d.values.map(v => ({ text: String(v.value), value: v.value })),
      () => null
    )
    p.then(v => settled.set(key, v))
    cache.set(key, p)
  }
  return p
}

/** The vocabulary of each `collection::field` key asked for, as it lands. */
export function useFieldValues(keys: readonly string[]): Map<string, ValueChoice[] | null> {
  const [, bump] = useState(0)
  const joined = keys.join("\n")
  useEffect(() => {
    let live = true
    for (const key of keys) {
      if (settled.has(key)) continue
      const [c, f] = key.split("::") as [string, string]
      void load(c, f).then(() => live && bump(n => n + 1))
    }
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the joined keys
  }, [joined])
  return settled
}
