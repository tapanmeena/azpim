import { AzureCliCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import chalk from "chalk";

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

export const authenticate = async (): Promise<AuthContext> => {
  if (process.env.AZP_CLI_DEBUG === "1") {
    console.log(chalk.blueBright("Authenticating with Azure CLI..."));
  }

  const credential = getCredential();

  // Create Microsoft Graph client
  const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: GRAPH_SCOPES });

  const graphClient = Client.initWithMiddleware({ authProvider, defaultVersion: "v1.0" });

  // Get user details
  const user = await graphClient.api("/me").header("Accept-Language", "en-US").select("id,userPrincipalName,displayName").get();
  const userId = user.id;
  const userPrincipalName = user.userPrincipalName;

  if (process.env.AZP_CLI_DEBUG === "1") {
    console.log(chalk.greenBright(`Authenticated as ${userPrincipalName} (ID: ${userId})`));
  }

  return {
    credential,
    graphClient,
    userId,
    userPrincipalName,
  };
};

export const getArmToken = async (credential: AzureCliCredential): Promise<string> => {
  const tokenResponse = await credential.getToken(ARM_SCOPES);
  if (!tokenResponse) {
    throw new Error("Failed to acquire ARM token");
  }
  return tokenResponse.token;
};
