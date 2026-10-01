# identity — handles are the merge key

The worst error this module can make is attributing one person's work to another. Everything below
exists to make that error require a human decision rather than a heuristic.

## the case this is built on

In one repository alone, one contributor — call him Sam Diaz — commits under **four** identities:

| handle | where it comes from |
|---|---|
| `SamDiaz` + a GitHub noreply address | a commit made through the web UI or with the privacy setting on |
| `Sam Diaz` (machine A) | a checkout whose `user.email` is a personal address |
| `Sam Diaz` (machine B) | a second checkout with a different `user.email` |
| `SamDiaz <sam.d@…>` | the work address — the one Asana also knows |

Four handles, one person. Other contributors in the same repos routinely appear under two spellings.
**A name is not an identity, and an email is not a person** — the
handle set is.

## the upsert rule — how a reader writes a person

`read-git` and `read-asana` both upsert into the same records. Given a handle:

1. **Match on the handle set, exactly** — any handle on any `perspective/users` record of this contributor,
   emails compared case-insensitively. Never match on the display name alone.
2. **Hit** → add the handles not already present (one `--handles` flag per handle), widen `first_seen`/`last_seen`, recompute
   `evidence_count` as distinct commits + tickets + sessions, add the `sources` ref, and add any
   newly observed role to `roles_observed`.
3. **Miss** → create the record with the handle(s) actually seen and the best display name the
   evidence gives. A record created from a noreply address alone is correct and is expected to be
   merged later.
4. **Never write `contact`.** No reader ever does — it is a person's confirmation, not a match.

Re-running a reader must produce the same records — the upsert is what makes the collect stage
idempotent.

## how the Asana email meets the git email

Asana gives a canonical work email plus a gid. Git gives author emails, including noreply forms.
**The email is the join, and it is the only automatic one:**

- work email from Asana == author email in git → one record, both handles on it. This is the
  intended path, and it is why `--contributor` takes an email.
- a **gid alone never joins** to a git handle. It is a handle in its own right and sits on whatever
  record the email put it on.
- a GitHub noreply address (`<id>+<login>@users.noreply.github.com`) carries a login, and the login
  often equals a display-name variant. That similarity is a **proposal**, never a join — it goes to
  a person as a question.

## merging is a person's decision

An automatic merge on name similarity is forbidden. When the evidence suggests two records are one
person, put it to them with the counts: *"`<handle A>` has 412 commits and `<handle B>` has 865, and
both appear on the same branches in the same weeks — same person?"* On a yes:

1. move every handle onto the surviving record — one `--handles` flag per handle, then `cat` the
   record;
2. re-point every `activities.collaborators`, `decisions.collaborators`, `workflows.collaborators`
   and `tickets.assignee` ref that named the absorbed record;
3. `dt rm` the absorbed record, recompute `evidence_count`, and `npm run check`.

On an unattended run (`min_interview_questions: 0`) **nothing is merged**. The duplicate records
stand, and the suspected merge is written as a `questions` record left `pending` — that is the
honest state, and it is cheap to fix later. A merge is not.

## `handles`, `contact` and `contributor` — three fields, three jobs

- **`handles`** is the merge key, and it is spelled the same on `perspective/users` and on
  `retrospective-sessions`. The run record's copy is the SEED: the first reader runs before any
  users record exists, so whatever the person declared at `installed` is the only identity
  there is, and an address missing from it becomes a second person. `lib/identity.mjs` computes the
  union of the seed and the users record that already carries one of them, in one function.
- **`contact`** is a real `x-reference: contacts` on both collections, set ONLY once a person
  confirmed the match. `contacts` is a declared PEER, so the module compiles in a workspace without
  it. A peer excuses a reference, never a mirror, so there is no `x-inverse`.
- **`retrospective-sessions.contributor`** is a SLUG (`dana-o`), never an address. It is the first
  segment of every evidence and model id the run writes, which is what makes a second retrospective
  update the model instead of writing a parallel copy of it; the field's `pattern` refuses anything
  else. `--contributor <email>` on the readers takes an address — that flag names the MAILBOX or the git author to read, not the id key.
