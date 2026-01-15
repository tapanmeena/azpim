import chalk from "chalk";
import ora, { type Ora } from "ora";
import { version } from "../package.json";

type UiOptions = {
  quiet: boolean;
};

let uiOptions: UiOptions = {
  quiet: false,
};

export const configureUi = (options: Partial<UiOptions>): void => {
  uiOptions = { ...uiOptions, ...options };
};

export const isQuietMode = (): boolean => uiOptions.quiet;

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
  console.log(chalk.blue("ℹ"), chalk.blue(message));
};

/**
 * Logs a success message with a green checkmark.
 */
export const logSuccess = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.green("✔"), chalk.green(message));
};

/**
 * Logs an error message with a red cross.
 */
export const logError = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.red("✖"), chalk.red(message));
};

/**
 * Logs a warning message with a yellow warning icon.
 */
export const logWarning = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.yellow("⚠"), chalk.yellow(message));
};

/**
 * Logs a dimmed/secondary message.
 */
export const logDim = (message: string): void => {
  if (isQuietMode()) return;
  console.log(chalk.dim(message));
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

/**
 * Displays the application header/banner with gradient styling.
 */
export const showHeader = (): void => {
  if (isQuietMode()) return;

  const width = 54;
  const margin = "  ";

  // Gradient line using transitioning block characters
  const gradientTop = margin + chalk.blueBright("▄".repeat(4)) + chalk.cyan("▄".repeat(width - 8)) + chalk.blueBright("▄".repeat(4));
  const gradientBottom = margin + chalk.blueBright("▀".repeat(4)) + chalk.cyan("▀".repeat(width - 8)) + chalk.blueBright("▀".repeat(4));

  // ASCII art style title
  const asciiArt = [
    "     █████╗ ███████╗██████╗        ██████╗██╗     ██╗",
    "    ██╔══██╗╚══███╔╝██╔══██╗      ██╔════╝██║     ██║",
    "    ███████║  ███╔╝ ██████╔╝█████╗██║     ██║     ██║",
    "    ██╔══██║ ███╔╝  ██╔═══╝ ╚════╝██║     ██║     ██║",
    "    ██║  ██║███████╗██║           ╚██████╗███████╗██║",
    "    ╚═╝  ╚═╝╚══════╝╚═╝            ╚═════╝╚══════╝╚═╝",
  ];

  const tagline = `v${version} • Activate & manage your Azure roles`;
  const centeredTagline = margin + tagline.padStart(Math.floor((width + tagline.length) / 2)).padEnd(width);

  logBlank();
  console.log(gradientTop);
  logBlank();

  for (const line of asciiArt) {
    console.log(chalk.bold.cyanBright(margin + line));
  }

  logBlank();
  console.log(chalk.dim(centeredTagline));
  logBlank();
  console.log(gradientBottom);
  logBlank();
};

/**
 * Displays a section divider
 */
export const showDivider = (): void => {
  if (isQuietMode()) return;
  const width = 54;
  const divider = chalk.blueBright("─".repeat(4)) + chalk.cyan("─".repeat(width - 8)) + chalk.blueBright("─".repeat(4));
  console.log("  " + divider);
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
    `[Started: ${startDate}]`
  )}`;
};

/**
 * Formats a subscription display string.
 */
export const formatSubscription = (displayName: string, subscriptionId: string): string => {
  return `${chalk.cyanBright.bold(displayName)} ${chalk.dim(`(${subscriptionId})`)}`;
};

/**
 * Formats a status display string based on status type.
 */
export const formatStatus = (status: string): string => {
  switch (status.toLowerCase()) {
    case "approved":
    case "provisioned":
    case "activated":
      return chalk.green.bold(`✔ ${status}`);
    case "denied":
    case "failed":
      return chalk.red.bold(`✖ ${status}`);
    case "pendingapproval":
    case "pending":
      return chalk.yellow.bold(`⏳ ${status}`);
    default:
      return chalk.cyanBright.bold(`ℹ ${status}`);
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

  const width = 54;
  const margin = "  ";
  const innerWidth = width - 2; // Account for left and right borders

  // Gradient borders
  const topBorder = chalk.blueBright("╭" + "─".repeat(2)) + chalk.cyan("─".repeat(width - 6)) + chalk.blueBright("─".repeat(2) + "╮");
  const bottomBorder = chalk.blueBright("╰" + "─".repeat(2)) + chalk.cyan("─".repeat(width - 6)) + chalk.blueBright("─".repeat(2) + "╯");

  // Fixed-width content lines (no emoji - they have inconsistent widths)
  const titleText = "Authenticated User";
  const titlePadding = innerWidth - titleText.length - 3; // 3 for " ● "
  const titleLine = ` ${chalk.cyanBright("●")} ${chalk.cyanBright.bold(titleText)}${" ".repeat(titlePadding)}`;

  const nameLabel = "Name:  ";
  const namePadding = innerWidth - 5 - nameLabel.length - displayName.length; // 5 for "   • "
  const nameLine = `   ${chalk.blueBright("•")} ${chalk.dim(nameLabel)}${chalk.white.bold(displayName)}${" ".repeat(Math.max(0, namePadding))}`;

  const emailLabel = "Email: ";
  const emailPadding = innerWidth - 5 - emailLabel.length - email.length; // 5 for "   • "
  const emailLine = `   ${chalk.blueBright("•")} ${chalk.dim(emailLabel)}${chalk.cyan(email)}${" ".repeat(Math.max(0, emailPadding))}`;

  const separatorLine = chalk.dim("─".repeat(innerWidth));

  logBlank();
  console.log(margin + topBorder);
  console.log(margin + chalk.blueBright("│") + titleLine + chalk.blueBright("│"));
  console.log(margin + chalk.blueBright("│") + separatorLine + chalk.blueBright("│"));
  console.log(margin + chalk.blueBright("│") + nameLine + chalk.blueBright("│"));
  console.log(margin + chalk.blueBright("│") + emailLine + chalk.blueBright("│"));
  console.log(margin + bottomBorder);
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
