"""The naming algorithm of design section 10, and the predicates enrolment shares with it.

Standard library only (the `engines.py` rule). Pure functions over plain dicts: a signature (design
section 8: `labels -> {seconds, share, longest_turn, windows: [{start, end, vector}]}`, `diarization ->
{id, labels, speakers_hint, fallback}`, `removed`), a recording context (task 7: `candidates`,
`attendee_count`, `attendee_count_certain`, `meeting`), prints (design section 8: `vector`, `trust`,
`auto`, `known_as`) and a calibration. Nothing here reads or writes a file, and nothing it returns
carries a vector.

The shared predicates (ruling D15) — `long_turn` (check 4), `two_voices` (check 5), `label_centroid`
and `usable` (step 3) — are public so `enrol` imports them rather than re-implementing them. This module
never imports `enrol`: it reads a print's `trust` and `auto` as they are stored (ruling D7).
"""
from __future__ import annotations

import re

from . import vec

LONG_TURN = 300.0        # check 4: a turn over five minutes ...
MAX_SHARE = 0.90         # ... or over 90% of the speech, in a diarisation of two or more labels
SMALL_GROUP = 0.20       # check 5: the smaller 2-means group holds at least a fifth of the windows
MIN_SPEECH = 20.0        # a label under 20 s of speech gets a proposal, never a written name

# The placeholders of the plan's global constraints. `decide` uses them only when there is no
# calibration, and then only to PROPOSE (and to refuse: steps 3 and 5's flags); never to write a name.
UNCALIBRATED = {"accept": 0.80, "accept_open": 0.85, "margin": 0.10, "same": 0.75, "split": 0.55, "suggest": 0.65}

COLLAPSED = "collapsed"
MIXED = "mixed-suspected"
VOICES = "may-hold-more-than-one-voice"
CONFLICT = "conflicts-with:"


# -- labels ---------------------------------------------------------------------------------------------
def _order(label):
    m = re.fullmatch(r"(.*?)(\d+)", label)
    return (m.group(1), int(m.group(2)), label) if m else (label, -1, label)


def display(label):
    """`speaker_3` as a transcript shows it: `Speaker 3` (render.py's spelling)."""
    m = re.fullmatch(r"speaker_(\d+)", label)
    return f"Speaker {m.group(1)}" if m else label


def no_match_line(label):
    """The per-label report of acceptance line 2."""
    return f"{display(label)}: no known voice matched"


def _labels(sig):
    return (sig or {}).get("labels") or {}


def _vectors(sig, label):
    return [w["vector"] for w in (_labels(sig).get(label) or {}).get("windows") or [] if w.get("vector")]


# -- the shared predicates ------------------------------------------------------------------------------
def label_centroid(sig, label):
    """The robust centroid of the label's windows (design section 9); None when it has none."""
    vs = _vectors(sig, label)
    return vec.robust_centroid(vs) if vs else None


def long_turn(label, sig):
    """Check 4: the diarisation has two or more labels and this label's longest turn is over 300 s or its
    share of the speech over 0.90. It reads the signature only, so it needs no meeting."""
    labels = _labels(sig)
    if len(labels) < 2 or label not in labels:
        return False
    st = labels[label]
    return float(st.get("longest_turn") or 0.0) > LONG_TURN or float(st.get("share") or 0.0) > MAX_SHARE


def two_voices(label, sig, split):
    """Check 5: the label's windows split by spherical 2-means give two centroids whose cosine is below
    `split` while the smaller group holds at least 20% of the windows. Under two windows: one voice."""
    vs = _vectors(sig, label)
    if len(vs) < 2:
        return False
    big, small, share, _ = vec.two_means(vs)
    return share >= SMALL_GROUP and vec.cos(big, small) < split


def usable(sig, attendee_count, attendee_count_certain, thresholds):
    """Step 3: is the diarisation usable? Rows in order; for each label the first row that matches wins.

    Returns `{outcome, flags: {label: [flag]}, reports: [str]}`, `outcome` one of:
    - `collapsed` — one label and an attendee count of two or more, however the label came about;
      the label is flagged `collapsed` (no machine name and no question);
    - `solo` — one label and an attendee count of one, or no count and `--speakers 1` declared, and the
      label holds one voice; a solo label holding two voices is `mixed-suspected` and flagged
      `may-hold-more-than-one-voice`;
    - `mixed-suspected` — two or more labels, the count forced (`speakers_hint`) or equal to the attendee
      count, and two labels' centroids reach `same`: both flagged `mixed-suspected`. An UNCERTAIN count
      is taken to equal any label count up to it (the real count may be lower);
    - `usable` — otherwise.
    Then any label not yet flagged that fails check 4 or 5 is suspect: flagged
    `may-hold-more-than-one-voice` (outcome unchanged). Labels in the file's `removed` are skipped.

    Enrolment's admission calls it with the file's `speakers_hint` as the count (None when
    unconstrained).
    """
    labels = sorted(_labels(sig), key=_order)
    removed = set((sig or {}).get("removed") or [])
    diar = (sig or {}).get("diarization") or {}
    hint, fallback = diar.get("speakers_hint"), diar.get("fallback")
    split, same = thresholds["split"], thresholds["same"]
    flags, reports = {}, []

    if len(labels) == 1:
        only = labels[0]
        if attendee_count is not None and attendee_count >= 2:
            how = (f"the diariser fell back: {fallback}" if fallback
                   else "one speaker was declared" if hint == 1 else "the diariser found one voice")
            reports.append(f"{display(only)} is the only speaker label but {attendee_count} speakers are "
                           f"expected ({how}): no name and no question — transcribe again with "
                           f"--speakers {attendee_count}")
            return {"outcome": "collapsed", "flags": {only: [COLLAPSED]}, "reports": reports}
        if attendee_count == 1 or (attendee_count is None and hint == 1):
            if only not in removed and two_voices(only, sig, split):
                reports.append(f"{display(only)} is the only speaker label and holds two voices: "
                               "a mixed diarisation is suspected; no name")
                return {"outcome": MIXED, "flags": {only: [VOICES]}, "reports": reports}
            return {"outcome": "solo", "flags": {}, "reports": []}

    outcome = "usable"
    n = len(labels)
    if n >= 2:
        may_equal = attendee_count is not None and (
            n == attendee_count or (not attendee_count_certain and n <= attendee_count))
        if hint is not None or may_equal:
            cents = [(l, label_centroid(sig, l)) for l in labels if l not in removed]
            cents = [(l, c) for l, c in cents if c is not None]
            for i in range(len(cents)):
                for j in range(i + 1, len(cents)):
                    (a, ca), (b, cb) = cents[i], cents[j]
                    if vec.cos(ca, cb) >= same:
                        flags[a], flags[b] = [MIXED], [MIXED]
                        reports.append(f"{display(a)} and {display(b)} sound alike although each attendee "
                                       "should have a label of their own: a mixed diarisation is suspected; "
                                       "no name on either")
                        outcome = MIXED
    for l in labels:
        if l in flags or l in removed:
            continue
        if long_turn(l, sig):
            flags[l] = [VOICES]
            reports.append(f"{display(l)} has a turn over five minutes or most of the speech: "
                           "it may hold more than one voice; no name from a voice print")
        elif two_voices(l, sig, split):
            flags[l] = [VOICES]
            reports.append(f"{display(l)} holds two distinct voices in its windows: "
                           "it may hold more than one voice; no name from a voice print")
    return {"outcome": outcome, "flags": flags, "reports": reports}


# -- the naming algorithm --------------------------------------------------------------------------------
def _key(name):
    return " ".join(str(name or "").split()).casefold()


def decide(sig, ctx, prints, existing, calib):
    """Design section 10, steps 0 to 8, over one signature. Computes everything and writes nothing.

    `ctx` is task 7's context, `prints` maps a person reference to its print for this workspace,
    `existing` is `{label: {name, person?, status}}` from the record, `calib` is None or
    `{model, thresholds, print_closed, print_open, source}`.

    Returns `{outcome, names: {label: {person, score, margin}}, proposals: {label: {person, origin,
    why}}, flags: {label: [flag]}, reports: [str]}`; no vector. `outcome` is `collapsed` or
    `mixed-suspected` when step 3 or step 5 refuses, else `named` (every label now has a name),
    `none` (nothing named, proposed or flagged) or `waiting`.

    - Step 0: with no calibration nothing is named; proposals and refusals use `UNCALIBRATED`.
    - Step 2: a label with a name of any status keeps it and is not proposed for; it is scored, and a
      different person it would be accepted as is reported. Its person (by `person`, else by the name
      string against the candidates) is taken: a label another taken person's print would be accepted
      on is flagged `conflicts-with:<label>` and gets nothing. A taken person still counts as a rival
      in the margin test (a voice between two people is not named).
    - Step 3 (`usable`) runs before any naming; its flagged labels get no machine name. With no meeting
      a declared `speakers_hint` stands in for the attendee count, exactly as enrolment's admission calls
      `usable`, so one label under `--speakers 2` (a fallback) is `collapsed` here too. A step-3 flag on a
      label that already has a name (any status) is informational: it is reported but kept out of
      `flags`, because that label is never rewritten nor re-asked (section 11); a record whose every
      label has a name is `named` (a `collapsed` diarisation stays `collapsed`).
    - Step 4 folds alike unflagged, unnamed labels when the diariser was unconstrained or there are
      more labels than attendees; a group's name lands on each of its labels.
    - Step 5: greedy one-to-one by score; accepted only from a `trusted` print with `auto` true, at
      `accept` (`accept_open` with no meeting; a contact never without one), beating every other
      candidate and every other label by `margin`. A pair at `suggest` that is not accepted is a
      proposal (`origin: print`). Before the pairing, two or more groups that both RESEMBLE one print —
      each at `suggest` or above, within `margin` of the best of them — contradict each other (line 4),
      whatever the print's trust or `auto`: all are flagged `mixed-suspected`, none is named or
      proposed, and the outcome is `mixed-suspected`. `suggest` is the bar because it is where the print
      would otherwise preselect one of two labels that both sound like it.
    - Step 6: elimination proposes only (`origin: attendees`), with a certain count equal to the
      groups; never onto a group carrying any flag (step 3's suspect or mixed, step 5's mixed, a
      conflict), nor against the left attendee's own trusted print scoring below `suggest`.
    - Step 7: a label at `accept` against a trusted print of a workspace user not on the invite is
      reported, never named, by the name of the print's `known_as` entry for `ctx["workspace"]`; a print
      known only in other workspaces is reported as resembling a print from another workspace, with no
      name. An unnamed label with nothing to say gets `no_match_line`.
    - Step 8: `print_closed` (with a meeting) or `print_open` (without) must be `auto` to write.
    """
    existing = existing or {}
    prints = prints or {}
    ctx = ctx or {}
    th = dict(calib["thresholds"]) if calib else dict(UNCALIBRATED)
    meeting = ctx.get("meeting")
    count = ctx.get("attendee_count") if meeting is not None else None
    certain = bool(ctx.get("attendee_count_certain")) and count is not None
    thr = th["accept"] if meeting is not None else th["accept_open"]
    thr_name = "accept" if meeting is not None else "accept_open"
    margin, suggest, same = th["margin"], th["suggest"], th["same"]
    switch = (calib or {}).get("print_closed" if meeting is not None else "print_open")
    hint = ((sig or {}).get("diarization") or {}).get("speakers_hint")

    names, proposals, flags, reports = {}, {}, {}, []

    def result(outcome):
        return {"outcome": outcome, "names": names, "proposals": proposals, "flags": flags, "reports": reports}

    # step 0
    if calib is None:
        reports.append("no calibration for the active speaker model: voices are proposed, no name is written")

    labels = sorted(_labels(sig), key=_order)
    removed = set((sig or {}).get("removed") or [])
    if not labels:
        reports.append("no speaker label to name")
        return result("none")

    # step 1: candidates, made distinct by reference, in the context's order
    cand, order = {}, []
    for c in ctx.get("candidates") or []:
        if c.get("person") and c["person"] not in cand:
            cand[c["person"]] = c
            order.append(c["person"])
    by_name = {}
    for p in order:
        k = _key(cand[p].get("name"))
        by_name[k] = None if k in by_name else p          # a name two candidates share matches nobody

    def pname(p):
        return cand[p].get("name") or p

    def pr(p):
        return prints.get(p) or {}

    def trusted(p):
        return pr(p).get("trust") == "trusted"

    def writes(p):
        return trusted(p) and pr(p).get("auto") is True

    def writable_kind(p):
        return meeting is not None or cand[p].get("kind") != "contact"

    # step 2: names already on the record, and whom they take
    held, taken = {}, {}
    for l in labels:
        e = existing.get(l) or {}
        if not e.get("name"):
            continue
        p = e.get("person") or by_name.get(_key(e["name"]))
        held[l] = p
        if p and p not in taken:
            taken[p] = l

    # step 3: refusals win before any naming. Without a meeting the declared count stands in for the
    # attendee count — the call enrolment's admission makes — so the two agree on one signature.
    if meeting is not None:
        u = usable(sig, count, certain, th)
    else:
        u = usable(sig, hint, hint is not None, th)
    reports.extend(u["reports"])
    if u["outcome"] == "collapsed":
        flags.update({l: list(fs) for l, fs in u["flags"].items()})
        return result("collapsed")
    for l, fs in u["flags"].items():
        if l not in held:                 # a named label is never re-asked: its flag is informational
            flags[l] = list(fs)
    mixed = u["outcome"] == MIXED and any(l in flags for l in labels)
    if mixed and len(labels) == 1:
        return result(MIXED)

    cent = {}
    for l in labels:
        if l not in removed:
            c = label_centroid(sig, l)
            if c is not None:
                cent[l] = c

    # step 4: fold over-split labels among those that may be machine-named
    eligible = [l for l in labels if l in cent and l not in held and l not in flags]
    parent = {l: l for l in eligible}

    def root(l):
        while parent[l] != l:
            l = parent[l]
        return l

    if hint is None or (count is not None and len(labels) > count):
        for i in range(len(eligible)):
            for j in range(i + 1, len(eligible)):
                a, b = eligible[i], eligible[j]
                if vec.cos(cent[a], cent[b]) >= same:
                    ra, rb = root(a), root(b)
                    if ra != rb:
                        parent[max(ra, rb, key=_order)] = min(ra, rb, key=_order)
    members = {}
    for l in eligible:
        members.setdefault(root(l), []).append(l)
    groups = [tuple(m) for _, m in sorted(members.items(), key=lambda kv: _order(kv[0]))]
    others = [(l,) for l in labels if l in cent and l not in eligible]
    every = groups + others
    gcent = {}
    for g in every:
        gcent[g] = cent[g[0]] if len(g) == 1 else vec.robust_centroid([v for l in g for v in _vectors(sig, l)])

    # step 5: scores against every candidate with a print
    scored = [p for p in order if pr(p).get("vector")]
    S = {(g, p): vec.cos(gcent[g], pr(p)["vector"]) for g in every for p in scored}

    def row_lead(g, p):
        rivals = [S[g, q] for q in scored if q != p]
        return S[g, p] - max(rivals) if rivals else None

    def col_lead(g, p):
        rivals = [S[h, p] for h in every if h != g]
        return S[g, p] - max(rivals) if rivals else None

    def acceptable_row(g, p):
        lead = row_lead(g, p)
        return writes(p) and writable_kind(p) and S[g, p] >= thr and (lead is None or lead >= margin)

    # a name on the record, disagreeing with the voice: reported, never rewritten
    for g in others:
        l = g[0]
        if l not in held:
            continue
        best = [p for p in scored if acceptable_row(g, p)]
        if best and best[0] != held[l]:
            reports.append(f"{display(l)} is named {existing[l]['name']} on the record but its voice matches "
                           f"{pname(best[0])} (score {S[g, best[0]]:.2f}); the name is kept")

    # a person already named on another label: no name here, flagged and asked
    conflict = set()
    for g in groups:
        for p in scored:
            if p in taken and acceptable_row(g, p):
                conflict.add(g)
                for l in g:
                    flags.setdefault(l, []).append(CONFLICT + taken[p])
                    reports.append(f"{display(l)} sounds like {pname(p)} (score {S[g, p]:.2f}), who is already "
                                   f"named on {display(taken[p])}: no name written; asked")
                break

    # two groups both resembling one print — trusted or not — contradict each other (line 4)
    active = [g for g in groups if g not in conflict]
    contradicted = set()
    for p in scored:
        if p in taken:
            continue
        hits = sorted(((S[g, p], i) for i, g in enumerate(active) if S[g, p] >= suggest),
                      key=lambda t: (-t[0], t[1]))
        if len(hits) >= 2 and hits[0][0] - hits[1][0] < margin:
            close = [active[i] for s, i in hits if hits[0][0] - s < margin]
            contradicted.update(close)
            for g in close:
                for l in g:
                    if MIXED not in flags.setdefault(l, []):
                        flags[l].append(MIXED)
            reports.append(" and ".join(display(g[0]) for g in close) + f" both resemble {pname(p)}'s voice "
                           "print and not each other: a mixed diarisation is suspected; no name on either")
            mixed = True

    # greedy one-to-one, in order of score
    free = [g for g in active if g not in contradicted]
    pool = [p for p in scored if p not in taken]
    pairs = sorted(((S[g, p], gi, pi) for gi, g in enumerate(free) for pi, p in enumerate(pool)
                    if S[g, p] >= suggest), key=lambda t: (-t[0], t[1], t[2]))
    used_g, used_p = set(), set()
    for s, gi, pi in pairs:
        g, p = free[gi], pool[pi]
        if g in used_g or p in used_p:
            continue
        used_g.add(g)
        used_p.add(p)
        rl, cl = row_lead(g, p), col_lead(g, p)
        if not trusted(p):
            why = "the voice print is not trusted yet"
        elif pr(p).get("auto") is not True:
            why = "the voice print was corrected and only proposes"
        elif not writable_kind(p):
            why = "no meeting is linked: a contact is proposed, never written"
        elif s < thr:
            why = f"score {s:.2f} is below {thr_name} {thr:.2f}"
        elif rl is not None and rl < margin:
            why = f"another candidate is within the margin ({rl:.2f})"
        elif cl is not None and cl < margin:
            why = f"another speaker label is as close to this voice print ({cl:.2f})"
        elif calib is None:
            why = "no calibration for the active speaker model"
        elif switch != "auto":
            why = "the calibration only proposes"
        else:
            why = None
        leads = [x for x in (rl, cl) if x is not None]
        for l in g:
            if why is None and float(_labels(sig)[l].get("seconds") or 0.0) >= MIN_SPEECH:
                names[l] = {"person": p, "score": round(s, 4), "margin": round(min(leads) if leads else s, 4)}
            else:
                proposals[l] = {"person": p, "origin": "print",
                                "why": why or f"under {MIN_SPEECH:.0f} s of speech"}

    # step 6: elimination, a proposal only
    if meeting is not None and certain:
        voices = groups + [(l,) for l in labels if l not in eligible]
        if len(voices) == count:
            spoken = set(taken) | {n["person"] for n in names.values()} | {x["person"] for x in proposals.values()}
            left_people = [p for p in order if p not in spoken]
            left_groups = [g for g in voices if not any(l in held or l in names or l in proposals for l in g)]
            if len(left_people) == 1 and len(left_groups) == 1:
                g, p = left_groups[0], left_people[0]
                blocked = any(l in removed or flags.get(l) for l in g)     # any flag: asked, never preselected
                against = g in gcent and p in scored and trusted(p) and S[g, p] < suggest
                if not blocked and not against:
                    for l in g:
                        proposals[l] = {"person": p, "origin": "attendees", "why": "the only attendee left"}

    # step 7: what stays unnamed
    uninvited = [p for p in sorted(prints) if p not in cand and p.startswith("users/")
                 and prints[p].get("trust") == "trusted" and prints[p].get("vector")] if meeting is not None else []
    for l in labels:
        if l in removed or l in held or l in names or l in proposals or l in flags:
            continue
        said = False
        if l in cent:
            elsewhere = False
            for p in uninvited:
                if vec.cos(cent[l], prints[p]["vector"]) < th["accept"]:
                    continue
                # only this workspace's name for the person; one known elsewhere is never named
                mine = [k for k in prints[p].get("known_as") or [] if k.get("workspace") == ctx.get("workspace")
                        and k.get("person") == p and k.get("name")]
                if mine:
                    reports.append(f"{display(l)} sounds like {mine[0]['name']}, who was not invited")
                    said = True
                else:
                    elsewhere = True
            if elsewhere and not said:
                reports.append(f"{display(l)} resembles a voice print from another workspace")
                said = True
        if not said:
            reports.append(no_match_line(l))

    open_labels = [l for l in labels if l not in removed and l not in held and l not in names]
    if not open_labels:
        return result("named")
    if mixed:
        return result(MIXED)
    if not names and not proposals and not flags:
        return result("none")
    return result("waiting")
