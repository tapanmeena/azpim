import inquirer from "inquirer";
import { AuthContext } from "./auth";
import {
  activateAzureRole,
  ActiveAzureRole,
  deactivateAzureRole,
  fetchEligibleRolesForSubscription,
  fetchSubscriptions,
  listActiveAzureRoles,
} from "./azure-pim";

const promptBackToMainMenuOrExit = async (message: string): Promise<void> => {
  const { next } = await inquirer.prompt<{ next: "back" | "exit" }>([
    {
      type: "select",
      name: "next",
      message,
      choices: [
        { name: "Back to Main Menu", value: "back" },
        { name: "Exit", value: "exit" },
      ],
      default: "back",
    },
  ]);

  if (next === "exit") {
    process.exit(0);
  }
};

export const showMainMenu = async (authContext: AuthContext): Promise<void> => {
  while (true) {
    const { action } = await inquirer.prompt<{ action: "activate" | "deactivate" | "exit" }>([
      {
        type: "select",
        name: "action",
        message: "Main Menu - Select an action:",
        choices: [
          { name: "Activate Role(s)", value: "activate" },
          { name: "Deactivate Role(s)", value: "deactivate" },
          { name: "Exit", value: "exit" },
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
        console.log("Exiting...");
        return;
    }
  }
};

export const handleActivation = async (authContext: AuthContext): Promise<void> => {
  try {
    const subscriptions = await fetchSubscriptions(authContext.credential);

    if (subscriptions.length === 0) {
      console.log("No subscriptions found.");
      await promptBackToMainMenuOrExit("No subscriptions found. What would you like to do?");
      return;
    }

    const BACK_VALUE = "__BACK__";
    const subscriptionChoices = subscriptions
      .map((sub) => ({
        name: `${sub.displayName} (${sub.subscriptionId})`,
        value: sub.subscriptionId,
      }))
      .concat([{ name: "Back to Main Menu", value: BACK_VALUE }]);

    const { selectedSubscriptionId } = await inquirer.prompt<{
      selectedSubscriptionId: string;
    }>([
      {
        type: "select",
        name: "selectedSubscriptionId",
        message: "Select a subscription:",
        choices: subscriptionChoices,
        pageSize: 15,
        default: subscriptionChoices[0]?.value,
      },
    ]);

    if (selectedSubscriptionId === BACK_VALUE) {
      console.log("Returning to main menu...");
      return;
    }

    const selectedSubscription = subscriptions.find((sub) => sub.subscriptionId === selectedSubscriptionId);
    if (!selectedSubscription) {
      console.error("Selected subscription not found.");
      return;
    }

    const eligibleRoles = await fetchEligibleRolesForSubscription(
      authContext.credential,
      selectedSubscription.subscriptionId,
      selectedSubscription.displayName,
      authContext.userId
    );

    if (eligibleRoles.length === 0) {
      console.log("No eligible roles found for the selected subscription.");
      await promptBackToMainMenuOrExit("No eligible roles found. What would you like to do?");
      return;
    }

    const { rolesToActivate } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "rolesToActivate",
        message: "Select roles to activate:",
        choices: eligibleRoles.map((role) => ({
          name: `${role.roleName} - ${role.scopeDisplayName}`,
          value: role.id,
          checked: false,
        })),
        validate: (answer) => {
          if (answer.length < 1) {
            return "You must choose at least one role.";
          }
          return true;
        },
        pageSize: 15,
      },
    ]);

    const activationDetails = await inquirer.prompt([
      {
        type: "number",
        name: "durationHours",
        message: "Duration (hours, max 8):",
        default: 8,
        validate: (value) => {
          if (!value) return "Please enter a valid number.";
          if (value >= 1 && value <= 8) return true;
          return "Please enter a value between 1 and 8.";
        },
      },
      {
        type: "input",
        name: "justification",
        message: "Justification for activation:",
        default: "Activated via azp-cli",
        validate: (value) => {
          if (value.trim().length >= 5) return true;
          return "Justification should be at least 5 characters long.";
        },
      },
    ]);

    const { confirmActivation } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmActivation",
        message: `Confirm activation of ${rolesToActivate.length} role(s) for ${activationDetails.durationHours} hour(s)?`,
        default: true,
      },
    ]);

    if (!confirmActivation) {
      console.log("Activation cancelled by user.");
      return;
    }

    console.log("Proceeding with activation...");
    await Promise.all(
      rolesToActivate.map(async (roleId: string) => {
        const role = eligibleRoles.find((r) => r.id === roleId);
        if (!role) {
          console.error(`Role with ID ${roleId} not found among eligible roles.`);
          return;
        }

        try {
          await activateAzureRole(
            authContext.credential,
            {
              principalId: authContext.userId,
              roleDefinitionId: role.roleDefinitionId,
              roleName: `${role.roleName} - ${role.scopeDisplayName}`,
              roleEligibilityScheduleId: role.roleEligibilityScheduleId,
              scope: role.scope,
              durationHours: activationDetails.durationHours,
              justification: activationDetails.justification,
            },
            selectedSubscription.subscriptionId
          );
        } catch (error) {
          console.error(`Failed to activate role ${role.roleName}:`, error);
        }
      })
    );
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    return;
  }
};

export const handleDeactivation = async (authContext: AuthContext): Promise<void> => {
  try {
    const subscriptions = await fetchSubscriptions(authContext.credential);
    let activeAzureRoles: ActiveAzureRole[] = [];

    if (subscriptions.length === 0) {
      console.log("No subscriptions found.");
      await promptBackToMainMenuOrExit("No subscriptions found. What would you like to do?");
      return;
    }

    for (const sub of subscriptions) {
      const roles = await listActiveAzureRoles(authContext.credential, sub.subscriptionId, sub.displayName, authContext.userId);
      activeAzureRoles = activeAzureRoles.concat(roles);
    }

    if (activeAzureRoles.length === 0) {
      console.log("No active roles found for deactivation.");
      await promptBackToMainMenuOrExit("No active roles found. What would you like to do?");
      return;
    }

    const BACK_VALUE = "__BACK__";

    const { rolesToDeactivate } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "rolesToDeactivate",
        message: "Select roles to deactivate:",
        choices: [
          { name: "Back to Main Menu", value: BACK_VALUE },
          ...activeAzureRoles.map((role) => ({
            name: `${role.roleName} - ${role.scopeDisplayName} (${role.subscriptionName}) (Activated on: ${new Date(
              role.startDateTime
            ).toLocaleString()})`,
            value: role.id,
            checked: false,
          })),
        ],
        validate: (answer) => {
          if (Array.isArray(answer) && answer.includes(BACK_VALUE)) {
            return true;
          }
          if (answer.length < 1) {
            return "You must choose at least one role.";
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
      console.log("Returning to main menu...");
      return;
    }

    const { confirmDeactivation } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmDeactivation",
        message: `Confirm deactivation of ${selectedRoleIds.length} role(s)?`,
        default: true,
      },
    ]);

    if (!confirmDeactivation) {
      console.log("Deactivation cancelled by user.");
      return;
    }

    console.log("Proceeding with deactivation...");

    await Promise.all(
      selectedRoleIds.map(async (roleId: string) => {
        const role = activeAzureRoles.find((r) => r.id === roleId);
        if (!role) {
          console.error(`Role with ID ${roleId} not found among active roles.`);
          return;
        }

        try {
          // Deactivation logic to be implemented
          console.log(`Deactivating role: ${role.roleName} - ${role.scopeDisplayName}`);
          await deactivateAzureRole(
            authContext.credential,
            role.scope,
            role.linkedRoleEligibilityScheduleId,
            role.subscriptionId,
            authContext.userId,
            role.roleDefinitionId
          );
        } catch (error) {
          console.error(`Failed to deactivate role ${role.roleName}:`, error);
        }
      })
    );
  } catch (error) {
    console.error("Error fetching subscriptions for deactivation:", error);
    return;
  }
};
