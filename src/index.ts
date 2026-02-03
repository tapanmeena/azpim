#!/usr/bin/env node

import { Command } from "commander";
import inquirer from "inquirer";
import { name as npmPackageName, version } from "../package.json";
import { authenticate } from "./auth";
import { activateOnce, deactivateOnce, showMainMenu } from "./cli";
import {
  addFavorite,
  clearFavorites,
  exportFavorites,
  getFavoriteIds,
  importFavorites,
  loadFavorites,
  removeFavorite,
  saveFavorites,
} from "./favorites";
import { migrateGlobalFilesToUser } from "./paths";
import {
  expandTemplate,
  getPreset,
  listPresetNames,
  loadPresets,
  removePreset,
  resolveActivatePresetOptions,
  resolveDeactivatePresetOptions,
  savePresets,
  setDefaultPresetName,
  upsertPreset,
} from "./presets";
import { runPresetAddWizard, runPresetEditWizard } from "./presets-cli";
import { formatCacheAge, getCacheAge, getSubscriptionNameMap, invalidateCache, validateSubscriptionId } from "./subscription-cache";
import { configureUi, logBlank, logDim, logError, logInfo, logSuccess, logWarning, showHeader } from "./ui";
import { checkForUpdate } from "./update-check";

type OutputFormat = "text" | "json";

type ActivateCommandOptions = {
  subscriptionId?: string;
  roleName?: string[];
  durationHours?: number;
  justification?: string;
  preset?: string;
  nonInteractive?: boolean;
  yes?: boolean;
  allowMultiple?: boolean;
  dryRun?: boolean;
  output?: OutputFormat;
  quiet?: boolean;
};

type DeactivateCommandOptions = {
  subscriptionId?: string;
  roleName?: string[];
  justification?: string;
  preset?: string;
  nonInteractive?: boolean;
  yes?: boolean;
  allowMultiple?: boolean;
  dryRun?: boolean;
  output?: OutputFormat;
  quiet?: boolean;
};

type PresetCommandOptions = {
  output?: OutputFormat;
  quiet?: boolean;
  fromAzure?: boolean;
  yes?: boolean;
};

type UpdateCommandOptions = {
  output?: OutputFormat;
  quiet?: boolean;
  checkOnly?: boolean;
};

const maybeNotifyUpdate = async (output: OutputFormat, quiet: boolean): Promise<void> => {
  if (quiet || output !== "text") return;
  if (!process.stdout.isTTY) return;
  if (process.env.CI) return;

  const result = await checkForUpdate({
    packageName: npmPackageName,
    currentVersion: version,
    mode: "auto",
  });

  if (!result.ok || !result.updateAvailable || !result.latestVersion) return;

  logWarning(`Update available: ${result.currentVersion} → ${result.latestVersion}`);
  logDim(`Update: npm install -g ${npmPackageName}@latest`);
  logDim(`        pnpm add -g ${npmPackageName}@latest`);
  logBlank();
};

const getOptionValueSource = (command: Command, optionName: string): string | undefined => {
  const fn = (command as any).getOptionValueSource;
  if (typeof fn === "function") return fn.call(command, optionName);
  return undefined;
};

const resolveValue = <T>(command: Command, optionName: string, cliValue: T, presetValue: T | undefined): T => {
  const source = getOptionValueSource(command, optionName);
  if (source === "cli") return cliValue;
  if (presetValue !== undefined) return presetValue;
  return cliValue;
};

const program = new Command();

program
  .name("azpim")
  .description("Azure PIM CLI - A CLI tool for Azure Privilege Identity Management (PIM)")
  .version(version)
  .option("--debug", "Enable debug logging");

program
  .command("activate", { isDefault: true })
  .description("Activate a role in Azure PIM")
  .alias("a")
  .option("--subscription-id <id>", "Azure subscription ID (required for non-interactive one-shot activation)")
  .option(
    "--role-name <name>",
    "Role name to activate (can be repeated). In --non-interactive mode, ambiguous matches error unless --allow-multiple is set.",
    (value: string, previous: string[] | undefined) => {
      const list = previous ?? [];
      list.push(value);
      return list;
    },
    [],
  )
  .option("--duration-hours <n>", "Duration hours (1-8)", (value: string) => Number.parseInt(value, 10))
  .option("--justification <text>", "Justification for activation")
  .option("--preset <name>", "Use a saved preset (fills defaults; flags still override)")
  .option("--non-interactive", "Do not prompt; require flags to be unambiguous")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--allow-multiple", "Allow activating multiple eligible matches for a role name")
  .option("--dry-run", "Resolve targets and print summary without submitting activation requests")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: ActivateCommandOptions, command: Command) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      // Show header (text mode only)
      showHeader();

      await maybeNotifyUpdate(output, quiet);

      const explicitPresetName = getOptionValueSource(command, "preset") === "cli" ? cmd.preset : undefined;

      const requestedRoleNames = cmd.roleName ?? [];
      const wantsOneShot = Boolean(cmd.nonInteractive || cmd.subscriptionId || requestedRoleNames.length > 0 || cmd.dryRun || explicitPresetName);

      // Authenticate (required for both interactive and one-shot flows)
      const authContext = await authenticate();

      // Migrate global config files to user-specific location
      await migrateGlobalFilesToUser(authContext.userId);

      if (!wantsOneShot) {
        await showMainMenu(authContext);
        return;
      }

      const presets = await loadPresets(authContext.userId);
      const hasRoleNamesFromCli = getOptionValueSource(command, "roleName") === "cli";
      const hasSubscriptionFromCli = getOptionValueSource(command, "subscriptionId") === "cli";

      const defaultPresetName = presets.data.defaults?.activatePreset;
      const shouldUseDefaultPreset = !explicitPresetName && Boolean(defaultPresetName) && (!hasSubscriptionFromCli || !hasRoleNamesFromCli);

      const presetNameToUse = explicitPresetName ?? (shouldUseDefaultPreset ? defaultPresetName : undefined);

      if (explicitPresetName) {
        const entry = getPreset(presets.data, explicitPresetName);
        if (!entry) {
          const names = listPresetNames(presets.data);
          throw new Error(
            `Preset not found: "${explicitPresetName}". Presets file: ${presets.filePath}. Available: ${names.length ? names.join(", ") : "(none)"}`,
          );
        }
        if (!entry.activate) {
          throw new Error(`Preset "${explicitPresetName}" does not define an activate block.`);
        }
      }

      const presetOptions = resolveActivatePresetOptions(presets.data, presetNameToUse);

      const effectiveSubscriptionId = resolveValue(command, "subscriptionId", cmd.subscriptionId ?? "", presetOptions.subscriptionId);
      const effectiveRoleNames = resolveValue(command, "roleName", requestedRoleNames, presetOptions.roleNames ?? undefined);
      const effectiveDurationHours = resolveValue(command, "durationHours", cmd.durationHours, presetOptions.durationHours);
      const effectiveAllowMultiple = resolveValue(command, "allowMultiple", cmd.allowMultiple, presetOptions.allowMultiple);
      const effectiveJustificationRaw = resolveValue(command, "justification", cmd.justification, presetOptions.justification);
      const effectiveJustification = effectiveJustificationRaw
        ? expandTemplate(effectiveJustificationRaw, {
            userId: authContext.userId,
            userPrincipalName: authContext.userPrincipalName,
          })
        : undefined;

      const result = await activateOnce(authContext, {
        subscriptionId: effectiveSubscriptionId,
        roleNames: effectiveRoleNames,
        durationHours: effectiveDurationHours,
        justification: effectiveJustification,
        dryRun: cmd.dryRun,
        nonInteractive: cmd.nonInteractive,
        yes: cmd.yes,
        allowMultiple: effectiveAllowMultiple,
      });

      if (output === "json") {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }

      logBlank();
      logError(`An error occurred: ${errorMessage}`);

      if (errorMessage.includes("AADSTS")) {
        logBlank();
        logError("Authentication error detected. Please ensure you have the necessary permissions and try again.");
        logDim("Tip: Make sure you are logged in with 'az login' before running this command.");
      }

      if (errorMessage.includes("Azure CLI not found") || errorMessage.includes("AzureCliCredential")) {
        logBlank();
        logDim("Tip: Make sure Azure CLI is installed and you are logged in with 'az login'.");
      }

      logBlank();
      process.exit(1);
    }
  });

program
  .command("deactivate")
  .description("Deactivate a role in Azure PIM")
  .alias("d")
  .option("--subscription-id <id>", "Azure subscription ID (optional; if omitted, searches all subscriptions)")
  .option(
    "--role-name <name>",
    "Role name to deactivate (can be repeated). In --non-interactive mode, ambiguous matches error unless --allow-multiple is set.",
    (value: string, previous: string[] | undefined) => {
      const list = previous ?? [];
      list.push(value);
      return list;
    },
    [],
  )
  .option("--justification <text>", "Justification for deactivation")
  .option("--preset <name>", "Use a saved preset (fills defaults; flags still override)")
  .option("--non-interactive", "Do not prompt; require flags to be unambiguous")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--allow-multiple", "Allow deactivating multiple active matches for a role name")
  .option("--dry-run", "Resolve targets and print summary without submitting deactivation requests")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: DeactivateCommandOptions, command: Command) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      // Show header (text mode only)
      showHeader();

      await maybeNotifyUpdate(output, quiet);

      const explicitPresetName = getOptionValueSource(command, "preset") === "cli" ? cmd.preset : undefined;

      const requestedRoleNames = cmd.roleName ?? [];
      const wantsOneShot = Boolean(cmd.nonInteractive || cmd.subscriptionId || requestedRoleNames.length > 0 || cmd.dryRun || explicitPresetName);

      // Authenticate (required for both interactive and one-shot flows)
      const authContext = await authenticate();

      // Migrate global config files to user-specific location
      await migrateGlobalFilesToUser(authContext.userId);

      if (!wantsOneShot) {
        await showMainMenu(authContext);
        return;
      }

      const presets = await loadPresets(authContext.userId);
      const hasRoleNamesFromCli = getOptionValueSource(command, "roleName") === "cli";

      const defaultPresetName = presets.data.defaults?.deactivatePreset;
      const shouldUseDefaultPreset = !explicitPresetName && Boolean(defaultPresetName) && !hasRoleNamesFromCli;
      const presetNameToUse = explicitPresetName ?? (shouldUseDefaultPreset ? defaultPresetName : undefined);

      if (explicitPresetName) {
        const entry = getPreset(presets.data, explicitPresetName);
        if (!entry) {
          const names = listPresetNames(presets.data);
          throw new Error(
            `Preset not found: "${explicitPresetName}". Presets file: ${presets.filePath}. Available: ${names.length ? names.join(", ") : "(none)"}`,
          );
        }
        if (!entry.deactivate) {
          throw new Error(`Preset "${explicitPresetName}" does not define a deactivate block.`);
        }
      }

      const presetOptions = resolveDeactivatePresetOptions(presets.data, presetNameToUse);

      const effectiveSubscriptionId = resolveValue(command, "subscriptionId", cmd.subscriptionId, presetOptions.subscriptionId);
      const effectiveRoleNames = resolveValue(command, "roleName", requestedRoleNames, presetOptions.roleNames ?? undefined);
      const effectiveAllowMultiple = resolveValue(command, "allowMultiple", cmd.allowMultiple, presetOptions.allowMultiple);
      const effectiveJustificationRaw = resolveValue(command, "justification", cmd.justification, presetOptions.justification);
      const effectiveJustification = effectiveJustificationRaw
        ? expandTemplate(effectiveJustificationRaw, {
            userId: authContext.userId,
            userPrincipalName: authContext.userPrincipalName,
          })
        : undefined;

      const result = await deactivateOnce(authContext, {
        subscriptionId: effectiveSubscriptionId,
        roleNames: effectiveRoleNames,
        justification: effectiveJustification,
        dryRun: cmd.dryRun,
        nonInteractive: cmd.nonInteractive,
        yes: cmd.yes,
        allowMultiple: effectiveAllowMultiple,
      });

      if (output === "json") {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }

      logBlank();
      logError(`An error occurred: ${errorMessage}`);

      if (errorMessage.includes("AADSTS")) {
        logBlank();
        logError("Authentication error detected. Please ensure you have the necessary permissions and try again.");
        logDim("Tip: Make sure you are logged in with 'az login' before running this command.");
      }

      if (errorMessage.includes("Azure CLI not found") || errorMessage.includes("AzureCliCredential")) {
        logBlank();
        logDim("Tip: Make sure Azure CLI is installed and you are logged in with 'az login'.");
      }

      logBlank();
      process.exit(1);
    }
  });

program
  .command("check-update")
  .description("Check if a newer azpim version is available")
  .alias("update")
  .option("--check-only", "Only check and print status (no upgrade instructions)")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: UpdateCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const result = await checkForUpdate({
        packageName: npmPackageName,
        currentVersion: version,
        mode: "force",
      });

      const upgradeCommands = {
        npm: `npm install -g ${npmPackageName}@latest`,
        pnpm: `pnpm add -g ${npmPackageName}@latest`,
      };

      if (output === "json") {
        process.stdout.write(
          `${JSON.stringify(
            {
              ...result,
              upgradeCommands: result.updateAvailable ? upgradeCommands : undefined,
            },
            null,
            2,
          )}\n`,
        );
        process.exit(result.ok ? (result.updateAvailable ? 2 : 0) : 1);
      }

      if (!result.ok) {
        logWarning("Could not check for updates.");
        if (result.error) logDim(result.error);
        if (!cmd.checkOnly) {
          logBlank();
          logDim(`Upgrade (when ready): ${upgradeCommands.npm}`);
          logDim(`Or:                ${upgradeCommands.pnpm}`);
        }
        process.exit(1);
      }

      if (result.updateAvailable && result.latestVersion) {
        logWarning(`Update available: ${result.currentVersion} → ${result.latestVersion}`);
        if (!cmd.checkOnly) {
          logBlank();
          logDim(`Upgrade: ${upgradeCommands.npm}`);
          logDim(`Or:      ${upgradeCommands.pnpm}`);
        }
        process.exit(2);
      }

      logSuccess(`You're up to date (${result.currentVersion}).`);
      process.exit(0);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

program
  .command("help")
  .description("Display help information about azpim commands")
  .action(() => {
    showHeader();
    program.outputHelp();
  });

const presetCommand = program
  .command("preset")
  .description("Manage azpim presets")
  .addHelpText("after", `\nPresets are stored per-user after authentication.\nYou can override via environment variable AZPIM_PRESETS_PATH.\n`);

presetCommand
  .command("list")
  .description("List available presets")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: PresetCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      await migrateGlobalFilesToUser(authContext.userId);

      const loaded = await loadPresets(authContext.userId);
      const names = listPresetNames(loaded.data);

      if (output === "json") {
        process.stdout.write(
          `${JSON.stringify(
            {
              ok: true,
              filePath: loaded.filePath,
              defaults: loaded.data.defaults ?? {},
              presets: names,
            },
            null,
            2,
          )}\n`,
        );
        return;
      }

      logInfo(`Presets file: ${loaded.filePath}`);
      if (!loaded.exists) {
        logDim("(File does not exist yet; use 'azpim preset add' to create one.)");
      }
      logBlank();

      if (names.length === 0) {
        logWarning("No presets found.");
        return;
      }

      const defaultActivate = loaded.data.defaults?.activatePreset;
      const defaultDeactivate = loaded.data.defaults?.deactivatePreset;
      for (const name of names) {
        const tags: string[] = [];
        if (defaultActivate === name) tags.push("default:activate");
        if (defaultDeactivate === name) tags.push("default:deactivate");
        const suffix = tags.length ? ` (${tags.join(", ")})` : "";
        logInfo(`${name}${suffix}`);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

presetCommand
  .command("show")
  .description("Show a preset")
  .argument("<name>", "Preset name")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (name: string, cmd: PresetCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      await migrateGlobalFilesToUser(authContext.userId);

      const loaded = await loadPresets(authContext.userId);
      const entry = getPreset(loaded.data, name);
      if (!entry) {
        const names = listPresetNames(loaded.data);
        throw new Error(`Preset not found: "${name}". Presets file: ${loaded.filePath}. Available: ${names.length ? names.join(", ") : "(none)"}`);
      }

      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: true, filePath: loaded.filePath, name, preset: entry }, null, 2)}\n`);
        return;
      }

      logInfo(`Preset: ${name}`);
      if (entry.description) logDim(entry.description);
      logBlank();

      if (entry.activate) {
        logInfo("activate:");
        logDim(`  subscriptionId: ${entry.activate.subscriptionId ?? "(unset)"}`);
        logDim(`  roleNames: ${(entry.activate.roleNames ?? []).join(", ") || "(unset)"}`);
        logDim(`  durationHours: ${entry.activate.durationHours ?? "(unset)"}`);
        logDim(`  justification: ${entry.activate.justification ?? "(unset)"}`);
        logDim(`  allowMultiple: ${entry.activate.allowMultiple ?? "(unset)"}`);
        logBlank();
      }

      if (entry.deactivate) {
        logInfo("deactivate:");
        logDim(`  subscriptionId: ${entry.deactivate.subscriptionId ?? "(unset)"}`);
        logDim(`  roleNames: ${(entry.deactivate.roleNames ?? []).join(", ") || "(unset)"}`);
        logDim(`  justification: ${entry.deactivate.justification ?? "(unset)"}`);
        logDim(`  allowMultiple: ${entry.deactivate.allowMultiple ?? "(unset)"}`);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

presetCommand
  .command("add")
  .description("Add a preset (interactive wizard)")
  .argument("[name]", "Preset name")
  .option("--from-azure", "Pick subscription and role names from Azure (prompts for auth)")
  .option("--no-from-azure", "Create preset without querying Azure")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (name: string | undefined, cmd: PresetCommandOptions, command: Command) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      await migrateGlobalFilesToUser(authContext.userId);

      const loaded = await loadPresets(authContext.userId);
      const existingNames = listPresetNames(loaded.data);

      if (name && getPreset(loaded.data, name)) {
        if (!cmd.yes) {
          const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
            {
              type: "confirm",
              name: "overwrite",
              message: `Preset "${name}" already exists. Overwrite?`,
              default: false,
            },
          ]);
          if (!overwrite) {
            throw new Error("Aborted.");
          }
        }
      }

      const fromAzureSource = getOptionValueSource(command, "fromAzure");
      const wizardFromAzure = fromAzureSource === "cli" ? Boolean(cmd.fromAzure) : undefined;

      const namesForValidation = name && getPreset(loaded.data, name) ? existingNames.filter((n) => n !== name) : existingNames;

      const wizard = await runPresetAddWizard({
        name,
        fromAzure: wizardFromAzure,
        existingNames: namesForValidation,
      });

      if (!cmd.yes) {
        const { confirmSave } = await inquirer.prompt<{
          confirmSave: boolean;
        }>([
          {
            type: "confirm",
            name: "confirmSave",
            message: "Save this preset?",
            default: true,
          },
        ]);
        if (!confirmSave) {
          throw new Error("Aborted.");
        }
      }

      let next = upsertPreset(loaded.data, wizard.name, wizard.entry);

      if (wizard.setDefaultFor === "activate" || wizard.setDefaultFor === "both") {
        next = setDefaultPresetName(next, "activate", wizard.name);
      }
      if (wizard.setDefaultFor === "deactivate" || wizard.setDefaultFor === "both") {
        next = setDefaultPresetName(next, "deactivate", wizard.name);
      }

      await savePresets(loaded.filePath, next);

      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: true, filePath: loaded.filePath, name: wizard.name }, null, 2)}\n`);
        return;
      }

      logSuccess(`Preset saved: ${wizard.name}`);
      logDim(`File: ${loaded.filePath}`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

presetCommand
  .command("edit")
  .description("Edit an existing preset (interactive wizard)")
  .argument("<name>", "Preset name")
  .option("--from-azure", "Pick subscription and role names from Azure (prompts for auth)")
  .option("--no-from-azure", "Edit preset without querying Azure")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (name: string, cmd: PresetCommandOptions, command: Command) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      await migrateGlobalFilesToUser(authContext.userId);

      const loaded = await loadPresets(authContext.userId);
      const existing = getPreset(loaded.data, name);
      if (!existing) {
        throw new Error(`Preset not found: "${name}"`);
      }

      const fromAzureSource = getOptionValueSource(command, "fromAzure");
      const wizardFromAzure = fromAzureSource === "cli" ? Boolean(cmd.fromAzure) : undefined;

      const wizard = await runPresetEditWizard({
        name,
        existingEntry: existing,
        fromAzure: wizardFromAzure,
      });

      if (!cmd.yes) {
        const { confirmSave } = await inquirer.prompt<{ confirmSave: boolean }>([
          {
            type: "confirm",
            name: "confirmSave",
            message: `Save changes to preset "${name}"?`,
            default: true,
          },
        ]);
        if (!confirmSave) {
          throw new Error("Aborted.");
        }
      }

      let next = upsertPreset(loaded.data, name, wizard.entry);
      if (wizard.setDefaultFor === "activate" || wizard.setDefaultFor === "both") {
        next = setDefaultPresetName(next, "activate", name);
      }
      if (wizard.setDefaultFor === "deactivate" || wizard.setDefaultFor === "both") {
        next = setDefaultPresetName(next, "deactivate", name);
      }

      await savePresets(loaded.filePath, next);

      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: true, filePath: loaded.filePath, name }, null, 2)}\n`);
        return;
      }

      logSuccess(`Preset updated: ${name}`);
      logDim(`File: ${loaded.filePath}`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

presetCommand
  .command("remove")
  .description("Remove a preset")
  .argument("<name>", "Preset name")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (name: string, cmd: PresetCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      await migrateGlobalFilesToUser(authContext.userId);

      const loaded = await loadPresets(authContext.userId);
      const entry = getPreset(loaded.data, name);
      if (!entry) {
        throw new Error(`Preset not found: "${name}"`);
      }

      if (!cmd.yes) {
        const { confirmRemove } = await inquirer.prompt<{
          confirmRemove: boolean;
        }>([
          {
            type: "confirm",
            name: "confirmRemove",
            message: `Remove preset "${name}"?`,
            default: false,
          },
        ]);
        if (!confirmRemove) {
          throw new Error("Aborted.");
        }
      }

      let next = removePreset(loaded.data, name);
      if (next.defaults?.activatePreset === name) next = setDefaultPresetName(next, "activate", undefined);
      if (next.defaults?.deactivatePreset === name) next = setDefaultPresetName(next, "deactivate", undefined);

      await savePresets(loaded.filePath, next);

      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: true, filePath: loaded.filePath, name }, null, 2)}\n`);
        return;
      }

      logSuccess(`Preset removed: ${name}`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

// ===============================
// Favorites Command
// ===============================

type FavoritesCommandOptions = {
  output?: OutputFormat;
  quiet?: boolean;
  force?: boolean;
  merge?: boolean;
};

const favoritesCommand = program.command("favorites").description("Manage favorite subscriptions").alias("fav");

favoritesCommand
  .command("list")
  .description("List all favorite subscriptions")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: FavoritesCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      const userId = authContext.userId;
      await migrateGlobalFilesToUser(userId);

      const loaded = await loadFavorites(userId);
      const favoriteIds = getFavoriteIds(loaded.data);
      const subscriptionNames = await getSubscriptionNameMap(userId);
      const cacheAge = await getCacheAge(userId);

      if (output === "json") {
        const favorites = favoriteIds.map((id) => ({
          subscriptionId: id,
          displayName: subscriptionNames.get(id) || null,
        }));
        process.stdout.write(`${JSON.stringify({ ok: true, filePath: loaded.filePath, cacheAge: cacheAge, favorites }, null, 2)}\n`);
        return;
      }

      logInfo(`Favorites: ${favoriteIds.length} subscription(s)`);
      logDim(`File: ${loaded.filePath}`);
      logDim(`Cache: ${formatCacheAge(cacheAge)}`);
      logBlank();

      if (favoriteIds.length === 0) {
        logWarning("No favorites configured yet.");
        logDim("Add favorites with: azpim favorites add <subscriptionId>");
      } else {
        for (const id of favoriteIds) {
          const name = subscriptionNames.get(id) || "(name not cached)";
          console.log(`  ★ ${name} (${id})`);
        }
      }
      logBlank();
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

favoritesCommand
  .command("add")
  .description("Add a subscription to favorites")
  .argument("<subscriptionId>", "Subscription ID to add")
  .option("--force", "Add even if subscription is not found in cache")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (subscriptionId: string, cmd: FavoritesCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      const userId = authContext.userId;
      await migrateGlobalFilesToUser(userId);

      const loaded = await loadFavorites(userId);
      const normalizedId = subscriptionId.trim().toLowerCase();

      // Check if already a favorite
      const existingIds = getFavoriteIds(loaded.data);
      if (existingIds.includes(normalizedId)) {
        if (output === "json") {
          process.stdout.write(`${JSON.stringify({ ok: true, alreadyExists: true, subscriptionId: normalizedId }, null, 2)}\n`);
          return;
        }
        logInfo("This subscription is already a favorite.");
        return;
      }

      // Validate against cache
      const validation = await validateSubscriptionId(userId, normalizedId);
      if (!validation.valid && !cmd.force) {
        throw new Error(
          `Subscription "${normalizedId}" not found in cache. Use --force to add anyway, or run 'azpim favorites refresh' to update cache.`,
        );
      }

      const updatedData = addFavorite(loaded.data, normalizedId);
      await saveFavorites(loaded.filePath, updatedData);

      const displayName = validation.subscription?.displayName || normalizedId;

      if (output === "json") {
        process.stdout.write(
          `${JSON.stringify({ ok: true, added: true, subscriptionId: normalizedId, displayName, validated: validation.valid }, null, 2)}\n`,
        );
        return;
      }

      if (validation.valid) {
        logSuccess(`Added "${displayName}" to favorites.`);
      } else {
        logWarning(`Added unvalidated subscription ID "${normalizedId}" to favorites.`);
      }
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

favoritesCommand
  .command("remove")
  .description("Remove a subscription from favorites")
  .argument("<subscriptionId>", "Subscription ID to remove")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (subscriptionId: string, cmd: FavoritesCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      const userId = authContext.userId;
      await migrateGlobalFilesToUser(userId);

      const loaded = await loadFavorites(userId);
      const normalizedId = subscriptionId.trim().toLowerCase();

      // Check if it's a favorite
      const existingIds = getFavoriteIds(loaded.data);
      if (!existingIds.includes(normalizedId)) {
        if (output === "json") {
          process.stdout.write(`${JSON.stringify({ ok: true, notFound: true, subscriptionId: normalizedId }, null, 2)}\n`);
          return;
        }
        logWarning("This subscription is not in favorites.");
        return;
      }

      const updatedData = removeFavorite(loaded.data, normalizedId);
      await saveFavorites(loaded.filePath, updatedData);

      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: true, removed: true, subscriptionId: normalizedId }, null, 2)}\n`);
        return;
      }

      logSuccess(`Removed "${normalizedId}" from favorites.`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

favoritesCommand
  .command("clear")
  .description("Clear all favorites")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: FavoritesCommandOptions & { yes?: boolean }) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      const userId = authContext.userId;
      await migrateGlobalFilesToUser(userId);

      const loaded = await loadFavorites(userId);
      const favoriteIds = getFavoriteIds(loaded.data);

      if (favoriteIds.length === 0) {
        if (output === "json") {
          process.stdout.write(`${JSON.stringify({ ok: true, cleared: 0 }, null, 2)}\n`);
          return;
        }
        logWarning("No favorites to clear.");
        return;
      }

      if (!cmd.yes && output !== "json") {
        const { confirmClear } = await inquirer.prompt<{
          confirmClear: boolean;
        }>([
          {
            type: "confirm",
            name: "confirmClear",
            message: `Clear all ${favoriteIds.length} favorite(s)?`,
            default: false,
          },
        ]);
        if (!confirmClear) {
          throw new Error("Aborted.");
        }
      }

      const updatedData = clearFavorites(loaded.data);
      await saveFavorites(loaded.filePath, updatedData);

      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: true, cleared: favoriteIds.length }, null, 2)}\n`);
        return;
      }

      logSuccess(`Cleared ${favoriteIds.length} favorite(s).`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

favoritesCommand
  .command("export")
  .description("Export favorites to a file")
  .argument("<filePath>", "Path to export file")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (filePath: string, cmd: FavoritesCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      const userId = authContext.userId;
      await migrateGlobalFilesToUser(userId);

      const loaded = await loadFavorites(userId);
      const favoriteIds = getFavoriteIds(loaded.data);

      if (favoriteIds.length === 0) {
        throw new Error("No favorites to export.");
      }

      const subscriptionNames = await getSubscriptionNameMap(userId);
      await exportFavorites(loaded.data, filePath.trim(), subscriptionNames);

      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: true, exported: favoriteIds.length, filePath: filePath.trim() }, null, 2)}\n`);
        return;
      }

      logSuccess(`Exported ${favoriteIds.length} favorite(s) to ${filePath.trim()}`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

favoritesCommand
  .command("import")
  .description("Import favorites from a file")
  .argument("<filePath>", "Path to import file")
  .option("--merge", "Merge with existing favorites (default: replace)")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (filePath: string, cmd: FavoritesCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      const authContext = await authenticate();
      const userId = authContext.userId;
      await migrateGlobalFilesToUser(userId);

      const loaded = await loadFavorites(userId);
      const merge = cmd.merge ?? false;

      const { data: importedData, result } = await importFavorites(loaded.data, filePath.trim(), merge);
      await saveFavorites(loaded.filePath, importedData);

      if (output === "json") {
        process.stdout.write(
          `${JSON.stringify({ ok: true, imported: result.imported, skipped: result.skipped, total: result.total, merge }, null, 2)}\n`,
        );
        return;
      }

      logSuccess(`Imported ${result.imported} new favorite(s), ${result.skipped} already existed.`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

favoritesCommand
  .command("refresh")
  .description("Refresh the subscription cache")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: FavoritesCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      const debug = Boolean(program.opts().debug);
      configureUi({ quiet, debug });

      showHeader();

      // Authenticate to fetch subscriptions
      const authContext = await authenticate();
      const userId = authContext.userId;

      logInfo("Invalidating subscription cache...");
      await invalidateCache(userId);

      logInfo("Fetching fresh subscription list...");
      const azurePim = await import("./azure-pim.js");
      const subscriptions = await azurePim.fetchSubscriptions(authContext.credential, userId, { forceRefresh: true });

      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: true, subscriptionCount: subscriptions.length }, null, 2)}\n`);
        return;
      }

      logSuccess(`Subscription cache refreshed. Found ${subscriptions.length} subscription(s).`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const output = (cmd.output ?? "text") as OutputFormat;
      if (output === "json") {
        process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
        process.exit(1);
      }
      logBlank();
      logError(`An error occurred: ${errorMessage}`);
      logBlank();
      process.exit(1);
    }
  });

program.parse();
