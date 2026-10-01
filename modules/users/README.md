# @dreamteamer/users

The people work is assigned to. One collection, `users`, which every owner, assignee, lead and
attendee field in the other modules points at. A user is not a contact: a contact is someone you deal
with, a user is someone who does work in this workspace. `users.contact` links the two when one person
is both. Agents can be users too, and every agent row names the human who owns it.

```bash
npm install @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| a list of the people in the workspace, and the agents they own | **tasks** adds each person's tasks to their record · **meetings** adds the meetings they sat in · **contacts** lets a user point at their contact record · **assets** gives them an avatar |

**Checking agent ownership.** `dreamteamer check` cannot express "an agent needs a human owner", so
this module ships a guard. Chain it after check in your workspace's `package.json`:

```json
"scripts": { "check": "dreamteamer check && node node_modules/@dreamteamer/users/bin/check-records.mjs" }
```
