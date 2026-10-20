# Payment System frontend

React + TypeScript + Vite, managed with pnpm. English UI, VND wallet.

## Current status

I1-03 source/configuration scaffold is prepared. Dependency installation,
lockfile creation, route generation and command verification are pending.
This is not an integrated authentication application.

- Router: file-based TanStack Router; `/` redirects to `/wallet`.
- `/login` and `/register` are placeholders until I1-06.
- `/wallet` keeps its URL and displays the sign-in placeholder. The parent
  deliberately has no `Outlet`, private loader or API call until I1-07/08.
- Query provider, Ant Design English locale/theme and Tailwind build plugin
  are configured. Detailed responsive layouts belong to I1-04.
- Axios, TanStack Form and Zod are declared; API/auth adapters belong to
  I1-05–09. No token storage, refresh timer or cookie handling exists yet.
- Vitest/Testing Library are configured; environment validation has unit
  tests. Playwright has configuration only; browser scenarios come later.

## Prerequisites

Use Node **24.22.0** and pnpm **10.32.1**, matching `.node-version` and
`package.json`. The current workstation's Node 22.16.0 does not meet this
configuration. Do not silently change the machine's global Node installation.

The repository's [command boundary](../docs/agents/boundary.md#5-tools-commands-and-data)
requires explicit permission before installation, validation or server startup.
The following instructions document the commands; they do not report executed checks.

## Local setup (PowerShell)

From `payment-system-frontend/`, with the required Node/pnpm available:

```powershell
Copy-Item .env.example .env.local
pnpm install
pnpm routes:generate
```

Commit the generated `pnpm-lock.yaml` and `src/routeTree.gen.ts` when a Git
operation is authorized. Never hand-edit the generated route tree. Vite's
router plugin updates it during development; `typecheck` and unit-test scripts
also generate it before TypeScript resolves route types.

`.env.local` must define `VITE_API_BASE_URL`, e.g. `http://localhost:8080`.
Use the API **origin**, without `/api/v1`, credentials, query or fragment.
Configuration is validated at startup; there is no silent production fallback.
Every `VITE_*` value is public client configuration and must not contain secrets.

After authorizing server startup:

```powershell
pnpm dev
```

Open `http://localhost:5173`. Keep `localhost` consistent across frontend,
backend and the backend's allowed origins. Do not substitute `127.0.0.1`
without updating that configuration. The frontend has no Vite API proxy;
future Axios adapters call the separate API origin with the auth/CSRF contract.

## Checks

```powershell
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

`build` includes route generation and TypeScript checking before Vite builds.
Playwright requires a running app, browser binaries and actual specifications;
`pnpm test:e2e` is reserved for the later browser scenarios.
No checks above have been run for this scaffold yet.

## Structure and styling

- `src/app`: providers, QueryClient and router composition.
- `src/routes`: route declarations and the temporary deny-by-default gate.
- `src/features`: feature pages; backend adapters are added by feature later.
- `src/shared/config`: validated public environment configuration.
- `src/shared/theme`: shared tokens, Ant Design mapping and global app styles.
- `src/shared/ui`: shared presentation, created only as needed.
- `src/test`: component-test setup; `e2e`: future browser scenarios.

Theme colors have one source in `shared/theme/theme.ts`, mapped to Ant Design
and CSS variables. Tailwind supplies layout utilities without Preflight.
Inter uses the system fallback until font packaging is settled; no font CDN is
loaded. Reduced-motion preference is observed by the theme provider.

See the [iteration plan](../docs/frontend/6-iteration-1.md),
[setup decisions](../docs/frontend/7-frontend-setup.md),
[design system](../docs/frontend/5-design-system.md) and
[auth integration contract](../docs/frontend/8-auth-integration-contract.md).
