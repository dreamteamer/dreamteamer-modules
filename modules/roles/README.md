# @dreamteamer/roles

The positions people hold — team leader, backend developer, product manager, QA engineer — as one
list the whole workspace shares. A person lists the roles they hold on `users.roles` (an overlay this
module adds to users), and each role lists its people back, generated. A role is a position, never a
task and never an area of ownership (that is `@dreamteamer/responsibilities`).

```bash
npm install @dreamteamer/roles @dreamteamer/users
npx dreamteamer compile
```

Until core 0.12.0 this shipped inside `@dreamteamer/core`; records stay in `data/roles/` under the same ids.
