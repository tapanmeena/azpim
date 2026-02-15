# Copilot instructions for azpim

## Big picture

- This is a Node.js/TypeScript terminal CLI for Azure PIM role activation/deactivation.
- Entry point: [src/index.ts](src/index.ts) (Commander commands; default is `activate`).
- The codebase is organized into four module layers under `src/`:

### `src/core/` — Foundational utilities (no domain logic)

- [constants.ts](src/core/constants.ts) — Shared magic values (durations, justifications, sentinels, PIM filter).
- [errors.ts](src/core/errors.ts) — Unified `extractErrorMessage`, `handleCommandError`, `isAuthError`, `showAuthHints`.
- [json-store.ts](src/core/json-store.ts) — Generic `loadJsonFile<T>` / `saveJsonFile<T>` used by all data persistence files.
- [paths.ts](src/core/paths.ts) — Config/data file path resolution and env var names.
- [ui.ts](src/core/ui.ts) — chalk formatting, single global ora spinner, summary and result display helpers.

### `src/azure/` — Azure SDK wrappers (no UI logic)

- [auth.ts](src/azure/auth.ts) — AzureCliCredential + Microsoft Graph `/me` lookup → `AuthContext`.
- [azure-pim.ts](src/azure/azure-pim.ts) — ARM AuthorizationManagementClient PIM schedule APIs; subscription fetching.

### `src/data/` — Local file persistence (all use `json-store`)

- [favorites.ts](src/data/favorites.ts) — Favorites management (load/save/toggle/import/export).
- [presets.ts](src/data/presets.ts) — Preset configuration, validation, and template expansion.
- [subscription-cache.ts](src/data/subscription-cache.ts) — Subscription caching (6-hour TTL).
- [update-check.ts](src/data/update-check.ts) — Update notification system.

### `src/cli/` — Interactive flows and command scaffolding

- [cli.ts](src/cli/cli.ts) — Main menu loop, shared helpers (`normalizeRoleName`, `validateDurationHours`, `promptBackToMainMenuOrExit`), and re-exports.
- [command-handler.ts](src/cli/command-handler.ts) — `withCommandHandler` wrapper that eliminates per-command boilerplate (auth, UI setup, error handling).
- [activate-flow.ts](src/cli/activate-flow.ts) — `activateOnce` (one-shot) + `handleActivation` (interactive).
- [deactivate-flow.ts](src/cli/deactivate-flow.ts) — `deactivateOnce` (one-shot) + `handleDeactivation` (interactive).
- [subscription-selector.ts](src/cli/subscription-selector.ts) — `selectSubscriptionInteractive` (shared by activate/deactivate), `selectSubscriptionWithSearch`.
- [favorites-manager.ts](src/cli/favorites-manager.ts) — `runFavoritesManager` interactive menu.
- [presets-cli.ts](src/cli/presets-cli.ts) — Inquirer-based preset add/edit/manage wizards.

## Key data flow

- `authenticate()` (AzureCliCredential) → Graph `/me` → returns `AuthContext` with `credential`, `userId`, `userPrincipalName`.
- `showMainMenu(authContext)` → activation/deactivation flows.
- Presets:
  - CLI `--preset <name>` (and optional defaults) load from `presets.json` via `loadPresets()`.
  - Effective one-shot options are resolved in `src/index.ts` with precedence: CLI flags > preset values > defaults > code defaults.
  - `justification` templates are expanded at runtime using `AuthContext` (e.g., `${date}`, `${datetime}`, `${userPrincipalName}`).
- Subscriptions fetched via `SubscriptionClient` (`fetchSubscriptions`).
- Eligible roles via `roleEligibilitySchedules.listForScope("/subscriptions/{id}", { filter: "asTarget()" })`.
- Activate via `roleAssignmentScheduleRequests.create(..., { requestType: "SelfActivate", linkedRoleEligibilityScheduleId, scheduleInfo, justification })`.
- Deactivate via `requestType: "SelfDeactivate"` using `linkedRoleEligibilityScheduleId` from active schedules.

## Developer workflows

- Install deps: `pnpm install` (repo pins pnpm in `package.json`).
- Dev run (ts-node): `pnpm dev` (runs `src/index.ts` with `tsconfig-paths/register`).
- Build: `pnpm build` (plain `tsc` → `dist/`).
- Run built CLI: `node dist/index.js` or `pnpm start`.
- Lint: `pnpm lint`.

## Project conventions to follow

- **Module boundaries:**
  - `core/` modules must not import from `azure/`, `data/`, or `cli/`.
  - `azure/` may import from `core/` and `data/` (for subscription cache).
  - `data/` may import from `core/` and `azure/` (for types like `AzureSubscription`).
  - `cli/` may import from all layers.
  - `index.ts` ties everything together.
- **Error handling:**
  - Use `extractErrorMessage(error)` from `core/errors.ts` instead of `(error as any).message`.
  - Use `handleCommandError(error, output)` in command catch blocks.
  - Use `error: unknown` (never `error: any`) in all catch clauses.
  - Commands in `index.ts` use `withCommandHandler` for automatic auth + error handling.
- **JSON persistence:**
  - Use `loadJsonFile<T>` / `saveJsonFile<T>` from `core/json-store.ts` instead of manual `readFile`/`writeFile`.
- **Constants:**
  - Use exports from `core/constants.ts` instead of hardcoded values.
  - Env variable names live in `core/paths.ts`.
- **UI helpers:**
  - Use `startSpinner/succeedSpinner/failSpinner` and `logInfo/logSuccess/logWarning/logError` from [core/ui.ts](src/core/ui.ts).
  - `ui.ts` maintains a single global spinner; stop/replace it instead of starting multiple spinners.
  - Use `displayResultsSummary(successCount, failCount, verb)` for result summaries.
- **CLI patterns:**
  - Keep Azure calls in [azure/azure-pim.ts](src/azure/azure-pim.ts); keep prompt/control-flow in `cli/` modules.
  - Keep preset persistence in [data/presets.ts](src/data/presets.ts); keep preset wizards in [cli/presets-cli.ts](src/cli/presets-cli.ts).
  - `type: "select"` for single-choice menus, `type: "checkbox"` for multi-select, `type: "confirm"` for confirmation.
  - Back navigation uses `SENTINEL_BACK` from `core/constants.ts`.
- **Azure errors:**
  - In `azure-pim.ts`, 403/`AuthorizationFailed` returns an empty list (warn) instead of failing the whole flow.
  - For presets, prefer clear "file path + next step" messages (e.g., mention `AZPIM_PRESETS_PATH` or `azpim preset list`).

## Integration points / prerequisites

- Requires Azure CLI login (`az login`) because authentication uses `AzureCliCredential`.
- Microsoft Graph is used only to resolve the current user via `/me` (scopes: `https://graph.microsoft.com/.default`).
- ARM management calls use scope `https://management.azure.com/.default` and `@azure/arm-authorization` APIs.

## TypeScript/build notes

- `tsconfig.json` uses `module`/`moduleResolution`: `NodeNext`, strict settings, and path alias `@/*` → `src/*`.
- Keep ESM/CJS interop consistent with current imports (don't rewrite module style unless required).
- Avoid `any` casts — use `unknown` + type narrowing or `Record<string, unknown>`.
