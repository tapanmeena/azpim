# Azure PIM CLI (azp-cli)

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

## Prerequisites

Before using azp-cli, ensure you have:

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

### From Source

```bash
# Clone the repository
git clone https://github.com/tapanmeena/azp-cli.git
cd azp-cli

# Install dependencies
pnpm install
# or
npm install

# Build the project
pnpm build
# or
npm run build
```

## Usage

### Running the CLI

```bash
# Development mode
pnpm dev
# or
npm run dev

# After building
node dist/index.js
```

### Commands

| Command      | Alias | Description                            |
| ------------ | ----- | -------------------------------------- |
| `activate`   | `a`   | Activate a role in Azure PIM (default) |
| `deactivate` | `d`   | Deactivate a role in Azure PIM         |
| `preset`     | -     | Manage reusable presets                |
| `help`       | -     | Display help information               |

### One-command (non-interactive) activation

Use flags to activate PIM roles directly without going through the main menu.

```bash
# Activate a single role by name (non-interactive)
azp activate --no-interactive --yes \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Owner" \
   --duration-hours 2 \
   --justification "Break-glass for incident" \
   --output json

# Activate multiple roles (repeat --role-name)
azp activate --no-interactive --yes \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Contributor" \
   --role-name "User Access Administrator"

# If a role name matches multiple eligible roles (different scopes),
# --no-interactive will error unless you explicitly allow activating all matches
azp activate --no-interactive --yes \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Contributor" \
   --allow-multiple

# Preview what would happen without submitting requests
azp activate --no-interactive --dry-run \
   --subscription-id <SUBSCRIPTION_GUID> \
   --role-name "Contributor" \
   --output json
```

## Presets

Presets let you save your daily activation/deactivation routines (subscription + role names + duration + justification) and reuse them with `--preset <name>`.

### Presets file location

By default, presets are stored in a per-user config file:

- macOS/Linux: `~/.config/azp-cli/presets.json` (or `$XDG_CONFIG_HOME/azp-cli/presets.json`)
- Windows: `%APPDATA%\azp-cli\presets.json`

Override the location with:

- `AZP_PRESETS_PATH=/path/to/presets.json`

### Preset contents

A preset can define one or both blocks:

- `activate`: `subscriptionId`, `roleNames[]`, `durationHours`, `justification`, `allowMultiple`
- `deactivate`: `subscriptionId` (optional), `roleNames[]`, `justification`, `allowMultiple`

`justification` supports simple templates:

- `${date}` → `YYYY-MM-DD`
- `${datetime}` → ISO timestamp
- `${userPrincipalName}` → resolved from Microsoft Graph `/me`

### Common workflows

```bash
# Create a preset (interactive wizard)
azp preset add daily-ops

# Edit a preset (interactive wizard)
azp preset edit daily-ops

# You can also re-run add to overwrite an existing preset
azp preset add daily-ops

# List presets
azp preset list

# Show one preset
azp preset show daily-ops

# Use a preset (flags still override preset values)
azp activate --preset daily-ops --yes

# Non-interactive run using the preset
azp activate --preset daily-ops --no-interactive --yes --output json

# Deactivate using a preset
azp deactivate --preset daily-ops --no-interactive --yes
```

### Defaults

When you create a preset via `azp preset add`, you can optionally set it as the default for `activate` and/or `deactivate`.

- Default presets are applied automatically when you run one-shot flows and you haven’t explicitly provided the required flags.
- Example: after setting a default activate preset, `azp activate --no-interactive --yes` can work without specifying `--subscription-id`/`--role-name`.

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
pnpm publish
```

### Project Structure

```
azp-cli/
├── src/
│   ├── index.ts      # CLI entry point and command definitions
│   ├── auth.ts       # Azure authentication handling
│   ├── azure-pim.ts  # Azure PIM API operations
│   ├── cli.ts        # Interactive menu and user flows
│   └── ui.ts         # Terminal UI utilities (spinners, formatting)
├── package.json
├── tsconfig.json
└── README.md
```

### Tech Stack

- **TypeScript** - Type-safe JavaScript
- **Commander.js** - CLI framework
- **Inquirer.js** - Interactive prompts
- **Ora** - Elegant terminal spinners
- **Chalk** - Terminal string styling
- **Azure SDK** - Azure service integration

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
