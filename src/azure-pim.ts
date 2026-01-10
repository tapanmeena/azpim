import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import { AzureCliCredential } from "@azure/identity";
import chalk from "chalk";
import { v4 as uuidv4 } from "uuid";

export interface AzureSubscription {
  subscriptionId: string;
  displayName: string;
  tenantId: string;
}

export interface EligibleAzureRole {
  id: string;
  roleEligibilityScheduleId: string;
  roleDefinitionId: string;
  roleName: string;
  roleDescription: string;
  scope: string;
  scopeDisplayName: string;
  principalId: string;
}

export interface ActiveAzureRole {
  id: string;
  roleDefinitionId: string;
  roleName: string;
  scope: string;
  scopeDisplayName: string;
  principalId: string;
  linkedRoleEligibilityScheduleId: string;
  startDateTime: string;
  endDateTime: string;
  subscriptionId: string;
  subscriptionName: string;
}

export interface AzureActivationRequest {
  roleEligibilityScheduleId: string;
  roleDefinitionId: string;
  roleName: string;
  scope: string;
  principalId: string;
  justification: string;
  durationHours: number;
}

export const fetchSubscriptions = async (credential: AzureCliCredential): Promise<AzureSubscription[]> => {
  if (process.env.AZP_CLI_DEBUG === "1") {
    console.log(chalk.blueBright("Fetching Azure subscriptions..."));
  }

  const subscriptionClient = new SubscriptionClient(credential);
  const subscriptions: AzureSubscription[] = [];

  for await (const sub of subscriptionClient.subscriptions.list()) {
    subscriptions.push({
      subscriptionId: sub.subscriptionId || "",
      displayName: sub.displayName || "N/A",
      tenantId: sub.tenantId || "",
    });
  }

  if (process.env.AZP_CLI_DEBUG === "1") {
    console.log(chalk.greenBright(`Fetched ${subscriptions.length} subscriptions.`));
  }
  return subscriptions;
};

export const fetchEligibleRolesForSubscription = async (
  credential: AzureCliCredential,
  subscriptionId: string,
  subscriptionName: string,
  principalId: string
): Promise<EligibleAzureRole[]> => {
  if (process.env.AZP_CLI_DEBUG === "1") {
    console.log(chalk.blueBright(`Fetching eligible roles for subscription ${subscriptionName}...`));
  }

  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const scope = `/subscriptions/${subscriptionId}`;
  const eligibleRoles: EligibleAzureRole[] = [];

  try {
    const schedules = client.roleEligibilitySchedules.listForScope(scope, {
      filter: `asTarget()`,
    });

    for await (const schedule of schedules) {
      if (schedule.id && schedule.roleDefinitionId) {
        eligibleRoles.push({
          id: schedule.id,
          roleEligibilityScheduleId: schedule.id,
          roleDefinitionId: schedule.roleDefinitionId,
          roleName: schedule.expandedProperties?.roleDefinition?.displayName || "Unknown Role",
          roleDescription: "No description available",
          scope: schedule.scope || scope,
          scopeDisplayName: getScopeDisplayName(schedule.scope || scope),
          principalId: schedule.principalId || principalId,
        });
      }
    }

    if (process.env.AZP_CLI_DEBUG === "1") {
      console.log(chalk.greenBright(`Fetched ${eligibleRoles.length} eligible roles for subscription ${subscriptionName}.`));
    }
    return eligibleRoles;
  } catch (error: any) {
    if (error.statusCode === 403 || error.code === "AuthorizationFailed") {
      if (process.env.AZP_CLI_DEBUG === "1") {
        console.log(chalk.redBright(`Insufficient permissions to fetch eligible roles for subscription ${subscriptionId}.`));
      }
      return [];
    }
    throw error;
  }
};

export const listActiveAzureRoles = async (
  credential: AzureCliCredential,
  subscriptionId: string,
  subscriptionName: string,
  principalId: string
): Promise<ActiveAzureRole[]> => {
  if (process.env.AZP_CLI_DEBUG === "1") {
    console.log(chalk.blueBright(`Fetching active roles for subscription ${subscriptionName}...`));
  }

  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const scope = `/subscriptions/${subscriptionId}`;
  const activeRoles: ActiveAzureRole[] = [];

  try {
    const schedules = client.roleAssignmentSchedules.listForScope(scope, {
      filter: `asTarget()`,
    });

    for await (const schedule of schedules) {
      if (schedule.id && schedule.roleDefinitionId && schedule.assignmentType === "Activated") {
        activeRoles.push({
          id: schedule.id,
          roleDefinitionId: schedule.roleDefinitionId,
          roleName: schedule.expandedProperties?.roleDefinition?.displayName || "Unknown Role",
          scope: schedule.scope || scope,
          scopeDisplayName: getScopeDisplayName(schedule.scope || scope),
          principalId: schedule.principalId || principalId,
          linkedRoleEligibilityScheduleId: schedule.linkedRoleEligibilityScheduleId || "",
          startDateTime: schedule.startDateTime?.toISOString() || "",
          endDateTime: schedule.endDateTime?.toISOString() || "",
          subscriptionId,
          subscriptionName,
        });
      }
    }

    if (process.env.AZP_CLI_DEBUG === "1") {
      console.log(chalk.greenBright(`Fetched ${activeRoles.length} active roles for subscription ${subscriptionName}.`));
    }
    return activeRoles;
  } catch (error: any) {
    if (error.statusCode === 403 || error.code === "AuthorizationFailed") {
      if (process.env.AZP_CLI_DEBUG === "1") {
        console.log(chalk.redBright(`Insufficient permissions to fetch active roles for subscription ${subscriptionId}.`));
      }
      return [];
    }
    throw error;
  }
};

export const listActiveAzureRolesForUser = async (credential: AzureCliCredential, principalId: string): Promise<ActiveAzureRole[]> => {
  const subscriptions = await fetchSubscriptions(credential);
  const all: ActiveAzureRole[] = [];

  for (const sub of subscriptions) {
    const roles = await listActiveAzureRoles(credential, sub.subscriptionId, sub.displayName, principalId);
    all.push(...roles);
  }

  return all;
};

export const activateAzureRole = async (credential: AzureCliCredential, request: AzureActivationRequest, subscriptionId: string): Promise<void> => {
  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const requestName = uuidv4();
  const now = new Date();
  const durationISO = `PT${request.durationHours}H`;

  const linkedScheduleId = request.roleEligibilityScheduleId.includes("/")
    ? request.roleEligibilityScheduleId
    : `${request.scope}/providers/Microsoft.Authorization/roleEligibilitySchedules/${request.roleEligibilityScheduleId}`;

  const requestBody = {
    principalId: request.principalId,
    roleDefinitionId: request.roleDefinitionId,
    requestType: "SelfActivate",
    linkedRoleEligibilityScheduleId: linkedScheduleId,
    scheduleInfo: {
      startDateTime: now,
      expiration: {
        type: "AfterDuration",
        duration: durationISO,
      },
    },
    justification: request.justification,
  };

  if (process.env.AZP_CLI_DEBUG === "1") {
    console.log(chalk.blueBright(`Submitting activation request for role ${request.roleName}...`));
  }

  try {
    const response = await client.roleAssignmentScheduleRequests.create(request.scope, requestName, requestBody);

    if (process.env.AZP_CLI_DEBUG === "1") {
      console.log(chalk.greenBright("Activation request submitted successfully."));
      console.log(chalk.greenBright(`Role Assignment Schedule Request ID: ${response.id}`));
    }

    if (response.status === "Approved") {
      if (process.env.AZP_CLI_DEBUG === "1") {
        console.log(chalk.greenBright("Your role activation has been approved."));
      }
    } else if (response.status === "Denied") {
      if (process.env.AZP_CLI_DEBUG === "1") {
        console.log(chalk.redBright("Your role activation has been denied."));
      }
    } else if (response.status === "PendingApproval") {
      if (process.env.AZP_CLI_DEBUG === "1") {
        console.log(chalk.yellowBright("Your role activation is pending approval."));
      }
    } else {
      if (process.env.AZP_CLI_DEBUG === "1") {
        console.log(chalk.yellowBright(`Your role activation is currently in status: ${response.status}`));
      }
    }
  } catch (error) {
    if (process.env.AZP_CLI_DEBUG === "1") {
      console.error(chalk.redBright("Failed to submit activation request:"), error);
    }
    throw error;
  }
};

export const deactivateAzureRole = async (
  credential: AzureCliCredential,
  scope: string,
  roleEligibilityScheduleId: string,
  subscriptionId: string,
  principalId: string,
  roleDefinitionId: string
): Promise<void> => {
  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const requestName = uuidv4();

  const response = await client.roleAssignmentScheduleRequests.create(scope, requestName, {
    principalId,
    roleDefinitionId,
    requestType: "SelfDeactivate",
    linkedRoleEligibilityScheduleId: roleEligibilityScheduleId,
  });

  if (process.env.AZP_CLI_DEBUG === "1") {
    console.log(chalk.greenBright(`Deactivation request submitted successfully - ${response.name}`));
  }
};

const getScopeDisplayName = (scope: string): string => {
  if (!scope) return "Unknown Scope";

  const parts = scope.split("/");

  // Management Group
  if (scope.includes("/managementGroups/")) {
    const mgIndex = parts.indexOf("managementGroups");
    return `Management Group: ${parts[mgIndex + 1]}`;
  }

  // Resource Group
  if (scope.includes("/resourceGroups/")) {
    const rgIndex = parts.indexOf("resourceGroups");
    const subIndex = parts.indexOf("subscriptions");
    return `Resource Group: ${parts[rgIndex + 1]} (Subscription: ${parts[subIndex + 1]})`;
  }

  // Subscription Level
  if (scope.includes("/subscriptions/")) {
    const subIndex = parts.indexOf("subscriptions");
    return `Subscription: ${parts[subIndex + 1]}`;
  }

  return scope;
};
