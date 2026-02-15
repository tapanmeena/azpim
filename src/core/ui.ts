import { ActivatePresetOptions, DeactivatePresetOptions } from "@/data/presets";
import chalk from "chalk";
import figures from "figures";
import gradient from "gradient-string";
import ora, { type Ora } from "ora";
import { version } from "../../package.json";

// ===============================
// Box Drawing Helper (replaces boxen)
// ===============================

const drawBox = (
  content: string,
  options: {
    padding?: { top?: number; bottom?: number; left?: number; right?: number };
    margin?: { left?: number };
    borderColor?: (s: string) => string;
    title?: string;
    centerText?: boolean;
  } = {},
): string => {
  const pad = { top: 0, bottom: 0, left: 1, right: 1, ...options.padding };
  const marginLeft = " ".repeat(options.margin?.left ?? 0);
  const colorize = options.borderColor ?? ((s: string) => s);

  const lines = content.split("\n");
  // Strip ANSI for width calculation
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const contentWidth = Math.max(...lines.map((l) => stripAnsi(l).length)) + pad.left + pad.right;

  const padLeft = " ".repeat(pad.left);
  const padRight = " ".repeat(pad.right);
  const emptyLine = " ".repeat(contentWidth);

  const result: string[] = [];

  // Top border
  if (options.title) {
    const titleStr = ` ${options.title} `;
    const titleLen = stripAnsi(titleStr).length;
    const remaining = contentWidth - titleLen;
    const leftDash = Math.floor(remaining / 2);
    const rightDash = remaining - leftDash;
    result.push(marginLeft + colorize("╭" + "─".repeat(leftDash)) + titleStr + colorize("─".repeat(rightDash) + "╮"));
  } else {
    result.push(marginLeft + colorize("╭" + "─".repeat(contentWidth) + "╮"));
  }

  // Top padding
  for (let i = 0; i < pad.top; i++) {
    result.push(marginLeft + colorize("│") + emptyLine + colorize("│"));
  }

  // Content lines
  for (const line of lines) {
    const visibleLen = stripAnsi(line).length;
    const totalPad = contentWidth - pad.left - pad.right - visibleLen;
    if (options.centerText) {
      const leftPad = Math.floor(totalPad / 2);
      const rightPad = totalPad - leftPad;
      result.push(marginLeft + colorize("│") + padLeft + " ".repeat(leftPad) + line + " ".repeat(rightPad) + padRight + colorize("│"));
    } else {
      result.push(marginLeft + colorize("│") + padLeft + line + " ".repeat(Math.max(0, totalPad)) + padRight + colorize("│"));
    }
  }

  // Bottom padding
  for (let i = 0; i < pad.bottom; i++) {
    result.push(marginLeft + colorize("│") + emptyLine + colorize("│"));
  }

  // Bottom border
  result.push(marginLeft + colorize("╰" + "─".repeat(contentWidth) + "╯"));

  return result.join("\n");
};

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
    drawBox(content, {
      padding: { top: 1, bottom: 1, left: 6, right: 6 },
      margin: { left: 1 },
      borderColor: chalk.cyan,
      centerText: true,
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

  const headers = [chalk.cyan.bold(title), chalk.cyan.bold("Value")];
  const rows = items.map((item) => [chalk.dim(item.label), chalk.white(item.value)]);

  logBlank();
  console.log(drawTable(headers, rows));
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
    drawBox(content, {
      title: chalk.cyanBright.bold("Authenticated User"),
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      margin: { left: 1 },
      borderColor: chalk.blueBright,
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

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const drawTable = (headers: string[], rows: string[][]): string => {
  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const headerLen = stripAnsi(h).length;
    const maxDataLen = rows.reduce((max, row) => Math.max(max, stripAnsi(row[i] ?? "").length), 0);
    return Math.max(headerLen, maxDataLen) + 2; // 1 space padding each side
  });

  const drawLine = (left: string, mid: string, right: string, fill: string): string =>
    chalk.dim(left + colWidths.map((w) => fill.repeat(w)).join(mid) + right);

  const drawRow = (cells: string[]): string =>
    chalk.dim("│") +
    cells
      .map((cell, i) => {
        const visible = stripAnsi(cell).length;
        const pad = (colWidths[i] ?? 0) - visible - 1;
        return " " + cell + " ".repeat(Math.max(0, pad));
      })
      .join(chalk.dim("│")) +
    chalk.dim("│");

  const lines: string[] = [];
  lines.push(drawLine("╭", "┬", "╮", "─"));
  lines.push(drawRow(headers));
  lines.push(drawLine("├", "┼", "┤", "─"));
  for (const row of rows) {
    lines.push(drawRow(row));
  }
  lines.push(drawLine("╰", "┴", "╯", "─"));
  return lines.join("\n");
};

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

  const headers = [chalk.cyan.bold("Name"), chalk.cyan.bold("Description"), chalk.cyan.bold("Commands"), chalk.cyan.bold("Default")];

  const rows = presets.map((preset) => [
    chalk.white.bold(preset.name),
    chalk.dim(preset.description || "—"),
    chalk.cyan(preset.commands),
    preset.isDefault ? chalk.green.bold(icons.success) : chalk.dim("—"),
  ]);

  console.log(drawTable(headers, rows));
};

/**
 * Displays a table of favorite subscriptions.
 */
export const displayFavoritesTable = (favorites: Array<{ name: string; subscriptionId: string }>): void => {
  if (isQuietMode()) return;

  const headers = ["", chalk.cyan.bold("Subscription Name"), chalk.cyan.bold("Subscription ID")];

  const rows = favorites.map((fav) => [chalk.yellow(icons.star), chalk.cyanBright.bold(fav.name), chalk.dim(fav.subscriptionId)]);

  console.log(drawTable(headers, rows));
};

/**
 * Display a detailed table for a single preset's configuration.
 */
export const displayPresetDetailTable = (entry: { activate?: ActivatePresetOptions; deactivate?: DeactivatePresetOptions }): void => {
  if (isQuietMode()) return;

  const headers = [chalk.cyan.bold("Command"), chalk.cyan.bold("Setting"), chalk.cyan.bold("Value")];
  const rows: string[][] = [];
  const unset = chalk.dim("(unset)");

  if (entry.activate) {
    const act = entry.activate;
    rows.push([chalk.green.bold("activate"), chalk.dim("subscriptionId"), chalk.white(act.subscriptionId || unset)]);
    rows.push(["", chalk.dim("roleNames"), act.roleNames ? chalk.white(act.roleNames.join(", ")) : unset]);
    rows.push(["", chalk.dim("durationHours"), act.durationHours ? chalk.white(act.durationHours.toString()) : unset]);
    rows.push(["", chalk.dim("justification"), chalk.white(act.justification || unset)]);
    rows.push(["", chalk.dim("allowMultiple"), chalk.white(act.allowMultiple ? "Yes" : "No")]);
  }

  if (entry.deactivate) {
    const deact = entry.deactivate;
    if (rows.length > 0) {
      // Add a visual separator row
      rows.push(["", "", ""]);
    }
    rows.push([chalk.red.bold("deactivate"), chalk.dim("subscriptionId"), chalk.white(deact.subscriptionId || unset)]);
    rows.push(["", chalk.dim("roleNames"), deact.roleNames ? chalk.white(deact.roleNames.join(", ")) : unset]);
    rows.push(["", chalk.dim("justification"), chalk.white(deact.justification || unset)]);
    rows.push(["", chalk.dim("allowMultiple"), chalk.white(deact.allowMultiple ? "Yes" : "No")]);
  }

  if (rows.length === 0) {
    logDim("No configuration set for this preset.");
    return;
  }

  console.log(drawTable(headers, rows));
};
