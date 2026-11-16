/**
 * THE MAP — the built-in `map` List (ported from the Vue ui's ListMap.vue): Leaflet over OpenStreetMap tiles,
 * one circle per record that has a position (`lib/map-coords.ts`), a click opening the record. Circles only — no
 * icon assets to bundle; their colour is the theme's accent, set in CSS.
 *
 * THREE empty states, not one: no rows (loading, nothing matching, an empty collection — `ListEmpty`) is not rows
 * without coordinates, and only the second may tell a person to add lat/lng fields.
 *
 * THE FIT: with `auto_fit` (default on) the map zooms to its markers — but only when the plotted points CHANGE,
 * never on a re-render (that would undo a pan), and never into a container that has not been laid out (Leaflet
 * solves the zoom against its cached size, and 0×0 yields the whole globe). A ResizeObserver re-drives the fit the
 * moment the element has a real size, whatever order mount, layout and data arrive in.
 */
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useEffect, useMemo, useRef } from "react"
import type { Row } from "../api/client.ts"
import { Icon } from "../components/Icon.tsx"
import { coordOf, fitKey } from "../lib/map-coords.ts"
import type { ListProps } from "../registry/props.ts"
import { ListEmpty } from "./ListEmpty.tsx"

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"

export function ListMap({ state }: ListProps) {
  const options = state.listOptions["map"] ?? {}
  const autoFit = options["auto_fit"] !== false
  const plotted = useMemo(
    () =>
      state.records
        .map(r => ({ r, coord: coordOf(r, options) }))
        .filter((x): x is { r: Row; coord: [number, number] } => x.coord !== null),
    [state.records, options]
  )
  const el = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef({ key: "", ever: false })
  // the latest render's values, for the observer and the marker clicks
  const now = useRef({ plotted, autoFit, open: state.openRecord, title: state.recordTitleOf })
  now.current = { plotted, autoFit, open: state.openRecord, title: state.recordTitleOf }
  const show = plotted.length > 0

  const draw = () => {
    const m = map.current
    const group = layer.current
    if (!m || !group) return
    const { plotted: pts, autoFit: fit } = now.current
    group.clearLayers()
    for (const { r, coord } of pts) {
      const marker = L.circleMarker(coord, { radius: 8, weight: 2, fillOpacity: 0.35, className: "dt-map-marker" })
      marker.bindTooltip(now.current.title(r) || r.id)
      marker.on("click", () => now.current.open(r))
      group.addLayer(marker)
    }
    // always before a fit: the container may have been measured hidden
    m.invalidateSize()
    if (!pts.length) return
    const size = m.getSize()
    if (size.x < 50 || size.y < 50) return
    const key = fitKey(pts.map(p => p.coord))
    if (!fit || key === fitted.current.key) return
    fitted.current = { key, ever: true }
    // maxZoom: one point has no extent, and Leaflet would land on its roof
    m.fitBounds(L.latLngBounds(pts.map(p => p.coord)).pad(0.2), { maxZoom: 14 })
  }

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: true }).setView([20, 0], 2)
    L.tileLayer(TILES, { attribution: "© OpenStreetMap" }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    draw()
    const ro = new ResizeObserver(entries => {
      m.invalidateSize()
      const box = entries[0]?.contentRect
      if (fitted.current.ever || !box || box.width < 50 || box.height < 50) return
      fitted.current.key = ""
      draw()
    })
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      layer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is made once; draw reads `now`
  }, [])

  useEffect(draw, [plotted])
  useEffect(() => {
    fitted.current = { key: "", ever: false }
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a changed switch refits
  }, [autoFit])

  return (
    <div className="dt-map-wrap">
      {!state.records.length ? (
        <ListEmpty state={state} />
      ) : (
        !show && (
          <div className="dt-list-empty">
            <Icon name="circle-slash" />
            <p>
              {state.records.length} records, none with coordinates — add numeric lat/lng fields (or an object field
              with lat and lng keys), or point Layout options (Latitude / Longitude) at yours.
            </p>
          </div>
        )
      )}
      {/* always mounted, hidden while empty: the map is made once and keeps its pan across reloads */}
      <div ref={el} className="dt-map" style={show ? undefined : { display: "none" }} />
      {show && (
        <div className="dt-subtle dt-map-note">
          {plotted.length} of {state.records.length} records plotted
        </div>
      )}
    </div>
  )
}
