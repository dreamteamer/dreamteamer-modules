import { loadDescriptors } from "./host/fsdata.ts"
import { engine, engineLoaded } from "./host/engine.ts"
import { shouldFoldOutOfRecordTree } from "./host/nav.ts"
import { tailOrder } from "./host/nav/tailOrder.ts"

/** What a nav write is checked against: the rows the tree can draw (`collections`, in drawn tail order — what
 *  applyNavOp places unplaced rows by), every compiled collection (`known`, what a PUT may name: an internal
 *  collection is not drawn but is not unknown) and the declared namespaces. */
export function navOpContext(root: string): {
  collections: Set<string>
  known: Set<string>
  namespaces: string[]
} {
  const descriptors = loadDescriptors(root)
  const { titleOf } = engine().descriptor
  return {
    collections: tailOrder(
      descriptors.filter(d => !shouldFoldOutOfRecordTree(d)),
      titleOf
    ),
    known: new Set(descriptors.map(d => d.name)),
    namespaces: [...(engineLoaded() ? engine().namespaces : [])],
  }
}
