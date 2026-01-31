import chalk from "chalk";
import inquirer from "inquirer";
import { authenticate, type AuthContext } from "./auth";
import { fetchEligibleRolesForSubscription, fetchSubscriptions } from "./azure-pim";
import type { ActivatePresetOptions, DeactivatePresetOptions, PresetCommandName, PresetEntry } from "./presets";
import { getPreset, listPresetNames, loadPresets, removePreset, savePresets, setDefaultPresetName, upsertPreset } from "./presets";
import { formatSubscription, logBlank, logDim, logError, logInfo, logSuccess, logWarning, showDivider } from "./ui";

export type PresetAddWizardResult = {
  name: string;
  entry: PresetEntry;
  setDefaultFor?: PresetCommandName | "both";
};

export type PresetEditWizardResult = {
  name: string;
  entry: PresetEntry;
  setDefaultFor?: PresetCommandName | "both";
};

type WizardArgs = {
  name?: string;
  fromAzure?: boolean;
  existingNames?: string[];
  appliesTo?: PresetCommandName | "both";
  setAsDefault?: boolean;
};

type EditWizardArgs = {
  name: string;
  existingEntry: PresetEntry;
  fromAzure?: boolean;
  appliesTo?: PresetCommandName | "both";
  setAsDefault?: boolean;
};

const validatePresetName = (value: string, existingNames: Set<string>): true | string => {
  const name = value.trim();
  if (!name) return chalk.red("Preset name cannot be empty.");
  if (name.length > 64) return chalk.red("Preset name is too long (max 64 chars).");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    return chalk.red("Use letters/numbers and separators (._-). Must start with a letter/number.");
  }
  if (existingNames.has(name)) {
    return chalk.red(`Preset \"${name}\" already exists. Choose a different name or remove it first.`);
  }
  return true;
};

const promptForCommandScope = async (): Promise<PresetAddWizardResult["setDefaultFor"]> => {
  const { appliesTo } = await inquirer.prompt<{
    appliesTo: "activate" | "deactivate" | "both";
  }>([
    {
      type: "select",
      name: "appliesTo",
      message: chalk.cyan("Create preset for which command(s)?"),
      choices: [
        { name: "activate", value: "activate" },
        { name: "deactivate", value: "deactivate" },
        { name: "both", value: "both" },
      ],
      default: "activate",
    },
  ]);
  return appliesTo;
};

const promptForEditScope = async (existingEntry: PresetEntry): Promise<PresetAddWizardResult["setDefaultFor"]> => {
  const defaultValue: "activate" | "deactivate" | "both" =
    existingEntry.activate && existingEntry.deactivate ? "both" : existingEntry.activate ? "activate" : "deactivate";

  const { appliesTo } = await inquirer.prompt<{
    appliesTo: "activate" | "deactivate" | "both";
  }>([
    {
      type: "select",
      name: "appliesTo",
      message: chalk.cyan("Edit which part(s) of this preset?"),
      choices: [
        { name: "activate", value: "activate" },
        { name: "deactivate", value: "deactivate" },
        { name: "both", value: "both" },
      ],
      default: defaultValue,
    },
  ]);
  return appliesTo;
};

const uniqueRoleChoices = (eligibleRoles: Array<{ roleName: string; scopeDisplayName: string }>) => {
  const map = new Map<string, { roleName: string; scopes: Set<string> }>();
  for (const role of eligibleRoles) {
    const existing = map.get(role.roleName);
    if (existing) {
      existing.scopes.add(role.scopeDisplayName);
    } else {
      map.set(role.roleName, {
        roleName: role.roleName,
        scopes: new Set([role.scopeDisplayName]),
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.roleName.localeCompare(b.roleName))
    .map((r) => {
      const count = r.scopes.size;
      const suffix = count > 1 ? chalk.dim(` (${count} scopes)`) : "";
      return {
        name: `${chalk.white.bold(r.roleName)}${suffix}`,
        value: r.roleName,
      };
    });
};

const promptForAzureSelection = async (): Promise<{
  authContext: AuthContext;
  subscriptionId: string;
  roleNames: string[];
}> => {
  logBlank();
  logInfo("Preset add: authenticating to query subscriptions/roles...");
  const authContext = await authenticate();

  const subscriptions = await fetchSubscriptions(authContext.credential, authContext.userId);
  if (subscriptions.length === 0) {
    throw new Error("No subscriptions found.");
  }

  const { subscriptionId } = await inquirer.prompt<{ subscriptionId: string }>([
    {
      type: "select",
      name: "subscriptionId",
      message: chalk.cyan("Select a subscription:"),
      choices: subscriptions
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((s) => ({
          name: formatSubscription(s.displayName, s.subscriptionId),
          value: s.subscriptionId,
        })),
      pageSize: 15,
    },
  ]);

  const selectedSubscription = subscriptions.find((s) => s.subscriptionId === subscriptionId);
  if (!selectedSubscription) {
    throw new Error("Selected subscription not found.");
  }

  const eligibleRoles = await fetchEligibleRolesForSubscription(
    authContext.credential,
    selectedSubscription.subscriptionId,
    selectedSubscription.displayName,
    authContext.userId,
  );

  if (eligibleRoles.length === 0) {
    logWarning("No eligible roles found in this subscription.");
  }

  const roleChoices = uniqueRoleChoices(eligibleRoles);

  const { roleNames } = await inquirer.prompt<{ roleNames: string[] }>([
    {
      type: "checkbox",
      name: "roleNames",
      message: chalk.cyan("Select role name(s) to include in this preset:"),
      choices: roleChoices.length
        ? roleChoices
        : [
            {
              name: chalk.dim("(No eligible roles found; you can add role names manually later)"),
              value: "",
            },
          ],
      validate: (answer) => {
        if (!Array.isArray(answer) || answer.filter(Boolean).length < 1) {
          return chalk.red("Choose at least one role name.");
        }
        return true;
      },
      pageSize: 15,
    },
  ]);

  const cleanedRoles = roleNames.map((r) => r.trim()).filter(Boolean);

  // If some role names are ambiguous (multiple scopes), warn users about behavior.
  const roleNameToCount = new Map<string, number>();
  for (const role of eligibleRoles) {
    roleNameToCount.set(role.roleName, (roleNameToCount.get(role.roleName) ?? 0) + 1);
  }
  const ambiguous = cleanedRoles.filter((name) => (roleNameToCount.get(name) ?? 0) > 1);
  if (ambiguous.length > 0) {
    logBlank();
    logWarning(`Note: ${ambiguous.length} role name(s) have multiple eligible matches (different scopes): ${ambiguous.join(", ")}.`);
    logDim("When running activate/deactivate, azpim may prompt unless allowMultiple is enabled or selection is interactive.");
  }

  return { authContext, subscriptionId, roleNames: cleanedRoles };
};

const promptForManualSelection = async (defaults?: {
  subscriptionId?: string;
  roleNames?: string[];
}): Promise<{ subscriptionId?: string; roleNames: string[] }> => {
  const { subscriptionId } = await inquirer.prompt<{ subscriptionId: string }>([
    {
      type: "input",
      name: "subscriptionId",
      message: chalk.cyan("Subscription ID (optional; leave blank to prompt at runtime):"),
      default: defaults?.subscriptionId ?? "",
    },
  ]);

  const { roleNamesRaw } = await inquirer.prompt<{ roleNamesRaw: string }>([
    {
      type: "input",
      name: "roleNamesRaw",
      message: chalk.cyan("Role names (comma-separated):"),
      default: (defaults?.roleNames ?? []).join(", "),
      validate: (value) => {
        const list = value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        if (list.length < 1) return chalk.red("Provide at least one role name.");
        return true;
      },
    },
  ]);

  const roleNames = roleNamesRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    subscriptionId: subscriptionId.trim() ? subscriptionId.trim() : undefined,
    roleNames,
  };
};

const promptForCommonFields = async (
  command: PresetCommandName,
  defaults?: { justification?: string; allowMultiple?: boolean },
): Promise<{ justification?: string; allowMultiple?: boolean }> => {
  const defaultJustification = command === "activate" ? "Activated via azpim" : "Deactivated via azpim";

  const { justification } = await inquirer.prompt<{ justification: string }>([
    {
      type: "input",
      name: "justification",
      message: chalk.cyan(`Justification for ${command} (supports \${date}, \${datetime}, \${userPrincipalName}):`),
      default: defaults?.justification ?? defaultJustification,
    },
  ]);

  const { allowMultiple } = await inquirer.prompt<{ allowMultiple: boolean }>([
    {
      type: "confirm",
      name: "allowMultiple",
      message: chalk.cyan("Allow multiple matches when a role name is ambiguous?"),
      default: defaults?.allowMultiple ?? false,
    },
  ]);

  return {
    justification: justification.trim() ? justification : undefined,
    allowMultiple,
  };
};

const promptForDurationHours = async (defaultValue?: number): Promise<number | undefined> => {
  const { durationHours } = await inquirer.prompt<{ durationHours: number }>([
    {
      type: "number",
      name: "durationHours",
      message: chalk.cyan("Activation duration hours (1-8):"),
      default: defaultValue ?? 8,
      validate: (value) => {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 1 || n > 8) return chalk.red("Enter a number between 1 and 8.");
        return true;
      },
    },
  ]);
  return Number.isFinite(durationHours) ? durationHours : undefined;
};

export const runPresetAddWizard = async (args: WizardArgs = {}): Promise<PresetAddWizardResult> => {
  const { fromAzure } = args;
  const existingNames = new Set(args.existingNames ?? []);

  const name =
    args.name && args.name.trim()
      ? args.name.trim()
      : (
          await inquirer.prompt<{ name: string }>([
            {
              type: "input",
              name: "name",
              message: chalk.cyan("Preset name:"),
              validate: (value) => validatePresetName(value, existingNames),
            },
          ])
        ).name.trim();

  const { description } = await inquirer.prompt<{ description: string }>([
    {
      type: "input",
      name: "description",
      message: chalk.cyan("Description (optional):"),
      default: "",
    },
  ]);

  const appliesTo = args.appliesTo ?? (await promptForCommandScope());

  const resolvedFromAzure =
    fromAzure !== undefined
      ? fromAzure
      : (
          await inquirer.prompt<{ useAzure: boolean }>([
            {
              type: "confirm",
              name: "useAzure",
              message: chalk.cyan("Pick subscription and roles from Azure now? (recommended)"),
              default: true,
            },
          ])
        ).useAzure;

  let subscriptionId: string | undefined;
  let roleNames: string[] = [];
  let authContext: AuthContext | undefined;

  if (resolvedFromAzure) {
    const selection = await promptForAzureSelection();
    authContext = selection.authContext;
    subscriptionId = selection.subscriptionId;
    roleNames = selection.roleNames;
  } else {
    const selection = await promptForManualSelection();
    subscriptionId = selection.subscriptionId;
    roleNames = selection.roleNames;
  }

  const entry: PresetEntry = {
    description: description.trim() ? description.trim() : undefined,
  };

  if (appliesTo === "activate" || appliesTo === "both") {
    const common = await promptForCommonFields("activate");
    const durationHours = await promptForDurationHours();
    const activate: ActivatePresetOptions = {
      subscriptionId,
      roleNames,
      durationHours,
      justification: common.justification,
      allowMultiple: common.allowMultiple,
    };
    entry.activate = activate;
  }

  if (appliesTo === "deactivate" || appliesTo === "both") {
    const common = await promptForCommonFields("deactivate");
    const deactivate: DeactivatePresetOptions = {
      subscriptionId,
      roleNames,
      justification: common.justification,
      allowMultiple: common.allowMultiple,
    };
    entry.deactivate = deactivate;
  }

  // If we authenticated, remind users about template vars.
  if (authContext) {
    logBlank();
    logDim(`Template vars available: \${date}, \${datetime}, \${userPrincipalName}=${authContext.userPrincipalName}`);
  }

  // Optionally set as default.
  const wantsDefault =
    args.setAsDefault !== undefined
      ? args.setAsDefault
      : (
          await inquirer.prompt<{ setDefault: boolean }>([
            {
              type: "confirm",
              name: "setDefault",
              message: chalk.cyan("Set this preset as the default for its command(s)?"),
              default: false,
            },
          ])
        ).setDefault;

  const setDefaultFor: PresetAddWizardResult["setDefaultFor"] | undefined = wantsDefault ? appliesTo : undefined;

  return { name, entry, setDefaultFor };
};

export const runPresetEditWizard = async (args: EditWizardArgs): Promise<PresetEditWizardResult> => {
  const { existingEntry } = args;

  const { description } = await inquirer.prompt<{ description: string }>([
    {
      type: "input",
      name: "description",
      message: chalk.cyan("Description (optional):"),
      default: existingEntry.description ?? "",
    },
  ]);

  const appliesTo = args.appliesTo ?? (await promptForEditScope(existingEntry));

  const resolvedFromAzure =
    args.fromAzure !== undefined
      ? args.fromAzure
      : (
          await inquirer.prompt<{ useAzure: boolean }>([
            {
              type: "confirm",
              name: "useAzure",
              message: chalk.cyan("Pick subscription and role names from Azure now?"),
              default: true,
            },
          ])
        ).useAzure;

  // Compute defaults for manual editing.
  const baseDefaults: { subscriptionId?: string; roleNames?: string[] } =
    appliesTo === "activate"
      ? {
          subscriptionId: existingEntry.activate?.subscriptionId,
          roleNames: existingEntry.activate?.roleNames,
        }
      : appliesTo === "deactivate"
        ? {
            subscriptionId: existingEntry.deactivate?.subscriptionId,
            roleNames: existingEntry.deactivate?.roleNames,
          }
        : {
            subscriptionId: existingEntry.activate?.subscriptionId ?? existingEntry.deactivate?.subscriptionId,
            roleNames: existingEntry.activate?.roleNames ?? existingEntry.deactivate?.roleNames,
          };

  let subscriptionId: string | undefined;
  let roleNames: string[] = [];
  let authContext: AuthContext | undefined;

  if (resolvedFromAzure) {
    const selection = await promptForAzureSelection();
    authContext = selection.authContext;
    subscriptionId = selection.subscriptionId;
    roleNames = selection.roleNames;
  } else {
    const selection = await promptForManualSelection(baseDefaults);
    subscriptionId = selection.subscriptionId;
    roleNames = selection.roleNames;
  }

  const entry: PresetEntry = {
    description: description.trim() ? description.trim() : undefined,
    activate: existingEntry.activate,
    deactivate: existingEntry.deactivate,
  };

  if (appliesTo === "activate" || appliesTo === "both") {
    const existing = existingEntry.activate;
    const common = await promptForCommonFields("activate", {
      justification: existing?.justification,
      allowMultiple: existing?.allowMultiple,
    });
    const durationHours = await promptForDurationHours(existing?.durationHours);
    entry.activate = {
      subscriptionId,
      roleNames,
      durationHours,
      justification: common.justification,
      allowMultiple: common.allowMultiple,
    };
  }

  if (appliesTo === "deactivate" || appliesTo === "both") {
    const existing = existingEntry.deactivate;
    const common = await promptForCommonFields("deactivate", {
      justification: existing?.justification,
      allowMultiple: existing?.allowMultiple,
    });
    entry.deactivate = {
      subscriptionId,
      roleNames,
      justification: common.justification,
      allowMultiple: common.allowMultiple,
    };
  }

  if (authContext) {
    logBlank();
    logDim(`Template vars available: \${date}, \${datetime}, \${userPrincipalName}=${authContext.userPrincipalName}`);
  }

  const wantsDefault =
    args.setAsDefault !== undefined
      ? args.setAsDefault
      : (
          await inquirer.prompt<{ setDefault: boolean }>([
            {
              type: "confirm",
              name: "setDefault",
              message: chalk.cyan("Set this preset as the default for the edited command(s)?"),
              default: false,
            },
          ])
        ).setDefault;

  const setDefaultFor: PresetEditWizardResult["setDefaultFor"] | undefined = wantsDefault ? appliesTo : undefined;

  return { name: args.name, entry, setDefaultFor };
};

export const runPresetsManager = async (authContext: AuthContext): Promise<void> => {
  while (true) {
    showDivider();
    logBlank();

    const presets = await loadPresets(authContext.userId);

    const { action } = await inquirer.prompt<{
      action: "list" | "add" | "edit" | "remove" | "defaults" | "back" | "exit";
    }>([
      {
        type: "select",
        name: "action",
        message: chalk.cyan.bold("Presets Manager"),
        choices: [
          { name: chalk.white("≡ List presets"), value: "list" },
          { name: chalk.green("+ Add preset"), value: "add" },
          { name: chalk.yellow("✎ Edit preset"), value: "edit" },
          { name: chalk.red("– Remove preset"), value: "remove" },
          { name: chalk.magenta("⚙ Set defaults"), value: "defaults" },
          { name: chalk.dim("↩ Back to Main Menu"), value: "back" },
          { name: chalk.red("✕ Exit"), value: "exit" },
        ],
        default: "list",
      },
    ]);

    try {
      switch (action) {
        case "list": {
          const names = listPresetNames(presets.data);
          logBlank();
          if (names.length === 0) {
            logDim(`No presets found. File: ${presets.filePath}`);
          } else {
            const defaultActivate = presets.data.defaults?.activatePreset;
            const defaultDeactivate = presets.data.defaults?.deactivatePreset;
            logInfo(`Presets file: ${presets.filePath}`);
            for (const name of names) {
              const entry = getPreset(presets.data, name);
              const tags: string[] = [];
              if (name === defaultActivate) tags.push("default-activate");
              if (name === defaultDeactivate) tags.push("default-deactivate");
              logBlank();
              logInfo(`- ${name}${tags.length ? ` (${tags.join(", ")})` : ""}`);
              if (entry?.description) logDim(`  ${entry.description}`);
            }
          }
          break;
        }

        case "add": {
          const names = listPresetNames(presets.data);
          const result = await runPresetAddWizard({
            existingNames: names,
            fromAzure: undefined,
          });
          let nextData = upsertPreset(presets.data, result.name, result.entry);
          if (result.setDefaultFor) {
            if (result.setDefaultFor === "both") {
              nextData = setDefaultPresetName(nextData, "activate", result.name);
              nextData = setDefaultPresetName(nextData, "deactivate", result.name);
            } else {
              nextData = setDefaultPresetName(nextData, result.setDefaultFor, result.name);
            }
          }
          await savePresets(presets.filePath, nextData);
          logBlank();
          logSuccess(`Preset "${result.name}" saved to ${presets.filePath}`);
          break;
        }

        case "edit": {
          const names = listPresetNames(presets.data);
          if (names.length === 0) {
            logWarning("No presets to edit.");
            break;
          }
          const { name } = await inquirer.prompt<{ name: string }>([
            {
              type: "select",
              name: "name",
              message: chalk.cyan("Select preset to edit:"),
              choices: names.map((n) => ({ name: n, value: n })),
            },
          ]);
          const existing = getPreset(presets.data, name)!;
          const result = await runPresetEditWizard({
            name,
            existingEntry: existing,
          });
          let nextData = upsertPreset(presets.data, result.name, result.entry);
          if (result.setDefaultFor) {
            if (result.setDefaultFor === "both") {
              nextData = setDefaultPresetName(nextData, "activate", result.name);
              nextData = setDefaultPresetName(nextData, "deactivate", result.name);
            } else {
              nextData = setDefaultPresetName(nextData, result.setDefaultFor, result.name);
            }
          }
          await savePresets(presets.filePath, nextData);
          logBlank();
          logSuccess(`Preset "${result.name}" updated in ${presets.filePath}`);
          break;
        }

        case "remove": {
          const names = listPresetNames(presets.data);
          if (names.length === 0) {
            logWarning("No presets to remove.");
            break;
          }
          const { name } = await inquirer.prompt<{ name: string }>([
            {
              type: "select",
              name: "name",
              message: chalk.cyan("Select preset to remove:"),
              choices: names.map((n) => ({ name: n, value: n })),
            },
          ]);
          const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
            {
              type: "confirm",
              name: "confirm",
              message: chalk.yellow(`Are you sure you want to remove preset "${name}"?`),
              default: false,
            },
          ]);
          if (!confirm) break;

          let nextData = removePreset(presets.data, name);
          // Clear defaults pointing to the removed name
          if (presets.data.defaults?.activatePreset === name) nextData = setDefaultPresetName(nextData, "activate", undefined);
          if (presets.data.defaults?.deactivatePreset === name) nextData = setDefaultPresetName(nextData, "deactivate", undefined);

          await savePresets(presets.filePath, nextData);
          logBlank();
          logSuccess(`Preset "${name}" removed from ${presets.filePath}`);
          break;
        }

        case "defaults": {
          const names = ["(none)", ...listPresetNames(presets.data)];
          const { activate } = await inquirer.prompt<{ activate: string }>([
            {
              type: "select",
              name: "activate",
              message: chalk.cyan("Default preset for activate (choose none to unset):"),
              choices: names.map((n) => ({ name: n, value: n })),
              default: presets.data.defaults?.activatePreset ?? "(none)",
            },
          ]);
          const { deactivate } = await inquirer.prompt<{ deactivate: string }>([
            {
              type: "select",
              name: "deactivate",
              message: chalk.cyan("Default preset for deactivate (choose none to unset):"),
              choices: names.map((n) => ({ name: n, value: n })),
              default: presets.data.defaults?.deactivatePreset ?? "(none)",
            },
          ]);

          let nextData = { ...presets.data } as any;
          nextData = setDefaultPresetName(nextData, "activate", activate === "(none)" ? undefined : activate);
          nextData = setDefaultPresetName(nextData, "deactivate", deactivate === "(none)" ? undefined : deactivate);

          await savePresets(presets.filePath, nextData);
          logBlank();
          logSuccess(`Defaults updated in ${presets.filePath}`);
          break;
        }

        case "back":
          return;

        case "exit":
          logBlank();
          logDim("Goodbye! 👋");
          logBlank();
          process.exit(0);
      }
    } catch (err: any) {
      logBlank();
      logError(`An error occurred: ${err?.message ?? String(err)}`);
    }
  }
};
