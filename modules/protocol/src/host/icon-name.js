/**
 * Icon names: ONE vocabulary, codicons.
 *
 * ⚠ This replaces a 3.8 MB Material Symbols font (3,895 glyphs, ~40 in use) with VS Code's own
 * 148 KB codicon set — and, more importantly, deletes the second vocabulary. The native tree can
 * only draw codicons, so a material name in a descriptor had to be TRANSLATED for the tree while
 * the webview drew it directly; that map was hand-maintained, and an unmapped name fell back to a
 * generic cylinder with no error. One set both halves can draw means nothing to keep in sync.
 *
 * `LEGACY` stays because a descriptor is DATA: a workspace written before this change (or copied
 * from a recipe that was) still carries material names, and silently drawing the fallback glyph is
 * the failure this whole change exists to end. It is a compatibility shim, not a vocabulary —
 * nothing in this repo may add to it, and new icons are codicon names.
 */
/** Material Symbols names this workspace family used → the codicon that carries the same meaning. */
const LEGACY = {
    // chrome
    close: 'close', add: 'add', delete: 'trash', chevron_right: 'chevron-right', chevron_left: 'chevron-left',
    expand_more: 'chevron-down', expand_less: 'chevron-up', keyboard_arrow_up: 'chevron-up',
    keyboard_arrow_down: 'chevron-down', arrow_upward: 'arrow-up', arrow_downward: 'arrow-down',
    arrow_forward: 'arrow-right', arrow_back: 'arrow-left', arrow_drop_down: 'triangle-down',
    more_vert: 'ellipsis', drag_indicator: 'gripper', search: 'search', edit: 'edit', edit_note: 'edit',
    save: 'save', undo: 'discard', content_copy: 'copy', check: 'check', commit: 'git-commit',
    filter_list: 'filter', filter_alt: 'filter', view_column: 'split-horizontal', width: 'arrow-both',
    hourglass_top: 'loading', progress_activity: 'loading', warning: 'warning', priority_high: 'warning',
    info: 'info', lock: 'lock', key: 'key', location_off: 'circle-slash', add_reaction: 'symbol-color',
    bookmark_add: 'bookmark', star: 'star-full', star_outline: 'star-empty', terminal: 'terminal',
    tune: 'settings', folder: 'folder', link: 'link', list: 'list-unordered', notes: 'note',
    // layouts
    table_rows: 'list-flat', view_list: 'list-flat', grid_view: 'layout', view_kanban: 'project',
    calendar_month: 'calendar', map: 'globe', table_chart: 'table', dashboard_customize: 'dashboard',
    data_usage: 'dashboard', database: 'database', schema: 'symbol-structure', hub: 'type-hierarchy',
    account_tree: 'type-hierarchy-sub', deployed_code: 'package', inbox: 'inbox',
    // records
    person: 'person', contacts: 'person', badge: 'account', group: 'organization', groups: 'organization',
    business: 'organization', apartment: 'organization', domain: 'briefcase', task_alt: 'checklist',
    checklist: 'checklist', flag: 'flag', article: 'file', source: 'file-code', smart_toy: 'robot',
    rocket_launch: 'rocket', rate_review: 'report', fact_check: 'verified', event: 'calendar',
    event_note: 'calendar', today: 'clock', schedule: 'clock', timer: 'watch', date_range: 'milestone',
    history: 'history', history_edu: 'history', mic: 'mic', summarize: 'note', forum: 'comment-discussion',
    sticky_note_2: 'comment', psychology: 'lightbulb', lightbulb: 'lightbulb', insights: 'graph',
    alt_route: 'git-branch', bolt: 'zap', activity: 'pulse', alert: 'warning', hotel: 'home',
    image: 'file-media', inventory_2: 'package',
};
/** The glyph to draw for a descriptor's `icon:` — a codicon name, or the legacy translation. */
export function codiconFor(name) {
    if (!name)
        return 'circle-outline';
    return LEGACY[name] ?? name;
}
