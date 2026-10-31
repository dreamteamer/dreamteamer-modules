# @dreamteamer/users

The people and agents work is assigned to, and the teams they form. `users` is what the owner,
assignee, lead and seat fields of tasks, meetings and projects point at. A user is not a contact: a contact is someone you deal
with, a user is someone who does work in this workspace. `users.contact` links the two when one person
is both. Agents can be users too, and every agent row names the human who owns it.

`teams` is a named group of users — a delivery team, a squad, a function. Membership is a list on
the TEAM (`members`, and the `lead`), so somebody joins or leaves by editing one record, and each
person reads the generated `teams` and `led_teams` on their own. A team is never the assignee: work
still goes to a person, and the team says who is available to be that person. Teams shipped with
`projects` until users 0.2.0; see `UPDATING.md`.

```bash
npm install @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| a list of the people in the workspace, the agents they own, and the teams they form — each person reads `teams` and `led_teams` on their own record | **tasks** adds each person's tasks to their record · **meetings** adds the meetings they sat in · **projects** adds the projects they lead and the risks, decisions and deliverables they own, and lists on each team the projects it is staffed to · **contacts** lets a user point at their contact record · **companies** names who they work for, and whose team it is · **assets** gives them an avatar |

**Checking agent ownership.** `dreamteamer check` does not enforce "an agent needs a human owner", so
this module ships a guard. Chain it after check in your workspace's `package.json`:

```json
"scripts": { "check": "dreamteamer check && node node_modules/@dreamteamer/users/bin/check-records.mjs" }
```
