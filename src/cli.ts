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
  adminDeactivateAssignment,
  AllActiveAssignment,
  ApprovalDecisionResult,
  fetchAllActiveAssignments,
  fetchPendingApprovals,
  getApprovalDetails,
  PendingApproval,
  submitApprovalDecision,
} from "./azure-pim-approvals";
import {
  formatActiveRole,
  formatAssignment,
  formatPendingApproval,
  formatPendingApprovalDetailed,
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
  nonInteractive?: boolean;
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
  nonInteractive?: boolean;
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

  const justification = options.justification ?? "Activated via azpim";

  if (!options.subscriptionId?.trim()) {
    throw new Error("Missing required flag: --subscription-id");
  }

  const requestedRoleNames = (options.roleNames || []).map((n) => n.trim()).filter(Boolean);
  if (requestedRoleNames.length === 0) {
    throw new Error("Missing required flag: --role-name (can be repeated)");
  }

  if (options.nonInteractive && !options.yes && !options.dryRun) {
    throw new Error("--non-interactive requires --yes (or use --dry-run)");
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
    authContext.userId,
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
      if (options.nonInteractive) {
        throw new Error(
          `Ambiguous --role-name="${name}" matched ${matches.length} eligible roles. Use --allow-multiple to activate all matches, or run without --non-interactive to select interactively.`,
        );
      }

      logBlank();
      logWarning(`Multiple eligible roles match "${name}". Please select which ones to activate:`);
      const { selectedIds } = await inquirer.prompt<{ selectedIds: string[] }>([
        {
          type: "checkbox",
          name: "selectedIds",
          message: chalk.cyan(`Select matches for "${name}":`),
          choices: matches.map((r) => ({
            name: formatRole(r.roleName, r.scopeDisplayName),
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
    {
      label: "Role(s)",
      value: targets.map((t) => `${t.roleName} @ ${t.scopeDisplayName}`).join(", "),
    },
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
        selectedSubscription.subscriptionId,
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
  const justification = options.justification ?? "Deactivated via azpim";

  const requestedRoleNames = (options.roleNames || []).map((n) => n.trim()).filter(Boolean);
  if (requestedRoleNames.length === 0) {
    throw new Error("Missing required flag: --role-name (can be repeated)");
  }

  if (options.nonInteractive && !options.yes && !options.dryRun) {
    throw new Error("--non-interactive requires --yes (or use --dry-run)");
  }

  logBlank();
  logInfo("Resolving subscriptions and active roles...");

  // const subscriptions = await fetchSubscriptions(authContext.credential);
  // if (subscriptions.length === 0) {
  //   throw new Error("No subscriptions found.");
  // }
  let targetSubscriptions: Array<{
    subscriptionId: string;
    displayName: string;
  }>;
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
      if (options.nonInteractive) {
        throw new Error(
          `Ambiguous --role-name="${name}" matched ${matches.length} active roles. Use --allow-multiple to deactivate all matches, or run without --non-interactive to select interactively.`,
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
    {
      label: "Role(s)",
      value: targets.map((t) => `${t.roleName} @ ${t.scopeDisplayName} (${t.subscriptionName})`).join(", "),
    },
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
        `${role.roleName} @ ${role.scopeDisplayName}`,
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
    const { action } = await inquirer.prompt<{
      action: "activate" | "deactivate" | "approvals" | "assignments" | "presets" | "exit";
    }>([
      {
        type: "select",
        name: "action",
        message: chalk.cyan.bold("What would you like to do?"),
        choices: [
          { name: chalk.green("▶ Activate Role(s)"), value: "activate" },
          { name: chalk.yellow("◼ Deactivate Role(s)"), value: "deactivate" },
          { name: chalk.blue("📋 Approvals..."), value: "approvals" },
          { name: chalk.cyan("👥 All Assignments..."), value: "assignments" },
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
      case "approvals":
        await showApprovalsMenu(authContext);
        break;
      case "assignments":
        await showAssignmentsMenu(authContext);
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
      const { action } = await inquirer.prompt<{
        action: "enter" | "back" | "exit";
      }>([
        {
          type: "select",
          name: "action",
          message: chalk.yellow("No subscriptions found. What would you like to do?"),
          choices: [
            {
              name: chalk.cyan("Enter subscription ID manually"),
              value: "enter",
            },
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
        selectedSubscription = {
          subscriptionId: manualId.trim(),
          displayName: manualId.trim(),
        };
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
      selectedSubscription = {
        subscriptionId: found.subscriptionId,
        displayName: found.displayName,
      };
    }

    const eligibleRoles = await fetchEligibleRolesForSubscription(
      authContext.credential,
      selectedSubscription.subscriptionId,
      selectedSubscription.displayName,
      authContext.userId,
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
        default: "Activated via azpim",
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
      {
        label: "Duration",
        value: `${activationDetails.durationHours} hour(s)`,
      },
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
          selectedSubscription.subscriptionId,
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
      const { action } = await inquirer.prompt<{
        action: "enter" | "back" | "exit";
      }>([
        {
          type: "select",
          name: "action",
          message: chalk.yellow("No subscriptions found. What would you like to do?"),
          choices: [
            {
              name: chalk.cyan("Enter subscription ID manually"),
              value: "enter",
            },
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
        subscriptions.push({
          subscriptionId: manualId.trim(),
          displayName: manualId.trim(),
          tenantId: "",
        } as any);
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
          `${role.roleName} @ ${role.scopeDisplayName}`,
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

// =============================================================================
// Approvals - Types
// =============================================================================

export type ApprovalsListResult = {
  pendingApprovals: PendingApproval[];
  count: number;
};

export type ApprovalsApproveOptions = {
  approvalId?: string;
  justification?: string;
  yes?: boolean;
};

export type ApprovalsRejectOptions = {
  approvalId?: string;
  justification?: string;
  yes?: boolean;
};

export type AssignmentsListOptions = {
  subscriptionId?: string;
  filterUser?: string;
};

export type AssignmentsListResult = {
  assignments: AllActiveAssignment[];
  count: number;
};

export type AssignmentsDeactivateOptions = {
  assignmentId?: string;
  subscriptionId?: string;
  justification?: string;
  yes?: boolean;
};

// =============================================================================
// Approvals - One-Shot Functions
// =============================================================================

/**
 * List pending approval requests (one-shot).
 */
export const approvalsListOnce = async (authContext: AuthContext): Promise<ApprovalsListResult> => {
  logBlank();
  logInfo("Fetching pending approval requests...");
  logBlank();

  const pendingApprovals = await fetchPendingApprovals(authContext.credential);

  if (pendingApprovals.length === 0) {
    logInfo("No pending approval requests.");
  } else {
    logBlank();
    logInfo(`Found ${pendingApprovals.length} pending approval(s):`);
    logBlank();
    for (const approval of pendingApprovals) {
      console.log(
        `  ${chalk.dim("•")} ${formatPendingApproval(
          approval.roleName,
          approval.scopeDisplayName,
          approval.requestor.displayName,
          approval.requestedDateTime,
        )}`,
      );
      console.log(`    ${chalk.dim("ID:")} ${chalk.cyan(approval.approvalId)}`);
    }
  }

  return {
    pendingApprovals,
    count: pendingApprovals.length,
  };
};

/**
 * Approve a pending request (one-shot or interactive).
 */
export const approvalsApproveOnce = async (authContext: AuthContext, options: ApprovalsApproveOptions): Promise<ApprovalDecisionResult> => {
  logBlank();

  let approvalId = options.approvalId;
  let justification = options.justification ?? "Approved via azpim";
  let stageId: string | undefined;

  // If no approval ID provided, show interactive selection
  if (!approvalId) {
    const pendingApprovals = await fetchPendingApprovals(authContext.credential);

    if (pendingApprovals.length === 0) {
      throw new Error("No pending approval requests found.");
    }

    logBlank();
    const { selectedApprovalId } = await inquirer.prompt<{
      selectedApprovalId: string;
    }>([
      {
        type: "select",
        name: "selectedApprovalId",
        message: chalk.cyan("Select a request to approve:"),
        choices: pendingApprovals.map((a) => ({
          name: formatPendingApproval(a.roleName, a.scopeDisplayName, a.requestor.displayName, a.requestedDateTime),
          value: a.approvalId,
        })),
        pageSize: 15,
      },
    ]);

    approvalId = selectedApprovalId;
    const approval = pendingApprovals.find((a) => a.approvalId === approvalId);
    stageId = approval?.currentStage?.stageId;

    // Show details and get justification
    if (approval) {
      logBlank();
      const details = formatPendingApprovalDetailed(
        approval.roleName,
        approval.scopeDisplayName,
        approval.requestor.displayName,
        approval.requestor.userPrincipalName,
        approval.justification,
        approval.requestedDurationHours,
        approval.requestedDateTime,
      );
      for (const line of details) {
        console.log(`  ${line}`);
      }
      logBlank();
    }

    if (!options.justification) {
      const { inputJustification } = await inquirer.prompt<{
        inputJustification: string;
      }>([
        {
          type: "input",
          name: "inputJustification",
          message: chalk.cyan("Justification for approval (optional):"),
          default: "Approved via azpim",
        },
      ]);
      justification = inputJustification;
    }
  } else {
    // Fetch details for the provided approval ID
    const approval = await getApprovalDetails(authContext.credential, approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    stageId = approval.currentStage?.stageId;

    if (!stageId) {
      throw new Error("No actionable approval stage found for this request.");
    }
  }

  if (!stageId) {
    throw new Error("Could not determine approval stage ID.");
  }

  // Confirm
  if (!options.yes) {
    const { confirmApprove } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmApprove",
        message: chalk.green("Confirm approval?"),
        default: true,
      },
    ]);

    if (!confirmApprove) {
      return {
        approvalId,
        stageId,
        decision: "Approve",
        justification,
        reviewedDateTime: new Date(),
        success: false,
        error: "Cancelled by user",
      };
    }
  }

  return submitApprovalDecision(authContext.credential, approvalId, stageId, "Approve", justification);
};

/**
 * Reject a pending request (one-shot or interactive).
 */
export const approvalsRejectOnce = async (authContext: AuthContext, options: ApprovalsRejectOptions): Promise<ApprovalDecisionResult> => {
  logBlank();

  let approvalId = options.approvalId;
  let justification = options.justification;
  let stageId: string | undefined;

  // Justification is required for rejection
  if (options.approvalId && !options.justification) {
    throw new Error("--justification is required when rejecting a request.");
  }

  // If no approval ID provided, show interactive selection
  if (!approvalId) {
    const pendingApprovals = await fetchPendingApprovals(authContext.credential);

    if (pendingApprovals.length === 0) {
      throw new Error("No pending approval requests found.");
    }

    logBlank();
    const { selectedApprovalId } = await inquirer.prompt<{
      selectedApprovalId: string;
    }>([
      {
        type: "select",
        name: "selectedApprovalId",
        message: chalk.cyan("Select a request to reject:"),
        choices: pendingApprovals.map((a) => ({
          name: formatPendingApproval(a.roleName, a.scopeDisplayName, a.requestor.displayName, a.requestedDateTime),
          value: a.approvalId,
        })),
        pageSize: 15,
      },
    ]);

    approvalId = selectedApprovalId;
    const approval = pendingApprovals.find((a) => a.approvalId === approvalId);
    stageId = approval?.currentStage?.stageId;

    // Show details and get justification
    if (approval) {
      logBlank();
      const details = formatPendingApprovalDetailed(
        approval.roleName,
        approval.scopeDisplayName,
        approval.requestor.displayName,
        approval.requestor.userPrincipalName,
        approval.justification,
        approval.requestedDurationHours,
        approval.requestedDateTime,
      );
      for (const line of details) {
        console.log(`  ${line}`);
      }
      logBlank();
    }

    // Justification is required
    const { inputJustification } = await inquirer.prompt<{
      inputJustification: string;
    }>([
      {
        type: "input",
        name: "inputJustification",
        message: chalk.cyan("Justification for rejection (required):"),
        validate: (value) => {
          if (value.trim().length >= 5) return true;
          return chalk.red("Justification must be at least 5 characters.");
        },
      },
    ]);
    justification = inputJustification;
  } else {
    // Fetch details for the provided approval ID
    const approval = await getApprovalDetails(authContext.credential, approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    stageId = approval.currentStage?.stageId;

    if (!stageId) {
      throw new Error("No actionable approval stage found for this request.");
    }
  }

  if (!stageId) {
    throw new Error("Could not determine approval stage ID.");
  }

  if (!justification) {
    throw new Error("Justification is required for rejection.");
  }

  // Confirm
  if (!options.yes) {
    const { confirmReject } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmReject",
        message: chalk.red("Confirm rejection?"),
        default: false,
      },
    ]);

    if (!confirmReject) {
      return {
        approvalId,
        stageId,
        decision: "Deny",
        justification,
        reviewedDateTime: new Date(),
        success: false,
        error: "Cancelled by user",
      };
    }
  }

  return submitApprovalDecision(authContext.credential, approvalId, stageId, "Deny", justification);
};

// =============================================================================
// Assignments - One-Shot Functions
// =============================================================================

/**
 * List all active assignments (one-shot).
 */
export const assignmentsListOnce = async (authContext: AuthContext, options: AssignmentsListOptions): Promise<AssignmentsListResult> => {
  logBlank();
  logInfo("Fetching active PIM assignments...");
  logBlank();

  let subscriptions: { subscriptionId: string; displayName: string }[];

  if (options.subscriptionId) {
    subscriptions = [
      {
        subscriptionId: options.subscriptionId,
        displayName: options.subscriptionId,
      },
    ];
  } else {
    subscriptions = await fetchSubscriptions(authContext.credential);
  }

  let allAssignments: AllActiveAssignment[] = [];

  for (const sub of subscriptions) {
    const assignments = await fetchAllActiveAssignments(authContext.credential, sub.subscriptionId, sub.displayName);
    allAssignments = allAssignments.concat(assignments);
  }

  // Apply user filter if provided
  if (options.filterUser) {
    const filter = options.filterUser.toLowerCase();
    allAssignments = allAssignments.filter(
      (a) => a.principal.displayName.toLowerCase().includes(filter) || a.principal.userPrincipalName?.toLowerCase().includes(filter),
    );
  }

  if (allAssignments.length === 0) {
    logInfo("No active assignments found.");
  } else {
    logBlank();
    logInfo(`Found ${allAssignments.length} active assignment(s):`);
    logBlank();
    for (const assignment of allAssignments) {
      console.log(
        `  ${chalk.dim("•")} ${formatAssignment(
          assignment.roleName,
          assignment.scopeDisplayName,
          assignment.principal.displayName,
          assignment.endDateTime,
        )}`,
      );
    }
  }

  return {
    assignments: allAssignments,
    count: allAssignments.length,
  };
};

/**
 * Deactivate another user's assignment (one-shot or interactive).
 */
export const assignmentsDeactivateOnce = async (
  authContext: AuthContext,
  options: AssignmentsDeactivateOptions,
): Promise<{ success: boolean; error?: string }> => {
  logBlank();

  let selectedAssignment: AllActiveAssignment | undefined;
  let justification = options.justification ?? "Deactivated via azpim (admin action)";

  if (options.assignmentId && options.subscriptionId) {
    // Fetch assignments for the subscription and find by ID
    const assignments = await fetchAllActiveAssignments(authContext.credential, options.subscriptionId, options.subscriptionId);
    selectedAssignment = assignments.find((a) => a.assignmentId === options.assignmentId);

    if (!selectedAssignment) {
      throw new Error(`Assignment not found: ${options.assignmentId}`);
    }
  } else {
    // Interactive selection
    const subscriptions = await fetchSubscriptions(authContext.credential);

    if (subscriptions.length === 0) {
      throw new Error("No subscriptions found.");
    }

    logBlank();
    const { selectedSubscriptionId } = await inquirer.prompt<{
      selectedSubscriptionId: string;
    }>([
      {
        type: "select",
        name: "selectedSubscriptionId",
        message: chalk.cyan("Select a subscription:"),
        choices: subscriptions.map((s) => ({
          name: formatSubscription(s.displayName, s.subscriptionId),
          value: s.subscriptionId,
        })),
        pageSize: 15,
      },
    ]);

    const sub = subscriptions.find((s) => s.subscriptionId === selectedSubscriptionId);
    const assignments = await fetchAllActiveAssignments(authContext.credential, selectedSubscriptionId, sub?.displayName || selectedSubscriptionId);

    if (assignments.length === 0) {
      throw new Error("No active assignments found in this subscription.");
    }

    logBlank();
    const { selectedAssignmentId } = await inquirer.prompt<{
      selectedAssignmentId: string;
    }>([
      {
        type: "select",
        name: "selectedAssignmentId",
        message: chalk.cyan("Select an assignment to deactivate:"),
        choices: assignments.map((a) => ({
          name: formatAssignment(a.roleName, a.scopeDisplayName, a.principal.displayName, a.endDateTime),
          value: a.assignmentId,
        })),
        pageSize: 15,
      },
    ]);

    selectedAssignment = assignments.find((a) => a.assignmentId === selectedAssignmentId);

    if (!selectedAssignment) {
      throw new Error("Assignment not found.");
    }

    // Get justification
    if (!options.justification) {
      const { inputJustification } = await inquirer.prompt<{
        inputJustification: string;
      }>([
        {
          type: "input",
          name: "inputJustification",
          message: chalk.cyan("Justification for admin deactivation:"),
          default: "Deactivated via azpim (admin action)",
          validate: (value) => {
            if (value.trim().length >= 5) return true;
            return chalk.red("Justification must be at least 5 characters.");
          },
        },
      ]);
      justification = inputJustification;
    }
  }

  // Show summary
  showSummary("Admin Deactivation", [
    { label: "Role", value: selectedAssignment.roleName },
    { label: "Scope", value: selectedAssignment.scopeDisplayName },
    { label: "User", value: selectedAssignment.principal.displayName },
    { label: "Justification", value: justification },
  ]);

  // Confirm
  if (!options.yes) {
    const { confirmDeactivate } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmDeactivate",
        message: chalk.red("⚠ This will deactivate another user's role. Confirm?"),
        default: false,
      },
    ]);

    if (!confirmDeactivate) {
      logWarning("Admin deactivation cancelled.");
      return { success: false, error: "Cancelled by user" };
    }
  }

  return adminDeactivateAssignment(authContext.credential, selectedAssignment, justification);
};

// =============================================================================
// Interactive Menus for Approvals & Assignments
// =============================================================================

/**
 * Interactive menu for approvals.
 */
export const showApprovalsMenu = async (authContext: AuthContext): Promise<void> => {
  while (true) {
    logBlank();
    const { action } = await inquirer.prompt<{
      action: "list" | "approve" | "reject" | "back";
    }>([
      {
        type: "select",
        name: "action",
        message: chalk.cyan.bold("Approvals Menu:"),
        choices: [
          { name: chalk.cyan("📋 View pending requests"), value: "list" },
          { name: chalk.green("✔ Approve a request"), value: "approve" },
          { name: chalk.red("✖ Reject a request"), value: "reject" },
          { name: chalk.dim("↩ Back to Main Menu"), value: "back" },
        ],
        default: "list",
      },
    ]);

    switch (action) {
      case "list":
        await approvalsListOnce(authContext);
        break;
      case "approve":
        try {
          await approvalsApproveOnce(authContext, {});
        } catch (error: any) {
          logError(error.message);
        }
        break;
      case "reject":
        try {
          await approvalsRejectOnce(authContext, {});
        } catch (error: any) {
          logError(error.message);
        }
        break;
      case "back":
        return;
    }
  }
};

/**
 * Interactive menu for assignments.
 */
export const showAssignmentsMenu = async (authContext: AuthContext): Promise<void> => {
  while (true) {
    logBlank();
    const { action } = await inquirer.prompt<{
      action: "list" | "deactivate" | "back";
    }>([
      {
        type: "select",
        name: "action",
        message: chalk.cyan.bold("All Assignments Menu:"),
        choices: [
          { name: chalk.cyan("👥 View all active assignments"), value: "list" },
          {
            name: chalk.red("🛑 Deactivate user's role (Admin)"),
            value: "deactivate",
          },
          { name: chalk.dim("↩ Back to Main Menu"), value: "back" },
        ],
        default: "list",
      },
    ]);

    switch (action) {
      case "list":
        await assignmentsListOnce(authContext, {});
        break;
      case "deactivate":
        try {
          await assignmentsDeactivateOnce(authContext, {});
        } catch (error: any) {
          logError(error.message);
        }
        break;
      case "back":
        return;
    }
  }
};
