import { AuthContext } from "@/auth";
import {
  activateAzureRole,
  ActiveAzureRole,
  deactivateAzureRole,
  fetchEligibleRolesForSubscription,
  fetchSubscriptions,
  listActiveAzureRoles,
} from "@/azure-pim";
import {
  formatActiveRole,
  formatRole,
  formatSubscription,
  logBlank,
  logDim,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  showDivider,
  showSummary,
} from "@/ui";
import chalk from "chalk";
import inquirer from "inquirer";

const promptBackToMainMenuOrExit = async (message: string): Promise<void> => {
  logBlank();
  const { next } = await inquirer.prompt<{ next: "back" | "exit" }>([
    {
      type: "select",
      name: "next",
      message: chalk.yellow(message),
      choices: [
        { name: chalk.cyan("↩ Back to Main Menu"), value: "back" },
        { name: chalk.red("✕ Exit"), value: "exit" },
      ],
      default: "back",
    },
  ]);

  if (next === "exit") {
    logBlank();
    logDim("Goodbye! 👋");
    process.exit(0);
  }
};

export const showMainMenu = async (authContext: AuthContext): Promise<void> => {
  while (true) {
    showDivider();
    logBlank();
    const { action } = await inquirer.prompt<{ action: "activate" | "deactivate" | "exit" }>([
      {
        type: "select",
        name: "action",
        message: chalk.cyan.bold("What would you like to do?"),
        choices: [
          { name: chalk.green("▶ Activate Role(s)"), value: "activate" },
          { name: chalk.yellow("◼ Deactivate Role(s)"), value: "deactivate" },
          { name: chalk.red("✕ Exit"), value: "exit" },
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
      case "exit":
        logBlank();
        logDim("Goodbye! 👋");
        logBlank();
        return;
    }
  }
};

export const handleActivation = async (authContext: AuthContext): Promise<void> => {
  try {
    logBlank();
    logInfo("Starting role activation flow...");
    logBlank();

    const subscriptions = await fetchSubscriptions(authContext.credential);

    if (subscriptions.length === 0) {
      logWarning("No subscriptions found.");
      await promptBackToMainMenuOrExit("What would you like to do?");
      return;
    }

    const BACK_VALUE = "__BACK__";
    const subscriptionChoices = subscriptions
      .map((sub) => ({
        name: formatSubscription(sub.displayName, sub.subscriptionId),
        value: sub.subscriptionId,
      }))
      .concat([{ name: chalk.dim("↩ Back to Main Menu"), value: BACK_VALUE }]);

    logBlank();
    const { selectedSubscriptionId } = await inquirer.prompt<{
      selectedSubscriptionId: string;
    }>([
      {
        type: "select",
        name: "selectedSubscriptionId",
        message: chalk.cyan("Select a subscription:"),
        choices: subscriptionChoices,
        pageSize: 15,
        default: subscriptionChoices[0]?.value,
      },
    ]);

    if (selectedSubscriptionId === BACK_VALUE) {
      logDim("Returning to main menu...");
      return;
    }

    const selectedSubscription = subscriptions.find((sub) => sub.subscriptionId === selectedSubscriptionId);
    if (!selectedSubscription) {
      logError("Selected subscription not found.");
      return;
    }

    const eligibleRoles = await fetchEligibleRolesForSubscription(
      authContext.credential,
      selectedSubscription.subscriptionId,
      selectedSubscription.displayName,
      authContext.userId
    );

    if (eligibleRoles.length === 0) {
      logWarning("No eligible roles found for the selected subscription.");
      await promptBackToMainMenuOrExit("What would you like to do?");
      return;
    }

    logBlank();
    const { rolesToActivate } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "rolesToActivate",
        message: chalk.cyan("Select role(s) to activate:"),
        choices: eligibleRoles.map((role) => ({
          name: formatRole(role.roleName, role.scopeDisplayName),
          value: role.id,
          checked: false,
        })),
        validate: (answer) => {
          if (answer.length < 1) {
            return chalk.red("You must choose at least one role.");
          }
          return true;
        },
        pageSize: 15,
      },
    ]);

    logBlank();
    const activationDetails = await inquirer.prompt([
      {
        type: "number",
        name: "durationHours",
        message: chalk.cyan("Duration (hours, max 8):"),
        default: 8,
        validate: (value) => {
          if (!value) return chalk.red("Please enter a valid number.");
          if (value >= 1 && value <= 8) return true;
          return chalk.red("Please enter a value between 1 and 8.");
        },
      },
      {
        type: "input",
        name: "justification",
        message: chalk.cyan("Justification for activation:"),
        default: "Activated via azp-cli",
        validate: (value) => {
          if (value.trim().length >= 5) return true;
          return chalk.red("Justification should be at least 5 characters long.");
        },
      },
    ]);

    // Show summary before confirmation
    const selectedRoleNames = rolesToActivate
      .map((roleId: string) => {
        const role = eligibleRoles.find((r) => r.id === roleId);
        return role ? `${role.roleName} @ ${role.scopeDisplayName}` : roleId;
      })
      .join(", ");

    showSummary("Activation Summary", [
      { label: "Subscription", value: selectedSubscription.displayName },
      { label: "Role(s)", value: selectedRoleNames },
      { label: "Duration", value: `${activationDetails.durationHours} hour(s)` },
      { label: "Justification", value: activationDetails.justification },
    ]);

    const { confirmActivation } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmActivation",
        message: chalk.yellow(`Confirm activation of ${rolesToActivate.length} role(s)?`),
        default: true,
      },
    ]);

    if (!confirmActivation) {
      logWarning("Activation cancelled by user.");
      return;
    }

    logBlank();
    logInfo(`Activating ${rolesToActivate.length} role(s)...`);
    logBlank();

    let successCount = 0;
    let failCount = 0;

    for (const roleId of rolesToActivate as string[]) {
      const role = eligibleRoles.find((r) => r.id === roleId);
      if (!role) {
        logError(`Role with ID ${roleId} not found among eligible roles.`);
        failCount++;
        continue;
      }

      try {
        await activateAzureRole(
          authContext.credential,
          {
            principalId: authContext.userId,
            roleDefinitionId: role.roleDefinitionId,
            roleName: `${role.roleName} @ ${role.scopeDisplayName}`,
            roleEligibilityScheduleId: role.roleEligibilityScheduleId,
            scope: role.scope,
            durationHours: activationDetails.durationHours,
            justification: activationDetails.justification,
          },
          selectedSubscription.subscriptionId
        );
        successCount++;
      } catch (error: any) {
        logError(`Failed to activate role "${role.roleName}": ${error.message || error}`);
        failCount++;
      }
    }

    logBlank();
    showDivider();
    if (successCount > 0 && failCount === 0) {
      logSuccess(`All ${successCount} role(s) activated successfully!`);
    } else if (successCount > 0 && failCount > 0) {
      logWarning(`${successCount} role(s) activated, ${failCount} failed.`);
    } else {
      logError(`All ${failCount} role activation(s) failed.`);
    }
  } catch (error: any) {
    logError(`Error during activation: ${error.message || error}`);
    return;
  }
};

export const handleDeactivation = async (authContext: AuthContext): Promise<void> => {
  try {
    logBlank();
    logInfo("Starting role deactivation flow...");
    logBlank();

    const subscriptions = await fetchSubscriptions(authContext.credential);
    let activeAzureRoles: ActiveAzureRole[] = [];

    if (subscriptions.length === 0) {
      logWarning("No subscriptions found.");
      await promptBackToMainMenuOrExit("What would you like to do?");
      return;
    }

    for (const sub of subscriptions) {
      const roles = await listActiveAzureRoles(authContext.credential, sub.subscriptionId, sub.displayName, authContext.userId);
      activeAzureRoles = activeAzureRoles.concat(roles);
    }

    if (activeAzureRoles.length === 0) {
      logWarning("No active roles found for deactivation.");
      await promptBackToMainMenuOrExit("What would you like to do?");
      return;
    }

    const BACK_VALUE = "__BACK__";

    logBlank();
    const { rolesToDeactivate } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "rolesToDeactivate",
        message: chalk.cyan("Select role(s) to deactivate:"),
        choices: [
          { name: chalk.dim("↩ Back to Main Menu"), value: BACK_VALUE },
          ...activeAzureRoles.map((role) => ({
            name: formatActiveRole(role.roleName, role.scopeDisplayName, role.subscriptionName, role.startDateTime),
            value: role.id,
            checked: false,
          })),
        ],
        validate: (answer) => {
          if (Array.isArray(answer) && answer.includes(BACK_VALUE)) {
            return true;
          }
          if (answer.length < 1) {
            return chalk.red("You must choose at least one role.");
          }
          return true;
        },
        pageSize: 15,
      },
    ]);

    const selectedRoleIds = (rolesToDeactivate as string[]).includes(BACK_VALUE)
      ? (rolesToDeactivate as string[]).filter((id) => id !== BACK_VALUE)
      : (rolesToDeactivate as string[]);

    if ((rolesToDeactivate as string[]).includes(BACK_VALUE) && selectedRoleIds.length === 0) {
      logDim("Returning to main menu...");
      return;
    }

    // Show summary before confirmation
    const selectedRoleNames = selectedRoleIds
      .map((roleId) => {
        const role = activeAzureRoles.find((r) => r.id === roleId);
        return role ? `${role.roleName} @ ${role.scopeDisplayName}` : roleId;
      })
      .join(", ");

    showSummary("Deactivation Summary", [{ label: "Role(s) to deactivate", value: selectedRoleNames }]);

    const { confirmDeactivation } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmDeactivation",
        message: chalk.yellow(`Confirm deactivation of ${selectedRoleIds.length} role(s)?`),
        default: true,
      },
    ]);

    if (!confirmDeactivation) {
      logWarning("Deactivation cancelled by user.");
      return;
    }

    logBlank();
    logInfo(`Deactivating ${selectedRoleIds.length} role(s)...`);
    logBlank();

    let successCount = 0;
    let failCount = 0;

    for (const roleId of selectedRoleIds) {
      const role = activeAzureRoles.find((r) => r.id === roleId);
      if (!role) {
        logError(`Role with ID ${roleId} not found among active roles.`);
        failCount++;
        continue;
      }

      try {
        await deactivateAzureRole(
          authContext.credential,
          role.scope,
          role.linkedRoleEligibilityScheduleId,
          role.subscriptionId,
          authContext.userId,
          role.roleDefinitionId,
          `${role.roleName} @ ${role.scopeDisplayName}`
        );
        successCount++;
      } catch (error: any) {
        logError(`Failed to deactivate role "${role.roleName}": ${error.message || error}`);
        failCount++;
      }
    }

    logBlank();
    showDivider();
    if (successCount > 0 && failCount === 0) {
      logSuccess(`All ${successCount} role(s) deactivated successfully!`);
    } else if (successCount > 0 && failCount > 0) {
      logWarning(`${successCount} role(s) deactivated, ${failCount} failed.`);
    } else {
      logError(`All ${failCount} role deactivation(s) failed.`);
    }
  } catch (error: any) {
    logError(`Error during deactivation: ${error.message || error}`);
    return;
  }
};
