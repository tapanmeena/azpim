import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import { AzureCliCredential } from "@azure/identity";
import { v4 as uuidv4 } from "uuid";
import { loadCachedSubscriptions, saveCachedSubscriptions } from "./subscription-cache";
import { failSpinner, formatStatus, logBlank, logDim, logError, logSuccess, logWarning, startSpinner, succeedSpinner, warnSpinner } from "./ui";

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

export type FetchSubscriptionsOptions = {
  forceRefresh?: boolean;
};

export const fetchSubscriptions = async (
  credential: AzureCliCredential,
  userId: string,
  options: FetchSubscriptionsOptions = {},
): Promise<AzureSubscription[]> => {
  const { forceRefresh = false } = options;

  // Try to use cached subscriptions if not forcing refresh
  if (!forceRefresh) {
    const cache = await loadCachedSubscriptions(userId);
    if (cache.isFresh && cache.data && cache.data.subscriptions.length > 0) {
      startSpinner("Using cached subscriptions...");
      succeedSpinner(`Found ${cache.data.subscriptions.length} subscription(s) (cached)`);
      return cache.data.subscriptions;
    }
  }

  startSpinner("Fetching Azure subscriptions...");

  const subscriptionClient = new SubscriptionClient(credential);
  const subscriptions: AzureSubscription[] = [];

  for await (const sub of subscriptionClient.subscriptions.list()) {
    subscriptions.push({
      subscriptionId: sub.subscriptionId || "",
      displayName: sub.displayName || "N/A",
      tenantId: sub.tenantId || "",
    });
  }

  // Save to cache
  await saveCachedSubscriptions(userId, subscriptions);

  succeedSpinner(`Found ${subscriptions.length} subscription(s)`);
  return subscriptions;
};

export const fetchEligibleRolesForSubscription = async (
  credential: AzureCliCredential,
  subscriptionId: string,
  subscriptionName: string,
  principalId: string,
): Promise<EligibleAzureRole[]> => {
  startSpinner(`Fetching eligible roles for "${subscriptionName}"...`);

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

    succeedSpinner(`Found ${eligibleRoles.length} eligible role(s) for "${subscriptionName}"`);
    return eligibleRoles;
  } catch (error: any) {
    if (error.statusCode === 403 || error.code === "AuthorizationFailed") {
      warnSpinner(`Insufficient permissions for subscription "${subscriptionName}"`);
      return [];
    }
    failSpinner(`Failed to fetch eligible roles for "${subscriptionName}"`);
    throw error;
  }
};

export const listActiveAzureRoles = async (
  credential: AzureCliCredential,
  subscriptionId: string,
  subscriptionName: string,
  principalId: string,
): Promise<ActiveAzureRole[]> => {
  startSpinner(`Fetching active roles for "${subscriptionName}"...`);

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

    succeedSpinner(`Found ${activeRoles.length} active role(s) for "${subscriptionName}"`);
    return activeRoles;
  } catch (error: any) {
    if (error.statusCode === 403 || error.code === "AuthorizationFailed") {
      warnSpinner(`Insufficient permissions for subscription "${subscriptionName}"`);
      return [];
    }
    failSpinner(`Failed to fetch active roles for "${subscriptionName}"`);
    throw error;
  }
};

export const activateAzureRole = async (
  credential: AzureCliCredential,
  request: AzureActivationRequest,
  subscriptionId: string,
): Promise<{ status?: string }> => {
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

  startSpinner(`Activating role "${request.roleName}"...`);

  try {
    const response = await client.roleAssignmentScheduleRequests.create(request.scope, requestName, requestBody);

    succeedSpinner(`Activation request submitted for "${request.roleName}"`);
    logBlank();

    if (response.status) {
      logDim(`   Status: ${formatStatus(response.status)}`);
    }

    if (response.status === "Approved" || response.status === "Provisioned") {
      logSuccess(`Role "${request.roleName}" has been activated successfully`);
    } else if (response.status === "Denied") {
      logError(`Role activation for "${request.roleName}" has been denied`);
    } else if (response.status === "PendingApproval") {
      logWarning(`Role activation for "${request.roleName}" is pending approval`);
    }

    return { status: response.status };
  } catch (error) {
    failSpinner(`Failed to activate role "${request.roleName}"`);
    throw error;
  }
};

export const deactivateAzureRole = async (
  credential: AzureCliCredential,
  scope: string,
  roleEligibilityScheduleId: string,
  subscriptionId: string,
  principalId: string,
  roleDefinitionId: string,
  roleName?: string,
): Promise<void> => {
  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const requestName = uuidv4();
  const displayName = roleName || "role";

  startSpinner(`Deactivating "${displayName}"...`);

  try {
    await client.roleAssignmentScheduleRequests.create(scope, requestName, {
      principalId,
      roleDefinitionId,
      requestType: "SelfDeactivate",
      linkedRoleEligibilityScheduleId: roleEligibilityScheduleId,
    });

    succeedSpinner(`Successfully deactivated "${displayName}"`);
  } catch (error) {
    failSpinner(`Failed to deactivate "${displayName}"`);
    throw error;
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
