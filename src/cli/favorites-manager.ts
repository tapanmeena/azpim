import chalk from "chalk";
import inquirer from "inquirer";
import type { AuthContext } from "../azure/auth";
import { fetchSubscriptions } from "../azure/azure-pim";
import { extractErrorMessage } from "../core/errors";
import { displayFavoritesTable, formatSubscription, icons, logBlank, logDim, logError, logInfo, logSuccess, logWarning } from "../core/ui";
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
} from "../data/favorites";
import { formatCacheAge, getCacheAge, getSubscriptionNameMap, invalidateCache, validateSubscriptionId } from "../data/subscription-cache";

// Separator type for Inquirer choices
type SeparatorChoice = { type: "separator"; separator?: string };
const separator = (label?: string): SeparatorChoice => ({
  type: "separator",
  separator: label ?? "",
});

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
          {
            name: chalk.cyanBright(`${icons.list} View/Edit Favorites`),
            value: "view",
          },
          {
            name: chalk.green(`${icons.add} Add Favorites from Subscriptions`),
            value: "add",
          },
          {
            name: chalk.green(`${icons.key} Add Favorite by Subscription ID`),
            value: "addById",
          },
          {
            name: chalk.yellow(`${icons.remove} Remove Favorites`),
            value: "remove",
          },
          {
            name: chalk.red(`${icons.error} Clear All Favorites`),
            value: "clear",
          },
          separator(),
          {
            name: chalk.blue(`${icons.arrowDown} Import Favorites from File`),
            value: "import",
          },
          {
            name: chalk.blue(`${icons.arrowUp} Export Favorites to File`),
            value: "export",
          },
          separator(),
          {
            name: chalk.magenta(`${icons.refresh} Refresh Subscription Cache`),
            value: "refresh",
          },
          separator(),
          { name: chalk.dim(`${icons.back} Back to Main Menu`), value: "back" },
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
        displayFavoritesTable(
          favoriteIds.map((id) => ({
            name: subscriptionNames.get(id) || "(name not cached)",
            subscriptionId: id,
          })),
        );
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

        if (isFavorite(favoritesData, normalizedId)) {
          logInfo("This subscription is already a favorite.");
          break;
        }

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
                name: `${chalk.yellow(icons.star)} ${chalk.cyanBright(name)} ${chalk.dim(`(${id})`)}`,
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
        } catch (err: unknown) {
          logError(`Import failed: ${extractErrorMessage(err)}`);
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
        } catch (err: unknown) {
          logError(`Export failed: ${extractErrorMessage(err)}`);
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
