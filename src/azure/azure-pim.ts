import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { SubscriptionClient } from "@azure/arm-resources-subscriptions";
import { AzureCliCredential } from "@azure/identity";
import { v4 as uuidv4 } from "uuid";
import { PIM_FILTER_AS_TARGET } from "../core/constants";

import {
  failSpinner,
  formatStatus,
  logBlank,
  logDebug,
  logDim,
  logError,
  logSuccess,
  logWarning,
  startSpinner,
  succeedSpinner,
  warnSpinner,
} from "../core/ui";
import { loadCachedSubscriptions, saveCachedSubscriptions } from "../data/subscription-cache";

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

export interface AzureDeactivationRequest {
  scope: string;
  roleEligibilityScheduleId: string;
  subscriptionId: string;
  principalId: string;
  roleDefinitionId: string;
  roleName?: string;
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
    logDebug("Checking subscription cache...");
    const cache = await loadCachedSubscriptions(userId);
    if (cache.isFresh && cache.data && cache.data.subscriptions.length > 0) {
      logDebug("Using cached subscriptions", {
        count: cache.data.subscriptions.length,
      });
      startSpinner("Using cached subscriptions...");
      succeedSpinner(`Found ${cache.data.subscriptions.length} subscription(s) (cached)`);
      return cache.data.subscriptions;
    }
    logDebug("Cache miss or stale, fetching from Azure");
  } else {
    logDebug("Force refresh enabled, skipping cache");
  }

  startSpinner("Fetching Azure subscriptions...");

  logDebug("Creating SubscriptionClient...");
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
  logDebug("Saving subscriptions to cache", { count: subscriptions.length });
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

  logDebug("Creating AuthorizationManagementClient...", { subscriptionId });
  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const scope = `/subscriptions/${subscriptionId}`;
  const eligibleRoles: EligibleAzureRole[] = [];

  try {
    logDebug("Querying eligible role schedules", {
      scope,
      filter: PIM_FILTER_AS_TARGET,
    });
    const schedules = client.roleEligibilitySchedules.listForScope(scope, {
      filter: PIM_FILTER_AS_TARGET,
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

    logDebug("Eligible roles fetched", {
      count: eligibleRoles.length,
      subscriptionName,
    });
    succeedSpinner(`Found ${eligibleRoles.length} eligible role(s) for "${subscriptionName}"`);
    return eligibleRoles;
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    logDebug("Error fetching eligible roles", {
      subscriptionName,
      errorType: err?.constructor?.name,
      statusCode: err?.statusCode,
      code: err?.code,
      message: (error as Error)?.message,
    });
    if (err.statusCode === 403 || err.code === "AuthorizationFailed") {
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

  logDebug("Creating AuthorizationManagementClient...", { subscriptionId });
  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const scope = `/subscriptions/${subscriptionId}`;
  const activeRoles: ActiveAzureRole[] = [];

  try {
    logDebug("Querying active role schedules", {
      scope,
      filter: PIM_FILTER_AS_TARGET,
    });
    const schedules = client.roleAssignmentSchedules.listForScope(scope, {
      filter: PIM_FILTER_AS_TARGET,
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

    logDebug("Active roles fetched", {
      count: activeRoles.length,
      subscriptionName,
    });
    succeedSpinner(`Found ${activeRoles.length} active role(s) for "${subscriptionName}"`);
    return activeRoles;
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    logDebug("Error fetching active roles", {
      subscriptionName,
      errorType: err?.constructor?.name,
      statusCode: err?.statusCode,
      code: err?.code,
      message: (error as Error)?.message,
    });
    if (err.statusCode === 403 || err.code === "AuthorizationFailed") {
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
  logDebug("Creating AuthorizationManagementClient for activation...", {
    subscriptionId,
  });
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

  logDebug("Submitting activation request", {
    scope: request.scope,
    roleName: request.roleName,
    requestName,
    durationISO,
    requestType: "SelfActivate",
  });

  startSpinner(`Activating role "${request.roleName}"...`);

  try {
    const response = await client.roleAssignmentScheduleRequests.create(request.scope, requestName, requestBody);

    logDebug("Activation response received", {
      status: response.status,
      id: response.id,
      roleName: request.roleName,
    });

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
    const err = error as Record<string, unknown>;
    logDebug("Activation error", {
      roleName: request.roleName,
      errorType: err?.constructor?.name,
      statusCode: err?.statusCode,
      code: err?.code,
      message: (error as Error)?.message,
    });
    failSpinner(`Failed to activate role "${request.roleName}"`);

    // Provide helpful guidance for specific error codes
    const errorCode = err?.code as string | undefined;
    const errorMessage = (error as Error)?.message || "";

    if (errorCode === "RoleAssignmentRequestPolicyValidationFailed" && errorMessage.includes("ExpirationRule")) {
      logBlank();
      logError(`The requested duration of ${request.durationHours} hour(s) exceeds the maximum allowed by the PIM policy for this role.`);
      logDim(`   Try activating with a shorter duration (e.g., --duration 4 or --duration 1)`);
      logDim(`   or check the role's PIM settings in the Azure portal to see the maximum allowed duration.`);
    }

    throw error;
  }
};

export const deactivateAzureRole = async (credential: AzureCliCredential, request: AzureDeactivationRequest): Promise<void> => {
  const { scope, roleEligibilityScheduleId, subscriptionId, principalId, roleDefinitionId, roleName } = request;
  logDebug("Creating AuthorizationManagementClient for deactivation...", {
    subscriptionId,
  });
  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const requestName = uuidv4();
  const displayName = roleName || "role";

  logDebug("Submitting deactivation request", {
    scope,
    roleName: displayName,
    requestName,
    requestType: "SelfDeactivate",
  });

  startSpinner(`Deactivating "${displayName}"...`);

  try {
    await client.roleAssignmentScheduleRequests.create(scope, requestName, {
      principalId,
      roleDefinitionId,
      requestType: "SelfDeactivate",
      linkedRoleEligibilityScheduleId: roleEligibilityScheduleId,
    });

    logDebug("Deactivation successful", { roleName: displayName });
    succeedSpinner(`Successfully deactivated "${displayName}"`);
  } catch (error) {
    const err = error as Record<string, unknown>;
    logDebug("Deactivation error", {
      roleName: displayName,
      errorType: err?.constructor?.name,
      statusCode: err?.statusCode,
      code: err?.code,
      message: (error as Error)?.message,
    });
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
