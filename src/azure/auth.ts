import { AzureCliCredential } from "@azure/identity";
import { exec } from "child_process";
import { promisify } from "util";
import { failSpinner, logDebug, showUserInfo, startSpinner, succeedSpinner } from "../core/ui";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

export interface AuthContext {
  credential: AzureCliCredential;
  userId: string;
  userPrincipalName: string;
}

let cachedCredential: AzureCliCredential | null = null;

const getCredential = (): AzureCliCredential => {
  if (!cachedCredential) {
    cachedCredential = new AzureCliCredential();
  }
  return cachedCredential;
};

const execAsync = promisify(exec);

const checkAzureCliInstalled = async (): Promise<void> => {
  try {
    logDebug("Checking Azure CLI installation...");
    await execAsync("az --version");
    logDebug("Azure CLI is installed");
  } catch (error) {
    logDebug("Azure CLI check failed", { error: (error as Error)?.message });
    throw new Error("Azure CLI is not installed or not in PATH. Please install it to use this tool.");
  }
};

export const authenticate = async (): Promise<AuthContext> => {
  await checkAzureCliInstalled();
  startSpinner("Authenticating with Azure CLI...");

  try {
    logDebug("Creating AzureCliCredential...");
    const credential = getCredential();

    // Get token and call Microsoft Graph /me directly
    logDebug("Fetching token for Microsoft Graph...");
    const tokenResponse = await credential.getToken(GRAPH_SCOPE);
    logDebug("Calling Microsoft Graph /me endpoint...");
    const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,displayName", {
      headers: {
        Authorization: `Bearer ${tokenResponse.token}`,
        "Accept-Language": "en-US",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Microsoft Graph /me request failed: ${res.status} ${res.statusText}`);
    }

    const user = (await res.json()) as Record<string, unknown>;
    const userId = user.id as string;
    const userPrincipalName = user.userPrincipalName as string;
    logDebug("User details retrieved", { userId, userPrincipalName });

    succeedSpinner("Authentication successful");
    showUserInfo(user.displayName as string, userPrincipalName);

    return {
      credential,
      userId,
      userPrincipalName,
    };
  } catch (error) {
    logDebug("Authentication error", {
      errorType: (error as Record<string, unknown>)?.constructor?.name,
      errorCode: (error as Record<string, unknown>)?.code,
      statusCode: (error as Record<string, unknown>)?.statusCode,
      message: (error as Error)?.message,
    });
    failSpinner("Authentication failed");
    throw error;
  }
};
