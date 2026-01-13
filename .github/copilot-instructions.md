# Copilot instructions for azp-cli

## Big picture

- This is a Node.js/TypeScript terminal CLI for Azure PIM role activation/deactivation.
- Entry point: [src/index.ts](src/index.ts) (Commander commands; default is `activate`).
- Interactive flows: [src/cli.ts](src/cli.ts) (Inquirer menus + loops; calls Azure operations).
- Presets (config + merge logic): [src/presets.ts](src/presets.ts) (JSON file in user config dir; template expansion).
- Presets (interactive wizards): [src/presets-cli.ts](src/presets-cli.ts) (Inquirer-based add/edit flows; can query Azure for subscriptions/roles).
- Auth: [src/auth.ts](src/auth.ts) (Azure CLI credential + Microsoft Graph `/me` lookup).
- Azure PIM operations: [src/azure-pim.ts](src/azure-pim.ts) (ARM AuthorizationManagementClient schedule APIs).
- Terminal UX helpers: [src/ui.ts](src/ui.ts) (chalk formatting + single global ora spinner).

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

- Prefer UI helpers over raw `console.log` in flows:
  - Use `startSpinner/succeedSpinner/failSpinner` and `logInfo/logSuccess/logWarning/logError` from [src/ui.ts](src/ui.ts).
  - `ui.ts` maintains a single global spinner; stop/replace it instead of starting multiple spinners.
- Keep Azure calls in [src/azure-pim.ts](src/azure-pim.ts); keep prompt/control-flow in [src/cli.ts](src/cli.ts).
- Keep preset persistence and schema validation in [src/presets.ts](src/presets.ts); keep preset wizards/prompts in [src/presets-cli.ts](src/presets-cli.ts).
- Inquirer patterns used here:
  - `type: "select"` for single-choice menus, `type: "checkbox"` for multi-select, `type: "confirm"` for final confirmation.
  - Back navigation uses sentinel values like `"__BACK__"`.
- Errors:
  - `src/index.ts` has top-level error handling and special-cases auth/Azure CLI errors (e.g., messages containing `AADSTS` or `AzureCliCredential`).
  - In `azure-pim.ts`, 403/`AuthorizationFailed` returns an empty list (warn) instead of failing the whole flow.
  - For presets, prefer clear “file path + next step” messages (e.g., mention `AZP_PRESETS_PATH` override or `azp preset list`).

## Integration points / prerequisites

- Requires Azure CLI login (`az login`) because authentication uses `AzureCliCredential`.
- Microsoft Graph is used only to resolve the current user via `/me` (scopes: `https://graph.microsoft.com/.default`).
- ARM management calls use scope `https://management.azure.com/.default` and `@azure/arm-authorization` APIs.

## TypeScript/build notes

- `tsconfig.json` uses `module`/`moduleResolution`: `NodeNext`, strict settings, and path alias `@/*` → `src/*`.
- Keep ESM/CJS interop consistent with current imports (don’t rewrite module style unless required).
