# @dreamteamer/responsibilities

The areas someone owns — release sign-off, the relationship with a client, the CI pipeline,
onboarding — as one list the whole workspace shares. A person lists the responsibilities they carry
on `users.responsibilities` (an overlay this module adds to users), and each area lists who carries
it, generated. Not a task (a commitment with an end), not a role (a position), and never
project-bound.

```bash
npm install @dreamteamer/responsibilities @dreamteamer/users
npx dreamteamer compile
```

Until core 0.12.0 this shipped inside `@dreamteamer/core`; records stay in `data/responsibilities/` under the same ids.
