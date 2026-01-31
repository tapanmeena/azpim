import { AuthorizationManagementClient } from "@azure/arm-authorization";
import { AzureCliCredential } from "@azure/identity";
import { v4 as uuidv4 } from "uuid";
import { getArmToken } from "./auth";
import { failSpinner, logBlank, logDim, logSuccess, logWarning, startSpinner, succeedSpinner, warnSpinner } from "./ui";

// =============================================================================
// Interfaces
// =============================================================================

export interface PendingApproval {
  approvalId: string;
  requestor: {
    principalId: string;
    displayName: string;
    userPrincipalName: string;
  };
  roleDefinitionId: string;
  roleName: string;
  scope: string;
  scopeDisplayName: string;
  subscriptionId: string;
  subscriptionName: string;
  justification: string;
  requestedDurationHours: number;
  requestedDateTime: Date;
  expirationDateTime: Date;
  stages: ApprovalStage[];
  currentStage?: ApprovalStage;
}

export interface ApprovalStage {
  stageId: string;
  displayName: string;
  status: "NotStarted" | "InProgress" | "Completed" | "Expired" | "Escalating" | "Escalated" | "Initializing" | "Completing";
  assignedToMe: boolean;
  reviewResult: "NotReviewed" | "Approve" | "Deny";
  reviewedBy?: {
    principalId: string;
    displayName: string;
    userPrincipalName: string;
  };
  reviewedDateTime?: Date;
  justification?: string;
}

export interface AllActiveAssignment {
  assignmentId: string;
  principal: {
    principalId: string;
    principalType: "User" | "Group" | "ServicePrincipal";
    displayName: string;
    userPrincipalName?: string;
  };
  roleDefinitionId: string;
  roleName: string;
  scope: string;
  scopeDisplayName: string;
  subscriptionId: string;
  subscriptionName: string;
  assignmentType: "Activated" | "Assigned";
  startDateTime: Date;
  endDateTime: Date;
  linkedEligibilityScheduleId?: string;
}

export type ApprovalDecision = "Approve" | "Deny";

export interface ApprovalDecisionResult {
  approvalId: string;
  stageId: string;
  decision: ApprovalDecision;
  justification: string;
  reviewedDateTime: Date;
  success: boolean;
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

const APPROVAL_API_VERSION = "2021-01-01-preview";
const ARM_BASE_URL = "https://management.azure.com";

// =============================================================================
// Helper Functions
// =============================================================================

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

const extractSubscriptionId = (scope: string): string | undefined => {
  const match = scope.match(/\/subscriptions\/([^/]+)/);
  return match?.[1];
};

const parseDurationToHours = (duration: string | undefined): number => {
  if (!duration) return 8;
  // Parse ISO 8601 duration like PT8H, PT1H30M, etc.
  const match = duration.match(/PT(\d+)H/);
  return match && match[1] ? parseInt(match[1], 10) : 8;
};

// =============================================================================
// REST API Helpers
// =============================================================================

interface ApprovalListResponse {
  value: Array<{
    id: string;
    name: string;
    type: string;
    properties: {
      stages: Array<{
        id: string;
        name: string;
        properties: {
          displayName?: string;
          status: string;
          assignedToMe: boolean;
          reviewResult: string;
          justification?: string;
          reviewedBy?: {
            principalId: string;
            principalName: string;
            userPrincipalName: string;
            principalType: string;
          };
          reviewedDateTime?: string;
        };
      }>;
    };
  }>;
  nextLink?: string;
}

interface RoleAssignmentScheduleRequestResponse {
  id: string;
  name: string;
  properties: {
    principalId: string;
    roleDefinitionId: string;
    scope: string;
    justification?: string;
    scheduleInfo?: {
      startDateTime?: string;
      expiration?: {
        type?: string;
        duration?: string;
        endDateTime?: string;
      };
    };
    expandedProperties?: {
      principal?: {
        id: string;
        displayName: string;
        email?: string;
        type: string;
      };
      roleDefinition?: {
        id: string;
        displayName: string;
        type: string;
      };
      scope?: {
        id: string;
        displayName: string;
        type: string;
      };
    };
    status: string;
    approvalId?: string;
    createdOn?: string;
  };
}

async function fetchWithAuth(credential: AzureCliCredential, url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getArmToken(credential);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...options.headers,
  };

  return fetch(url, { ...options, headers });
}

// =============================================================================
// Approval Operations
// =============================================================================

/**
 * Fetch all pending approvals where the current user is an approver.
 */
export const fetchPendingApprovals = async (credential: AzureCliCredential): Promise<PendingApproval[]> => {
  startSpinner("Fetching pending approval requests...");

  try {
    const url = `${ARM_BASE_URL}/providers/Microsoft.Authorization/roleAssignmentApprovals?api-version=${APPROVAL_API_VERSION}&$filter=asApprover()`;
    const response = await fetchWithAuth(credential, url);

    if (!response.ok) {
      if (response.status === 403) {
        warnSpinner("No pending approvals or insufficient permissions");
        return [];
      }
      throw new Error(`Failed to fetch approvals: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as ApprovalListResponse;
    const pendingApprovals: PendingApproval[] = [];

    for (const approval of data.value || []) {
      // Find stages that are in progress and assigned to the current user
      const stages: ApprovalStage[] = (approval.properties.stages || []).map((stage) => ({
        stageId: stage.name,
        displayName: stage.properties.displayName || "Approval Stage",
        status: stage.properties.status as ApprovalStage["status"],
        assignedToMe: stage.properties.assignedToMe,
        reviewResult: stage.properties.reviewResult as ApprovalStage["reviewResult"],
        justification: stage.properties.justification,
        reviewedBy: stage.properties.reviewedBy
          ? {
              principalId: stage.properties.reviewedBy.principalId,
              displayName: stage.properties.reviewedBy.principalName,
              userPrincipalName: stage.properties.reviewedBy.userPrincipalName,
            }
          : undefined,
        reviewedDateTime: stage.properties.reviewedDateTime ? new Date(stage.properties.reviewedDateTime) : undefined,
      }));

      const currentStage = stages.find((s) => s.assignedToMe && s.reviewResult === "NotReviewed");

      // Skip if no actionable stage for current user
      if (!currentStage) continue;

      // We need to fetch additional details about the request to get role/scope info
      // The approval ID corresponds to a roleAssignmentScheduleRequest
      const requestDetails = await fetchApprovalRequestDetails(credential, approval.name);

      if (requestDetails) {
        pendingApprovals.push({
          approvalId: approval.name,
          requestor: {
            principalId: requestDetails.properties.principalId,
            displayName: requestDetails.properties.expandedProperties?.principal?.displayName || "Unknown",
            userPrincipalName: requestDetails.properties.expandedProperties?.principal?.email || "Unknown",
          },
          roleDefinitionId: requestDetails.properties.roleDefinitionId,
          roleName: requestDetails.properties.expandedProperties?.roleDefinition?.displayName || "Unknown Role",
          scope: requestDetails.properties.scope,
          scopeDisplayName: getScopeDisplayName(requestDetails.properties.scope),
          subscriptionId: extractSubscriptionId(requestDetails.properties.scope) || "",
          subscriptionName: requestDetails.properties.expandedProperties?.scope?.displayName || "Unknown",
          justification: requestDetails.properties.justification || "",
          requestedDurationHours: parseDurationToHours(requestDetails.properties.scheduleInfo?.expiration?.duration),
          requestedDateTime: requestDetails.properties.createdOn ? new Date(requestDetails.properties.createdOn) : new Date(),
          expirationDateTime: requestDetails.properties.scheduleInfo?.expiration?.endDateTime
            ? new Date(requestDetails.properties.scheduleInfo.expiration.endDateTime)
            : new Date(),
          stages,
          currentStage,
        });
      }
    }

    succeedSpinner(`Found ${pendingApprovals.length} pending approval(s)`);
    return pendingApprovals;
  } catch (error: any) {
    if (error.message?.includes("403")) {
      warnSpinner("No pending approvals or insufficient permissions");
      return [];
    }
    failSpinner("Failed to fetch pending approvals");
    throw error;
  }
};

/**
 * Fetch details of a specific approval request by approval ID.
 */
async function fetchApprovalRequestDetails(
  credential: AzureCliCredential,
  approvalId: string,
): Promise<RoleAssignmentScheduleRequestResponse | null> {
  try {
    // Search for the role assignment schedule request with this approval ID
    // We need to search across subscriptions - for now, use a global search
    const url = `${ARM_BASE_URL}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests?api-version=2020-10-01&$filter=approvalId eq '${approvalId}'`;
    const response = await fetchWithAuth(credential, url);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      value?: RoleAssignmentScheduleRequestResponse[];
    };
    if (data.value && data.value.length > 0) {
      return data.value[0] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get details of a specific approval by ID.
 */
export const getApprovalDetails = async (credential: AzureCliCredential, approvalId: string): Promise<PendingApproval | null> => {
  startSpinner(`Fetching approval details for ${approvalId}...`);

  try {
    const url = `${ARM_BASE_URL}/providers/Microsoft.Authorization/roleAssignmentApprovals/${approvalId}?api-version=${APPROVAL_API_VERSION}`;
    const response = await fetchWithAuth(credential, url);

    if (!response.ok) {
      if (response.status === 404) {
        warnSpinner("Approval not found");
        return null;
      }
      throw new Error(`Failed to fetch approval: ${response.status} ${response.statusText}`);
    }

    const approval = (await response.json()) as {
      properties?: { stages?: any[] };
    };
    const stages: ApprovalStage[] = (approval.properties?.stages || []).map((stage: any) => ({
      stageId: stage.name,
      displayName: stage.properties?.displayName || "Approval Stage",
      status: stage.properties?.status || "Unknown",
      assignedToMe: stage.properties?.assignedToMe || false,
      reviewResult: stage.properties?.reviewResult || "NotReviewed",
      justification: stage.properties?.justification,
      reviewedBy: stage.properties?.reviewedBy
        ? {
            principalId: stage.properties.reviewedBy.principalId,
            displayName: stage.properties.reviewedBy.principalName,
            userPrincipalName: stage.properties.reviewedBy.userPrincipalName,
          }
        : undefined,
      reviewedDateTime: stage.properties?.reviewedDateTime ? new Date(stage.properties.reviewedDateTime) : undefined,
    }));

    const currentStage = stages.find((s) => s.assignedToMe && s.reviewResult === "NotReviewed");
    const requestDetails = await fetchApprovalRequestDetails(credential, approvalId);

    if (!requestDetails) {
      warnSpinner("Could not fetch full approval details");
      return null;
    }

    succeedSpinner("Approval details loaded");

    return {
      approvalId,
      requestor: {
        principalId: requestDetails.properties.principalId,
        displayName: requestDetails.properties.expandedProperties?.principal?.displayName || "Unknown",
        userPrincipalName: requestDetails.properties.expandedProperties?.principal?.email || "Unknown",
      },
      roleDefinitionId: requestDetails.properties.roleDefinitionId,
      roleName: requestDetails.properties.expandedProperties?.roleDefinition?.displayName || "Unknown Role",
      scope: requestDetails.properties.scope,
      scopeDisplayName: getScopeDisplayName(requestDetails.properties.scope),
      subscriptionId: extractSubscriptionId(requestDetails.properties.scope) || "",
      subscriptionName: requestDetails.properties.expandedProperties?.scope?.displayName || "Unknown",
      justification: requestDetails.properties.justification || "",
      requestedDurationHours: parseDurationToHours(requestDetails.properties.scheduleInfo?.expiration?.duration),
      requestedDateTime: requestDetails.properties.createdOn ? new Date(requestDetails.properties.createdOn) : new Date(),
      expirationDateTime: requestDetails.properties.scheduleInfo?.expiration?.endDateTime
        ? new Date(requestDetails.properties.scheduleInfo.expiration.endDateTime)
        : new Date(),
      stages,
      currentStage,
    };
  } catch (error: any) {
    failSpinner("Failed to fetch approval details");
    throw error;
  }
};

/**
 * Submit an approval decision (Approve or Deny).
 */
export const submitApprovalDecision = async (
  credential: AzureCliCredential,
  approvalId: string,
  stageId: string,
  decision: ApprovalDecision,
  justification: string,
): Promise<ApprovalDecisionResult> => {
  const actionLabel = decision === "Approve" ? "Approving" : "Rejecting";
  startSpinner(`${actionLabel} request...`);

  try {
    const url = `${ARM_BASE_URL}/providers/Microsoft.Authorization/roleAssignmentApprovals/${approvalId}/stages/${stageId}?api-version=${APPROVAL_API_VERSION}`;

    const body = {
      reviewResult: decision,
      justification,
    };

    const response = await fetchWithAuth(credential, url, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `${response.status} ${response.statusText}`;

      try {
        const errorJson = JSON.parse(errorBody);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        // Use default error message
      }

      if (response.status === 409) {
        failSpinner("This request has already been reviewed");
        return {
          approvalId,
          stageId,
          decision,
          justification,
          reviewedDateTime: new Date(),
          success: false,
          error: "This request has already been reviewed",
        };
      }

      if (response.status === 403) {
        failSpinner("This approval stage is not assigned to you");
        return {
          approvalId,
          stageId,
          decision,
          justification,
          reviewedDateTime: new Date(),
          success: false,
          error: "This approval stage is not assigned to you",
        };
      }

      failSpinner(`Failed to ${decision.toLowerCase()} request`);
      return {
        approvalId,
        stageId,
        decision,
        justification,
        reviewedDateTime: new Date(),
        success: false,
        error: errorMessage,
      };
    }

    const resultLabel = decision === "Approve" ? "approved" : "rejected";
    succeedSpinner(`Request ${resultLabel} successfully`);
    logBlank();
    if (decision === "Approve") {
      logSuccess(`The role assignment request has been approved`);
    } else {
      logWarning(`The role assignment request has been rejected`);
    }

    return {
      approvalId,
      stageId,
      decision,
      justification,
      reviewedDateTime: new Date(),
      success: true,
    };
  } catch (error: any) {
    failSpinner(`Failed to ${decision.toLowerCase()} request`);
    return {
      approvalId,
      stageId,
      decision,
      justification,
      reviewedDateTime: new Date(),
      success: false,
      error: error.message,
    };
  }
};

// =============================================================================
// Active Assignments Operations
// =============================================================================

/**
 * Fetch all active role assignments for a subscription (not just current user).
 */
export const fetchAllActiveAssignments = async (
  credential: AzureCliCredential,
  subscriptionId: string,
  subscriptionName: string,
): Promise<AllActiveAssignment[]> => {
  startSpinner(`Fetching all active assignments for "${subscriptionName}"...`);

  const client = new AuthorizationManagementClient(credential, subscriptionId);
  const scope = `/subscriptions/${subscriptionId}`;
  const activeAssignments: AllActiveAssignment[] = [];

  try {
    // List all role assignment schedules (not filtered to current user)
    const schedules = client.roleAssignmentSchedules.listForScope(scope, {});

    for await (const schedule of schedules) {
      if (schedule.id && schedule.roleDefinitionId && schedule.assignmentType === "Activated") {
        activeAssignments.push({
          assignmentId: schedule.id,
          principal: {
            principalId: schedule.principalId || "",
            principalType: (schedule.principalType as AllActiveAssignment["principal"]["principalType"]) || "User",
            displayName: schedule.expandedProperties?.principal?.displayName || "Unknown",
            userPrincipalName: schedule.expandedProperties?.principal?.email,
          },
          roleDefinitionId: schedule.roleDefinitionId,
          roleName: schedule.expandedProperties?.roleDefinition?.displayName || "Unknown Role",
          scope: schedule.scope || scope,
          scopeDisplayName: getScopeDisplayName(schedule.scope || scope),
          subscriptionId,
          subscriptionName,
          assignmentType: "Activated",
          startDateTime: schedule.startDateTime || new Date(),
          endDateTime: schedule.endDateTime || new Date(),
          linkedEligibilityScheduleId: schedule.linkedRoleEligibilityScheduleId,
        });
      }
    }

    succeedSpinner(`Found ${activeAssignments.length} active assignment(s) for "${subscriptionName}"`);
    return activeAssignments;
  } catch (error: any) {
    if (error.statusCode === 403 || error.code === "AuthorizationFailed") {
      warnSpinner(`Insufficient permissions for subscription "${subscriptionName}"`);
      return [];
    }
    failSpinner(`Failed to fetch active assignments for "${subscriptionName}"`);
    throw error;
  }
};

/**
 * Deactivate another user's role assignment (admin action).
 * Requires Owner or User Access Administrator permissions.
 */
export const adminDeactivateAssignment = async (
  credential: AzureCliCredential,
  assignment: AllActiveAssignment,
  justification: string,
): Promise<{ success: boolean; error?: string }> => {
  const displayName = `${assignment.roleName} for ${assignment.principal.displayName}`;
  startSpinner(`Deactivating ${displayName}...`);

  try {
    const client = new AuthorizationManagementClient(credential, assignment.subscriptionId);
    const requestName = uuidv4();

    await client.roleAssignmentScheduleRequests.create(assignment.scope, requestName, {
      principalId: assignment.principal.principalId,
      roleDefinitionId: assignment.roleDefinitionId,
      requestType: "AdminRemove",
      linkedRoleEligibilityScheduleId: assignment.linkedEligibilityScheduleId,
      justification,
    });

    succeedSpinner(`Successfully deactivated ${displayName}`);
    logBlank();
    logSuccess(`Role "${assignment.roleName}" has been deactivated for ${assignment.principal.displayName}`);

    return { success: true };
  } catch (error: any) {
    failSpinner(`Failed to deactivate ${displayName}`);

    let errorMessage = error.message || "Unknown error";
    if (error.statusCode === 403 || error.code === "AuthorizationFailed") {
      errorMessage = "Insufficient permissions. You need Owner or User Access Administrator role to deactivate other users' assignments.";
    }

    logBlank();
    logDim(`Error: ${errorMessage}`);

    return { success: false, error: errorMessage };
  }
};
