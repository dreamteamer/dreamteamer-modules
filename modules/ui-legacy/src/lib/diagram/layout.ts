/**
 * Position solvers for diagrams. Layout only — nothing here knows about Vue Flow, the DOM, or how a
 * node looks. Two solvers, because two shapes of graph need genuinely different treatment:
 *
 * - `layoutGrouped` — dagre per group, group boxes packed into rows. For models with a declared
 *   partition (a schema's `group:`, a module's collections).
 * - `layoutForce` — a settled d3-force simulation. For meshes with no natural rank.
 *
 * ## Why per-group, and not one dagre run
 *
 * One dagre pass over the whole schema draws a ~9000px column. This workspace is wide and shallow —
 * ~34 connected collections but few long reference chains — so nearly every node lands on rank 0 and
 * same-rank nodes stack along the cross axis. Switching `rankdir` only rotates the problem, and it
 * also breaks the left/right field handles an ERD wants.
 *
 * So: run dagre once PER group, then pack the resulting group boxes into rows. That fixes the
 * aspect ratio, makes the group container an exact bounding box rather than a guess, and matches how
 * the workspace already describes itself — the groups are the operator's own partition of the model.
 *
 * dagre reports node positions as CENTRES; Vue Flow wants top-left. That conversion happens here,
 * once, so no component has to remember it.
 */
import dagre from '@dagrejs/dagre';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';

export interface LayoutBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SizedNode {
	id: string;
	width: number;
	height: number;
	/** The model's group id. Ungrouped nodes are packed together as one unlabelled block. */
	group?: string;
}

export interface GroupedResult {
	positions: Map<string, { x: number; y: number }>;
	/** One box per named group, in graph coordinates, padded for its label. */
	groupBoxes: Map<string, LayoutBox>;
}

/** Room for the container's border and its title above the first member. */
const PAD = 26;
const PAD_TOP = 46;
/** Gap between packed group boxes. */
const GUTTER = 56;

const UNGROUPED = '';

export function layoutGrouped(
	nodes: SizedNode[],
	edges: Array<{ source: string; target: string }>,
	opts: { rankdir?: 'LR' | 'TB'; nodesep?: number; ranksep?: number } = {},
): GroupedResult {
	const byGroup = new Map<string, SizedNode[]>();
	for (const n of nodes) {
		const key = n.group ?? UNGROUPED;
		if (!byGroup.has(key)) byGroup.set(key, []);
		byGroup.get(key)!.push(n);
	}

	// Each group is solved in ITS OWN coordinate space, then translated during packing.
	const local = new Map<string, { positions: Map<string, { x: number; y: number }>; box: LayoutBox }>();
	for (const [group, members] of byGroup) {
		const ids = new Set(members.map((m) => m.id));
		// Only intra-group edges shape a group's internal ranking; a cross-group edge is still drawn,
		// it just doesn't get to drag one group's layout around to satisfy another's.
		const inner = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
		local.set(group, solveBestAspect(members, inner, opts));
	}

	// Pack: named groups first (they carry the visual structure), the ungrouped block last.
	const order = [...local.keys()].sort((a, b) => {
		if (a === UNGROUPED) return 1;
		if (b === UNGROUPED) return -1;
		return a.localeCompare(b);
	});

	/**
	 * Where to wrap. A FIXED wrap width is wrong at both ends — it ribbons a big model into a column
	 * and it spreads a small one into a single row — so it is derived from the material instead: the
	 * width a screen-shaped rectangle of this much group area would have. Measured 2026-08-11, the
	 * a large private workspace's schema (51 collections) at a fixed 2600 packed one group per row and came out 2142 × 8915, which fits at
	 * 0.10 and is unreadable at any size.
	 *
	 * Floored at the widest single group, since nothing can wrap narrower than its widest member.
	 */
	const area = [...local.values()].reduce((sum, s) => sum + s.box.width * s.box.height, 0);
	const widest = Math.max(0, ...[...local.values()].map((s) => s.box.width));
	const wrapAt = Math.max(widest, Math.sqrt(area * IDEAL_ASPECT));

	const positions = new Map<string, { x: number; y: number }>();
	const groupBoxes = new Map<string, LayoutBox>();

	let cursorX = 0;
	let rowY = 0;
	let rowHeight = 0;

	for (const group of order) {
		const solved = local.get(group)!;
		const w = solved.box.width;
		const h = solved.box.height;

		if (cursorX > 0 && cursorX + w > wrapAt) {
			cursorX = 0;
			rowY += rowHeight + GUTTER;
			rowHeight = 0;
		}

		const dx = cursorX - solved.box.x;
		const dy = rowY - solved.box.y;
		for (const [id, p] of solved.positions) positions.set(id, { x: p.x + dx, y: p.y + dy });
		if (group !== UNGROUPED) groupBoxes.set(group, { x: cursorX, y: rowY, width: w, height: h });

		cursorX += w + GUTTER;
		rowHeight = Math.max(rowHeight, h);
	}

	return { positions, groupBoxes };
}

/** A screen is wider than it is tall, and so a diagram should be. */
const IDEAL_ASPECT = 1.7;

/**
 * Solve one group twice — TB and LR — and keep whichever comes out closer to screen-shaped.
 *
 * Neither direction is right for every group, and picking one globally is what made the first ERD
 * unreadable: a group whose members form a REFERENCE CHAIN (contacts → companies → meetings →
 * summaries → briefs) gets one dagre rank per link, so under TB it draws a ~3000px column of
 * 232px-wide boxes; measured 2026-08-11, the whole schema came out 2390 × 8165 and fitted at 0.10,
 * where a table's field rows are one pixel each. The same group under LR is wide and short. A group
 * of mostly UNCONNECTED members is the mirror image — every node lands on rank 0, so LR stacks them
 * into a column and TB spreads them.
 *
 * Two dagre runs over tens of nodes are microseconds, so the cheap answer is to run both and
 * measure, rather than to guess a direction and be wrong for half the groups.
 *
 * The field handles stay left/right regardless: they anchor where a reference LEAVES and ARRIVES,
 * which is a property of the row, not of the ranking.
 */
function solveBestAspect(
	members: SizedNode[],
	edges: Array<{ source: string; target: string }>,
	opts: { rankdir?: 'LR' | 'TB'; nodesep?: number; ranksep?: number },
): { positions: Map<string, { x: number; y: number }>; box: LayoutBox } {
	// An explicit rankdir is an instruction, not a hint — honour it and skip the contest.
	if (opts.rankdir) return solve(members, edges, opts);

	const candidates = (['TB', 'LR'] as const).map((rankdir) => solve(members, edges, { ...opts, rankdir }));
	let best = candidates[0]!;
	let bestCost = Infinity;
	for (const c of candidates) {
		if (c.box.width <= 0 || c.box.height <= 0) continue;
		// Log distance, so "twice as wide as ideal" and "half as wide" cost the same.
		const cost = Math.abs(Math.log(c.box.width / c.box.height) - Math.log(IDEAL_ASPECT));
		if (cost < bestCost) {
			bestCost = cost;
			best = c;
		}
	}
	return best;
}

/** One dagre run over one group, returning member positions and the padded bounding box. */
function solve(
	members: SizedNode[],
	edges: Array<{ source: string; target: string }>,
	opts: { rankdir?: 'LR' | 'TB'; nodesep?: number; ranksep?: number },
): { positions: Map<string, { x: number; y: number }>; box: LayoutBox } {
	const g = new dagre.graphlib.Graph();
	g.setGraph({
		// TB *inside* a group. Within a group the same stacking problem recurs — a group of eight
		// collections with two edges puts six of them on rank 0, which under LR is a tall narrow
		// column and makes every group box tall. TB spreads a rank horizontally, so groups come out
		// wide and pack into few rows. The field handles stay left/right regardless: they anchor
		// where a reference LEAVES and ARRIVES, which is a property of the row, not of the ranking.
		rankdir: opts.rankdir ?? 'TB',
		nodesep: opts.nodesep ?? 46,
		ranksep: opts.ranksep ?? 110,
		marginx: 0,
		marginy: 0,
	});
	g.setDefaultEdgeLabel(() => ({}));

	for (const m of members) g.setNode(m.id, { width: m.width, height: m.height });

	// A duplicate edge pair only thickens the ranking; a self-reference has nothing to rank against.
	const seen = new Set<string>();
	for (const e of edges) {
		if (e.source === e.target) continue;
		const key = `${e.source} ${e.target}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
	}

	dagre.layout(g);

	const positions = new Map<string, { x: number; y: number }>();
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const m of members) {
		const laid = g.node(m.id) as { x: number; y: number } | undefined;
		// dagre returns centres, and NaN for anything it failed to place.
		const x = laid && Number.isFinite(laid.x) ? laid.x - m.width / 2 : 0;
		const y = laid && Number.isFinite(laid.y) ? laid.y - m.height / 2 : 0;
		positions.set(m.id, { x, y });
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + m.width);
		maxY = Math.max(maxY, y + m.height);
	}

	if (!Number.isFinite(minX)) return { positions, box: { x: 0, y: 0, width: 0, height: 0 } };

	return {
		positions,
		box: { x: minX - PAD, y: minY - PAD_TOP, width: maxX - minX + PAD * 2, height: maxY - minY + PAD_TOP + PAD },
	};
}

/**
 * Settled force layout for meshes with no natural rank. Ticked synchronously rather than animated:
 * a live simulation fighting Vue's reactivity spends a frame budget on motion nobody asked for, and
 * a diagram that drifts under the cursor is harder to read.
 *
 * Constants tuned against a large private workspace's `meetings` (144 records → ~304 nodes). The first pass used -320
 * charge and 110px links and spread the cloud so far that fit-view landed at a zoom where every
 * node was a speck. Density is the point: a vault graph should read as a constellation, and detail
 * arrives by zooming in. 300 ticks is where this graph shape stops moving perceptibly; running it
 * synchronously keeps the render deterministic — the same data always draws the same picture.
 */
export function layoutForce(
	nodes: Array<{ id: string }>,
	edges: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number }> {
	const sim = nodes.map((n) => ({ id: n.id })) as Array<{ id: string; x?: number; y?: number }>;
	const links = edges.map((e) => ({ source: e.source, target: e.target }));

	forceSimulation(sim as any)
		.force(
			'link',
			forceLink(links as any)
				.id((d: any) => d.id)
				.distance(62)
				.strength(0.45),
		)
		.force('charge', forceManyBody().strength(-140).distanceMax(420))
		.force('center', forceCenter(0, 0))
		.force('collide', forceCollide(26))
		.stop()
		.tick(300);

	const out = new Map<string, { x: number; y: number }>();
	for (const s of sim) out.set(s.id, { x: s.x ?? 0, y: s.y ?? 0 });
	return out;
}
