#!/usr/bin/env node

import { Command } from "commander";
import inquirer from "inquirer";
import { version } from "../package.json";
import { authenticate } from "./auth";
import { activateOnce, deactivateOnce, showMainMenu } from "./cli";
import { runPresetAddWizard, runPresetEditWizard } from "./presets-cli";
import {
  expandTemplate,
  getDefaultPresetsFilePath,
  getPreset,
  listPresetNames,
  loadPresets,
  removePreset,
  savePresets,
  resolveActivatePresetOptions,
  resolveDeactivatePresetOptions,
  setDefaultPresetName,
  upsertPreset,
} from "./presets";
import { configureUi, logBlank, logDim, logError, logInfo, logSuccess, logWarning, showHeader } from "./ui";

type OutputFormat = "text" | "json";

type ActivateCommandOptions = {
  subscriptionId?: string;
  roleName?: string[];
  durationHours?: number;
  justification?: string;
  preset?: string;
  noInteractive?: boolean;
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
  noInteractive?: boolean;
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

program.name("azp-cli").description("Azure PIM CLI - A CLI tool for Azure Privilege Identity Management (PIM)").version(version);

program
  .command("activate", { isDefault: true })
  .description("Activate a role in Azure PIM")
  .alias("a")
  .option("--subscription-id <id>", "Azure subscription ID (required for non-interactive one-shot activation)")
  .option(
    "--role-name <name>",
    "Role name to activate (can be repeated). In --no-interactive mode, ambiguous matches error unless --allow-multiple is set.",
    (value: string, previous: string[] | undefined) => {
      const list = previous ?? [];
      list.push(value);
      return list;
    },
    []
  )
  .option("--duration-hours <n>", "Duration hours (1-8)", (value: string) => Number.parseInt(value, 10))
  .option("--justification <text>", "Justification for activation")
  .option("--preset <name>", "Use a saved preset (fills defaults; flags still override)")
  .option("--no-interactive", "Do not prompt; require flags to be unambiguous")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--allow-multiple", "Allow activating multiple eligible matches for a role name")
  .option("--dry-run", "Resolve targets and print summary without submitting activation requests")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: ActivateCommandOptions, command: Command) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      configureUi({ quiet });

      // Show header (text mode only)
      showHeader();

      const explicitPresetName = getOptionValueSource(command, "preset") === "cli" ? cmd.preset : undefined;

      const requestedRoleNames = cmd.roleName ?? [];
      const wantsOneShot = Boolean(cmd.noInteractive || cmd.subscriptionId || requestedRoleNames.length > 0 || cmd.dryRun || explicitPresetName);

      // Authenticate (required for both interactive and one-shot flows)
      const authContext = await authenticate();

      if (!wantsOneShot) {
        await showMainMenu(authContext);
        return;
      }

      const presets = await loadPresets();
      const hasRoleNamesFromCli = getOptionValueSource(command, "roleName") === "cli";
      const hasSubscriptionFromCli = getOptionValueSource(command, "subscriptionId") === "cli";

      const defaultPresetName = presets.data.defaults?.activatePreset;
      const shouldUseDefaultPreset =
        !explicitPresetName && Boolean(defaultPresetName) && (!hasSubscriptionFromCli || !hasRoleNamesFromCli);

      const presetNameToUse = explicitPresetName ?? (shouldUseDefaultPreset ? defaultPresetName : undefined);

      if (explicitPresetName) {
        const entry = getPreset(presets.data, explicitPresetName);
        if (!entry) {
          const names = listPresetNames(presets.data);
          throw new Error(
            `Preset not found: "${explicitPresetName}". Presets file: ${presets.filePath}. Available: ${names.length ? names.join(", ") : "(none)"}`
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
        noInteractive: cmd.noInteractive,
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
    "Role name to deactivate (can be repeated). In --no-interactive mode, ambiguous matches error unless --allow-multiple is set.",
    (value: string, previous: string[] | undefined) => {
      const list = previous ?? [];
      list.push(value);
      return list;
    },
    []
  )
  .option("--justification <text>", "Justification for deactivation")
  .option("--preset <name>", "Use a saved preset (fills defaults; flags still override)")
  .option("--no-interactive", "Do not prompt; require flags to be unambiguous")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--allow-multiple", "Allow deactivating multiple active matches for a role name")
  .option("--dry-run", "Resolve targets and print summary without submitting deactivation requests")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: DeactivateCommandOptions, command: Command) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      configureUi({ quiet });

      // Show header (text mode only)
      showHeader();

      const explicitPresetName = getOptionValueSource(command, "preset") === "cli" ? cmd.preset : undefined;

      const requestedRoleNames = cmd.roleName ?? [];
      const wantsOneShot = Boolean(cmd.noInteractive || cmd.subscriptionId || requestedRoleNames.length > 0 || cmd.dryRun || explicitPresetName);

      // Authenticate (required for both interactive and one-shot flows)
      const authContext = await authenticate();

      if (!wantsOneShot) {
        await showMainMenu(authContext);
        return;
      }

      const presets = await loadPresets();
      const hasRoleNamesFromCli = getOptionValueSource(command, "roleName") === "cli";

      const defaultPresetName = presets.data.defaults?.deactivatePreset;
      const shouldUseDefaultPreset = !explicitPresetName && Boolean(defaultPresetName) && !hasRoleNamesFromCli;
      const presetNameToUse = explicitPresetName ?? (shouldUseDefaultPreset ? defaultPresetName : undefined);

      if (explicitPresetName) {
        const entry = getPreset(presets.data, explicitPresetName);
        if (!entry) {
          const names = listPresetNames(presets.data);
          throw new Error(
            `Preset not found: "${explicitPresetName}". Presets file: ${presets.filePath}. Available: ${names.length ? names.join(", ") : "(none)"}`
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
        noInteractive: cmd.noInteractive,
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
  .command("help")
  .description("Display help information about azp-cli commands")
  .action(() => {
    showHeader();
    program.outputHelp();
  });

const presetCommand = program
  .command("preset")
  .description("Manage azp-cli presets")
  .addHelpText(
    "after",
    `\nPresets file location:\n  ${getDefaultPresetsFilePath()}\n\nYou can override via environment variable AZP_PRESETS_PATH.\n`
  );

presetCommand
  .command("list")
  .description("List available presets")
  .option("--output <text|json>", "Output format", "text")
  .option("--quiet", "Suppress non-essential output (recommended with --output json)")
  .action(async (cmd: PresetCommandOptions) => {
    try {
      const output = (cmd.output ?? "text") as OutputFormat;
      const quiet = Boolean(cmd.quiet || output === "json");
      configureUi({ quiet });

      showHeader();

      const loaded = await loadPresets();
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
            2
          )}\n`
        );
        return;
      }

      logInfo(`Presets file: ${loaded.filePath}`);
      if (!loaded.exists) {
        logDim("(File does not exist yet; use 'azp preset add' to create one.)");
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
      configureUi({ quiet });

      showHeader();

      const loaded = await loadPresets();
      const entry = getPreset(loaded.data, name);
      if (!entry) {
        const names = listPresetNames(loaded.data);
        throw new Error(
          `Preset not found: "${name}". Presets file: ${loaded.filePath}. Available: ${names.length ? names.join(", ") : "(none)"}`
        );
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
      configureUi({ quiet });

      showHeader();

      const loaded = await loadPresets();
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
        const { confirmSave } = await inquirer.prompt<{ confirmSave: boolean }>([
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
      configureUi({ quiet });

      showHeader();

      const loaded = await loadPresets();
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
      configureUi({ quiet });

      showHeader();

      const loaded = await loadPresets();
      const entry = getPreset(loaded.data, name);
      if (!entry) {
        throw new Error(`Preset not found: "${name}"`);
      }

      if (!cmd.yes) {
        const { confirmRemove } = await inquirer.prompt<{ confirmRemove: boolean }>([
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

program.parse();
