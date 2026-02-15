import chalk from "chalk";
import inquirer from "inquirer";
import type { AuthContext } from "../azure/auth";
import { type ActiveAzureRole, deactivateAzureRole, fetchSubscriptions, listActiveAzureRoles } from "../azure/azure-pim";
import { DEFAULT_JUSTIFICATION_DEACTIVATE, SENTINEL_BACK } from "../core/constants";
import { extractErrorMessage } from "../core/errors";
import {
  displayResultsSummary,
  formatActiveRole,
  logBlank,
  logDebug,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  showDivider,
  showSummary,
} from "../core/ui";
import { normalizeRoleName, promptBackToMainMenuOrExit } from "./cli";
import { selectSubscriptionInteractive } from "./subscription-selector";

// ===============================
// Types
// ===============================

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

// ===============================
// One-shot deactivation (non-interactive / CLI flags)
// ===============================

export const deactivateOnce = async (authContext: AuthContext, options: DeactivateOnceOptions): Promise<DeactivateOnceResult> => {
  const justification = options.justification ?? DEFAULT_JUSTIFICATION_DEACTIVATE;

  const requestedRoleNames = (options.roleNames || []).map((n) => n.trim()).filter(Boolean);
  if (requestedRoleNames.length === 0) {
    throw new Error("Missing required flag: --role-name (can be repeated)");
  }

  if (options.nonInteractive && !options.yes && !options.dryRun) {
    throw new Error("--non-interactive requires --yes (or use --dry-run)");
  }

  logBlank();
  logInfo("Resolving subscriptions and active roles...");

  let targetSubscriptions: Array<{
    subscriptionId: string;
    displayName: string;
  }>;
  if (options.subscriptionId?.trim()) {
    logDebug("Using subscription ID from options", {
      subscriptionId: options.subscriptionId,
    });
    targetSubscriptions = [
      {
        subscriptionId: options.subscriptionId,
        displayName: `${options.subscriptionId} (name unavailable)`,
      },
    ];
  } else {
    logDebug("Fetching all subscriptions for deactivation...");
    const subscriptions = await fetchSubscriptions(authContext.credential, authContext.userId);
    if (subscriptions.length === 0) {
      throw new Error("No subscriptions found. use --subscription-id to specify a subscription.");
    }
    targetSubscriptions = subscriptions;
  }

  logDebug("Target subscriptions resolved for deactivation", {
    count: targetSubscriptions.length,
  });

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

  logDebug("Matching requested role names for deactivation", {
    requestedRoleNames,
    activeCount: allActiveRoles.length,
    uniqueRoleNames: Array.from(activeByName.keys()),
  });

  const resolvedTargets: DeactivateOnceResult["resolvedTargets"] = [];

  for (const name of requestedRoleNames) {
    const matches = activeByName.get(normalizeRoleName(name)) ?? [];

    logDebug(`Role name "${name}" matched ${matches.length} active role(s)`);

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
      await deactivateAzureRole(authContext.credential, {
        scope: role.scope,
        roleEligibilityScheduleId: role.linkedRoleEligibilityScheduleId,
        subscriptionId: role.subscriptionId,
        principalId: authContext.userId,
        roleDefinitionId: role.roleDefinitionId,
        roleName: `${role.roleName} @ ${role.scopeDisplayName}`,
      });
      results.push({
        assignmentId: target.assignmentId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        subscriptionName: target.subscriptionName,
        success: true,
      });
    } catch (error: unknown) {
      results.push({
        assignmentId: target.assignmentId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        subscriptionName: target.subscriptionName,
        success: false,
        error: extractErrorMessage(error),
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  logBlank();
  showDivider();
  displayResultsSummary(successCount, failCount, "deactivated");

  return {
    requestedRoleNames,
    resolvedTargets: targets,
    justification,
    dryRun: false,
    results,
  };
};

// ===============================
// Interactive deactivation flow
// ===============================

export const handleDeactivation = async (authContext: AuthContext): Promise<void> => {
  try {
    logBlank();
    logInfo("Starting role deactivation flow...");
    logBlank();

    const subResult = await selectSubscriptionInteractive(authContext);
    if (!subResult) return;

    const { selectedSubscription } = subResult;

    const activeAzureRoles = await listActiveAzureRoles(
      authContext.credential,
      selectedSubscription.subscriptionId,
      selectedSubscription.displayName,
      authContext.userId,
    );

    if (activeAzureRoles.length === 0) {
      logWarning("No active roles found for deactivation.");
      await promptBackToMainMenuOrExit("What would you like to do?");
      return;
    }

    logBlank();
    const { rolesToDeactivate } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "rolesToDeactivate",
        message: chalk.cyan("Select role(s) to deactivate:"),
        choices: [
          { name: chalk.dim("↩ Back to Main Menu"), value: SENTINEL_BACK },
          ...activeAzureRoles.map((role) => ({
            name: formatActiveRole(role.roleName, role.scopeDisplayName, role.subscriptionName, role.startDateTime),
            value: role.id,
            checked: false,
          })),
        ],
        validate: (answer) => {
          if (Array.isArray(answer) && answer.includes(SENTINEL_BACK)) {
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

    const selectedRoleIds = (rolesToDeactivate as string[]).includes(SENTINEL_BACK)
      ? (rolesToDeactivate as string[]).filter((id) => id !== SENTINEL_BACK)
      : (rolesToDeactivate as string[]);

    if ((rolesToDeactivate as string[]).includes(SENTINEL_BACK) && selectedRoleIds.length === 0) {
      return;
    }

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
        await deactivateAzureRole(authContext.credential, {
          scope: role.scope,
          roleEligibilityScheduleId: role.linkedRoleEligibilityScheduleId,
          subscriptionId: role.subscriptionId,
          principalId: authContext.userId,
          roleDefinitionId: role.roleDefinitionId,
          roleName: `${role.roleName} @ ${role.scopeDisplayName}`,
        });
        successCount++;
      } catch (error: unknown) {
        logError(`Failed to deactivate role "${role.roleName}": ${extractErrorMessage(error)}`);
        failCount++;
      }
    }

    logBlank();
    showDivider();
    displayResultsSummary(successCount, failCount, "deactivated");
  } catch (error: unknown) {
    logError(`Error during deactivation: ${extractErrorMessage(error)}`);
    return;
  }
};
