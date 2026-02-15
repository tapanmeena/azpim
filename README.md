# Azure PIM CLI (azpim)

A command-line interface tool for managing Azure Privileged Identity Management (PIM) role activations directly from your terminal.

![Terminal UI](https://img.shields.io/badge/Terminal-UI-cyan)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![License](https://img.shields.io/badge/License-ISC-green)

## Features

- 🔐 **Role Activation** - Quickly activate eligible Azure PIM roles
- 🔓 **Role Deactivation** - Deactivate active roles when no longer needed
- 📋 **Interactive Menu** - User-friendly menu-driven interface
- ✨ **Beautiful UI** - Polished terminal experience with spinners and colors
- 🔄 **Multi-role Support** - Activate or deactivate multiple roles at once
- 📊 **Status Tracking** - Real-time feedback on activation/deactivation status
- 💾 **Presets** - Save and reuse activation/deactivation configurations
- ⭐ **Favorites** - Mark subscriptions as favorites for quick access
- 🗃️ **Subscription Cache** - Automatic caching of subscriptions (6-hour TTL) for faster startup
- 🚀 **Non-interactive Mode** - CLI flags for scripting and automation
- 🔔 **Update Notifications** - Automatic update checks with configurable behavior
- 📤 **JSON Output** - Machine-readable output for integration with other tools
- 👤 **Per-user Data Isolation** - Configuration and cache stored per Azure user ID

## Prerequisites

Before using azpim, ensure you have:

1. **Node.js** (v18 or higher)
2. **Azure CLI** installed and configured
3. **Azure account** with PIM-eligible roles

### Azure CLI Setup

```bash
# Install Azure CLI (if not installed)
# See: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli

# Login to Azure
az login

# Verify you're logged in
az account show
```

## Installation

### Global Installation (Recommended)

```bash
# Using npm
npm install -g azpim

# Using pnpm
pnpm add -g azpim

# Using yarn
yarn global add azpim
```

After installation, the `azpim` command will be available globally.

### Migrating from azp-cli

If you previously used `azp-cli`, your presets are stored in `~/.config/azp-cli/` (or `%APPDATA%\azp-cli\` on Windows). To migrate:

1. Copy your `presets.json` to the new location: `~/.config/azpim/` (or `%APPDATA%\azpim\`)
2. Uninstall the old package: `npm uninstall -g azp-cli`

### From Source (Development)

```bash
# Clone the repository
git clone https://github.com/tapanmeena/azpim.git
cd azpim

# Install dependencies
pnpm install

# Build the project
pnpm build

# Link globally for development
npm link
```

## Usage

### Running the CLI

```bash
# After global installation
azpim

# Or with specific commands
azpim activate
azpim deactivate
azpim preset list
azpim update

# Development mode (from source)
pnpm dev
```

### Commands

| Command        | Alias               | Description                            |
| -------------- | ------------------- | -------------------------------------- |
| `activate`     | `a`                 | Activate a role in Azure PIM (default) |
| `deactivate`   | `d`                 | Deactivate a role in Azure PIM         |
| `preset`       | -                   | Manage reusable presets                |
| `favorites`    | `fav`               | Manage favorite subscriptions          |
| `check-update` | `update`, `upgrade` | Check for a newer version              |
| `help`         | -                   | Display help information               |

**Global Flags:**

- `--debug` - Enable debug logging
- `--version` - Show version number

#### Preset Subcommands

| Command         | Description                                  |
| --------------- | -------------------------------------------- |
| `preset list`   | List all available presets                   |
| `preset show`   | Show details of a specific preset            |
| `preset add`    | Add a new preset (interactive wizard)        |
| `preset edit`   | Edit an existing preset (interactive wizard) |
| `preset remove` | Remove a preset                              |

#### Favorites Subcommands

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `favorites list`    | List all favorite subscriptions      |
| `favorites add`     | Add a subscription to favorites      |
| `favorites remove`  | Remove a subscription from favorites |
| `favorites clear`   | Clear all favorites                  |
| `favorites export`  | Export favorites to a file           |
| `favorites import`  | Import favorites from a file         |
| `favorites refresh` | Refresh the subscription cache       |

### Updates

You can check if a newer version is available:

```bash
azpim update
# alias
azpim upgrade
```

Notes:

- `azpim update` exits with code `0` when up-to-date, `2` when an update is available, and `1` on error.
- `--check-only` - Only check and print status without showing upgrade instructions.
- `--output json` returns a structured response suitable for scripts.
- By default, `azpim activate` and `azpim deactivate` will also show a short "update available" hint (text mode only) at most once per day.
- Disable update checks via `AZPIM_NO_UPDATE_NOTIFIER=1` (or `AZPIM_DISABLE_UPDATE_CHECK=1`).

The update-check cache is stored alongside presets in your config directory:

- macOS/Linux: `~/.config/azpim/update-check.json` (or `$XDG_CONFIG_HOME/azpim/update-check.json`)
- Windows: `%APPDATA%\azpim\update-check.json`

### Non-interactive Mode (Automation)

Use flags to activate or deactivate PIM roles directly without going through the interactive menu, perfect for scripting and CI/CD workflows.

#### Activation Examples

```bash
# Activate a single role by name (non-interactive)
azpim activate --non-interactive --yes \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Owner" \
   --duration-hours 2 \
   --justification "Break-glass for incident" \
   --output json

# Activate multiple roles (repeat --role-name)
azpim activate --non-interactive --yes \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Contributor" \
   --role-name "User Access Administrator"

# If a role name matches multiple eligible roles (different scopes),
# --non-interactive will error unless you explicitly allow activating all matches
azpim activate --non-interactive --yes \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Contributor" \
   --allow-multiple

# Preview what would happen without submitting requests
azpim activate --non-interactive --dry-run \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Contributor" \
   --output json
```

#### Deactivation Examples

```bash
# Deactivate specific roles
azpim deactivate --non-interactive --yes \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Owner" \
   --justification "Task completed"

# Deactivate across all subscriptions (omit subscription-id)
azpim deactivate --non-interactive --yes \
   --role-name "Contributor" \
   --allow-multiple
```

#### Available Flags

**Common flags (activate/deactivate):**

- `--non-interactive` - Disable interactive prompts
- `-y, --yes` - Skip confirmation prompts
- `--subscription-id <id>` - Target subscription (optional for deactivate)
- `--role-name <name>` - Role name(s) to target (can be repeated)
- `--allow-multiple` - Allow multiple role matches
- `--dry-run` - Preview without submitting
- `--output <text|json>` - Output format (default: text)
- `--quiet` - Suppress non-essential output

**Activation-specific:**

- `--duration-hours <n>` - Duration (1-8 hours, default varies by role)
- `--justification <text>` - Justification for activation

**Deactivation-specific:**

- `--justification <text>` - Justification for deactivation (optional)

## Presets

Presets let you save your daily activation/deactivation routines (subscription + role names + duration + justification) and reuse them with `--preset <name>`.

### Presets file location

By default, presets are stored in a per-user config file:

- macOS/Linux: `~/.config/azpim/presets.json` (or `$XDG_CONFIG_HOME/azpim/presets.json`)
- Windows: `%APPDATA%\azpim\presets.json`

Override the location with:

- `AZPIM_PRESETS_PATH=/path/to/presets.json`

### Preset contents

A preset can define one or both blocks:

- `activate`: `subscriptionId`, `roleNames[]`, `durationHours`, `justification`, `allowMultiple`
- `deactivate`: `subscriptionId` (optional), `roleNames[]`, `justification`, `allowMultiple`

`justification` supports simple templates:

- `${date}` → `YYYY-MM-DD`
- `${datetime}` → ISO timestamp
- `${userPrincipalName}` → resolved from Microsoft Graph `/me`

### Common Workflows

```bash
# Create a preset (interactive wizard)
azpim preset add daily-ops

# Create a preset with Azure integration (fetches subscriptions/roles)
azpim preset add daily-ops --from-azure

# Edit a preset (interactive wizard)
azpim preset edit daily-ops

# List all presets
azpim preset list

# Show one preset details
azpim preset show daily-ops

# Remove a preset
azpim preset remove daily-ops

# Use a preset (flags still override preset values)
azpim activate --preset daily-ops --yes

# Non-interactive run using the preset
azpim activate --preset daily-ops --non-interactive --yes --output json

# Deactivate using a preset
azpim deactivate --preset daily-ops --non-interactive --yes
```

### Defaults

When you create a preset via `azpim preset add`, you can optionally set it as the default for `activate` and/or `deactivate`.

- Default presets are applied automatically when you run one-shot flows and you haven’t explicitly provided the required flags.
- Example: after setting a default activate preset, `azpim activate --non-interactive --yes` can work without specifying `--subscription-id`/`--role-name`.

### Example Session

```
╔════════════════════════════════════════════════════╗
║     Azure PIM CLI - Role Activation Manager        ║
╚════════════════════════════════════════════════════╝

✔ Authentication successful

┌─ User Information ──────────────────────────────────
│ Name: John Doe
│ Email: john@example.com
└──────────────────────────────────────────────────────

✔ Found 3 subscription(s)

? What would you like to do?
❯ ▶ Activate Role(s)
  ◼ Deactivate Role(s)
  ✕ Exit
```

### Role Activation Flow

1. Select a subscription from your available Azure subscriptions
2. Choose one or more eligible roles to activate
3. Specify activation duration (1-8 hours)
4. Provide a justification for the activation
5. Confirm and activate

### Role Deactivation Flow

1. View all currently active roles across subscriptions
2. Select roles to deactivate
3. Confirm deactivation

## Favorites

Favorites allow you to mark specific subscriptions for quick access. Favorite subscriptions are displayed at the top of subscription lists in the interactive menu.

### Favorites file location

By default, favorites are stored per-user:

- macOS/Linux: `~/.config/azpim/users/<userId>/favorites.json`
- Windows: `%APPDATA%\azpim\users\<userId>\favorites.json`

Override the location with:

- `AZPIM_FAVORITES_PATH=/path/to/favorites.json`

### Common Workflows

```bash
# List all favorites
azpim favorites list
azpim fav list

# Add a subscription to favorites
azpim favorites add <subscription-id>

# Add even if subscription is not in cache
azpim favorites add <subscription-id> --force

# Remove a subscription from favorites
azpim favorites remove <subscription-id>

# Clear all favorites
azpim favorites clear

# Export favorites to a file
azpim favorites export ./my-favorites.json

# Import favorites from a file (replaces existing)
azpim favorites import ./my-favorites.json

# Import favorites and merge with existing
azpim favorites import ./my-favorites.json --merge

# Refresh the subscription cache
azpim favorites refresh
```

## Subscription Cache

azpim automatically caches subscription information to improve startup time. The cache has a 6-hour TTL (time-to-live) and is refreshed automatically when expired.

### Cache location

Cache files are stored per-user:

- macOS/Linux: `~/.config/azpim/users/<userId>/subscriptions-cache.json`
- Windows: `%APPDATA%\azpim\users\<userId>\subscriptions-cache.json`

### Refreshing the cache

```bash
# Force refresh the subscription cache
azpim favorites refresh
```

## Development

### Available Scripts

```bash
# Run in development mode with hot reload
pnpm dev

# Build the TypeScript project
pnpm build

# Run the built application
pnpm start

# Lint the codebase
pnpm lint
```

## Changelog & releases

This repo uses [Keep a Changelog](https://keepachangelog.com/) format in [CHANGELOG.md](CHANGELOG.md).

### Recommended commit messages

For best results, use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: ...` (new feature) → minor bump
- `fix: ...` (bug fix) → patch bump
- `chore: ...`, `docs: ...`, `refactor: ...` (no bump unless breaking)

### Cutting a release

1. Make sure `CHANGELOG.md` has up-to-date entries under **Unreleased**.

2. Run one of the following:

```bash
# Automatically determines next version from commits, updates CHANGELOG.md,
# bumps package.json, and creates a git tag.
pnpm release

# Preview what would change
pnpm release:dry

# Force a specific bump if needed
pnpm release -- --release-as patch
pnpm release -- --release-as minor
pnpm release -- --release-as major
```

3. Push commits + tags:

```bash
git push --follow-tags
```

4. Publish to npm (if desired):

```bash
npm publish
# or
pnpm publish
```

### Project Structure

```
azpim/
├── src/
│   ├── index.ts                        # CLI entry point and command definitions
│   ├── core/                           # Foundational utilities (no domain logic)
│   │   ├── constants.ts                # Shared magic values and defaults
│   │   ├── errors.ts                   # Unified error handling utilities
│   │   ├── json-store.ts              # Generic JSON file persistence
│   │   ├── paths.ts                    # Config/data file path resolution
│   │   └── ui.ts                       # Terminal UI (spinners, formatting, colors)
│   ├── azure/                          # Azure SDK wrappers
│   │   ├── auth.ts                     # Azure CLI credential + Graph /me lookup
│   │   └── azure-pim.ts               # PIM role activation/deactivation API
│   ├── data/                           # Local data persistence
│   │   ├── favorites.ts               # Favorites management
│   │   ├── presets.ts                  # Preset configuration and validation
│   │   ├── subscription-cache.ts      # Subscription caching (6-hour TTL)
│   │   └── update-check.ts            # Update notification system
│   └── cli/                            # Interactive flows and command scaffolding
│       ├── cli.ts                      # Main menu loop and shared helpers
│       ├── command-handler.ts         # Reusable command wrapper (auth, UI, errors)
│       ├── activate-flow.ts           # Role activation (one-shot + interactive)
│       ├── deactivate-flow.ts         # Role deactivation (one-shot + interactive)
│       ├── subscription-selector.ts   # Subscription search/select with favorites
│       ├── favorites-manager.ts       # Interactive favorites management menu
│       └── presets-cli.ts             # Preset add/edit/manage wizards
├── package.json
├── tsconfig.json
├── CHANGELOG.md
└── README.md
```

### Architecture

The codebase follows a layered module structure:

- **`core/`** — Zero-dependency utilities shared across the entire project. `json-store.ts` provides a generic load/save pattern used by all data persistence files. `errors.ts` centralizes error extraction and command-level error handling. `constants.ts` eliminates magic values.
- **`azure/`** — Thin wrappers around Azure SDKs (`@azure/identity`, `@azure/arm-authorization`, Microsoft Graph). No UI logic.
- **`data/`** — Local file persistence (favorites, presets, subscription cache, update state). All use `json-store` for consistent file I/O.
- **`cli/`** — User-facing interactive flows and command scaffolding. `command-handler.ts` provides a `withCommandHandler` wrapper that eliminates boilerplate (auth, UI setup, error handling) across all Commander commands. Activation and deactivation flows share a `selectSubscriptionInteractive` function from `subscription-selector.ts`.

### Tech Stack

- **TypeScript** - Type-safe JavaScript
- **Commander.js** - CLI framework
- **Inquirer.js** - Interactive prompts
- **Ora** - Elegant terminal spinners
- **Chalk** - Terminal string styling
- **Azure SDK** - Azure service integration

## Environment Variables

| Variable                     | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `AZPIM_PRESETS_PATH`         | Override the presets file path                |
| `AZPIM_FAVORITES_PATH`       | Override the favorites file path              |
| `AZPIM_NO_UPDATE_NOTIFIER`   | Set to `1` to disable automatic update checks |
| `AZPIM_DISABLE_UPDATE_CHECK` | Alias for `AZPIM_NO_UPDATE_NOTIFIER`          |

## Troubleshooting

### "Azure CLI not found" Error

Ensure Azure CLI is installed and accessible in your PATH:

```bash
az --version
```

### Authentication Errors

1. Make sure you're logged in to Azure CLI:

   ```bash
   az login
   ```

2. Verify your account has PIM-eligible roles:

   ```bash
   az account show
   ```

3. Check if you have the necessary permissions in Azure AD

### No Subscriptions Found

- Verify your Azure account has access to subscriptions
- Try refreshing your Azure CLI login: `az login --refresh`

## License

This project is licensed under the ISC License.

## Author

**Tapan Meena** - [tapanmeena1998@gmail.com](mailto:tapanmeena1998@gmail.com)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
