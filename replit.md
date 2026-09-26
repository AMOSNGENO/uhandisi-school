# Uhandisi School

Mobile-first learning platform for Kenyan students, built around Lipa Pole Pole progressive module access.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source-of-truth contract for learning, progress, and payment endpoints
- `artifacts/api-server/src/lib/uhandisi-data.ts` — seeded learning domain data and server-side access calculation
- `artifacts/api-server/src/routes/learning.ts` — course, dashboard, and payment history reads
- `artifacts/api-server/src/routes/payments.ts` — pending STK request and idempotent callback flow
- `artifacts/uhandisi-school/src/App.tsx` — responsive student experience and payment request UI
- `artifacts/uhandisi-school/src/index.css` — Uhandisi visual tokens and interaction styling

## Architecture decisions

- Successful payment callbacks are the only event that can change paid balance or module access.
- Course module access is derived server-side from cumulative completed payments and each module's unlock amount.
- Frontend routes consume generated React Query hooks from the OpenAPI contract instead of hand-written fetch types.
- Seeded course artwork is stored as local SVG assets so the first load does not depend on third-party image hosts.

## Product

- Student overview with streak, active courses, funded amount, and next module
- Course shelf with search and category filtering
- Course detail pages with locked/unlocked modules and Lipa Pole Pole payment request flow
- Payment ledger with pending, completed, and failed states
- Responsive mobile navigation and student profile preferences

## User preferences

- Keep the experience mobile-first and optimized for Kenyan students.

## Gotchas

- The current first-build API uses an in-memory seeded service layer for preview; replace it with persistent Drizzle/Postgres repositories before production launch.
- Live Safaricom Daraja credentials and callback configuration are still required before enabling real STK Push traffic.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
