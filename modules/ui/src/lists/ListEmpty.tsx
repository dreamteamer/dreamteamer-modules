/**
 * What a List draws with no rows — loading, nothing matching the query, or an empty collection with the way to
 * fill it — the three states every built-in List tells apart (an empty collection is not one whose records lack
 * a date or a coordinate, and saying the second for the first sends a person to fix a schema that is fine).
 */
import { Icon } from "../components/Icon.tsx"
import type { ListProps } from "../registry/props.ts"
import { button, buttonSize, buttonTone, cx, listEmpty } from "../styles/classes.ts"

export function ListEmpty({ state }: { state: ListProps["state"] }) {
  return (
    <div className={listEmpty}>
      <Icon name={state.loading ? "loading" : "inbox"} />
      <p>
        {state.loading
          ? "Loading…"
          : state.hasActiveQuery
            ? "No records match your search or filters."
            : "No records yet."}
      </p>
      {!state.loading && !state.hasActiveQuery && !state.unavailable && (
        <button
          type="button"
          className={cx(button, buttonTone.default, buttonSize.default)}
          onClick={() => state.createRecord()}
        >
          Create record
        </button>
      )}
    </div>
  )
}
