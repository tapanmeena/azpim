import chalk from "chalk";
import inquirer from "inquirer";
import type { AuthContext } from "../azure/auth";
import { DURATION_MAX_HOURS, DURATION_MIN_HOURS } from "../core/constants";
import { icons, logBlank, logDim, showDivider } from "../core/ui";
import { handleActivation } from "./activate-flow";
import { handleDeactivation } from "./deactivate-flow";
import { runFavoritesManager } from "./favorites-manager";
import { runPresetsManager } from "./presets-cli";

// Re-export types and functions that index.ts depends on
export { activateOnce, handleActivation, type ActivateOnceOptions, type ActivateOnceResult } from "./activate-flow";
export { deactivateOnce, handleDeactivation, type DeactivateOnceOptions, type DeactivateOnceResult } from "./deactivate-flow";
export { runFavoritesManager } from "./favorites-manager";
export type { SubscriptionSelectResult } from "./subscription-selector";

// ===============================
// Shared Helpers
// ===============================

export const normalizeRoleName = (value: string): string => value.trim().toLowerCase();

export const validateDurationHours = (value: number): void => {
  if (!Number.isFinite(value) || value < DURATION_MIN_HOURS || value > DURATION_MAX_HOURS) {
    throw new Error(`Invalid --duration-hours. Expected a number between ${DURATION_MIN_HOURS} and ${DURATION_MAX_HOURS}.`);
  }
};

export const promptBackToMainMenuOrExit = async (message: string): Promise<void> => {
  logBlank();
  const { next } = await inquirer.prompt<{ next: "back" | "exit" }>([
    {
      type: "select",
      name: "next",
      message: chalk.yellow(message),
      choices: [
        { name: chalk.cyan(`${icons.back} Back to Main Menu`), value: "back" },
        { name: chalk.red(`${icons.exit} Exit`), value: "exit" },
      ],
      default: "back",
    },
  ]);

  if (next === "exit") {
    logBlank();
    logDim(`Goodbye! ${icons.wave}`);
    process.exit(0);
  }
};

// ===============================
// Main Menu
// ===============================

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
          {
            name: chalk.green(`${icons.pointer} Activate Role(s)`),
            value: "activate",
          },
          {
            name: chalk.yellow(`${icons.stop} Deactivate Role(s)`),
            value: "deactivate",
          },
          {
            name: chalk.yellow(`${icons.star} Favorites...`),
            value: "favorites",
          },
          { name: chalk.magenta(`${icons.gear} Presets...`), value: "presets" },
          { name: chalk.red(`${icons.exit} Exit`), value: "exit" },
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
        logDim(`Goodbye! ${icons.wave}`);
        logBlank();
        return;
    }
  }
};
