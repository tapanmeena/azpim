import chalk from "chalk";
import inquirer from "inquirer";
import { AuthContext } from "./auth";
import {
  activateAzureRole,
  ActiveAzureRole,
  AzureSubscription,
  deactivateAzureRole,
  fetchEligibleRolesForSubscription,
  fetchSubscriptions,
  listActiveAzureRoles,
} from "./azure-pim";
import {
  addFavorite,
  clearFavorites,
  exportFavorites,
  getFavoriteIds,
  importFavorites,
  isFavorite,
  loadFavorites,
  removeFavorite,
  saveFavorites,
  toggleFavorite,
} from "./favorites";
import { formatCacheAge, getCacheAge, getSubscriptionNameMap, invalidateCache, validateSubscriptionId } from "./subscription-cache";
import {
  createSubscriptionSeparator,
  formatActiveRole,
  formatFavoriteSubscription,
  formatNonFavoriteSubscription,
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

// ===============================
// Subscription Selector with Favorites & Search
// ===============================

const BACK_VALUE = "__BACK__";

export type SubscriptionSelectResult = {
  subscriptionId: string;
  displayName: string;
} | null;

/**
 * Builds subscription choices with favorites grouped at top.
 */
// Separator type for Inquirer choices
type SeparatorChoice = { type: "separator"; separator?: string };
type ChoiceItem = { name: string; value: string } | SeparatorChoice;

const separator = (label?: string): SeparatorChoice => ({
  type: "separator",
  separator: label ?? "",
});

/**
 * Builds subscription choices with favorites grouped at top.
 */
const buildSubscriptionChoices = (subscriptions: AzureSubscription[], favoriteIds: Set<string>): ChoiceItem[] => {
  const favorites: AzureSubscription[] = [];
  const others: AzureSubscription[] = [];

  for (const sub of subscriptions) {
    if (favoriteIds.has(sub.subscriptionId.toLowerCase())) {
      favorites.push(sub);
    } else {
      others.push(sub);
    }
  }

  // Sort both lists alphabetically
  favorites.sort((a, b) => a.displayName.localeCompare(b.displayName));
  others.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const choices: ChoiceItem[] = [];

  if (favorites.length > 0) {
    choices.push(separator(createSubscriptionSeparator("Favorites")));
    for (const sub of favorites) {
      choices.push({
        name: formatFavoriteSubscription(sub.displayName, sub.subscriptionId),
        value: sub.subscriptionId,
      });
    }
  }

  if (others.length > 0) {
    if (favorites.length > 0) {
      choices.push(separator(createSubscriptionSeparator("All Subscriptions")));
    }
    for (const sub of others) {
      choices.push({
        name:
          favorites.length > 0
            ? formatNonFavoriteSubscription(sub.displayName, sub.subscriptionId)
            : formatSubscription(sub.displayName, sub.subscriptionId),
        value: sub.subscriptionId,
      });
    }
  }

  choices.push(separator());
  choices.push({ name: chalk.dim("↩ Back to Main Menu"), value: BACK_VALUE });

  return choices;
};

/**
 * Try to use @inquirer/search for type-ahead, fallback to standard select.
 */
const selectSubscriptionWithSearch = async (subscriptions: AzureSubscription[], favoriteIds: Set<string>): Promise<SubscriptionSelectResult> => {
  const choices = buildSubscriptionChoices(subscriptions, favoriteIds);

  // Try @inquirer/search first for better type-ahead experience
  try {
    const searchModule = await import("@inquirer/search");
    const search = searchModule.default;

    // Build searchable items (excluding separators)
    const searchableItems = subscriptions.map((sub) => {
      const isFav = favoriteIds.has(sub.subscriptionId.toLowerCase());
      return {
        name: isFav ? formatFavoriteSubscription(sub.displayName, sub.subscriptionId) : formatSubscription(sub.displayName, sub.subscriptionId),
        value: sub.subscriptionId,
        displayName: sub.displayName,
        isFavorite: isFav,
      };
    });

    // Sort: favorites first, then alphabetically
    searchableItems.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    // Add back option
    searchableItems.push({
      name: chalk.dim("↩ Back to Main Menu"),
      value: BACK_VALUE,
      displayName: "Back",
      isFavorite: false,
    });

    const selectedId = await search({
      message: chalk.cyan("Search and select a subscription (type to filter):"),
      source: async (input: string | undefined) => {
        const term = (input || "").toLowerCase();
        if (!term) {
          return searchableItems.map((item) => ({
            name: item.name,
            value: item.value,
          }));
        }
        return searchableItems
          .filter((item) => item.displayName.toLowerCase().includes(term) || item.value.toLowerCase().includes(term))
          .map((item) => ({ name: item.name, value: item.value }));
      },
    });

    if (selectedId === BACK_VALUE) {
      return null;
    }

    const found = subscriptions.find((sub) => sub.subscriptionId === selectedId);
    return found ? { subscriptionId: found.subscriptionId, displayName: found.displayName } : null;
  } catch {
    // Fallback to standard Inquirer select (v13 has built-in type-to-filter)
    logDim("(Using standard selection - type to filter)");

    const { selectedSubscriptionId } = await inquirer.prompt<{
      selectedSubscriptionId: string;
    }>([
      {
        type: "select",
        name: "selectedSubscriptionId",
        message: chalk.cyan("Select a subscription:"),
        choices,
        pageSize: 20,
      },
    ]);

    if (selectedSubscriptionId === BACK_VALUE) {
      return null;
    }

    const found = subscriptions.find((sub) => sub.subscriptionId === selectedSubscriptionId);
    return found ? { subscriptionId: found.subscriptionId, displayName: found.displayName } : null;
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
    const subscriptions = await fetchSubscriptions(authContext.credential, authContext.userId);
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

// ===============================
// Favorites Manager
// ===============================

export const runFavoritesManager = async (authContext: AuthContext): Promise<void> => {
  while (true) {
    const favoritesLoaded = await loadFavorites(authContext.userId);
    const favoritesData = favoritesLoaded.data;
    const favoriteIds = getFavoriteIds(favoritesData);
    const cacheAge = await getCacheAge(authContext.userId);
    const subscriptionNames = await getSubscriptionNameMap(authContext.userId);

    logBlank();
    logInfo(`Favorites: ${favoriteIds.length} subscription(s)`);
    logDim(`Cache: ${formatCacheAge(cacheAge)}`);
    logBlank();

    const { action } = await inquirer.prompt<{
      action: "view" | "add" | "addById" | "remove" | "clear" | "import" | "export" | "refresh" | "back";
    }>([
      {
        type: "select",
        name: "action",
        message: chalk.cyan("Favorites Menu:"),
        choices: [
          { name: chalk.cyanBright("📋 View/Edit Favorites"), value: "view" },
          {
            name: chalk.green("➕ Add Favorites from Subscriptions"),
            value: "add",
          },
          {
            name: chalk.green("🔢 Add Favorite by Subscription ID"),
            value: "addById",
          },
          { name: chalk.yellow("➖ Remove Favorites"), value: "remove" },
          { name: chalk.red("🗑  Clear All Favorites"), value: "clear" },
          separator(),
          {
            name: chalk.blue("📥 Import Favorites from File"),
            value: "import",
          },
          { name: chalk.blue("📤 Export Favorites to File"), value: "export" },
          separator(),
          {
            name: chalk.magenta("🔄 Refresh Subscription Cache"),
            value: "refresh",
          },
          separator(),
          { name: chalk.dim("↩ Back to Main Menu"), value: "back" },
        ],
        pageSize: 15,
      },
    ]);

    if (action === "back") {
      return;
    }

    switch (action) {
      case "view": {
        if (favoriteIds.length === 0) {
          logWarning("No favorites yet. Add some subscriptions to favorites first.");
          break;
        }
        logBlank();
        logInfo("Current Favorites:");
        for (const id of favoriteIds) {
          const name = subscriptionNames.get(id) || "(name not cached)";
          console.log(`  ${chalk.yellow("★")} ${chalk.cyanBright(name)} ${chalk.dim(`(${id})`)}`);
        }
        logBlank();
        break;
      }

      case "add": {
        const subscriptions = await fetchSubscriptions(authContext.credential, authContext.userId);
        if (subscriptions.length === 0) {
          logWarning("No subscriptions available.");
          break;
        }

        const favoriteSet = new Set(favoriteIds.map((id) => id.toLowerCase()));
        const nonFavorites = subscriptions.filter((sub) => !favoriteSet.has(sub.subscriptionId.toLowerCase()));

        if (nonFavorites.length === 0) {
          logInfo("All subscriptions are already favorites!");
          break;
        }

        const { selectedIds } = await inquirer.prompt<{
          selectedIds: string[];
        }>([
          {
            type: "checkbox",
            name: "selectedIds",
            message: chalk.cyan("Select subscriptions to add to favorites:"),
            choices: nonFavorites
              .sort((a, b) => a.displayName.localeCompare(b.displayName))
              .map((sub) => ({
                name: formatSubscription(sub.displayName, sub.subscriptionId),
                value: sub.subscriptionId,
              })),
            pageSize: 15,
          },
        ]);

        if (selectedIds.length === 0) {
          logDim("No subscriptions selected.");
          break;
        }

        let updatedData = favoritesData;
        for (const id of selectedIds) {
          updatedData = addFavorite(updatedData, id);
        }
        await saveFavorites(favoritesLoaded.filePath, updatedData);
        logSuccess(`Added ${selectedIds.length} subscription(s) to favorites.`);
        break;
      }

      case "addById": {
        const { subscriptionId } = await inquirer.prompt<{
          subscriptionId: string;
        }>([
          {
            type: "input",
            name: "subscriptionId",
            message: chalk.cyan("Enter subscription ID:"),
            validate: (value) => {
              if (!value || !value.trim()) return chalk.red("Please enter a subscription ID.");
              return true;
            },
          },
        ]);

        const normalizedId = subscriptionId.trim();

        // Check if already a favorite
        if (isFavorite(favoritesData, normalizedId)) {
          logInfo("This subscription is already a favorite.");
          break;
        }

        // Validate against cache
        const validation = await validateSubscriptionId(authContext.userId, normalizedId);
        if (validation.valid && validation.subscription) {
          const updatedData = addFavorite(favoritesData, normalizedId);
          await saveFavorites(favoritesLoaded.filePath, updatedData);
          logSuccess(`Added "${validation.subscription.displayName}" to favorites.`);
        } else {
          logWarning("Subscription not found in cache. It may be invalid or inaccessible.");
          const { forceAdd } = await inquirer.prompt<{ forceAdd: boolean }>([
            {
              type: "confirm",
              name: "forceAdd",
              message: chalk.yellow("Add anyway?"),
              default: false,
            },
          ]);

          if (forceAdd) {
            const updatedData = addFavorite(favoritesData, normalizedId);
            await saveFavorites(favoritesLoaded.filePath, updatedData);
            logWarning(`Added invalidated subscription ID "${normalizedId}" to favorites.`);
          } else {
            logDim("Cancelled.");
          }
        }
        break;
      }

      case "remove": {
        if (favoriteIds.length === 0) {
          logWarning("No favorites to remove.");
          break;
        }

        const { selectedIds } = await inquirer.prompt<{
          selectedIds: string[];
        }>([
          {
            type: "checkbox",
            name: "selectedIds",
            message: chalk.cyan("Select favorites to remove:"),
            choices: favoriteIds.map((id) => {
              const name = subscriptionNames.get(id) || "(name not cached)";
              return {
                name: `${chalk.yellow("★")} ${chalk.cyanBright(name)} ${chalk.dim(`(${id})`)}`,
                value: id,
              };
            }),
            pageSize: 15,
          },
        ]);

        if (selectedIds.length === 0) {
          logDim("No favorites selected for removal.");
          break;
        }

        let updatedData = favoritesData;
        for (const id of selectedIds) {
          updatedData = removeFavorite(updatedData, id);
        }
        await saveFavorites(favoritesLoaded.filePath, updatedData);
        logSuccess(`Removed ${selectedIds.length} subscription(s) from favorites.`);
        break;
      }

      case "clear": {
        if (favoriteIds.length === 0) {
          logWarning("No favorites to clear.");
          break;
        }

        const { confirmClear } = await inquirer.prompt<{
          confirmClear: boolean;
        }>([
          {
            type: "confirm",
            name: "confirmClear",
            message: chalk.red(`Are you sure you want to clear all ${favoriteIds.length} favorite(s)?`),
            default: false,
          },
        ]);

        if (confirmClear) {
          const updatedData = clearFavorites(favoritesData);
          await saveFavorites(favoritesLoaded.filePath, updatedData);
          logSuccess("All favorites cleared.");
        } else {
          logDim("Cancelled.");
        }
        break;
      }

      case "import": {
        const { filePath } = await inquirer.prompt<{ filePath: string }>([
          {
            type: "input",
            name: "filePath",
            message: chalk.cyan("Path to import file:"),
            validate: (value) => {
              if (!value || !value.trim()) return chalk.red("Please enter a file path.");
              return true;
            },
          },
        ]);

        const { merge } = await inquirer.prompt<{ merge: boolean }>([
          {
            type: "confirm",
            name: "merge",
            message: chalk.cyan("Merge with existing favorites? (No = replace)"),
            default: true,
          },
        ]);

        try {
          const { data: importedData, result } = await importFavorites(favoritesData, filePath.trim(), merge);
          await saveFavorites(favoritesLoaded.filePath, importedData);
          logSuccess(`Imported ${result.imported} new favorite(s), ${result.skipped} already existed.`);
        } catch (err: any) {
          logError(`Import failed: ${err.message || err}`);
        }
        break;
      }

      case "export": {
        if (favoriteIds.length === 0) {
          logWarning("No favorites to export.");
          break;
        }

        const { filePath } = await inquirer.prompt<{ filePath: string }>([
          {
            type: "input",
            name: "filePath",
            message: chalk.cyan("Path to export file:"),
            default: "azpim-favorites.json",
            validate: (value) => {
              if (!value || !value.trim()) return chalk.red("Please enter a file path.");
              return true;
            },
          },
        ]);

        try {
          await exportFavorites(favoritesData, filePath.trim(), subscriptionNames);
          logSuccess(`Exported ${favoriteIds.length} favorite(s) to ${filePath.trim()}`);
        } catch (err: any) {
          logError(`Export failed: ${err.message || err}`);
        }
        break;
      }

      case "refresh": {
        logInfo("Invalidating subscription cache...");
        await invalidateCache(authContext.userId);
        logInfo("Fetching fresh subscription list...");
        await fetchSubscriptions(authContext.credential, authContext.userId, {
          forceRefresh: true,
        });
        logSuccess("Subscription cache refreshed.");
        break;
      }
    }
  }
};

export const showMainMenu = async (authContext: AuthContext): Promise<void> => {
  while (true) {
    showDivider();
    logBlank();
    const { action } = await inquirer.prompt<{
      action: "activate" | "deactivate" | "favorites" | "presets" | "exit";
    }>([
      {
        type: "select",
        name: "action",
        message: chalk.cyan.bold("What would you like to do?"),
        choices: [
          { name: chalk.green("▶ Activate Role(s)"), value: "activate" },
          { name: chalk.yellow("◼ Deactivate Role(s)"), value: "deactivate" },
          { name: chalk.yellow("★ Favorites..."), value: "favorites" },
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
      case "favorites":
        await runFavoritesManager(authContext);
        break;
      case "presets":
        await runPresetsManager(authContext);
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

    // Load favorites for subscription display
    const favoritesLoaded = await loadFavorites(authContext.userId);
    let favoritesData = favoritesLoaded.data;
    const favoriteIds = new Set(getFavoriteIds(favoritesData).map((id) => id.toLowerCase()));

    let subscriptions = await fetchSubscriptions(authContext.credential, authContext.userId);

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
      logBlank();
      const result = await selectSubscriptionWithSearch(subscriptions, favoriteIds);

      if (!result) {
        logDim("Returning to main menu...");
        return;
      }

      selectedSubscription = result;

      // Prompt to toggle favorite
      const isCurrentlyFavorite = isFavorite(favoritesData, selectedSubscription.subscriptionId);
      const { toggleFav } = await inquirer.prompt<{ toggleFav: boolean }>([
        {
          type: "confirm",
          name: "toggleFav",
          message: isCurrentlyFavorite
            ? chalk.yellow(`☆ Remove "${selectedSubscription.displayName}" from favorites?`)
            : chalk.yellow(`★ Add "${selectedSubscription.displayName}" to favorites?`),
          default: false,
        },
      ]);

      if (toggleFav) {
        const { data: updatedData, added } = toggleFavorite(favoritesData, selectedSubscription.subscriptionId);
        favoritesData = updatedData;
        await saveFavorites(favoritesLoaded.filePath, favoritesData);
        if (added) {
          logSuccess(`Added "${selectedSubscription.displayName}" to favorites.`);
        } else {
          logInfo(`Removed "${selectedSubscription.displayName}" from favorites.`);
        }
      }
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

    // Load favorites to prioritize scanning
    const favoritesLoaded = await loadFavorites(authContext.userId);
    const favoriteIds = new Set(getFavoriteIds(favoritesLoaded.data).map((id) => id.toLowerCase()));

    let subscriptions = await fetchSubscriptions(authContext.credential, authContext.userId);
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

    // Sort subscriptions: favorites first, then alphabetically
    subscriptions.sort((a, b) => {
      const aIsFav = favoriteIds.has(a.subscriptionId.toLowerCase());
      const bIsFav = favoriteIds.has(b.subscriptionId.toLowerCase());
      if (aIsFav !== bIsFav) return aIsFav ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    // Scan favorites first for faster results
    if (favoriteIds.size > 0) {
      logDim("Scanning favorite subscriptions first...");
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
