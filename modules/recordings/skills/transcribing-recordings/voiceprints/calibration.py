"""Calibration (design section 13): which calibration naming runs with, and the decision rule the
developer's evaluation applies before any measurement.

    active(skill_dir, store)  the active speaker model (models.active_model, never resolved here), the
                              calibration shipped for it in `<skill>/calibration/`, or the local override
                              `<store>/<model>/calibration.json`, which wins for that model only
    fit(...)                  rule 2: the thresholds of one model on its own scale, or why it fails
    qualifies / choose        rules 1, 3, 4 and 5 over each model's evaluation
    verdict(per_model)        the one verdict line and, beside it, n, the bound 3/n, what each fold's
                              thresholds were fitted on, and that the judged recording was in none of them
    build_file                the calibration file — numbers and counts only

A calibration file:

    {version, model: {id, sha256, dim}, thresholds: {accept, accept_open, margin, same, split, suggest},
     print_closed, print_open, elimination: "propose", split_weak, counts: {recordings, people, genuine,
     impostor, written, wrong}, bound, generated}

It names no person, no record, no path and holds no vector (`check_numbers_only`).

Standard library only (the `engines.py` rule).
"""
from __future__ import annotations

import math
import os

from voiceprints import models

THRESHOLDS = ("accept", "accept_open", "margin", "same", "split", "suggest")
SWITCHES = ("auto", "propose")

# Rule 1: enough evidence over the whole labelled set.
MIN_GENUINE, MIN_IMPOSTOR, MIN_RECORDINGS, MIN_PEOPLE = 16, 40, 12, 4
# Rule 2.
MIN_MARGIN = 0.05
WEAK_SHARE = 0.20          # more than one in five mixed sets passing `split` makes the check weak
# Rule 3.
THIN_BELOW = 10            # a fold with fewer genuine trials is thin
MAX_THIN = 2
MIN_WRITTEN = 11
# Rule 4.
CHOOSE_POINTS, CHOOSE_LABELS = 10.0, 3

LOCAL_FILE = "calibration.json"


class CalibrationInvalid(Exception):
    """A calibration file that cannot be used: unreadable, or missing a threshold or a switch."""


# -- the active calibration ---------------------------------------------------------------------------
def validate(obj, where="calibration file"):
    """The file as a dict, checked: a model id, the six thresholds as numbers, the two switches."""
    if not isinstance(obj, dict):
        raise CalibrationInvalid(f"{where} is not a JSON object")
    m = obj.get("model")
    mid = m.get("id") if isinstance(m, dict) else m
    if not isinstance(mid, str) or not mid:
        raise CalibrationInvalid(f"{where} names no model")
    th = obj.get("thresholds")
    if not isinstance(th, dict):
        raise CalibrationInvalid(f"{where} has no thresholds")
    for k in THRESHOLDS:
        if not isinstance(th.get(k), (int, float)) or isinstance(th.get(k), bool):
            raise CalibrationInvalid(f"{where} has no number for {k}")
    for k in ("print_closed", "print_open"):
        if obj.get(k) not in SWITCHES:
            raise CalibrationInvalid(f"{where}: {k} is {obj.get(k)!r}, not auto or propose")
    return obj


def model_id_of(obj):
    m = obj.get("model")
    return m.get("id") if isinstance(m, dict) else m


def to_calib(obj, source):
    """The calibration `naming.decide` and `enrol` read: `{model, thresholds, print_closed, print_open,
    elimination, split_weak, source}`."""
    return {"model": model_id_of(obj), "thresholds": {k: float(obj["thresholds"][k]) for k in THRESHOLDS},
            "print_closed": obj["print_closed"], "print_open": obj["print_open"],
            "elimination": "propose", "split_weak": bool(obj.get("split_weak")), "source": source}


def _read(path):
    import json
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except ValueError:
        raise CalibrationInvalid(f"calibration file {os.path.basename(path)} is not JSON")


def active(skill_dir, store):
    """`{model, calib, source}`. The model is `models.active_model(skill_dir)` — the one file in the
    skill's `calibration/` folder names it, none names `DEFAULT_MODEL`, two is an error naming both
    (`models.CalibrationAmbiguous`). `calib` is the local override `<store>/<model>/calibration.json` when
    there is one (`source: local`), else the shipped file (`source: shipped`), else None (`source: None`):
    with no calibration nothing is written as a name (design section 10, step 0)."""
    mid = models.active_model(skill_dir)
    if store is not None:
        local = store.read_json(os.path.join(store.model_dir(mid), LOCAL_FILE))
        if local is not None:
            validate(local, f"the local calibration of {mid}")
            if model_id_of(local) != mid:
                raise CalibrationInvalid(f"the local calibration in the {mid} folder names model {model_id_of(local)}")
            return {"model": mid, "calib": to_calib(local, "local"), "source": "local"}
    folder = os.path.join(skill_dir, models.CALIBRATION_SUBDIR)
    try:
        names = sorted(n for n in os.listdir(folder)
                       if not n.startswith(".") and os.path.isfile(os.path.join(folder, n)))
    except (FileNotFoundError, NotADirectoryError):
        names = []
    if names:
        shipped = validate(_read(os.path.join(folder, names[0])), f"calibration file {names[0]}")
        return {"model": mid, "calib": to_calib(shipped, "shipped"), "source": "shipped"}
    return {"model": mid, "calib": None, "source": None}


# -- statistics ---------------------------------------------------------------------------------------
def percentile(xs, q):
    """The q-th percentile (0..100) with linear interpolation between closest ranks."""
    s = sorted(float(x) for x in xs)
    if not s:
        raise ValueError("no values")
    if len(s) == 1:
        return s[0]
    pos = (len(s) - 1) * q / 100.0
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def stdev(xs):
    """The sample standard deviation; 0.0 under two values."""
    s = [float(x) for x in xs]
    if len(s) < 2:
        return 0.0
    m = sum(s) / len(s)
    return math.sqrt(sum((x - m) ** 2 for x in s) / (len(s) - 1))


def _r(x):
    return round(float(x), 4)


# -- rule 2 -------------------------------------------------------------------------------------------
def fit(genuine, impostor_closed, impostor_open, cross_label, pure_split, mixed_split, mixed_second=()):
    """Rule 2 of design section 13, exactly, for one model on its own scale.

    `genuine` are label-against-own-print scores; `impostor_open` every label-against-another-print score
    (the closed-set ones included); `impostor_closed` the subset whose print is an attendee of the label's
    recording; `cross_label` centroid cosines between labels of different heard speakers; `pure_split` the
    two-group cosine of each heard-pure label; `mixed_split` the two-group cosine of each deliberately mixed
    set whose second voice holds a fifth of the windows — check 5's line and acceptance line 8's (a set whose
    smaller group is under a fifth counts as passing: check 5 cannot fire on it); `mixed_second` the same
    for sets at 30%, a second look that is counted and printed and decides nothing.

    - accept: the highest closed-set impostor plus one (sample) standard deviation of the impostor
      scores; the model FAILS when that is above the 10th percentile of genuine scores;
    - accept_open: the same with the open-set impostors;
    - margin: half the gap between the median genuine and the 95th percentile of impostors, at least 0.05;
    - suggest: the 95th percentile of impostors; same: the 95th percentile of `cross_label`;
    - split: the 5th percentile of `pure_split`; `split_weak` when more than one in five of the mixed sets
      at a fifth pass (their cosine reaches `split`).

    Returns the six thresholds plus `split_weak`, `mixed: {pass, sets}` and `mixed_second: {pass, sets}`,
    or `{fails: reason}`."""
    if not genuine:
        return {"fails": "no genuine trial"}
    if not impostor_closed:
        return {"fails": "no closed-set impostor trial"}
    if not cross_label:
        return {"fails": "no two heard speakers in one recording to set `same`"}
    if not pure_split:
        return {"fails": "no heard-pure label to set `split`"}
    sd = stdev(impostor_open)
    accept = max(impostor_closed) + sd
    p10 = percentile(genuine, 10)
    if accept > p10:
        return {"fails": f"accept {accept:.3f} (the highest closed-set impostor {max(impostor_closed):.3f} plus one "
                         f"standard deviation {sd:.3f}) is above the 10th percentile of genuine scores {p10:.3f}"}
    p95 = percentile(impostor_open, 95)
    split = percentile(pure_split, 5)
    passing = sum(1 for x in mixed_split if x >= split)
    sets = len(mixed_split)
    second = {"pass": sum(1 for x in mixed_second if x >= split), "sets": len(mixed_second)}
    return {"accept": _r(accept), "accept_open": _r(max(impostor_open) + sd),
            "margin": _r(max(MIN_MARGIN, (percentile(genuine, 50) - p95) / 2.0)),
            "same": _r(percentile(cross_label, 95)), "split": _r(split), "suggest": _r(p95),
            "split_weak": bool(sets) and passing / sets > WEAK_SHARE, "mixed": {"pass": passing, "sets": sets},
            "mixed_second": second}


def thresholds(f):
    return {k: f[k] for k in THRESHOLDS}


# -- rules 1, 3, 4, 5 ---------------------------------------------------------------------------------
def sufficient(evidence):
    """Rule 1 over the whole labelled set: `(ok, why)`."""
    e = evidence or {}
    short = []
    for key, need, what in (("genuine", MIN_GENUINE, "genuine"), ("impostor", MIN_IMPOSTOR, "impostor"),
                            ("recordings", MIN_RECORDINGS, "recordings"), ("people", MIN_PEOPLE, "people with prints")):
        if int(e.get(key) or 0) < need:
            short.append(f"{int(e.get(key) or 0)} {what} (at least {need})")
    if short:
        return False, "gold evidence short: " + ", ".join(short)
    return True, None


def qualifies(r):
    """Rule 3 (with rules 1 and 2) for one model's evaluation: `(ok, reasons)`."""
    reasons = []
    ok, why = sufficient(r.get("evidence"))
    if not ok:
        reasons.append(why)
    fit_ = r.get("fit") or {}
    if "fails" in fit_:
        reasons.append(f"its scores do not separate: {fit_['fails']}")
    if int(r.get("thin") or 0) > MAX_THIN:
        reasons.append(f"{r['thin']} thin folds (at most {MAX_THIN})")
    if int(r.get("wrong") or 0):
        reasons.append(f"{r['wrong']} wrong names")
    if int(r.get("written") or 0) < MIN_WRITTEN:
        reasons.append(f"{int(r.get('written') or 0)} names written (at least {MIN_WRITTEN})")
    eligible, named = int(r.get("eligible") or 0), int(r.get("named_eligible") or 0)
    if not eligible:
        reasons.append("no label had a trusted print of its speaker")
    elif named * 2 < eligible:
        reasons.append(f"named {named} of {eligible} labels whose speaker had a trusted print (at least half)")
    if int(r.get("enrolled_mixed") or 0):
        reasons.append(f"enrolled from {r['enrolled_mixed']} labels heard as mixed")
    return not reasons, reasons


def _rate(r):
    j = int(r.get("judged") or 0)
    return 100.0 * int(r.get("written") or 0) / j if j else 0.0


def choose(per_model):
    """Rule 4: `{kind: insufficient | none | chosen, model, why}`."""
    if not any(sufficient(r.get("evidence"))[0] for r in per_model.values()):
        why = next((sufficient(r.get("evidence"))[1] for r in per_model.values()), "nothing was evaluated")
        return {"kind": "insufficient", "model": None, "why": why}
    qual = [mid for mid, r in per_model.items() if qualifies(r)[0]]
    if not qual:
        return {"kind": "none", "model": None, "why": "no model qualifies"}
    if len(qual) == 1:
        return {"kind": "chosen", "model": qual[0], "why": "the only model that qualifies"}
    if models.DEFAULT_MODEL in qual:
        base = per_model[models.DEFAULT_MODEL]
        best = max((m for m in qual if m != models.DEFAULT_MODEL),
                   key=lambda m: (int(per_model[m].get("written") or 0), m))
        r = per_model[best]
        points = _rate(r) - _rate(base)
        labels = int(r.get("written") or 0) - int(base.get("written") or 0)
        if points >= CHOOSE_POINTS and labels >= CHOOSE_LABELS:
            return {"kind": "chosen", "model": best,
                    "why": f"both qualify; it names {points:.1f} points and {labels} labels more than {models.DEFAULT_MODEL}"}
        return {"kind": "chosen", "model": models.DEFAULT_MODEL,
                "why": f"both qualify; {models.DEFAULT_MODEL} is kept: {best} names {points:+.1f} points and "
                       f"{labels:+d} labels against it, short of +{CHOOSE_POINTS:.0f} points and +{CHOOSE_LABELS} labels"}
    best = max(qual, key=lambda m: (int(per_model[m].get("written") or 0), m))
    return {"kind": "chosen", "model": best, "why": "it names the most labels of the models that qualify"}


def open_switch(r):
    """Rule 5: open-set is `auto` only when the open-set replay also writes no wrong name."""
    return "auto" if int(r.get("open_wrong") or 0) == 0 else "propose"


def _span(xs):
    xs = sorted(xs)
    if not xs:
        return "0"
    return f"{xs[0]}" if xs[0] == xs[-1] else f"{xs[0]}–{xs[-1]}"


def beside(mid, r):
    """What stands beside the verdict line for one model: n, the bound, the fit counts, held-out."""
    n, wrong = int(r.get("written") or 0), int(r.get("wrong") or 0)
    if n:
        head = (f"{mid}: n = {n} names written, {wrong} wrong — error bound 3/n = {3.0 / n:.3f}: zero wrong in "
                f"{n} says only that the error rate is probably below {300.0 / n:.0f}%")
    else:
        head = f"{mid}: n = 0 names written, {wrong} wrong — no error bound"
    # a name on a label nobody heard (mostly `x`, unfinished, never labelled) is neither right nor wrong: it
    # is not in n, whose bound speaks only of names checked against what a person heard; it is counted here
    unheard = sum(1 for u in r.get("unheard") or [] if u.get("set") == "closed")
    if unheard:
        head += (f"; {unheard} more name{'' if unheard == 1 else 's'} written on labels nobody heard, not in n "
                 f"(listed above: listen to each)")
    folds = r.get("folds") or []
    if folds:
        tail = (f"thresholds fitted per fold on {_span([f['recordings'] for f in folds])} labelled recordings and "
                f"{_span([f['genuine'] for f in folds])} genuine / {_span([f['impostor'] for f in folds])} impostor "
                f"trials ({len(folds)} folds); the judged recording was in none of them")
    else:
        tail = "no fold was judged"
    return f"  {head}; {tail}"


def verdict(per_model):
    """The verdict line (rules 1, 3, 4, 5), then beside it, per model, n, the bound 3/n, the recordings
    and trials each fold's thresholds were fitted on, and that the judged recording was in none of them."""
    c = choose(per_model)
    if c["kind"] == "insufficient":
        line = f"verdict: insufficient, label more — {c['why']}; nothing is written"
    elif c["kind"] == "none":
        line = "verdict: none qualifies — print_closed and print_open ship as propose; questions with preselected answers"
    else:
        r = per_model[c["model"]]
        th = r["fit"]
        line = (f"verdict: {c['model']} — " + " · ".join(f"{k} {th[k]:.4f}" for k in THRESHOLDS)
                + f"; print_closed auto, print_open {open_switch(r)}"
                + ("; the embedding check is weak for this model (split_weak)" if th.get("split_weak") else "")
                + f" ({c['why']})")
    out = [line]
    order = ([c["model"]] if c.get("model") else []) + [m for m in per_model if m != c.get("model")]
    for mid in order:
        r = per_model[mid]
        out.append(beside(mid, r))
        ok, reasons = qualifies(r)
        out.append(f"    {mid} " + ("qualifies" if ok else "does not qualify: " + "; ".join(reasons)))
    return "\n".join(out)


# -- the file -----------------------------------------------------------------------------------------
def build_file(r, chosen, generated):
    """The calibration file for one model's evaluation. `chosen` False (no model qualified) ships both
    switches as `propose`. Counts: `recordings` judged (folds), `people` with prints, gold `genuine` and
    `impostor` trials, names `written` and `wrong` by the replay; `bound` 3/n."""
    f = r["fit"]
    if "fails" in f:
        raise ValueError(f"no thresholds to write: {f['fails']}")
    n = int(r.get("written") or 0)
    e = r.get("evidence") or {}
    m = r["model"]
    body = {
        "version": 1,
        "model": {"id": m["id"], "sha256": m["sha256"], "dim": int(m["dim"])},
        "thresholds": thresholds(f),
        "print_closed": "auto" if chosen else "propose",
        "print_open": open_switch(r) if chosen else "propose",
        "elimination": "propose",
        "split_weak": bool(f.get("split_weak")),
        "counts": {"recordings": len(r.get("folds") or []), "people": int(e.get("people") or 0),
                   "genuine": int(e.get("genuine") or 0), "impostor": int(e.get("impostor") or 0),
                   "written": n, "wrong": int(r.get("wrong") or 0)},
        "bound": round(3.0 / n, 4) if n else None,
        "generated": str(generated),
    }
    check_numbers_only(body)
    return body


def check_numbers_only(obj, where="calibration"):
    """Raise ValueError when the file holds anything but numbers, counts and the few words it needs: no
    list of more than 16 numbers (a vector), and no string with a `/` (a reference or a path)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            check_numbers_only(v, f"{where}.{k}")
    elif isinstance(obj, (list, tuple)):
        if len(obj) > 16 and all(isinstance(x, (int, float)) for x in obj):
            raise ValueError(f"{where} holds a list of {len(obj)} numbers — a vector has no place in a calibration")
        for i, v in enumerate(obj):
            check_numbers_only(v, f"{where}[{i}]")
    elif isinstance(obj, str):
        if "/" in obj or "\\" in obj:
            raise ValueError(f"{where} holds {obj!r} — a calibration names no reference and no path")
