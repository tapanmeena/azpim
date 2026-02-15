import chalk from "chalk";
import inquirer from "inquirer";
import type { AuthContext } from "../azure/auth";
import { activateAzureRole, fetchEligibleRolesForSubscription } from "../azure/azure-pim";
import { DEFAULT_DURATION_HOURS, DEFAULT_JUSTIFICATION_ACTIVATE, DURATION_MAX_HOURS, DURATION_MIN_HOURS } from "../core/constants";
import { extractErrorMessage } from "../core/errors";
import {
  displayResultsSummary,
  formatRole,
  logBlank,
  logDebug,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  showDivider,
  showSummary,
} from "../core/ui";
import { normalizeRoleName, promptBackToMainMenuOrExit, validateDurationHours } from "./cli";
import { selectSubscriptionInteractive } from "./subscription-selector";

// ===============================
// Types
// ===============================

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

// ===============================
// One-shot activation (non-interactive / CLI flags)
// ===============================

export const activateOnce = async (authContext: AuthContext, options: ActivateOnceOptions): Promise<ActivateOnceResult> => {
  const durationHours = options.durationHours ?? DURATION_MAX_HOURS;
  validateDurationHours(durationHours);

  const justification = options.justification ?? DEFAULT_JUSTIFICATION_ACTIVATE;

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

  logDebug("Matching requested role names", {
    requestedRoleNames,
    eligibleCount: eligibleRoles.length,
    uniqueRoleNames: Array.from(eligibleByName.keys()),
  });

  const resolvedTargets: ActivateOnceResult["resolvedTargets"] = [];

  for (const name of requestedRoleNames) {
    const matches = eligibleByName.get(normalizeRoleName(name)) ?? [];

    logDebug(`Role name "${name}" matched ${matches.length} eligible role(s)`);

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
    } catch (error: unknown) {
      results.push({
        eligibilityId: target.eligibilityId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        success: false,
        error: extractErrorMessage(error),
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  logBlank();
  showDivider();
  displayResultsSummary(successCount, failCount, "activated");

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

// ===============================
// Interactive activation flow
// ===============================

export const handleActivation = async (authContext: AuthContext): Promise<void> => {
  try {
    logBlank();
    logInfo("Starting role activation flow...");
    logBlank();

    const subResult = await selectSubscriptionInteractive(authContext);
    if (!subResult) return;

    const { selectedSubscription } = subResult;

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
        default: DEFAULT_DURATION_HOURS,
        validate: (value) => {
          if (!value) return chalk.red("Please enter a valid number.");
          if (value >= DURATION_MIN_HOURS && value <= DURATION_MAX_HOURS) return true;
          return chalk.red("Please enter a value between 1 and 8.");
        },
      },
      {
        type: "input",
        name: "justification",
        message: chalk.cyan("Justification for activation:"),
        default: DEFAULT_JUSTIFICATION_ACTIVATE,
        validate: (value) => {
          if (value.trim().length >= 5) return true;
          return chalk.red("Justification should be at least 5 characters long.");
        },
      },
    ]);

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
      } catch (error: unknown) {
        logError(`Failed to activate role "${role.roleName}": ${extractErrorMessage(error)}`);
        failCount++;
      }
    }

    logBlank();
    showDivider();
    displayResultsSummary(successCount, failCount, "activated");
  } catch (error: unknown) {
    logError(`Error during activation: ${extractErrorMessage(error)}`);
    return;
  }
};
