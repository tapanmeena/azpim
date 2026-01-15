import chalk from "chalk";
import inquirer from "inquirer";
import { AuthContext } from "./auth";
import {
  activateAzureRole,
  ActiveAzureRole,
  deactivateAzureRole,
  fetchEligibleRolesForSubscription,
  fetchSubscriptions,
  listActiveAzureRoles,
} from "./azure-pim";
import {
  formatActiveRole,
  formatRole,
  formatSubscription,
  logBlank,
  logDim,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  showDivider,
  showSummary,
} from "./ui";

import { runPresetsManager } from "./presets-cli";

export type ActivateOnceOptions = {
  subscriptionId: string;
  roleNames: string[];
  durationHours?: number;
  justification?: string;
  dryRun?: boolean;
  noInteractive?: boolean;
  yes?: boolean;
  allowMultiple?: boolean;
};

export type ActivateOnceResult = {
  subscriptionId: string;
  subscriptionName: string;
  requestedRoleNames: string[];
  resolvedTargets: Array<{
    eligibilityId: string;
    roleName: string;
    scope: string;
    scopeDisplayName: string;
    roleDefinitionId: string;
  }>;
  durationHours: number;
  justification: string;
  dryRun: boolean;
  results?: Array<{
    eligibilityId: string;
    roleName: string;
    scopeDisplayName: string;
    status?: string;
    success: boolean;
    error?: string;
  }>;
};

export type DeactivateOnceOptions = {
  subscriptionId?: string;
  roleNames: string[];
  justification?: string;
  dryRun?: boolean;
  noInteractive?: boolean;
  yes?: boolean;
  allowMultiple?: boolean;
};

export type DeactivateOnceResult = {
  requestedRoleNames: string[];
  resolvedTargets: Array<{
    assignmentId: string;
    roleName: string;
    scope: string;
    scopeDisplayName: string;
    subscriptionId: string;
    subscriptionName: string;
  }>;
  justification: string;
  dryRun: boolean;
  results?: Array<{
    assignmentId: string;
    roleName: string;
    scopeDisplayName: string;
    subscriptionName: string;
    success: boolean;
    error?: string;
  }>;
};

const normalizeRoleName = (value: string): string => value.trim().toLowerCase();

const validateDurationHours = (value: number): void => {
  if (!Number.isFinite(value) || value < 1 || value > 8) {
    throw new Error("Invalid --duration-hours. Expected a number between 1 and 8.");
  }
};

export const activateOnce = async (authContext: AuthContext, options: ActivateOnceOptions): Promise<ActivateOnceResult> => {
  const durationHours = options.durationHours ?? 8;
  validateDurationHours(durationHours);

  const justification = options.justification ?? "Activated via azp-cli";

  if (!options.subscriptionId?.trim()) {
    throw new Error("Missing required flag: --subscription-id");
  }

  const requestedRoleNames = (options.roleNames || []).map((n) => n.trim()).filter(Boolean);
  if (requestedRoleNames.length === 0) {
    throw new Error("Missing required flag: --role-name (can be repeated)");
  }

  if (options.noInteractive && !options.yes && !options.dryRun) {
    throw new Error("--no-interactive requires --yes (or use --dry-run)");
  }

  logBlank();
  logInfo("Resolving subscription and eligible roles...");

  // Allow users without Reader permissions to activate roles via PIM
  // as long as they have eligible roles in the subscription.
  const selectedSubscription = {
    subscriptionId: options.subscriptionId,
    displayName: `${options.subscriptionId} (name unavailable)`,
  };

  const eligibleRoles = await fetchEligibleRolesForSubscription(
    authContext.credential,
    selectedSubscription.subscriptionId,
    selectedSubscription.displayName,
    authContext.userId
  );

  const eligibleByName = new Map<string, typeof eligibleRoles>();
  for (const role of eligibleRoles) {
    const key = normalizeRoleName(role.roleName);
    const list = eligibleByName.get(key) ?? [];
    list.push(role);
    eligibleByName.set(key, list);
  }

  const resolvedTargets: ActivateOnceResult["resolvedTargets"] = [];

  for (const name of requestedRoleNames) {
    const matches = eligibleByName.get(normalizeRoleName(name)) ?? [];

    if (matches.length === 0) {
      throw new Error(`No eligible roles found matching --role-name="${name}" in subscription "${selectedSubscription.displayName}"`);
    }

    if (matches.length > 1 && !options.allowMultiple) {
      if (options.noInteractive) {
        throw new Error(
          `Ambiguous --role-name="${name}" matched ${matches.length} eligible roles. Use --allow-multiple to activate all matches, or run without --no-interactive to select interactively.`
        );
      }

      logBlank();
      logWarning(`Multiple eligible roles match "${name}". Please select which ones to activate:`);
      const { selectedIds } = await inquirer.prompt<{ selectedIds: string[] }>([
        {
          type: "checkbox",
          name: "selectedIds",
          message: chalk.cyan(`Select matches for "${name}":`),
          choices: matches.map((r) => ({ name: formatRole(r.roleName, r.scopeDisplayName), value: r.id })),
          validate: (answer) => {
            if (!Array.isArray(answer) || answer.length < 1) {
              return chalk.red("You must choose at least one role.");
            }
            return true;
          },
          pageSize: 15,
        },
      ]);
      for (const id of selectedIds) {
        const role = matches.find((m) => m.id === id);
        if (role) {
          resolvedTargets.push({
            eligibilityId: role.id,
            roleName: role.roleName,
            scope: role.scope,
            scopeDisplayName: role.scopeDisplayName,
            roleDefinitionId: role.roleDefinitionId,
          });
        }
      }
      continue;
    }

    for (const role of matches) {
      resolvedTargets.push({
        eligibilityId: role.id,
        roleName: role.roleName,
        scope: role.scope,
        scopeDisplayName: role.scopeDisplayName,
        roleDefinitionId: role.roleDefinitionId,
      });
    }
  }

  const uniqueTargets = new Map<string, ActivateOnceResult["resolvedTargets"][number]>();
  for (const target of resolvedTargets) {
    uniqueTargets.set(target.eligibilityId, target);
  }

  const targets = Array.from(uniqueTargets.values());
  if (targets.length === 0) {
    throw new Error("No eligible roles selected to activate.");
  }

  showSummary("Activation Summary", [
    { label: "Subscription", value: selectedSubscription.displayName },
    { label: "Role(s)", value: targets.map((t) => `${t.roleName} @ ${t.scopeDisplayName}`).join(", ") },
    { label: "Duration", value: `${durationHours} hour(s)` },
    { label: "Justification", value: justification },
    { label: "Dry-run", value: options.dryRun ? "Yes" : "No" },
  ]);

  if (options.dryRun) {
    logSuccess("Dry-run complete. No activation requests were submitted.");
    return {
      subscriptionId: selectedSubscription.subscriptionId,
      subscriptionName: selectedSubscription.displayName,
      requestedRoleNames,
      resolvedTargets: targets,
      durationHours,
      justification,
      dryRun: true,
    };
  }

  if (!options.yes) {
    const { confirmActivation } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmActivation",
        message: chalk.yellow(`Confirm activation of ${targets.length} role(s)?`),
        default: true,
      },
    ]);

    if (!confirmActivation) {
      logWarning("Activation cancelled by user.");
      return {
        subscriptionId: selectedSubscription.subscriptionId,
        subscriptionName: selectedSubscription.displayName,
        requestedRoleNames,
        resolvedTargets: targets,
        durationHours,
        justification,
        dryRun: false,
        results: targets.map((t) => ({
          eligibilityId: t.eligibilityId,
          roleName: t.roleName,
          scopeDisplayName: t.scopeDisplayName,
          success: false,
          error: "Cancelled",
        })),
      };
    }
  }

  logBlank();
  logInfo(`Activating ${targets.length} role(s)...`);
  logBlank();

  const results: NonNullable<ActivateOnceResult["results"]> = [];
  for (const target of targets) {
    try {
      const response = await activateAzureRole(
        authContext.credential,
        {
          principalId: authContext.userId,
          roleDefinitionId: target.roleDefinitionId,
          roleName: `${target.roleName} @ ${target.scopeDisplayName}`,
          roleEligibilityScheduleId: target.eligibilityId,
          scope: target.scope,
          durationHours,
          justification,
        },
        selectedSubscription.subscriptionId
      );
      results.push({
        eligibilityId: target.eligibilityId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        status: response.status,
        success: true,
      });
    } catch (error: any) {
      results.push({
        eligibilityId: target.eligibilityId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        success: false,
        error: error?.message ?? String(error),
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  logBlank();
  showDivider();
  if (successCount > 0 && failCount === 0) {
    logSuccess(`All ${successCount} role(s) activated successfully!`);
  } else if (successCount > 0 && failCount > 0) {
    logWarning(`${successCount} role(s) activated, ${failCount} failed.`);
  } else {
    logError(`All ${failCount} role activation(s) failed.`);
  }

  return {
    subscriptionId: selectedSubscription.subscriptionId,
    subscriptionName: selectedSubscription.displayName,
    requestedRoleNames,
    resolvedTargets: targets,
    durationHours,
    justification,
    dryRun: false,
    results,
  };
};

export const deactivateOnce = async (authContext: AuthContext, options: DeactivateOnceOptions): Promise<DeactivateOnceResult> => {
  const justification = options.justification ?? "Deactivated via azp-cli";

  const requestedRoleNames = (options.roleNames || []).map((n) => n.trim()).filter(Boolean);
  if (requestedRoleNames.length === 0) {
    throw new Error("Missing required flag: --role-name (can be repeated)");
  }

  if (options.noInteractive && !options.yes && !options.dryRun) {
    throw new Error("--no-interactive requires --yes (or use --dry-run)");
  }

  logBlank();
  logInfo("Resolving subscriptions and active roles...");

  // const subscriptions = await fetchSubscriptions(authContext.credential);
  // if (subscriptions.length === 0) {
  //   throw new Error("No subscriptions found.");
  // }
  let targetSubscriptions: Array<{ subscriptionId: string; displayName: string }>;
  if (options.subscriptionId?.trim()) {
    // Allow users without Reader permissions to deactivate roles via PIM
    // as long as they have active roles in the subscription.
    targetSubscriptions = [
      {
        subscriptionId: options.subscriptionId,
        displayName: `${options.subscriptionId} (name unavailable)`,
      },
    ];
  } else {
    const subscriptions = await fetchSubscriptions(authContext.credential);
    if (subscriptions.length === 0) {
      throw new Error("No subscriptions found. use --subscription-id to specify a subscription.");
    }
    targetSubscriptions = subscriptions;
  }

  let allActiveRoles: ActiveAzureRole[] = [];
  for (const sub of targetSubscriptions) {
    const roles = await listActiveAzureRoles(authContext.credential, sub.subscriptionId, sub.displayName, authContext.userId);
    allActiveRoles = allActiveRoles.concat(roles);
  }

  if (allActiveRoles.length === 0) {
    throw new Error("No active roles found for deactivation.");
  }

  const activeByName = new Map<string, typeof allActiveRoles>();
  for (const role of allActiveRoles) {
    const key = normalizeRoleName(role.roleName);
    const list = activeByName.get(key) ?? [];
    list.push(role);
    activeByName.set(key, list);
  }

  const resolvedTargets: DeactivateOnceResult["resolvedTargets"] = [];

  for (const name of requestedRoleNames) {
    const matches = activeByName.get(normalizeRoleName(name)) ?? [];

    if (matches.length === 0) {
      throw new Error(`No active roles found matching --role-name="${name}"`);
    }

    if (matches.length > 1 && !options.allowMultiple) {
      if (options.noInteractive) {
        throw new Error(
          `Ambiguous --role-name="${name}" matched ${matches.length} active roles. Use --allow-multiple to deactivate all matches, or run without --no-interactive to select interactively.`
        );
      }

      logBlank();
      logWarning(`Multiple active roles match "${name}". Please select which ones to deactivate:`);
      const { selectedIds } = await inquirer.prompt<{ selectedIds: string[] }>([
        {
          type: "checkbox",
          name: "selectedIds",
          message: chalk.cyan(`Select matches for "${name}":`),
          choices: matches.map((r) => ({
            name: formatActiveRole(r.roleName, r.scopeDisplayName, r.subscriptionName, r.startDateTime),
            value: r.id,
          })),
          validate: (answer) => {
            if (!Array.isArray(answer) || answer.length < 1) {
              return chalk.red("You must choose at least one role.");
            }
            return true;
          },
          pageSize: 15,
        },
      ]);
      for (const id of selectedIds) {
        const role = matches.find((m) => m.id === id);
        if (role) {
          resolvedTargets.push({
            assignmentId: role.id,
            roleName: role.roleName,
            scope: role.scope,
            scopeDisplayName: role.scopeDisplayName,
            subscriptionId: role.subscriptionId,
            subscriptionName: role.subscriptionName,
          });
        }
      }
      continue;
    }

    for (const role of matches) {
      resolvedTargets.push({
        assignmentId: role.id,
        roleName: role.roleName,
        scope: role.scope,
        scopeDisplayName: role.scopeDisplayName,
        subscriptionId: role.subscriptionId,
        subscriptionName: role.subscriptionName,
      });
    }
  }

  const uniqueTargets = new Map<string, DeactivateOnceResult["resolvedTargets"][number]>();
  for (const target of resolvedTargets) {
    uniqueTargets.set(target.assignmentId, target);
  }

  const targets = Array.from(uniqueTargets.values());
  if (targets.length === 0) {
    throw new Error("No active roles selected to deactivate.");
  }

  showSummary("Deactivation Summary", [
    { label: "Role(s)", value: targets.map((t) => `${t.roleName} @ ${t.scopeDisplayName} (${t.subscriptionName})`).join(", ") },
    { label: "Justification", value: justification },
    { label: "Dry-run", value: options.dryRun ? "Yes" : "No" },
  ]);

  if (options.dryRun) {
    logSuccess("Dry-run complete. No deactivation requests were submitted.");
    return {
      requestedRoleNames,
      resolvedTargets: targets,
      justification,
      dryRun: true,
    };
  }

  if (!options.yes) {
    const { confirmDeactivation } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmDeactivation",
        message: chalk.yellow(`Confirm deactivation of ${targets.length} role(s)?`),
        default: true,
      },
    ]);

    if (!confirmDeactivation) {
      logWarning("Deactivation cancelled by user.");
      return {
        requestedRoleNames,
        resolvedTargets: targets,
        justification,
        dryRun: false,
        results: targets.map((t) => ({
          assignmentId: t.assignmentId,
          roleName: t.roleName,
          scopeDisplayName: t.scopeDisplayName,
          subscriptionName: t.subscriptionName,
          success: false,
          error: "Cancelled",
        })),
      };
    }
  }

  logBlank();
  logInfo(`Deactivating ${targets.length} role(s)...`);
  logBlank();

  const results: NonNullable<DeactivateOnceResult["results"]> = [];
  for (const target of targets) {
    const role = allActiveRoles.find((r) => r.id === target.assignmentId);
    if (!role) {
      results.push({
        assignmentId: target.assignmentId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        subscriptionName: target.subscriptionName,
        success: false,
        error: "Role not found in active roles list",
      });
      continue;
    }

    try {
      await deactivateAzureRole(
        authContext.credential,
        role.scope,
        role.linkedRoleEligibilityScheduleId,
        role.subscriptionId,
        authContext.userId,
        role.roleDefinitionId,
        `${role.roleName} @ ${role.scopeDisplayName}`
      );
      results.push({
        assignmentId: target.assignmentId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        subscriptionName: target.subscriptionName,
        success: true,
      });
    } catch (error: any) {
      results.push({
        assignmentId: target.assignmentId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        subscriptionName: target.subscriptionName,
        success: false,
        error: error?.message ?? String(error),
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  logBlank();
  showDivider();
  if (successCount > 0 && failCount === 0) {
    logSuccess(`All ${successCount} role(s) deactivated successfully!`);
  } else if (successCount > 0 && failCount > 0) {
    logWarning(`${successCount} role(s) deactivated, ${failCount} failed.`);
  } else {
    logError(`All ${failCount} role deactivation(s) failed.`);
  }

  return {
    requestedRoleNames,
    resolvedTargets: targets,
    justification,
    dryRun: false,
    results,
  };
};

const promptBackToMainMenuOrExit = async (message: string): Promise<void> => {
  logBlank();
  const { next } = await inquirer.prompt<{ next: "back" | "exit" }>([
    {
      type: "select",
      name: "next",
      message: chalk.yellow(message),
      choices: [
        { name: chalk.cyan("↩ Back to Main Menu"), value: "back" },
        { name: chalk.red("✕ Exit"), value: "exit" },
      ],
      default: "back",
    },
  ]);

  if (next === "exit") {
    logBlank();
    logDim("Goodbye! 👋");
    process.exit(0);
  }
};

export const showMainMenu = async (authContext: AuthContext): Promise<void> => {
  while (true) {
    showDivider();
    logBlank();
    const { action } = await inquirer.prompt<{ action: "activate" | "deactivate" | "presets" | "exit" }>([
      {
        type: "select",
        name: "action",
        message: chalk.cyan.bold("What would you like to do?"),
        choices: [
          { name: chalk.green("▶ Activate Role(s)"), value: "activate" },
          { name: chalk.yellow("◼ Deactivate Role(s)"), value: "deactivate" },
          { name: chalk.magenta("⚙ Presets..."), value: "presets" },
          { name: chalk.red("✕ Exit"), value: "exit" },
        ],
        default: "activate",
      },
    ]);

    switch (action) {
      case "activate":
        await handleActivation(authContext);
        break;
      case "deactivate":
        await handleDeactivation(authContext);
        break;
      case "presets":
        await runPresetsManager();
        break;
      case "exit":
        logBlank();
        logDim("Goodbye! 👋");
        logBlank();
        return;
    }
  }
};

export const handleActivation = async (authContext: AuthContext): Promise<void> => {
  try {
    logBlank();
    logInfo("Starting role activation flow...");
    logBlank();

    let subscriptions = await fetchSubscriptions(authContext.credential);

    let selectedSubscription: { subscriptionId: string; displayName: string } | undefined;

    if (subscriptions.length === 0) {
      logWarning("No subscriptions found.");
      const { action } = await inquirer.prompt<{ action: "enter" | "back" | "exit" }>([
        {
          type: "select",
          name: "action",
          message: chalk.yellow("No subscriptions found. What would you like to do?"),
          choices: [
            { name: chalk.cyan("Enter subscription ID manually"), value: "enter" },
            { name: chalk.cyan("↩ Back to Main Menu"), value: "back" },
            { name: chalk.red("✕ Exit"), value: "exit" },
          ],
          default: "enter",
        },
      ]);

      if (action === "back") {
        return;
      } else if (action === "exit") {
        logBlank();
        logDim("Goodbye! 👋");
        process.exit(0);
      } else {
        const { manualId } = await inquirer.prompt<{ manualId: string }>([
          {
            type: "input",
            name: "manualId",
            message: chalk.cyan("Subscription ID:"),
            validate: (value) => {
              if (!value || !value.trim()) return chalk.red("Please enter a subscription ID.");
              return true;
            },
          },
        ]);
        selectedSubscription = { subscriptionId: manualId.trim(), displayName: manualId.trim() };
      }
    } else {
      const BACK_VALUE = "__BACK__";
      const subscriptionChoices = subscriptions
        .map((sub) => ({
          name: formatSubscription(sub.displayName, sub.subscriptionId),
          value: sub.subscriptionId,
        }))
        .concat([{ name: chalk.dim("↩ Back to Main Menu"), value: BACK_VALUE }]);

      logBlank();
      const { selectedSubscriptionId } = await inquirer.prompt<{
        selectedSubscriptionId: string;
      }>([
        {
          type: "select",
          name: "selectedSubscriptionId",
          message: chalk.cyan("Select a subscription:"),
          choices: subscriptionChoices,
          pageSize: 15,
          default: subscriptionChoices[0]?.value,
        },
      ]);

      if (selectedSubscriptionId === BACK_VALUE) {
        logDim("Returning to main menu...");
        return;
      }

      const found = subscriptions.find((sub) => sub.subscriptionId === selectedSubscriptionId);
      if (!found) {
        logError("Selected subscription not found.");
        return;
      }
      selectedSubscription = { subscriptionId: found.subscriptionId, displayName: found.displayName };
    }

    const eligibleRoles = await fetchEligibleRolesForSubscription(
      authContext.credential,
      selectedSubscription.subscriptionId,
      selectedSubscription.displayName,
      authContext.userId
    );

    if (eligibleRoles.length === 0) {
      logWarning("No eligible roles found for the selected subscription.");
      await promptBackToMainMenuOrExit("What would you like to do?");
      return;
    }

    logBlank();
    const { rolesToActivate } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "rolesToActivate",
        message: chalk.cyan("Select role(s) to activate:"),
        choices: eligibleRoles.map((role) => ({
          name: formatRole(role.roleName, role.scopeDisplayName),
          value: role.id,
          checked: false,
        })),
        validate: (answer) => {
          if (answer.length < 1) {
            return chalk.red("You must choose at least one role.");
          }
          return true;
        },
        pageSize: 15,
      },
    ]);

    logBlank();
    const activationDetails = await inquirer.prompt([
      {
        type: "number",
        name: "durationHours",
        message: chalk.cyan("Duration (hours, max 8):"),
        default: 8,
        validate: (value) => {
          if (!value) return chalk.red("Please enter a valid number.");
          if (value >= 1 && value <= 8) return true;
          return chalk.red("Please enter a value between 1 and 8.");
        },
      },
      {
        type: "input",
        name: "justification",
        message: chalk.cyan("Justification for activation:"),
        default: "Activated via azp-cli",
        validate: (value) => {
          if (value.trim().length >= 5) return true;
          return chalk.red("Justification should be at least 5 characters long.");
        },
      },
    ]);

    // Show summary before confirmation
    const selectedRoleNames = rolesToActivate
      .map((roleId: string) => {
        const role = eligibleRoles.find((r) => r.id === roleId);
        return role ? `${role.roleName} @ ${role.scopeDisplayName}` : roleId;
      })
      .join(", ");

    showSummary("Activation Summary", [
      { label: "Subscription", value: selectedSubscription.displayName },
      { label: "Role(s)", value: selectedRoleNames },
      { label: "Duration", value: `${activationDetails.durationHours} hour(s)` },
      { label: "Justification", value: activationDetails.justification },
    ]);

    const { confirmActivation } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmActivation",
        message: chalk.yellow(`Confirm activation of ${rolesToActivate.length} role(s)?`),
        default: true,
      },
    ]);

    if (!confirmActivation) {
      logWarning("Activation cancelled by user.");
      return;
    }

    logBlank();
    logInfo(`Activating ${rolesToActivate.length} role(s)...`);
    logBlank();

    let successCount = 0;
    let failCount = 0;

    for (const roleId of rolesToActivate as string[]) {
      const role = eligibleRoles.find((r) => r.id === roleId);
      if (!role) {
        logError(`Role with ID ${roleId} not found among eligible roles.`);
        failCount++;
        continue;
      }

      try {
        await activateAzureRole(
          authContext.credential,
          {
            principalId: authContext.userId,
            roleDefinitionId: role.roleDefinitionId,
            roleName: `${role.roleName} @ ${role.scopeDisplayName}`,
            roleEligibilityScheduleId: role.roleEligibilityScheduleId,
            scope: role.scope,
            durationHours: activationDetails.durationHours,
            justification: activationDetails.justification,
          },
          selectedSubscription.subscriptionId
        );
        successCount++;
      } catch (error: any) {
        logError(`Failed to activate role "${role.roleName}": ${error.message || error}`);
        failCount++;
      }
    }

    logBlank();
    showDivider();
    if (successCount > 0 && failCount === 0) {
      logSuccess(`All ${successCount} role(s) activated successfully!`);
    } else if (successCount > 0 && failCount > 0) {
      logWarning(`${successCount} role(s) activated, ${failCount} failed.`);
    } else {
      logError(`All ${failCount} role activation(s) failed.`);
    }
  } catch (error: any) {
    logError(`Error during activation: ${error.message || error}`);
    return;
  }
};

export const handleDeactivation = async (authContext: AuthContext): Promise<void> => {
  try {
    logBlank();
    logInfo("Starting role deactivation flow...");
    logBlank();

    let subscriptions = await fetchSubscriptions(authContext.credential);
    let activeAzureRoles: ActiveAzureRole[] = [];

    if (subscriptions.length === 0) {
      logWarning("No subscriptions found.");
      const { action } = await inquirer.prompt<{ action: "enter" | "back" | "exit" }>([
        {
          type: "select",
          name: "action",
          message: chalk.yellow("No subscriptions found. What would you like to do?"),
          choices: [
            { name: chalk.cyan("Enter subscription ID manually"), value: "enter" },
            { name: chalk.cyan("↩ Back to Main Menu"), value: "back" },
            { name: chalk.red("✕ Exit"), value: "exit" },
          ],
          default: "enter",
        },
      ]);

      if (action === "back") {
        return;
      } else if (action === "exit") {
        logBlank();
        logDim("Goodbye! 👋");
        process.exit(0);
      } else {
        const { manualId } = await inquirer.prompt<{ manualId: string }>([
          {
            type: "input",
            name: "manualId",
            message: chalk.cyan("Subscription ID to inspect (for active roles):"),
            validate: (value) => {
              if (!value || !value.trim()) return chalk.red("Please enter a subscription ID.");
              return true;
            },
          },
        ]);
        subscriptions.push({ subscriptionId: manualId.trim(), displayName: manualId.trim(), tenantId: "" } as any);
      }
    }

    for (const sub of subscriptions) {
      const roles = await listActiveAzureRoles(authContext.credential, sub.subscriptionId, sub.displayName, authContext.userId);
      activeAzureRoles = activeAzureRoles.concat(roles);
    }

    if (activeAzureRoles.length === 0) {
      logWarning("No active roles found for deactivation.");
      await promptBackToMainMenuOrExit("What would you like to do?");
      return;
    }

    const BACK_VALUE = "__BACK__";

    logBlank();
    const { rolesToDeactivate } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "rolesToDeactivate",
        message: chalk.cyan("Select role(s) to deactivate:"),
        choices: [
          { name: chalk.dim("↩ Back to Main Menu"), value: BACK_VALUE },
          ...activeAzureRoles.map((role) => ({
            name: formatActiveRole(role.roleName, role.scopeDisplayName, role.subscriptionName, role.startDateTime),
            value: role.id,
            checked: false,
          })),
        ],
        validate: (answer) => {
          if (Array.isArray(answer) && answer.includes(BACK_VALUE)) {
            return true;
          }
          if (answer.length < 1) {
            return chalk.red("You must choose at least one role.");
          }
          return true;
        },
        pageSize: 15,
      },
    ]);

    const selectedRoleIds = (rolesToDeactivate as string[]).includes(BACK_VALUE)
      ? (rolesToDeactivate as string[]).filter((id) => id !== BACK_VALUE)
      : (rolesToDeactivate as string[]);

    if ((rolesToDeactivate as string[]).includes(BACK_VALUE) && selectedRoleIds.length === 0) {
      logDim("Returning to main menu...");
      return;
    }

    // Show summary before confirmation
    const selectedRoleNames = selectedRoleIds
      .map((roleId) => {
        const role = activeAzureRoles.find((r) => r.id === roleId);
        return role ? `${role.roleName} @ ${role.scopeDisplayName}` : roleId;
      })
      .join(", ");

    showSummary("Deactivation Summary", [{ label: "Role(s) to deactivate", value: selectedRoleNames }]);

    const { confirmDeactivation } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmDeactivation",
        message: chalk.yellow(`Confirm deactivation of ${selectedRoleIds.length} role(s)?`),
        default: true,
      },
    ]);

    if (!confirmDeactivation) {
      logWarning("Deactivation cancelled by user.");
      return;
    }

    logBlank();
    logInfo(`Deactivating ${selectedRoleIds.length} role(s)...`);
    logBlank();

    let successCount = 0;
    let failCount = 0;

    for (const roleId of selectedRoleIds) {
      const role = activeAzureRoles.find((r) => r.id === roleId);
      if (!role) {
        logError(`Role with ID ${roleId} not found among active roles.`);
        failCount++;
        continue;
      }

      try {
        await deactivateAzureRole(
          authContext.credential,
          role.scope,
          role.linkedRoleEligibilityScheduleId,
          role.subscriptionId,
          authContext.userId,
          role.roleDefinitionId,
          `${role.roleName} @ ${role.scopeDisplayName}`
        );
        successCount++;
      } catch (error: any) {
        logError(`Failed to deactivate role "${role.roleName}": ${error.message || error}`);
        failCount++;
      }
    }

    logBlank();
    showDivider();
    if (successCount > 0 && failCount === 0) {
      logSuccess(`All ${successCount} role(s) deactivated successfully!`);
    } else if (successCount > 0 && failCount > 0) {
      logWarning(`${successCount} role(s) deactivated, ${failCount} failed.`);
    } else {
      logError(`All ${failCount} role deactivation(s) failed.`);
    }
  } catch (error: any) {
    logError(`Error during deactivation: ${error.message || error}`);
    return;
  }
};
