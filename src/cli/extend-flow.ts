import chalk from "chalk";
import inquirer from "inquirer";
import type { AuthContext } from "../azure/auth";
import { extendAzureRole, listActiveAzureRoles } from "../azure/azure-pim";
import { DEFAULT_DURATION_HOURS, DEFAULT_JUSTIFICATION_EXTEND, DURATION_MAX_HOURS, DURATION_MIN_HOURS, SENTINEL_BACK } from "../core/constants";
import { extractErrorMessage } from "../core/errors";
import {
  displayResultsSummary,
  formatActiveRole,
  icons,
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

export type ExtendOnceOptions = {
  subscriptionId: string;
  roleNames: string[];
  durationHours?: number;
  justification?: string;
  dryRun?: boolean;
  nonInteractive?: boolean;
  yes?: boolean;
  allowMultiple?: boolean;
};

export type ExtendOnceResult = {
  subscriptionId: string;
  subscriptionName: string;
  requestedRoleNames: string[];
  resolvedTargets: Array<{
    assignmentId: string;
    roleName: string;
    scope: string;
    scopeDisplayName: string;
    roleDefinitionId: string;
    linkedRoleEligibilityScheduleId: string;
  }>;
  durationHours: number;
  justification: string;
  dryRun: boolean;
  results?: Array<{
    assignmentId: string;
    roleName: string;
    scopeDisplayName: string;
    status?: string;
    success: boolean;
    error?: string;
  }>;
};

// ===============================
// One-shot extension (non-interactive / CLI flags)
// ===============================

export const extendOnce = async (authContext: AuthContext, options: ExtendOnceOptions): Promise<ExtendOnceResult> => {
  const durationHours = options.durationHours ?? DURATION_MAX_HOURS;
  validateDurationHours(durationHours);

  const justification = options.justification ?? DEFAULT_JUSTIFICATION_EXTEND;

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
  logInfo("Resolving subscription and active roles...");

  const selectedSubscription = {
    subscriptionId: options.subscriptionId,
    displayName: `${options.subscriptionId} (name unavailable)`,
  };

  const activeRoles = await listActiveAzureRoles(
    authContext.credential,
    selectedSubscription.subscriptionId,
    selectedSubscription.displayName,
    authContext.userId,
  );

  if (activeRoles.length === 0) {
    throw new Error(`No active roles found in subscription "${selectedSubscription.displayName}".`);
  }

  const activeByName = new Map<string, typeof activeRoles>();
  for (const role of activeRoles) {
    const normalized = normalizeRoleName(role.roleName);
    if (!activeByName.has(normalized)) {
      activeByName.set(normalized, []);
    }
    activeByName.get(normalized)?.push(role);
  }

  const resolvedTargets: ExtendOnceResult["resolvedTargets"] = [];

  for (const name of requestedRoleNames) {
    const normalized = normalizeRoleName(name);
    const matches = activeByName.get(normalized);

    if (!matches || matches.length === 0) {
      logWarning(`No active role named "${name}" found.`);
      continue;
    }

    if (matches.length > 1 && !options.allowMultiple) {
      logError(`Multiple matches for role "${name}" found, but --allow-multiple not specified.`);
      logBlank();
      for (const r of matches) {
        logInfo(`  - ${r.roleName} @ ${r.scopeDisplayName} (${r.subscriptionName})`);
      }
      throw new Error(`Ambiguous role name: "${name}". Use --allow-multiple to extend all matches.`);
    }

    for (const role of matches) {
      resolvedTargets.push({
        assignmentId: role.id,
        roleName: role.roleName,
        scope: role.scope,
        scopeDisplayName: role.scopeDisplayName,
        roleDefinitionId: role.roleDefinitionId,
        linkedRoleEligibilityScheduleId: role.linkedRoleEligibilityScheduleId,
      });
    }
  }

  const uniqueTargets = new Map<string, ExtendOnceResult["resolvedTargets"][number]>();
  for (const target of resolvedTargets) {
    uniqueTargets.set(target.assignmentId, target);
  }

  const finalTargets = Array.from(uniqueTargets.values());
  if (finalTargets.length === 0) {
    throw new Error("No active roles matched the requested role names.");
  }

  const result: ExtendOnceResult = {
    subscriptionId: selectedSubscription.subscriptionId,
    subscriptionName: selectedSubscription.displayName,
    requestedRoleNames,
    resolvedTargets: finalTargets,
    durationHours,
    justification,
    dryRun: options.dryRun ?? false,
  };

  // Show summary
  showSummary({
    Subscription: selectedSubscription.displayName,
    "Role(s) to extend": finalTargets.map((t) => `${t.roleName} @ ${t.scopeDisplayName}`).join(", "),
    "Extension Duration": `${durationHours} hour(s)`,
    Justification: justification,
  });

  // Dry run?
  if (options.dryRun) {
    logInfo("Dry-run mode: no actual extension performed.");
    return result;
  }

  // Confirm if not auto-yes
  if (!options.yes && !options.nonInteractive) {
    logBlank();
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: "confirm",
        name: "confirm",
        message: chalk.yellow(`Proceed with extending ${finalTargets.length} role(s)?`),
        default: true,
      },
    ]);
    if (!confirm) {
      logInfo("Extension cancelled.");
      return result;
    }
  }

  // Perform extensions
  logBlank();
  logInfo(`Extending ${finalTargets.length} role(s)...`);
  logBlank();

  const results: ExtendOnceResult["results"] = [];

  for (const target of finalTargets) {
    try {
      const response = await extendAzureRole(
        authContext.credential,
        {
          roleEligibilityScheduleId: target.linkedRoleEligibilityScheduleId,
          roleDefinitionId: target.roleDefinitionId,
          roleName: target.roleName,
          scope: target.scope,
          principalId: authContext.userId,
          justification,
          durationHours,
        },
        selectedSubscription.subscriptionId,
      );

      results.push({
        assignmentId: target.assignmentId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        status: response.status,
        success: true,
      });
    } catch (error: unknown) {
      const errorMsg = extractErrorMessage(error);
      results.push({
        assignmentId: target.assignmentId,
        roleName: target.roleName,
        scopeDisplayName: target.scopeDisplayName,
        success: false,
        error: errorMsg,
      });
      logError(`Failed to extend "${target.roleName}": ${errorMsg}`);
    }
  }

  result.results = results;

  // Summary
  logBlank();
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;
  displayResultsSummary(successCount, failCount, "extended");

  return result;
};

// ===============================
// Interactive extension flow
// ===============================

export const handleExtension = async (authContext: AuthContext): Promise<void> => {
  logBlank();

  // Step 1: Select subscription
  const subscriptionResult = await selectSubscriptionInteractive(authContext);
  if (!subscriptionResult) return;

  const { subscriptionId, subscriptionName } = subscriptionResult;

  // Step 2: Fetch active roles
  const activeAzureRoles = await listActiveAzureRoles(authContext.credential, subscriptionId, subscriptionName, authContext.userId);

  if (activeAzureRoles.length === 0) {
    logWarning(`No active roles found for "${subscriptionName}".`);
    await promptBackToMainMenuOrExit("No active roles to extend.");
    return;
  }

  logBlank();

  // Step 3: Select roles to extend (with expiration warnings)
  const { rolesToExtend } = await inquirer.prompt<{ rolesToExtend: string[] | string }>([
    {
      type: "checkbox",
      name: "rolesToExtend",
      message: chalk.cyan("Select role(s) to extend:"),
      choices: [
        {
          name: chalk.dim(`${icons.back} Back to Main Menu`),
          value: SENTINEL_BACK,
        },
        ...activeAzureRoles.map((role) => ({
          name: formatActiveRole(role.roleName, role.scopeDisplayName, role.subscriptionName, role.startDateTime, role.endDateTime),
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

  const selectedRoleIds = (rolesToExtend as string[]).includes(SENTINEL_BACK)
    ? (rolesToExtend as string[]).filter((id) => id !== SENTINEL_BACK)
    : (rolesToExtend as string[]);

  if ((rolesToExtend as string[]).includes(SENTINEL_BACK) && selectedRoleIds.length === 0) {
    return;
  }

  const selectedRoles = activeAzureRoles.filter((r) => selectedRoleIds.includes(r.id));

  // Step 4: Prompt for duration
  logBlank();
  const { durationHours } = await inquirer.prompt<{ durationHours: number }>([
    {
      type: "number",
      name: "durationHours",
      message: chalk.cyan(`Extension duration (hours, ${DURATION_MIN_HOURS}-${DURATION_MAX_HOURS}):`),
      default: DEFAULT_DURATION_HOURS,
      validate: (val) => {
        if (!Number.isFinite(val) || val < DURATION_MIN_HOURS || val > DURATION_MAX_HOURS) {
          return chalk.red(`Please enter a number between ${DURATION_MIN_HOURS} and ${DURATION_MAX_HOURS}.`);
        }
        return true;
      },
    },
  ]);

  // Step 5: Prompt for justification
  const { justification } = await inquirer.prompt<{ justification: string }>([
    {
      type: "input",
      name: "justification",
      message: chalk.cyan("Justification (optional):"),
      default: DEFAULT_JUSTIFICATION_EXTEND,
    },
  ]);

  // Step 6: Show summary and confirm
  showDivider();
  logBlank();
  showSummary({
    Subscription: subscriptionName,
    "Role(s) to extend": selectedRoles.map((r) => `${r.roleName} @ ${r.scopeDisplayName}`).join(", "),
    "Extension Duration": `${durationHours} hour(s)`,
    Justification: justification,
  });
  logBlank();

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow("Confirm extension?"),
      default: true,
    },
  ]);

  if (!confirm) {
    logInfo("Extension cancelled.");
    await promptBackToMainMenuOrExit("Extension cancelled.");
    return;
  }

  // Step 7: Perform extensions
  logBlank();
  showDivider();
  logBlank();
  logInfo(`Extending ${selectedRoles.length} role(s)...`);
  logBlank();

  let successCount = 0;
  let failCount = 0;

  for (const role of selectedRoles) {
    try {
      await extendAzureRole(
        authContext.credential,
        {
          roleEligibilityScheduleId: role.linkedRoleEligibilityScheduleId,
          roleDefinitionId: role.roleDefinitionId,
          roleName: role.roleName,
          scope: role.scope,
          principalId: authContext.userId,
          justification,
          durationHours,
        },
        subscriptionId,
      );
      successCount++;
    } catch (error: unknown) {
      failCount++;
      const errorMsg = extractErrorMessage(error);
      logDebug("Extension failed", { role: role.roleName, error: errorMsg });
    }
  }

  logBlank();
  displayResultsSummary(successCount, failCount, "extended");

  await promptBackToMainMenuOrExit("Extension completed.");
};
