import chalk from "chalk";
import ora, { type Ora } from "ora";

// ===============================
// Spinner Management
// ===============================

let currentSpinner: Ora | null = null;

/**
 * Starts a new spinner with the given text.
 * If a spinner is already running, it will be stopped first.
 */
export const startSpinner = (text: string): Ora => {
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
  if (currentSpinner) {
    currentSpinner.text = chalk.cyan(text);
  }
};

/**
 * Stops the current spinner with a success message.
 */
export const succeedSpinner = (text?: string): void => {
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
  console.log(chalk.blue("ℹ"), chalk.blue(message));
};

/**
 * Logs a success message with a green checkmark.
 */
export const logSuccess = (message: string): void => {
  console.log(chalk.green("✔"), chalk.green(message));
};

/**
 * Logs an error message with a red cross.
 */
export const logError = (message: string): void => {
  console.log(chalk.red("✖"), chalk.red(message));
};

/**
 * Logs a warning message with a yellow warning icon.
 */
export const logWarning = (message: string): void => {
  console.log(chalk.yellow("⚠"), chalk.yellow(message));
};

/**
 * Logs a dimmed/secondary message.
 */
export const logDim = (message: string): void => {
  console.log(chalk.dim(message));
};

/**
 * Logs a blank line.
 */
export const logBlank = (): void => {
  console.log();
};

// ===============================
// UI Elements
// ===============================

/**
 * Displays the application header/banner.
 */
export const showHeader = (): void => {
  logBlank();
  console.log(chalk.cyan.bold("╔════════════════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("║") + chalk.white.bold("     Azure PIM CLI - Role Activation Manager        ") + chalk.cyan.bold("║"));
  console.log(chalk.cyan.bold("╚════════════════════════════════════════════════════╝"));
  logBlank();
};

/**
 * Displays a section divider.
 */
export const showDivider = (): void => {
  console.log(chalk.dim("─".repeat(54)));
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
  return `${chalk.white.bold(displayName)} ${chalk.dim(`(${subscriptionId})`)}`;
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
      return chalk.blue.bold(`ℹ ${status}`);
  }
};

/**
 * Displays a summary box for activation/deactivation results.
 */
export const showSummary = (title: string, items: { label: string; value: string }[]): void => {
  const boxWidth = 54;
  const titleWidth = Math.max(0, boxWidth - 4 - title.length);
  logBlank();
  console.log(chalk.cyan.bold(`┌─ ${title} ${"─".repeat(titleWidth)}`));
  items.forEach((item) => {
    console.log(chalk.cyan("│ ") + chalk.dim(`${item.label}: `) + chalk.white(item.value));
  });
  console.log(chalk.cyan.bold("└" + "─".repeat(boxWidth)));
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
