#!/usr/bin/env bash
# Take an outside pull request in — the only path by which one reaches main (cr-modules-001, design D-f).
#
#   git fetch origin pull/<n>/head:pr-<n>
#   bash scripts/take-in.sh pr-<n> <new-branch>
#
# WHY NOT THE MERGE BUTTON, AND WHY NOT THE PR'S OWN SHA. A pull request's run uses the workflow files
# of the pull request itself, so a fork can report contexts named `ci` and `leak-scan` that pass — and
# keep reporting them on its head sha. So the change is CHERRY-PICKED onto a branch from main: every
# commit gets a new sha with you as committer, and the only run that ever reports on those shas is this
# repo's own push run, with the secrets. `git rebase` is not used: on a fork already based on main's
# tip it changes nothing and the fork's sha survives.
#
# WHY SOME CHANGES ARE REFUSED. That push run executes the branch's own code with this repo's secrets.
# A change to `.github/`, to `.leak-scan-allow`, or to the `scripts` of any package.json (npm runs
# lifecycle scripts where NODE_AUTH_TOKEN is set) is refused here — make such an edit yourself, as your
# own commit, after reading it. Every commit of the range is checked, so a later commit cannot undo an
# earlier one out of sight, and a rename is checked on both sides.
set -euo pipefail

REF="${1:-}"; BRANCH="${2:-}"
[ -n "$REF" ] && [ -n "$BRANCH" ] || { echo "usage: take-in.sh <fetched-ref> <new-branch>" >&2; exit 2; }
fail() { echo "✗ $*" >&2; exit 1; }

git rev-parse --verify -q "$REF^{commit}" >/dev/null || fail "$REF is not a commit here — fetch it first"
git rev-parse --verify -q "refs/heads/$BRANCH" >/dev/null && fail "branch $BRANCH already exists"

RANGE="main..$REF"
FORK_SHAS=$(git rev-list "$RANGE")
[ -n "$FORK_SHAS" ] || fail "$REF adds no commit over main"
[ -z "$(git rev-list --merges "$RANGE")" ] || fail "$REF holds a merge commit — ask for a linear branch"

touched=$(git log --format= --name-only --no-renames "$RANGE" | sort -u)
guarded=$(printf '%s\n' "$touched" | grep -E '^(\.github/|\.leak-scan-allow$)' || true)
[ -z "$guarded" ] || fail "the change touches workflows or the leak allow-list — refused:
$(printf '%s\n' "$guarded" | sed 's/^/    /')"

# the `scripts` object of every package.json the range touches, at main and after each of its commits
for pkg in $(printf '%s\n' "$touched" | grep -E '(^|/)package\.json$' || true); do
	for rev in $FORK_SHAS; do
		node -e '
			const { execFileSync } = require("node:child_process");
			const read = (rev) => { try { return JSON.stringify(JSON.parse(execFileSync("git", ["show", `${rev}:${process.argv[1]}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).scripts ?? {}); } catch { return "{}"; } };
			process.exit(read("main") === read(process.argv[2]) ? 0 : 1);
		' "$pkg" "$rev" || fail "the change edits the npm scripts of $pkg — refused (npm runs them where the publish token is set)"
	done
done

git switch -q -c "$BRANCH" main
if ! git cherry-pick $(git rev-list --reverse "$RANGE") >/dev/null; then
	git cherry-pick --abort 2>/dev/null || true
	git switch -q main
	git branch -q -D "$BRANCH"
	fail "the cherry-pick did not apply cleanly — nothing was taken in"
fi
for s in $(git rev-list "main..$BRANCH"); do
	if printf '%s\n' "$FORK_SHAS" | grep -qx "$s"; then
		git switch -q main
		git branch -q -D "$BRANCH"
		fail "a fork sha survived the cherry-pick ($s) — nothing was taken in"
	fi
done

n=$(git rev-list --count "main..$BRANCH")
echo "✔ $n commit(s) of $REF taken in on $BRANCH, at new shas"
echo "next:"
echo "  git push origin $BRANCH"
echo "  # wait for ci and leak-scan green on its head"
echo "  git push origin $BRANCH:main"
