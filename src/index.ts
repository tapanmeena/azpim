import chalk from "chalk";
import { Command } from "commander";
import { render } from "ink";
import { readFileSync } from "node:fs";
import React from "react";
import { authenticate } from "./auth";
import { App } from "./ui/App";

const readPackageVersion = (): string => {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    const json = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(json) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const program = new Command();
const version = readPackageVersion();

program.name("azp-cli").description("Azure PIM CLI - A CLI tool for Azure Privilege Identity Management (PIM)").version(version);

const runInk = async (initialScreen?: "main" | "activate/subscriptions" | "deactivate/roles"): Promise<void> => {
  try {
    const authContext = await authenticate();
    render(React.createElement(App, { authContext, initialScreen }));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.redBright(`Startup error: ${errorMessage}`));

    if (errorMessage.includes("AADSTS")) {
      console.log(chalk.redBright("Authentication error detected. Please ensure you have the necessary permissions and try again."));
    }

    process.exit(1);
  }
};

program
  .command("activate", { isDefault: true })
  .description("Open the TUI (start on Activate)")
  .alias("a")
  .action(async () => {
    await runInk("activate/subscriptions");
  });

program
  .command("deactivate")
  .description("Open the TUI (start on Deactivate)")
  .alias("d")
  .action(async () => {
    await runInk("deactivate/roles");
  });

program
  .command("menu")
  .description("Open the TUI (start on Main Menu)")
  .action(async () => {
    await runInk("main");
  });

program
  .command("help")
  .description("Display help information about azp-cli commands")
  .action(() => {
    program.outputHelp();
  });

program.parse();
