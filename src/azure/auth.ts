import { AzureCliCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { exec } from "child_process";
import { promisify } from "util";
import { failSpinner, logDebug, showUserInfo, startSpinner, succeedSpinner } from "../core/ui";

export const GRAPH_SCOPES = ["https://graph.microsoft.com/.default"];

export interface AuthContext {
  credential: AzureCliCredential;
  graphClient: Client;
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

    // Create Microsoft Graph client
    logDebug("Creating Microsoft Graph client...", { scopes: GRAPH_SCOPES });
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: GRAPH_SCOPES,
    });

    const graphClient = Client.initWithMiddleware({
      authProvider,
      defaultVersion: "v1.0",
    });

    // Get user details
    logDebug("Calling Microsoft Graph /me endpoint...");
    const user = await graphClient.api("/me").header("Accept-Language", "en-US").select("id,userPrincipalName,displayName").get();
    const userId = user.id;
    const userPrincipalName = user.userPrincipalName;
    logDebug("User details retrieved", { userId, userPrincipalName });

    succeedSpinner("Authentication successful");
    showUserInfo(user.displayName, userPrincipalName);

    return {
      credential,
      graphClient,
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
