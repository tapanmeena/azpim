import chalk from "chalk";
import inquirer from "inquirer";
import type { AuthContext } from "../azure/auth";
import type { AzureSubscription } from "../azure/azure-pim";
import { fetchSubscriptions } from "../azure/azure-pim";
import { SENTINEL_BACK } from "../core/constants";
import {
  createSubscriptionSeparator,
  formatFavoriteSubscription,
  formatNonFavoriteSubscription,
  formatSubscription,
  icons,
  logDim,
  logInfo,
  logSuccess,
  logWarning,
} from "../core/ui";
import { getFavoriteIds, isFavorite, loadFavorites, saveFavorites, toggleFavorite } from "../data/favorites";

// ===============================
// Types
// ===============================

const BACK_VALUE = SENTINEL_BACK;

export type SubscriptionSelectResult = {
  subscriptionId: string;
  displayName: string;
} | null;

type SeparatorChoice = { type: "separator"; separator?: string };
type ChoiceItem = { name: string; value: string } | SeparatorChoice;

const separator = (label?: string): SeparatorChoice => ({
  type: "separator",
  separator: label ?? "",
});

// ===============================
// Subscription Choices Builder
// ===============================

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
  choices.push({
    name: chalk.dim(`${icons.back} Back to Main Menu`),
    value: BACK_VALUE,
  });

  return choices;
};

// ===============================
// Subscription Search/Select
// ===============================

export const selectSubscriptionWithSearch = async (
  subscriptions: AzureSubscription[],
  favoriteIds: Set<string>,
): Promise<SubscriptionSelectResult> => {
  const choices = buildSubscriptionChoices(subscriptions, favoriteIds);

  try {
    const searchModule = await import("@inquirer/search");
    const search = searchModule.default;

    const searchableItems = subscriptions.map((sub) => {
      const isFav = favoriteIds.has(sub.subscriptionId.toLowerCase());
      return {
        name: isFav ? formatFavoriteSubscription(sub.displayName, sub.subscriptionId) : formatSubscription(sub.displayName, sub.subscriptionId),
        value: sub.subscriptionId,
        displayName: sub.displayName,
        isFavorite: isFav,
      };
    });

    searchableItems.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    searchableItems.push({
      name: chalk.dim(`${icons.back} Back to Main Menu`),
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

// ===============================
// Interactive Subscription Selection (shared by activate/deactivate flows)
// ===============================

export type InteractiveSubscriptionResult = {
  selectedSubscription: { subscriptionId: string; displayName: string };
} | null;

/**
 * Shared interactive subscription selection flow used by both activation and deactivation.
 * Handles: fetch subscriptions, empty state (manual ID entry), search+select, favorites toggle.
 * Returns null if user chose "Back to Main Menu".
 */
export const selectSubscriptionInteractive = async (authContext: AuthContext): Promise<InteractiveSubscriptionResult> => {
  const favoritesLoaded = await loadFavorites(authContext.userId);
  let favoritesData = favoritesLoaded.data;
  const favoriteIds = new Set(getFavoriteIds(favoritesData).map((id) => id.toLowerCase()));

  const subscriptions = await fetchSubscriptions(authContext.credential, authContext.userId);

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
          {
            name: chalk.cyan(`${icons.back} Back to Main Menu`),
            value: "back",
          },
          { name: chalk.red(`${icons.exit} Exit`), value: "exit" },
        ],
        default: "enter",
      },
    ]);

    if (action === "back") {
      return null;
    } else if (action === "exit") {
      logDim(`Goodbye! ${icons.wave}`);
      process.exit(0);
    }

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

    return {
      selectedSubscription: {
        subscriptionId: manualId.trim(),
        displayName: manualId.trim(),
      },
    };
  }

  const result = await selectSubscriptionWithSearch(subscriptions, favoriteIds);

  if (!result) {
    logDim("Returning to main menu...");
    return null;
  }

  // Prompt to toggle favorite
  const isCurrentlyFavorite = isFavorite(favoritesData, result.subscriptionId);
  const { toggleFav } = await inquirer.prompt<{ toggleFav: boolean }>([
    {
      type: "confirm",
      name: "toggleFav",
      message: isCurrentlyFavorite
        ? chalk.yellow(`${icons.star} Remove "${result.displayName}" from favorites?`)
        : chalk.yellow(`${icons.star} Add "${result.displayName}" to favorites?`),
      default: false,
    },
  ]);

  if (toggleFav) {
    const { data: updatedData, added } = toggleFavorite(favoritesData, result.subscriptionId);
    favoritesData = updatedData;
    await saveFavorites(favoritesLoaded.filePath, favoritesData);
    if (added) {
      logSuccess(`Added "${result.displayName}" to favorites.`);
    } else {
      logInfo(`Removed "${result.displayName}" from favorites.`);
    }
  }

  return { selectedSubscription: result };
};
