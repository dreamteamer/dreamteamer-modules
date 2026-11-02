import { Descriptor, type ModuleRecord } from "./fsdata.js";
import { type SourceEntry } from "./sources.js";
/**
 * A runtime-stored collection this workspace keeps records in ON PURPOSE, and therefore a nav row.
 *
 * ⚠ THE OVERLAY IS THE OPT-IN, and that is the whole mechanism — there is no separate flag. Compile
 * derives `compiled.overlaid_by` (the modules contributing an overlay to a collection, asked through
 * `overlaidByOf`), so a runtime collection carrying one has been deliberately extended by a module in
 * this tree. Nobody does that by accident: the overlay gate refuses an overlay whose base module is
 * not declared in `dreamteamer.dependencies`, so it costs an authored dependency and an authored
 * descriptor. An operator who paid that has said the collection is theirs.
 *
 * Why this rather than a `nav: true` on the descriptor: that field would cost an engine field, an
 * engine release and a version bump in every consumer, and `overlaid_by` is already derived and already
 * means "somebody in this tree claimed this".
 *
 * The default is untouched: `collections`, `skills`, `commands`, `command-bindings`, `ui-views`,
 * `mixins`, `modules` and any runtime kind an engine extension contributes carry no overlay in an
 * ordinary workspace and stay where they belong, in the Schema tab.
 */
export declare function keepsRuntimeRecords(d: Descriptor): boolean;
/**
 * Does this collection fold OUT of the record tree and live on the Schema tab instead?
 *
 * Exported and pure so it can be asserted by running it. It was inline in the descriptor loop
 * below, where the only way to check it was to boot an editor — and it is exactly the decision
 * worth arguing about, which this module's header says is the reason the module exists.
 */
export declare function shouldFoldOutOfRecordTree(d: Descriptor): boolean;
/**
 * Where a collection BROWSES in the app. The workspace's plumbing (`internal: true`) routes under
 * `/settings/system/*`, where the app has modelled the schema since the settings app existed
 * (webview/src/registry/register-defaults.ts); everything else is content.
 *
 * ⚠ It asks `isInternal`, not `isRuntime`. Those agree on every engine kind except `repos` — internal
 * while its records are ordinary files the operator edits. `isRuntime` is the WRITE question (what the
 * compiler stamps and what the store's own refusal reads); routing by it sent `repos` to `/content/*`
 * while the schema surface expected it. Never answer one of these two from the other.
 *
 * ⚠ `collections` used to be special-cased to `/settings/data-model` here, and that one line is
 * why the schema diagram had no route a user could reach: `collections` is a collection, its
 * records are descriptors, and a diagram over it is an ordinary saved view.
 */
export declare function routeFor(d: Descriptor): string;
/**
 * What a collection's own ROW in the tree says: the title compile resolved (`titleOf` — authored, or
 * `compiled.defaults.title`; the tree never title-cases an id itself), the descriptor's
 * `display.nav.icon`, and its records root as the tooltip. Pure, so it is asserted by running it —
 * `tree.ts` cannot be imported outside an editor.
 *
 * With `sources` (0.24.0, `src/sources.ts`): a row a layer or a module actually holds records of is
 * `shared`, and the tree marks it with a monochrome `⚭` beside the title; a private row carries no
 * mark (operator 2026-10-29 — the dimmed `from org` there read as part of the name, and the question
 * a row answers is shared-or-not, not which source). The hover says where the shared records come
 * from (`from org`, `from 3 layers`, `project-a not installed`) above every root with its count. The
 * workspace's own root is never counted, so a collection with no layer and no module-owned list reads
 * exactly as it did.
 */
export declare function collectionRow(d: Descriptor, sources?: SourceEntry[]): {
    label: string;
    icon: string | undefined;
    tooltip: string;
    shared?: true;
    count?: number;
};
/**
 * THE MODULE A NAV FOLDER IS — what a click on it opens: that module's page in the Schema tab, the
 * same page Settings › Schema › Modules shows (operator 2026-10-29). A module fold (`mod:<id>`) is the
 * module itself; a namespace folder (`ns:<ns>`) is the module that declares the namespace; a record
 * layer is the module of the same id where it attaches as one (`git_modules.<key>.module: true`, so
 * `.dreamteamer/modules/<key>.module.yaml` exists); a SECTION (`grp:`, a `display.nav.section` or a
 * `dreamteamer.navGroups` entry) is the module whose collections it holds EXACTLY — every one it ships
 * and nothing else, as a `crm` section over the CRM module's three is (operator 2026-10-29). A section
 * holding part of a module (Meetings out of a larger one) or several modules' is none. The workspace
 * row is no one module — it opens them all — and a folder that is no module — a workspace group, a plain layer — answers undefined and only expands.
 */
export declare function folderModule(folder: {
    key: string;
    collections?: ReadonlyArray<{
        name: string;
    }>;
} | {
    layer: string;
}, modules: ReadonlyArray<Pick<ModuleRecord, "id" | "namespaces" | "collections">>): string | undefined;
/**
 * HOW A NAV FOLDER DRAWS, AND WHAT ITS CLICK DOES — one rule for every folder kind (a module fold, a
 * namespace, a section, a record layer), so a module looks and behaves the same wherever the nav puts
 * it (operator 2026-10-29). A folder that IS a module (`folderModule`) opens the module's page,
 * narrowed to it, and wears an icon that says what it DOES — the icon of the first collection it ships
 * (`moduleIcon`), the Schema tab's generic module icon only when it ships none. That it is a module at
 * all is said on the right, by the module mark where the shared mark sits on other rows (`rowMarks`) —
 * operator, same day: "module icons should reflect functionality, move module indicator next to shared
 * indicator", then "simple single icon".
 * Any other folder is a plain folder that only opens and closes — a records-only layer, a mixed
 * section, a workspace group — and carries the shared mark when what it holds is shared.
 */
export declare const MODULE_ICON = "deployed_code";
/** A plain folder. NOT the codicon `folder`: VS Code draws that one from the file-icon theme the moment
 *  the row carries a `resourceUri` — which a marked row does — and most themes draw nothing there. */
export declare const PLAIN_FOLDER_ICON = "folder-compact";
/** The mark on the right of a row — ONE, never two (operator 2026-10-29: "too much noise on module
 *  indicator, simple single icon", then "very small dot, solid"). Text, because a tree badge is text
 *  on the stable API — a codicon badge is gated behind the `codiconDecoration` proposal, which only
 *  allow-listed extensions get — and monochrome: no decoration colour, which would tint the label too. */
export declare const MODULE_MARK = "\u2022";
export declare const SHARED_MARK = "\u26AD";
/** A row's badge: the module mark for a module (what it is outranks where its records come from), else
 *  the shared mark for anything shared; undefined when it is neither. */
export declare function rowMarks(marks: {
    module?: boolean;
    shared?: boolean;
}): string | undefined;
/**
 * What a module DOES, as an icon: the nav icon of its LEADING collection — the one it ships that the
 * nav puts first (lowest `display.nav.order`, unordered last, ties in the module's own order). A
 * schema kind it overlays (`agents`) is plumbing, not its function, and is skipped.
 */
export declare function moduleIcon(module: Pick<ModuleRecord, "collections"> | undefined, look: (collection: string) => {
    icon?: string;
    order?: number;
    runtime?: boolean;
} | undefined): string | undefined;
export declare function folderPresentation(module: string | undefined, about?: string, 
/** `source`: the record layer this folder is drawn INSIDE — its click opens the module's page scoped to it. */
opts?: {
    icon?: string;
    shared?: boolean;
    source?: string;
}): {
    icon: string;
    tooltip?: string;
    route?: string;
    marks?: string;
};
/** The workspace row's page: the Activity of EVERY module, aggregated, never narrowed — the root is all
 *  of them (operator 2026-10-29: "root nav node should show aggregated"). */
export declare const WORKSPACE_ROUTE = "/settings/schema/activity";
/** Where a module clicked in the nav lands: the Schema tab's ACTIVITY page — its named git history,
 *  the first page, or the module's PAGE view when one names it (`webview/src/pages/ModulePage.vue`) —
 *  with the tab narrowed to that module (`webview/src/lib/module-scope.ts`). Its record is one click
 *  away, under Modules. `source`: the folder sits inside that record layer, so the page is scoped to
 *  the layer's records (cr: nested ui-views). */
export declare function moduleRoute(id: string, source?: string): string;
/**
 * One folder in the nav, with the folders that nest inside it.
 *
 * `key` is `ns:<namespace>` for the primary axis, or `mod:<module-id>` for the SECONDARY one — a
 * module folding the default-namespace collections it owns (see `groupTopLevel`). A module folder
 * never has children: a module has no hierarchy to nest by. A module that declares a namespace draws
 * no `mod:` folder at all — its default-namespace collections sit in that `ns:` folder beside its
 * namespaced ones, so an `ns:` folder can hold collections from both axes.
 */
export type NavFolder = {
    key: string;
    collections: Descriptor[];
    children: NavFolder[];
};
/**
 * THE NAV AXIS: namespace first, and — for the DEFAULT namespace only — the owning module second.
 * The decision, separated from the tree widgets so it can be tested without a VS Code window
 * (test/unit/namespace-ui.test.ts).
 *
 * It used to be `owner` (a module) alone, and that was right while a workspace's only partition was
 * "which module shipped this". Namespaces gave the operator a partition of their own — health, finance,
 * work — and letting both compete for ONE fold was the mistake `group:` made before `owner` replaced
 * it: one screen, two spellings of "what this belongs to". So the module fold was removed outright.
 *
 * ⚠ **And then it came back, NARROWED (2026-09-10).** Five meeting-family collections — meetings,
 * preps, summaries, analyses, recordings — drew as five sibling top-level rows in a workspace that keeps
 * them all in the default namespace, and the operator asked for one Meetings folder. The namespace axis
 * cannot give him that without renaming every id and every reference; the module that OWNS the family
 * can, at no migration cost. The two axes never see the same COLLECTION — but they can see the same
 * MODULE, and so the same FOLDER; the fourth bullet is what keeps that one folder:
 *
 *  - A NAMESPACED collection folds under `ns:<namespace>`, whoever owns it. Nested namespaces nest.
 *  - A DEFAULT-namespace collection folds under `mod:<owner>` when that module owns TWO OR MORE
 *    default-namespace collections here — a folder of one costs a click and shows nothing the row did
 *    not — and is NOT the workspace module. Otherwise it lists ungrouped at the top, as before.
 *  - ⚠ EXCEPT when that module owns too few and DEPENDS on one that folds, in which case its
 *    collections file under the DEPENDENCY's folder (2026-09-10, the operator's second ask: "meeting
 *    recordings should also move under meetings module"). A module that owns one collection here and
 *    declares a hard dependency on the module owning the family is an EXTENSION of it — the audio and
 *    transcript of a meeting are part of the meeting family however the modules are packaged — and the
 *    two honest alternatives are both worse: a sibling row above the folder its own family is in, or a
 *    folder of one. ONE HOP ONLY, and only when the dependency ACTUALLY FOLDS here: chasing a chain
 *    would drag a collection into a folder named after a module its own package.json never names, and
 *    a dependency owning one collection here would invent a folder for two rows that are not a family.
 *    The graph is the compiled module record's `dependencies` (`.dreamteamer/modules/<id>.module.yaml`),
 *    which is authored as `dreamteamer.dependencies` and is the same list the extends gate charges for.
 *  - ⚠ ONE MODULE, ONE FOLDER (2026-10-30). A module that DECLARES a namespace and also owns default-
 *    namespace collections folds those into its namespace's folder, not a `mod:` folder of its own. The
 *    rule above used to draw both — `mod:<id>` for the default-namespace pair and `ns:<namespace>` for
 *    the rest — and when the namespace is named after the module, both borrow the module's title: two
 *    sibling folders with one label, the module's family split across them for no reason anyone
 *    authored. The namespace folder keeps its key, its place and its title; the fold condition is
 *    unchanged (two or more, or a dependent riding in), so a module owning ONE default-namespace
 *    collection still lists it at the top. The dependency hop follows the fold: a dependent filed under
 *    a module that folded into its namespace lands in that namespace's folder. Which namespace is the
 *    module's HOME is pinned by `homeNamespaceOf`: the one named after the module if it declares one
 *    (the case where the label collides), else its only ROOT namespace (a nested one it also declares
 *    hangs inside that root anyway); a module with several unrelated roots keeps its `mod:` folder,
 *    because picking among them would depend on the order the namespaces were typed into package.json,
 *    the trap the longest-prefix sort below exists to avoid. Only namespaces the WORKSPACE declares
 *    count, and with no module→namespaces map handed in the rule is off — the next bullet still holds.
 *  - ⚠ NEVER TWO SIBLING FOLDERS WITH ONE LABEL (2026-10-30, `foldSameLabel`). The bullet above keys
 *    the merge on what a module DECLARES, and two pictures slip past it: a section authored with a
 *    namespace's name (`display.nav.section: rnd` on a workspace collection draws `grp:rnd`, and its
 *    label borrows the rnd module's title exactly as `ns:rnd`'s does — two "R&D" folders), and a
 *    module whose namespaces this runtime cannot read, or which has several unrelated roots one of
 *    which carries its name. So the LABEL is the last word: after every fold, siblings that would draw
 *    the same label (`groupLabel`, case-insensitive) become ONE folder — the namespace's when one of
 *    them is a namespace, else the module's, else the section's — holding all their collections and
 *    children, keyed and placed as that folder. Same level only: a folder nested elsewhere with the
 *    same name is a different place. The same pass runs inside a layer's folder (`layerEntries`).
 *  - ⚠ THE WORKSPACE MODULE NEVER FOLDS. It is the operator's own catch-all — in a dogfood vault it owns
 *    every default-namespace collection — and folding it would put the whole vault under one folder
 *    named after itself, which is worse than flat. Which module that is comes from `package.json`
 *    (`workspaceModule` in fsdata.ts), and when it is UNKNOWN the module fold is off entirely: an
 *    older runtime, or a workspace that declares none, looks exactly as it did.
 *
 * ⚠ AND AN INTERNAL COLLECTION IS NOT A NAV NODE — unless this workspace overlaid it
 * (`keepsRuntimeRecords`, above), in which case it is a TOP-LEVEL row and never folds by module: the
 * engine owns every runtime kind, and sweeping `agents` under a System folder because `commands` was
 * overlaid too would undo the 0.15.1 opt-in. `collections`, `skills`, `agents`, `commands`,
 * `command-bindings`, `ui-views`, `mixins`, `modules` and `repos` are the SCHEMA of the workspace
 * by default, and the schema is a place you go (the Schema tab), not a group inside the place you keep
 * records.
 *
 * ⚠ **A NESTED namespace nests in the tree too** (2026-08-28). `family`, `family/health` and
 * `family/travel` are three declared namespaces and used to draw three SIBLING folders — "Family",
 * "Family Health", "Family Travel" — which reads as three unrelated partitions and buries the
 * relationship the names are spelling out. A namespace folder now hangs under the longest DECLARED
 * namespace that is a proper prefix of it, so Health and Travel sit inside Family, labelled by the
 * segment they add rather than by their whole path.
 *
 * Only a DECLARED prefix nests. `work/clients` under an undeclared `work` stays top-level: an
 * undeclared prefix is not a namespace, and inventing a folder for one would put a partition on screen
 * that the workspace never declared — the same "two spellings" mistake from the other direction.
 *
 * Folders sort by key, so module folders (`mod:`) come before namespace folders (`ns:`), each group
 * alphabetical.
 */
export declare function groupTopLevel(descriptors: Descriptor[], declared: string[], workspaceModule?: string, dependsOn?: Map<string, string[]>, navGroups?: Map<string, string[]>, namespacesOf?: Map<string, string[]>, titleOf?: Map<string, string | undefined>): {
    top: Descriptor[];
    folders: NavFolder[];
};
/**
 * NEVER TWO SIBLING FOLDERS WITH ONE LABEL (see the axis comment on `groupTopLevel`). Siblings whose
 * `groupLabel` matches, ignoring case, become one folder: the highest-ranked (`FOLD_RANK`, then key)
 * keeps its key and place, and takes the others' collections after its own and their children among
 * its own, sorted by key as every level is. Recurses with each folder as the parent, so a nested level
 * is labelled — and merged — exactly as the tree labels it. Mutates nothing it was handed.
 */
export declare function foldSameLabel(folders: NavFolder[], titleOf: Map<string, string | undefined>, parentKey?: string): NavFolder[];
/** One row at the top of the nav: a collection, a folder holding some, or the record layers' folder. */
export type NavEntry = {
    kind: "collection";
    descriptor: Descriptor;
} | {
    kind: "folder";
    folder: NavFolder;
} | {
    kind: "layers";
    label: string;
    layers: LayerFolder[];
};
/**
 * The name a workspace uses to talk about a top-level entry — a collection's own name, or a folder's
 * key with its axis prefix removed. So `dreamteamer.navOrder` is written the way the operator says
 * it out loud (`["users", "agents", "projects", "office", "rnd"]`) and never has to know which of
 * those is a namespace, which is a module fold and which is a workspace group.
 */
export declare const navKey: (e: NavEntry) => string;
/** `dreamteamer.navHidden` as the nav reads it: the non-blank strings, trimmed and lower-cased; `[]`
 *  for anything that is not a list. */
export declare function navHiddenOf(raw: unknown): string[];
/**
 * THE TOP-LEVEL ENTRIES A WORKSPACE DOES NOT DRAW — `dreamteamer.navHidden` (operator 2026-11-01: a
 * project's domain namespaces, read for its records, drew two confusing roots beside the organisation
 * folder that already holds the project). Named the way `navOrder` names an entry (`navKey`), but
 * trimmed and case-insensitive. TOP LEVEL ONLY: it filters `orderTopLevel`'s sequence, so a folder
 * nested elsewhere and a layer folder's own nav (`layerEntries`) still draw what it hides, and nothing
 * is unread — lists, search and references never ask the nav. Nothing named returns `entries` itself.
 */
export declare function withoutHidden(entries: NavEntry[], hidden?: readonly string[]): NavEntry[];
/**
 * THE TOP-LEVEL ORDER — rows and folders in ONE sequence.
 *
 * ⚠ WITHOUT `navOrder` THIS CHANGES NOTHING: every collection row first (already sorted by the
 * descriptors' `display.nav.order`), then every folder, exactly as the tree drew them before. That default is
 * deliberate — interleaving folders by, say, the lowest `order` they contain would silently
 * reshuffle the nav of every workspace that never asked, to fix one that did.
 *
 * WITH `navOrder`, the names it lists are placed in that order and everything else keeps its
 * existing relative position behind them. It is a workspace's explicit override of the TOP LEVEL
 * only: inside a folder, and among the entries it does not name, the descriptors' `display.nav.order`
 * still decides. One spelling per question — `display.nav.order` says where a collection sits among its siblings,
 * `navOrder` says what the ten things on the left are, top to bottom.
 *
 * An unknown name is ignored rather than refused: a workspace that disables a module should not
 * have to edit its nav order too, and a typo costs a row in the wrong place, not a broken tree.
 *
 * A collection the list names that sits INSIDE a folder is lifted out of it first (see below), so
 * `navOrder` is also the per-collection opt-out the module fold never had.
 */
export declare function orderTopLevel(top: Descriptor[], folders: NavFolder[], navOrder?: string[], layers?: (NavEntry & {
    kind: "layers";
}) | Array<NavEntry & {
    kind: "layers";
}>): NavEntry[];
/**
 * The label for a folder key: `ns:health` → "Health".
 *
 * ⚠ IT STILL READS THE MODULE TITLES, and that is not a leftover. A namespace whose name IS a module
 * id borrows that module's authored title — the only reason `rnd` renders as R&D rather than "Rnd",
 * because an acronym cannot be derived. That is a LABEL lookup, never a fold; removing the module
 * fold did not and must not take it with it. The `mod:` branch below is dead as a nav key and kept as
 * the label path for a module id handed in directly.
 *
 * `parentKey` is the folder this one is drawn INSIDE. A nested namespace is labelled by the segments it
 * adds — `ns:family/health` under `ns:family` is "Health", not "Family Health" — because the path is
 * already on screen as the row above it.
 *
 * ⚠ **A namespace whose name IS a module id borrows that module's authored title.** Title-casing gives
 * "Rnd" for a namespace the operator calls R&D, and an acronym cannot be derived — which is exactly why
 * a module carries a `title` at all. Where the two names coincide they are the same concept (a module
 * owns a namespace), so the authored title is the namespace's display name too. It stays a LABEL
 * lookup, never a fold: `owner` is not competing for the axis, and a namespace with no matching module
 * (`family/health`, or a namespace whose module is named differently) title-cases exactly as before.
 */
export declare function groupLabel(key: string, titleOf: Map<string, string | undefined>, parentKey?: string): string;
export declare function moduleLabel(id: string, title?: string): string;
/** The parent folder's label when the workspace sets none. */
export declare const LAYERS_FOLDER_DEFAULT = "Layers";
/** `dreamteamer.layersFolder` as the tree draws it: the setting trimmed, or "Layers" when it is unset,
 *  blank or not a string. */
export declare function layersFolderLabel(raw: unknown): string;
/** One top-level layers folder: its label and the layer keys it holds, in the order given. */
export type LayerGroup = {
    label: string;
    keys: string[];
};
/**
 * `dreamteamer.layersFolder` resolved against the layer keys: which top-level folder each layer sits in.
 *
 * A string (or nothing) is the ONE folder every layer nests in, labelled by `layersFolderLabel`. An
 * object maps a folder label to the key patterns it holds (`*` wildcard; one string or a list), and
 * a layer joins the FIRST folder, in the object's order, whose pattern matches it — so a catch-all
 * can sit last. A layer no pattern matches still shows, in a "Layers" folder after the others: a
 * new layer must never vanish from the nav because a pattern was not updated. A folder no layer
 * matches is not drawn.
 */
export declare function layerGroups(raw: unknown, keys: string[]): LayerGroup[];
/** One collection row inside a layer's folder. */
export type LayerRow = {
    collection: string;
    title: string;
    icon: string | undefined;
    count: number;
    route: string;
};
/** One record layer as the nav draws it. `rows` is empty for a layer with no records or no clone —
 *  `installed` says which of the two notes the folder shows. */
export type LayerFolder = {
    key: string;
    label: string;
    installed: boolean;
    rows: LayerRow[];
};
/** What `layerFolders` reads of a layer — `sourcesStack(...).layers` has exactly this shape. */
export type LayerSource = {
    name: string;
    installed: boolean;
    collections: Array<{
        collection: string;
        count: number;
    }>;
};
/**
 * The display label of every layer key: the longest dash-delimited prefix ALL the keys share is
 * stripped and each remaining segment title-cased — `org-project-alpha`, `org-project-beta-gamma` →
 * "Alpha", "Beta Gamma" — because a family of layers is named for the family first and the shared
 * words say nothing on a row that is already inside the family's folder. A single layer has no family
 * to strip and keeps its whole key. The prefix never eats a WHOLE key: `org-a` beside `org-a-b` strips
 * only `org`, so no label is ever empty.
 *
 * `titles` wins per key: a layer whose `package.json` authors `dreamteamer.title` or `title` is named
 * by it (`layerTitle` in sources.ts reads it), for the acronym a derivation cannot make.
 */
export declare function layerLabels(keys: string[], titles?: Map<string, string | undefined>): Map<string, string>;
/** The browse route a layer row opens: the collection's own route, filtered to `$source is <layer>` —
 *  the builder's `{logic, rules}` shape that `?filter=` carries (`parseFilterGroup`). */
export declare function layerRoute(d: Descriptor, layer: string): string;
/**
 * The layer folders, sorted by label: one per layer the stack names, each holding a row per
 * collection it has at least one record of, ordered as `descriptors` is (`loadDescriptors` sorts by
 * `display.nav.order`) and labelled with the collection's title and its count. A collection the
 * descriptors no longer carry is skipped rather than drawn as a dead row.
 */
export declare function layerFolders(layers: LayerSource[], descriptors: Descriptor[], titles?: Map<string, string | undefined>): LayerFolder[];
/**
 * The top-level layers folders, each with its layer folders (`layerFolders` per group, so a label
 * strips the prefix shared WITHIN its folder — `hq-*` under Personal reads by person, `org-project-*`
 * under Projects by project).
 */
export declare function groupedLayerFolders(layers: LayerSource[], descriptors: Descriptor[], raw: unknown, titles?: Map<string, string | undefined>): Array<{
    label: string;
    layers: LayerFolder[];
}>;
/** The one dim row a layer's folder shows instead of collections: "not installed" for a declared
 *  layer whose clone is absent, "no records yet" for one holding nothing; undefined when it has rows. */
export declare function layerNote(l: LayerFolder): string | undefined;
/**
 * ⚠ A LAYER'S FOLDER DRAWS THE LAYER'S OWN NAV, NOT A FLAT LIST (operator 2026-10-30: "collection list
 * on nav sub modules is flat, should be like when opening module"). A layer is another workspace, and
 * opened on its own it folds its collections by section, namespace and module and orders them by its
 * own `navOrder`; a folder of thirty bare rows under it read as a different thing. So its rows go
 * through the SAME `groupTopLevel` + `orderTopLevel` the top level does — with the LAYER's workspace
 * module (its own collections never fold, exactly as in its own window) and the LAYER's
 * `.vscode/settings.json` `navGroups` / `navOrder`, which travel with its repo. The descriptors are
 * this workspace's, because that is the schema its records are read through here.
 *
 * Every row still shows: one the record tree folds out (a runtime kind such as `repos`) has records in
 * the layer and a count to say, so it stays a top-level row rather than vanishing from the folder.
 */
export type LayerEntry = {
    kind: "row";
    row: LayerRow;
} | {
    kind: "folder";
    folder: NavFolder;
    label: string;
    entries: LayerEntry[];
};
export declare function layerEntries(rows: LayerRow[], descriptors: Descriptor[], nav: {
    declared: string[];
    workspaceModule?: string;
    dependsOn?: Map<string, string[]>;
    navGroups?: Map<string, string[]>;
    navOrder?: string[];
    titleOf?: Map<string, string | undefined>;
    namespacesOf?: Map<string, string[]>;
}): LayerEntry[];
