import { AzureCliCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { exec } from "child_process";
import { promisify } from "util";
import { failSpinner, logDebug, showUserInfo, startSpinner, succeedSpinner } from "./ui";

const GRAPH_SCOPES = ["https://graph.microsoft.com/.default"];

const ARM_SCOPES = ["https://management.azure.com/.default"];

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
      errorType: (error as any)?.constructor?.name,
      errorCode: (error as any)?.code,
      statusCode: (error as any)?.statusCode,
      message: (error as Error)?.message,
    });
    failSpinner("Authentication failed");
    throw error;
  }
};

export const getArmToken = async (credential: AzureCliCredential): Promise<string> => {
  logDebug("Acquiring ARM token...", { scopes: ARM_SCOPES });
  const tokenResponse = await credential.getToken(ARM_SCOPES);
  if (!tokenResponse) {
    logDebug("Failed to acquire ARM token");
    throw new Error("Failed to acquire ARM token");
  }
  logDebug("ARM token acquired successfully");
  return tokenResponse.token;
};
