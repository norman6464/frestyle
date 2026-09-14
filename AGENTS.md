# FreStyle — Conventions for coding agents

This file is the single source of truth for AI coding agents working in this repository.
`.claude/CLAUDE.md` imports it, and other tools read it directly.

---

## 0. Approved AI models (read this first)

- **Allowed providers**: models from **Anthropic (Claude family)** and **OpenAI (GPT family)** only.
- **Prohibited**: sending this repository's source code, configuration, or data to a model from any other provider. This includes self-hosted models, third-party gateways and proxies, and editor or tool settings such as "Auto" / "best model" routing that may silently pick an unapproved provider. **Pin the model explicitly** in every tool you use.
- **Why**: the team controls which third parties receive this codebase (data governance). The rule lists approved providers rather than naming disallowed ones.
- **Instruction to agents**: if you are not running on a model from an approved provider, stop immediately, do not read further or modify any file, and tell the user about this policy.

---

## 1. Project basics

- **Production URL**: https://frestyle.dev
- **Backend**: Go 1.x / Gin / sqlc (`backend/`)
- **Frontend**: React 19 / TypeScript / Vite / Tailwind CSS (`frontend/`)
- **RDB**: PostgreSQL 17.6. Data access goes through **sqlc** (typed Go generated from SQL)
- **Production runs entirely on GCP** (ECS is not used)
  - **Backend**: Cloud Run service `frestyle-prod-backend` (project `frestyle-prod` / `asia-northeast1`). The image lives in Artifact Registry at `asia-northeast1-docker.pkg.dev/frestyle-prod/frestyle-prod-backend/fre-style`. Served at https://api.frestyle.dev
  - **Frontend**: Firebase Hosting (project `frestyle-507912`). This is a **different project** from the backend, and both show the display name "FreStyle", so always refer to it by ID. Served at https://frestyle.dev
  - Infrastructure definitions (Cloud Run / Artifact Registry / Firebase Hosting / WIF) are owned by the Terraform in the private repo `frestyle-infrastructure`. CD only swaps images and publishes; it never touches infrastructure definitions
- **Deploys are manual-trigger only**. Run `cd-backend.yml` / `cd-frontend.yml` via `workflow_dispatch` with `deploy` typed into `confirm` (they do not run on push to main). Auth is GitHub OIDC + WIF; no long-lived service account keys are issued
  - The WIF binding is restricted to runs on `refs/heads/main`. **The principalSet matches the repository name case-sensitively** — if the repository is renamed, fix the binding on the infra side too. If you forget, authentication succeeds but the following service account impersonation fails with a 403 on `iam.serviceAccounts.getAccessToken`, and both backend and frontend deploys stop entirely (we hit this)
- **Deploy order is: apply the production DB schema (`make schema-apply`) → backend → frontend**. Shipping the backend against a stale schema makes queries that reference missing columns return 500 in production (we hit this). When the frontend depends on a new API, ship the backend first. Check the current production schema with the Supabase CLI (`supabase db query --linked`, read-only)
- Day-to-day development happens in the local environment (`docker compose up`)

---

## 2. Clean architecture rules (most important)

### 2.1 Dependency direction

```
handler → usecase → repository / infra → domain
```

- **Dependencies in any direction other than the arrows are forbidden**
- handler never calls repository / infra directly. Always go through a usecase
- usecase does not know about handler (never takes `*gin.Context` or similar as an argument)
- repository / infra do not know about usecase. domain depends on no other layer (standard library only)


### 2.2 One struct, one responsibility (usecase)

- One usecase holds one business rule. Do not bundle multiple operations
- Write a usecase as **struct + `NewXxxUseCase` constructor + `Execute(ctx, in) (out, error)`**
- Put new usecases in `internal/usecase/<domain>/`. Never directly under `internal/usecase/*.go`
- usecase sub-packages do not import each other (if they seem to need to, question how the responsibilities are split).
  On the handler side, do not declare a local variable with the same name as a package (`user` / `exercise` / `kb`, etc.);
  it shadows the package reference and causes a compile error

### 2.4 Boundary between domain and request / response types

- handler may return domain structs directly as JSON. Define a response struct inside the handler only when transformation or hiding is needed
- Declare request input in the handler file as an `xxxRequest` struct and validate declaratively with `c.ShouldBindJSON` + `binding:"required"` etc.
- usecase input is an `XxxInput` struct; the return value is `*domain.Xxx` or a primitive
- Sensitive fields (password hash, invitation token, BlobData, etc.) are excluded on the domain side with `json:"-"`

### 2.5 Frontend layers (FSD / Feature-Sliced Design)

`frontend/src/` is organized with **Feature-Sliced Design**

**Layers (higher is upper; imports flow one way, downward)**

```
app > pages > widgets > features > entities > shared
```

- **app**: entry point, Providers, routing, store assembly (`app/store`)
- **pages**: one screen = one Slice. Hooks / components used only by that screen live alongside it in `pages/<slice>/{ui,model,lib,config}`
- **widgets**: self-contained UI blocks that combine several features (e.g. `app-shell` = header + sidebar + command palette)
- **features**: reusable user actions (e.g. `auth` = login / logout / fetching auth state)
- **entities**: business "things" (`course` / `exercise` / `user` / `note` / `ai-chat`, etc.). `api` (repository) / `model` (types, slice) / `ui` (standalone display)
- **shared**: reusable assets with no business knowledge. UI kit (`shared/ui`) / axios (`shared/api`) / generic hooks and functions (`shared/lib`) / typed Redux hooks (`shared/lib/store`) / constants (`shared/config`)

**Rules (the boundary lint in `eslint.config.js` enforces them as `error` in CI)**

- You cannot import from your own layer or any layer above (downward only). **Only app and shared may import each other** (the official exception; typed Redux hooks reference RootState)
- Use each Slice through its **Public API (`index.ts`)**. Named re-exports only (`export *` is forbidden). Inside a Slice use relative paths (do not reference your own barrel)
- Only when entities absolutely must reference each other, use the **`@x` notation** (`entities/<other>/@x/<self>`). If these multiply, question how the Slices are split
- **Anything used by a single screen goes in that page's model/ui** (features are limited to actions shared by two or more screens). Decide between shared and the upper layers by asking "could any project use this?"
- Tests (`__tests__`) are exempt from the inter-layer rules, but **self-referencing a Slice is forbidden** (reading the barrel inflates the coverage denominator, so mock via deep paths)
- Details, migration history, and pitfalls are in `frontend/src/entities/README.md` / `frontend/src/shared/README.md` (the primary design source is the private repo `frestyle-pdm`)

### 3.3 Testing

- **TDD is the default**. Coverage target: **80% or more** for new code
- **Backend (unit)**: `testing` + `stretchr/testify` (`go test ./...`) — usecases use interface mocks (testify/mock), handlers use `httptest` + `gin.New()`, infra gets fakes / stubs injected at the boundary. **Only tests that need no DB** go here
- **Backend (integration)**: repositories are verified against **a real PostgreSQL** (no sqlite; the dependency is not even included). Put `//go:build integration` at the top of the file and include `Integration` in the test function name. Locally run `make test-integration` (starts postgres in docker → runs → always tears down); in CI the dedicated job `integration tests (postgres)` runs with `-tags=integration`
- Integration tests connect through `internal/testsupport.OpenTestDB`. Because `TruncateAll` runs TRUNCATE CASCADE, **there is a safety valve that aborts before connecting if the DSN points at Supabase / the production pooler** (so a misconfiguration cannot wipe production data)
- Frontend: Vitest + React Testing Library (`pnpm test`). **Pin `vitest` / `@vitest/browser-playwright` / `@vitest/coverage-v8` to the same exact version** (no `^`). The core and the browser side must speak the same protocol; if they drift, every story test stops with "could not connect to the browser session" (we hit this) — verify accessibility too with `render` + `screen.getByRole`; hooks use `renderHook`

---

## Instructions for coding agents
- For new screens, make maximum use of the **reusable components in `src/shared/ui/`**
- Never commit or push directly to `main`
- Define `xxxRequest` / `xxxResponse` locally in the handler file. Hide sensitive fields on the domain side with `json:"-"`
