/**
 * Where a record sits on the map layout (ported out of @dreamteamer/ui's ListMap.vue so it can be pinned). In
 * order: the `lat`/`lng` options' fields; numeric fields named lat/latitude and lng/lon/long/longitude; any object
 * field carrying numeric `lat` and `lng` keys. A record with none of them is not plotted (and the map counts it).
 */

const LAT_NAMES = ["lat", "latitude"]
const LNG_NAMES = ["lng", "lon", "long", "longitude"]

const objectLatLng = (v: unknown): [number, number] | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  return typeof o["lat"] === "number" && typeof o["lng"] === "number" ? [o["lat"], o["lng"]] : null
}

export function coordOf(
  record: Record<string, unknown>,
  options: Record<string, unknown> = {}
): [number, number] | null {
  const latF =
    typeof options["lat"] === "string" && options["lat"]
      ? options["lat"]
      : LAT_NAMES.find(n => typeof record[n] === "number")
  const lngF =
    typeof options["lng"] === "string" && options["lng"]
      ? options["lng"]
      : LNG_NAMES.find(n => typeof record[n] === "number")
  // an option may name ONE object field for both axes — `{ lat, lng }` read off it
  if (latF && latF === lngF) {
    const both = objectLatLng(record[latF])
    if (both) return both
  }
  if (latF && lngF && typeof record[latF] === "number" && typeof record[lngF] === "number")
    return [record[latF] as number, record[lngF] as number]
  for (const v of Object.values(record)) {
    const both = objectLatLng(v)
    if (both) return both
  }
  return null
}

/** The key a fit is remembered by: refit only when the plotted points change, never on a re-render. */
export const fitKey = (points: readonly [number, number][]): string => points.map(p => `${p[0]},${p[1]}`).join("|")
