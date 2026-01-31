import { mkdir, rename, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logInfo, logWarning } from "./ui";

// ===============================
// Constants
// ===============================

const APP_NAME = "azpim";
const USERS_DIR = "users";

// ===============================
// Environment Variable Overrides
// ===============================

export const ENV_FAVORITES_PATH = "AZPIM_FAVORITES_PATH";
export const ENV_PRESETS_PATH = "AZPIM_PRESETS_PATH";

// ===============================
// Base Directory
// ===============================

/**
 * Returns the base config directory for azpim.
 * - Windows: %APPDATA%/azpim
 * - Unix: $XDG_CONFIG_HOME/azpim or ~/.config/azpim
 */
export const getBaseConfigDir = (): string => {
  const platform = process.platform;

  if (platform === "win32") {
    const appData = process.env.APPDATA;
    const base = appData && appData.trim() ? appData.trim() : path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, APP_NAME);
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const base = xdgConfigHome && xdgConfigHome.trim() ? xdgConfigHome.trim() : path.join(os.homedir(), ".config");
  return path.join(base, APP_NAME);
};

// ===============================
// User-Specific Paths
// ===============================

/**
 * Returns the user-specific config directory.
 * E.g., %APPDATA%/azpim/users/<userId>/
 */
export const getUserConfigDir = (userId: string): string => {
  return path.join(getBaseConfigDir(), USERS_DIR, userId);
};

/**
 * Returns a user-specific file path.
 * E.g., %APPDATA%/azpim/users/<userId>/favorites.json
 */
export const getUserDataPath = (userId: string, fileName: string): string => {
  return path.join(getUserConfigDir(userId), fileName);
};

// ===============================
// Global (Legacy) Paths
// ===============================

/**
 * Returns the global (legacy) path for a file.
 * E.g., %APPDATA%/azpim/favorites.json
 */
export const getGlobalFilePath = (fileName: string): string => {
  return path.join(getBaseConfigDir(), fileName);
};

// ===============================
// Migration Logic
// ===============================

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const moveFile = async (src: string, dest: string): Promise<boolean> => {
  try {
    const destDir = path.dirname(dest);
    await mkdir(destDir, { recursive: true });
    await rename(src, dest);
    return true;
  } catch (error: any) {
    // If rename fails (cross-device), try manual copy+delete
    if (error?.code === "EXDEV") {
      const { readFile, writeFile } = await import("node:fs/promises");
      const content = await readFile(src);
      await writeFile(dest, content);
      await unlink(src);
      return true;
    }
    throw error;
  }
};

type MigrationFile = {
  globalPath: string;
  userPath: string;
  name: string;
  envOverride?: string;
};

/**
 * Migrates global config files to user-specific directories.
 * Should be called immediately after authentication.
 *
 * For each file (favorites, presets, subscription-cache):
 * - If env override is set, skip migration for that file
 * - If global file exists and user file doesn't exist, move global to user
 * - Delete original global file after move
 */
export const migrateGlobalFilesToUser = async (userId: string): Promise<void> => {
  const files: MigrationFile[] = [
    {
      name: "favorites",
      globalPath: getGlobalFilePath("favorites.json"),
      userPath: getUserDataPath(userId, "favorites.json"),
      envOverride: process.env[ENV_FAVORITES_PATH],
    },
    {
      name: "presets",
      globalPath: getGlobalFilePath("presets.json"),
      userPath: getUserDataPath(userId, "presets.json"),
      envOverride: process.env[ENV_PRESETS_PATH],
    },
    {
      name: "subscription-cache",
      globalPath: getGlobalFilePath("subscriptions-cache.json"),
      userPath: getUserDataPath(userId, "subscriptions-cache.json"),
      // No env override for cache
    },
  ];

  for (const file of files) {
    // Skip if env override is set
    if (file.envOverride && file.envOverride.trim()) {
      continue;
    }

    try {
      const globalExists = await fileExists(file.globalPath);
      const userExists = await fileExists(file.userPath);

      if (globalExists && !userExists) {
        await moveFile(file.globalPath, file.userPath);
        logInfo(`Migrated ${file.name} to user-specific location`);
      } else if (globalExists && userExists) {
        // Both exist - delete global to avoid confusion
        await unlink(file.globalPath);
        logWarning(`Removed duplicate global ${file.name} file (user-specific version kept)`);
      }
    } catch (error: any) {
      logWarning(`Failed to migrate ${file.name}: ${error?.message ?? "unknown error"}`);
    }
  }
};
