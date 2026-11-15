// BUG vs CHANGE REQUEST — the third dimension the two convergence curves are sliced by, and the one
// the person named the method for: lay the ticket system's tickets on the same timeline so a change
// can be attributed to a defect or to a requirement shift. Until a ticket join exists, the commit
// SUBJECT is the evidence actually on disk, and conventional-commit prefixes carry the intent
// explicitly.
//
// Deliberately THREE-VALUED. A subject that says neither is counted as NEITHER. Sweeping every
// unlabelled commit into `change-request` would destroy the only reading that matters here, which is
// the bug SHARE rising late in a project.
//
// Lives in lib/ rather than beside its caller so a test can import it: read-git.mjs runs on import.
const BUG_RE = /^(fix|bugfix|hotfix|revert)\b|^\w+(\([^)]*\))?!?:\s*(fix|correct|repair)\b|\b(bug ?fix|hot ?fix|regression|broken|crash(es|ed)?|fails?|failing|error|patch(ed)?)\b/i;
const CR_RE = /^(feat|feature|refactor|perf|chore|docs|style|test|build|ci)\b|\b(add(ed|s|ing)?|implement(ed|s|ing)?|introduce[ds]?|support for|migrate[ds]?|rename[ds]?|remove[ds]?|upgrade[ds]?|redesign(ed)?)\b/i;

export function commitIntent(subject) {
	const s = String(subject ?? '');
	// Bug wins on a tie: "fix: add the missing guard" is a defect, and a commit that fixes while adding
	// is the expensive kind. The ORDER of these two tests is the classifier.
	if (BUG_RE.test(s)) return 'bug';
	if (CR_RE.test(s)) return 'change-request';
	return 'neither';
}
