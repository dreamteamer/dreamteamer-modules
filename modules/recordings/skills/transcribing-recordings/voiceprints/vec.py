"""Vectors as plain lists of floats: unit, cosine, means, the robust centroid and spherical 2-means.

Standard library only (the `engines.py` rule), so a bare python3 runs everything that judges a voice
print; only `embed.py` needs numpy and sherpa-onnx.
"""
from __future__ import annotations

import math


def _norm(v):
    return math.sqrt(sum(x * x for x in v))


def unit(v):
    """`v` scaled to length 1; a zero vector stays zero."""
    n = _norm(v)
    if n == 0.0:
        return [0.0 for _ in v]
    return [x / n for x in v]


def cos(a, b):
    """Cosine of the angle between `a` and `b`; 0.0 when either is the zero vector."""
    if len(a) != len(b):
        raise ValueError(f"vectors of different dimensions: {len(a)} and {len(b)}")
    na, nb = _norm(a), _norm(b)
    if na == 0.0 or nb == 0.0:
        return 0.0
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def _sum(vs):
    vs = list(vs)
    if not vs:
        raise ValueError("no vectors")
    dim = len(vs[0])
    total = [0.0] * dim
    for v in vs:
        if len(v) != dim:
            raise ValueError(f"vectors of different dimensions: {dim} and {len(v)}")
        for i, x in enumerate(v):
            total[i] += x
    return total


def mean_unit(vs):
    """The normalised mean of `vs`, each unit-normalised first so every vector weighs the same however
    long it is (a print's vector is this over its admitted sources' centroids)."""
    return unit(_sum(unit(v) for v in vs))


def robust_centroid(vs, drop=0.30, rounds=2):
    """A label's centroid that a minority of stray windows cannot pull (design section 9).

    Each window is unit-normalised and averaged; the `drop` share of windows farthest (by cosine) from
    that average is dropped and the rest averaged again. Each of the `rounds` rounds ranks ALL windows
    against the latest average, so the kept share stays `1 - drop` and a window dropped by an early,
    pulled average can come back once the average has moved. The result is unit length.
    """
    units = [unit(v) for v in vs]
    if not units:
        raise ValueError("no vectors")
    centre = mean_unit(units)
    keep = max(1, len(units) - int(len(units) * drop))
    for _ in range(rounds):
        ranked = sorted(range(len(units)), key=lambda i: (-cos(units[i], centre), i))
        centre = mean_unit([units[i] for i in ranked[:keep]])
    return centre


def two_means(vs, iters=25):
    """Spherical 2-means over `vs`, deterministic: seeded by the farthest pair (the lowest cosine).

    Returns `(big, small, small_share, groups)`: the unit centroids of the larger and the smaller group,
    the smaller group's share of the windows, and each window's group (0 the big one, 1 the small one).
    A tie in size makes the group of the first window the big one. One window, or windows that are all
    the same, give two equal centroids and a share of 0.0.
    """
    units = [unit(v) for v in vs]
    n = len(units)
    if n == 0:
        raise ValueError("no vectors")
    if n == 1:
        return units[0], units[0], 0.0, [0]
    lo, seeds = 2.0, (0, 1)
    for i in range(n):
        for j in range(i + 1, n):
            c = cos(units[i], units[j])
            if c < lo:
                lo, seeds = c, (i, j)
    centres = [units[seeds[0]], units[seeds[1]]]
    groups = None
    for _ in range(max(1, iters)):
        new = [0 if cos(u, centres[0]) >= cos(u, centres[1]) else 1 for u in units]
        if new == groups:
            break
        groups = new
        for g in (0, 1):
            members = [u for u, k in zip(units, groups) if k == g]
            if members:
                centres[g] = mean_unit(members)
    sizes = [groups.count(0), groups.count(1)]
    big = 0 if sizes[0] > sizes[1] or (sizes[0] == sizes[1] and groups[0] == 0) else 1
    small = 1 - big
    out_groups = [0 if k == big else 1 for k in groups]
    return centres[big], centres[small], sizes[small] / n, out_groups
