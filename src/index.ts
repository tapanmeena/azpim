#!/usr/bin/env node

import { Command } from "commander";
import { version } from "../package.json";
import { authenticate } from "./auth";
import { showMainMenu } from "./cli";
import { logBlank, logDim, logError, showHeader } from "./ui";

const program = new Command();

program.name("azp-cli").description("Azure PIM CLI - A CLI tool for Azure Privilege Identity Management (PIM)").version(version);

program
  .command("activate", { isDefault: true })
  .description("Activate a role in Azure PIM")
  .alias("a")
  .action(async () => {
    try {
      // Show header
      showHeader();

      // Authenticate
      const authContext = await authenticate();

      // show mainmenu
      await showMainMenu(authContext);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logBlank();
      logError(`An error occurred: ${errorMessage}`);

      if (errorMessage.includes("AADSTS")) {
        logBlank();
        logError("Authentication error detected. Please ensure you have the necessary permissions and try again.");
        logDim("Tip: Make sure you are logged in with 'az login' before running this command.");
      }

      if (errorMessage.includes("Azure CLI not found") || errorMessage.includes("AzureCliCredential")) {
        logBlank();
        logDim("Tip: Make sure Azure CLI is installed and you are logged in with 'az login'.");
      }

      logBlank();
      process.exit(1);
    }
  });

program
  .command("deactivate")
  .description("Deactivate a role in Azure PIM")
  .alias("d")
  .action(async () => {
    showHeader();
    logDim("Deactivate role command invoked - use the main menu to deactivate roles.");
  });

program
  .command("help")
  .description("Display help information about azp-cli commands")
  .action(() => {
    showHeader();
    program.outputHelp();
  });

program.parse();
