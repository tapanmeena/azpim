import boxen from "boxen";
import chalk from "chalk";
import Table from "cli-table3";
import figures from "figures";
import gradient from "gradient-string";
import ora, { type Ora } from "ora";
import { version } from "../../package.json";

// ===============================
// Icons (cross-platform via `figures`)
// ===============================

export const icons = {
  success: figures.tick,
  error: figures.cross,
  warning: figures.warning,
  info: figures.info,
  pointer: figures.play,
  stop: figures.squareSmallFilled,
  star: figures.star,
  starEmpty: figures.star, // ☆ not available in figures; use different styling
  back: figures.arrowLeft,
  exit: figures.cross,
  gear: figures.pointer, // ⚙ not in figures, use hamburger
  bullet: figures.bullet,
  add: figures.pointer,
  remove: figures.line,
  list: figures.hamburger,
  edit: figures.pointer,
  arrowDown: figures.arrowDown,
  arrowUp: figures.arrowUp,
  refresh: figures.radioOn,
  search: figures.pointer,
  key: figures.pointer,
  wave: "\u{1F44B}",
} as const;

type UiOptions = {
  quiet: boolean;
  debug: boolean;
};

let uiOptions: UiOptions = {
  quiet: false,
  debug: false,
};

export const configureUi = (options: Partial<UiOptions>): void => {
  uiOptions = { ...uiOptions, ...options };
};

export const isQuietMode = (): boolean => uiOptions.quiet;

export const isDebugMode = (): boolean => uiOptions.debug;

// ===============================
// Spinner Management
// ===============================

let currentSpinner: Ora | null = null;

/**
 * Starts a new spinner with the given text.
 * If a spinner is already running, it will be stopped first.
 */
export const startSpinner = (text: string): Ora => {
  if (isQuietMode()) {
    currentSpinner = ora({ isEnabled: false, text: "" });
    return currentSpinner;
  }
  if (currentSpinner) {
    currentSpinner.stop();
  }
  currentSpinner = ora({
    text: chalk.cyan(text),
    color: "cyan",
  }).start();
  return currentSpinner;
};

/**
 * Updates the text of the current spinner.
 */
export const updateSpinner = (text: string): void => {
  if (isQuietMode()) return;
  if (currentSpinner) {
    currentSpinner.text = chalk.cyan(text);
  }
};

/**
 * Stops the current spinner with a success message.
 */
export const succeedSpinner = (text?: string): void => {
  if (isQuietMode()) {
    currentSpinner = null;
    return;
  }
  if (currentSpinner) {
    if (text) {
      currentSpinner.succeed(chalk.green(text));
    } else {
      currentSpinner.succeed();
    }
    currentSpinner = null;
  }
};

/**
 * Stops the current spinner with a failure message.
 */
export const failSpinner = (text?: string): void => {
  if (isQuietMode()) {
    currentSpinner = null;
    return;
  }
  if (currentSpinner) {
    if (text) {
      currentSpinner.fail(chalk.red(text));
    } else {
      currentSpinner.fail();
    }
    currentSpinner = null;
  }
};

/**
 * Stops the current spinner with a warning message.
 */
export const warnSpinner = (text?: string): void => {
  if (isQuietMode()) {
    currentSpinner = null;
    return;
  }
  if (currentSpinner) {
    if (text) {
      currentSpinner.warn(chalk.yellow(text));
    } else {
      currentSpinner.warn();
    }
    currentSpinner = null;
  }
};

/**
 * Stops the current spinner with an info message.
 */
export const infoSpinner = (text?: string): void => {
  if (isQuietMode()) {
    currentSpinner = null;
    return;
  }
  if (currentSpinner) {
    if (text) {
      currentSpinner.info(chalk.blue(text));
    } else {
      currentSpinner.info();
    }
    currentSpinner = null;
  }
};

/**
 * Stops the current spinner without persisting any text.
 */
export const stopSpinner = (): void => {
  if (isQuietMode()) {
    currentSpinner = null;
    return;
  }
  if (currentSpinner) {
    currentSpinner.stop();
    currentSpinner = null;
  }
};

// ===============================
// Console Log Helpers
// ===============================

/**
 * Logs an info message with a blue info icon.
 */
export const logInfo = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.blue(icons.info), chalk.blue(message));
};

/**
 * Logs a success message with a green checkmark.
 */
export const logSuccess = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.green(icons.success), chalk.green(message));
};

/**
 * Logs an error message with a red cross.
 */
export const logError = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.red(icons.error), chalk.red(message));
};

/**
 * Logs a warning message with a yellow warning icon.
 */
export const logWarning = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.yellow(icons.warning), chalk.yellow(message));
};

/**
 * Logs a dimmed/secondary message.
 */
export const logDim = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.dim(message));
};

/**
 * Outputs debug logging message (only when debug mode is enabled).
 * Debug mode overrides quiet mode.
 */
export const logDebug = (message: string, data?: unknown): void => {
  if (!isDebugMode()) return;
  const prefix = chalk.magenta("[DEBUG]");
  console.log(prefix, chalk.dim(message));
  if (data !== undefined) {
    console.log(chalk.dim(JSON.stringify(data, null, 2)));
  }
};

/**
 * Logs a blank line.
 */
export const logBlank = (): void => {
  if (isQuietMode()) return;
  console.log();
};

// ===============================
// UI Elements
// ===============================

// Gradient presets
const headerGradient = gradient(["#3b82f6", "#06b6d4", "#8b5cf6"]);
const dividerGradient = gradient(["#3b82f6", "#06b6d4", "#3b82f6"]);

/**
 * Displays the application header/banner with gradient styling.
 */
export const showHeader = (): void => {
  if (isQuietMode()) return;

  const asciiArt = [
    " █████╗ ███████╗██████╗ ██╗███╗   ███╗",
    "██╔══██╗╚══███╔╝██╔══██╗██║████╗ ████║",
    "███████║  ███╔╝ ██████╔╝██║██╔████╔██║",
    "██╔══██║ ███╔╝  ██╔═══╝ ██║██║╚██╔╝██║",
    "██║  ██║███████╗██║     ██║██║ ╚═╝ ██║",
    "╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚═╝     ╚═╝",
  ].join("\n");

  const tagline = chalk.dim(`v${version} ${icons.bullet} Activate & manage your Azure roles`);
  const content = headerGradient.multiline(asciiArt) + "\n" + tagline;

  logBlank();
  console.log(
    boxen(content, {
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      margin: { top: 0, bottom: 0, left: 1, right: 0 },
      borderStyle: "round",
      borderColor: "cyan",
      textAlignment: "center",
    }),
  );
  logBlank();
};

/**
 * Displays a section divider with gradient styling.
 */
export const showDivider = (): void => {
  if (isQuietMode()) return;
  const width = 54;
  console.log("  " + dividerGradient("─".repeat(width)));
};

/**
 * Formats a role display string.
 */
export const formatRole = (roleName: string, scopeDisplayName: string): string => {
  return `${chalk.white.bold(roleName)} ${chalk.dim("@")} ${chalk.cyan(scopeDisplayName)}`;
};

/**
 * Formats an active role display string with additional metadata.
 */
export const formatActiveRole = (roleName: string, scopeDisplayName: string, subscriptionName: string, startDateTime: string): string => {
  const startDate = new Date(startDateTime).toLocaleString();
  return `${chalk.white.bold(roleName)} ${chalk.dim("@")} ${chalk.cyan(scopeDisplayName)} ${chalk.dim(`(${subscriptionName})`)} ${chalk.dim(
    `[Started: ${startDate}]`,
  )}`;
};

/**
 * Formats a subscription display string.
 */
export const formatSubscription = (displayName: string, subscriptionId: string): string => {
  return `${chalk.cyanBright.bold(displayName)} ${chalk.dim(`(${subscriptionId})`)}`;
};

/**
 * Formats a favorite subscription display string with a star icon.
 */
export const formatFavoriteSubscription = (displayName: string, subscriptionId: string): string => {
  return `${chalk.yellow("★")} ${chalk.cyanBright.bold(displayName)} ${chalk.dim(`(${subscriptionId})`)}`;
};

/**
 * Formats a non-favorite subscription with spacing to align with favorites.
 */
export const formatNonFavoriteSubscription = (displayName: string, subscriptionId: string): string => {
  return `  ${chalk.cyanBright.bold(displayName)} ${chalk.dim(`(${subscriptionId})`)}`;
};

/**
 * Creates a separator label for subscription groups.
 */
export const createSubscriptionSeparator = (label: string): string => {
  return chalk.dim(`── ${label} ──`);
};

/**
 * Formats a status display string based on status type.
 */
export const formatStatus = (status: string): string => {
  switch (status.toLowerCase()) {
    case "approved":
    case "provisioned":
    case "activated":
      return chalk.green.bold(`${icons.success} ${status}`);
    case "denied":
    case "failed":
      return chalk.red.bold(`${icons.error} ${status}`);
    case "pendingapproval":
    case "pending":
      return chalk.yellow.bold(`${figures.circleDotted} ${status}`);
    default:
      return chalk.cyanBright.bold(`${icons.info} ${status}`);
  }
};

/**
 * Displays a summary box for activation/deactivation results.
 */
export const showSummary = (title: string, items: { label: string; value: string }[]): void => {
  if (isQuietMode()) return;
  const boxWidth = 54;
  const margin = "  ";
  const titleWidth = Math.max(0, boxWidth - 4 - title.length);

  // Gradient-style top border
  const topLeft = chalk.blueBright("┌─");
  const topTitle = chalk.cyanBright.bold(` ${title} `);
  const topRight = chalk.cyan("─".repeat(titleWidth - 2)) + chalk.blueBright("─".repeat(2));

  logBlank();
  console.log(margin + topLeft + topTitle + topRight);
  items.forEach((item) => {
    console.log(margin + chalk.blueBright("│") + chalk.cyan(" ") + chalk.dim(`${item.label}: `) + chalk.white(item.value));
  });
  // Gradient-style bottom border
  const bottomBorder = chalk.blueBright("└" + "─".repeat(2)) + chalk.cyan("─".repeat(boxWidth - 4)) + chalk.blueBright("─".repeat(2));
  console.log(margin + bottomBorder);
  logBlank();
};

/**
 * Displays user information in a stylish card format.
 */
export const showUserInfo = (displayName: string, email: string): void => {
  if (isQuietMode()) return;

  const content = [`${chalk.dim("Name:")}  ${chalk.white.bold(displayName)}`, `${chalk.dim("Email:")} ${chalk.cyan(email)}`].join("\n");

  logBlank();
  console.log(
    boxen(content, {
      title: chalk.cyanBright.bold("Authenticated User"),
      titleAlignment: "center",
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { top: 0, bottom: 0, left: 1, right: 0 },
      borderStyle: "round",
      borderColor: "blueBright",
    }),
  );
  logBlank();
};

// ===============================
// Async Operation Wrapper
// ===============================

/**
 * Wraps an async operation with a spinner.
 * Shows spinner while operation is in progress, then shows success/failure.
 */
export const withSpinner = async <T>(text: string, operation: () => Promise<T>, successText?: string, failText?: string): Promise<T> => {
  startSpinner(text);
  try {
    const result = await operation();
    if (successText) {
      succeedSpinner(successText);
    } else {
      succeedSpinner();
    }
    return result;
  } catch (error) {
    if (failText) {
      failSpinner(failText);
    } else {
      failSpinner();
    }
    throw error;
  }
};

/**
 * Displays a success/fail summary for batch operations.
 * Replaces the identical 3-branch if/else pattern used across activation and deactivation flows.
 */
export const displayResultsSummary = (successCount: number, failCount: number, actionVerb: string): void => {
  const pastTense = actionVerb;
  if (successCount > 0 && failCount === 0) {
    logSuccess(`All ${successCount} role(s) ${pastTense} successfully!`);
  } else if (successCount > 0 && failCount > 0) {
    logWarning(`${successCount} role(s) ${pastTense}, ${failCount} failed.`);
  } else {
    logError(`All ${failCount} role ${actionVerb.replace(/d$/, "")}(s) failed.`);
  }
};

// ===============================
// Table Helpers
// ===============================

/**
 * Displays a table of presets.
 */
export const displayPresetsTable = (
  presets: Array<{
    name: string;
    description?: string;
    commands: string;
    isDefault: boolean;
  }>,
): void => {
  if (isQuietMode()) return;
  const table = new Table({
    head: [chalk.cyan.bold("Name"), chalk.cyan.bold("Description"), chalk.cyan.bold("Commands"), chalk.cyan.bold("Default")],
    style: { head: [], border: ["dim"] },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });

  for (const preset of presets) {
    table.push([
      chalk.white.bold(preset.name),
      chalk.dim(preset.description || "—"),
      chalk.cyan(preset.commands),
      preset.isDefault ? chalk.green.bold(icons.success) : chalk.dim("—"),
    ]);
  }

  console.log(table.toString());
};

/**
 * Displays a table of favorite subscriptions.
 */
export const displayFavoritesTable = (favorites: Array<{ name: string; subscriptionId: string }>): void => {
  if (isQuietMode()) return;
  const table = new Table({
    head: ["", chalk.cyan.bold("Subscription Name"), chalk.cyan.bold("Subscription ID")],
    style: { head: [], border: ["dim"] },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });

  for (const fav of favorites) {
    table.push([chalk.yellow(icons.star), chalk.cyanBright.bold(fav.name), chalk.dim(fav.subscriptionId)]);
  }

  console.log(table.toString());
};
