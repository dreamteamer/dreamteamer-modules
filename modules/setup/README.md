# @dreamteamer/extensions

Ready-made building blocks for a [dreamteamer](https://www.npmjs.com/package/dreamteamer) workspace.
Install it once and your workspace knows about people, companies, tasks, meetings, recordings, and
how to read your own past work. Keep the parts you want, switch off the rest.

Nothing in here holds any data. It adds the *shapes* your records take and the *skills* your coding
agent uses to work with them. Your records stay in your workspace, in your repo.

## what you get

Eight modules. Each one works on its own, and they know how to work together.

| module | what it gives you |
|---|---|
| **contacts** | People you deal with, and the companies they belong to. A command to fill in a person's details from LinkedIn. Views of everyone, and of who still needs a LinkedIn link. |
| **tasks** | Things you have committed to do. An inbox of what is open, and a board grouped however you like. |
| **meetings** | Your calendar meetings, pulled straight from Google Calendar. For each one: a short brief to read before you walk in, a neutral summary after, and, when you want it, an honest critique of how it went. |
| **recordings** | Audio recordings of your meetings, matched to the meeting they belong to and transcribed on your own machine. Hebrew and English, with speakers told apart. Screenshots taken during a call get filed beside it. |
| **assets** | Small pictures the workspace shows: icons, logos, people's photos. |
| **perspective** | Reads your own past work — git history, coding-agent conversations, tickets, documents, mail — and tells you what you keep doing, what you keep deciding, and what you have never written down. It asks before it concludes. What it FINDS is kept apart from what you WROTE: the people, projects, work, commitments and outcomes it reconstructs live under `perspective/world`, in the same shape as your own, each pointing at the record it thinks it matches — a suggestion you confirm, never a link it makes for you. |
| **notebooks** | A notebook and the corpora it is built on, behind two adapters. A **wiki** is a folder of markdown you can read with `cat` — no account, no login, no network — and every source in it carries a completeness marker, so a half-downloaded corpus can never pass for a finished one and one command tells you what still needs scraping. NotebookLM is the extra: your notebooks as records, the rules that keep the vendor CLI honest, one safe command to apply a persona, and one to mirror a live notebook's sources onto disk. |
| **rnd** | What you build and investigate. Products and the projects that deliver them; design docs, user stories and prototypes; features wanted and defects found in your own repos; what outside reading settled and what it could not; experiments; panels of real people scored against what they actually said; drafts; generated media. A spec and its plan are records here, not files beside the code. |

Every module comes with the skills your agent needs to use it well, written down in plain steps.

## install

You need a dreamteamer workspace on engine **0.24.0 or newer**. Then:

```bash
npm install @dreamteamer/extensions
npx dt-extensions setup
```

`setup` shows you where your workspace stands, asks before each change, and only changes files inside
your workspace. It never installs software or downloads anything for you. It tells you exactly what
to run when something is missing.

Run `npx dt-extensions doctor` any time to see the same board without changing anything.

### coming from 0.1.x with records already written

The `introspection` module is `perspective` in 0.2.0, and the rename goes all the way down — the
namespace, the collection names, the record suffixes, the field names and the record ids. There is no
compatibility path and no deprecation window, by design. One command moves a workspace:

```bash
npx dt-extensions migrate            # --dry-run first, if you would rather look
```

It refuses on an uncommitted tree, so the move is one reviewable diff. It refuses on any field no
descriptor declares, rather than dropping something you wrote. It ends by running `dreamteamer check`
over the result, and that output — not its own summary — is what says whether it worked.


### coming from 0.2.x-0.6.x with records already written

The observed world moved into `perspective/world` — `collaborators` became `world/users`, and
`activities`, `projects` and `goals` moved beside it. **No record id changes**, so nothing has to be
re-derived and no retrospective has to be repeated. One command moves a workspace:

```bash
npx dt-extensions migrate-world      # --dry-run first, if you would rather look
```

⚠ **Run it before you compile.** If any of your OWN files name one of the moved collections — an
overlay's `extends:`, a view's `collection:` — compile fails first, with a message about a missing
base rather than about the file. `migrate-world` checks for exactly that before it touches anything
and prints the file, the line and the edit; `--rewrite-sources` applies them for you. Reading them is
worth the minute: a file naming a collection that moved is often out of date for its own reasons.

It refuses on an uncommitted tree, so the move is one reviewable diff, and it ends by running
`dreamteamer compile` and `dreamteamer check` — that output, not its own summary, is what says
whether it worked. A workspace still on 0.1.x runs `migrate` alone; it folds both moves.

## keep only what you want

Every module is optional. Turn some off by naming them in your `package.json`:

```json
"dreamteamer": {
  "disable": ["recordings", "perspective"]
}
```

Then run `npx dreamteamer compile`. A few modules depend on others — `meetings` needs `contacts` and
`tasks`, and `recordings` needs `meetings`. If you switch off something another module needs, compile
tells you which one.

## what needs setting up, and what does not

**Nothing is required.** Every module works for reading and writing records with no setup at all.
The pieces below unlock extra abilities, and each one is optional:

| to do this | you need |
|---|---|
| pull meetings from your calendar | a Google account signed in through the `google-workspace` tool your agent already uses, and a list of which calendars count as work |
| transcribe recordings | `ffmpeg`, `uv`, and about 1.6 GB of speech models, downloaded once |
| fill in contacts from LinkedIn | Docker, and one sign-in to LinkedIn |
| read tickets in perspective | an Asana token |
| build, fill, search or check a **wiki** | nothing. No account, no login, no network — that is the point of the local adapter |
| apply a notebook persona, mirror a notebook onto disk, or read a NotebookLM notebook | `notebooklm-py` 0.7.3+ (`uv tool install notebooklm-py`) and one `notebooklm login` |

`setup` checks each of these and tells you what to do. Skip any of them and that ability simply says it
is unavailable. Nothing breaks.

## where your files live

Recordings, meeting files and wiki corpora are big, so they never go in your repo. They live in a
folder you choose, usually a synced one like Google Drive or iCloud. Your records only carry a
reference to that folder, so the same record works on every machine you use. `setup` asks you where
that folder is.

A wiki lives at `<that folder>/wikis/<name>/` and is an ordinary tree of markdown — a `wiki.yaml`
saying what it is, then `sources/001--….md` and so on, nested into subfolders when the corpus has
sections. You can open it, grep it, and read it without any of this tooling; that is deliberate.

## a note on language and time

The meeting tools were built for someone working in Israel: the work week runs Sunday to Thursday,
times are Jerusalem time, and both Hebrew and English are handled throughout. None of this is
personal to anyone — but if you work elsewhere, you will want to change the week and the time zone.

## more

- Working on this package: [CONTRIBUTING.md](CONTRIBUTING.md)
- Publishing a release: [RELEASING.md](RELEASING.md)
- How it was designed: [docs/](docs/)
