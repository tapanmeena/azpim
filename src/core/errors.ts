import { logBlank, logDim, logError } from "./ui";

/**
 * Extracts a human-readable message from any thrown value.
 * Consolidates 6+ inconsistent patterns into one canonical implementation.
 */
export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
};

/**
 * Checks whether an error message indicates an Azure authentication issue.
 */
export const isAuthError = (message: string): boolean => {
  return message.includes("AADSTS") || message.includes("Azure CLI not found") || message.includes("AzureCliCredential");
};

/**
 * Displays contextual hints for authentication errors.
 */
export const showAuthHints = (message: string): void => {
  if (message.includes("AADSTS")) {
    logBlank();
    logError("Authentication error detected. Please ensure you have the necessary permissions and try again.");
    logDim("Tip: Make sure you are logged in with 'az login' before running this command.");
  }

  if (message.includes("Azure CLI not found") || message.includes("AzureCliCredential")) {
    logBlank();
    logDim("Tip: Make sure Azure CLI is installed and you are logged in with 'az login'.");
  }
};

export type OutputFormat = "text" | "json";

/**
 * Handles command errors consistently across all CLI commands.
 * Extracts error message, shows auth hints, outputs JSON if needed, and exits.
 */
export const handleCommandError = (error: unknown, output: OutputFormat): never => {
  const errorMessage = extractErrorMessage(error);

  if (output === "json") {
    process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage }, null, 2)}\n`);
    process.exit(1);
  }

  logBlank();
  logError(`An error occurred: ${errorMessage}`);
  showAuthHints(errorMessage);
  logBlank();
  process.exit(1);
};
