import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadJsonFile, saveJsonFile } from "../core/json-store";
import { ENV_FAVORITES_PATH, getUserDataPath } from "../core/paths";

// ===============================
// Types
// ===============================

export type FavoritesFile = {
  version: 1;
  subscriptionIds: string[];
};

export type LoadedFavorites = {
  filePath: string;
  data: FavoritesFile;
  exists: boolean;
};

// ===============================
// File Path
// ===============================

/**
 * Returns the favorites file path for a specific user.
 * If AZPIM_FAVORITES_PATH env is set, uses that as absolute override.
 * Otherwise returns user-specific path: %APPDATA%/azpim/users/<userId>/favorites.json
 */
export const getFavoritesFilePath = (userId: string): string => {
  const envOverride = process.env[ENV_FAVORITES_PATH];
  if (envOverride && envOverride.trim()) {
    return envOverride.trim();
  }
  return getUserDataPath(userId, "favorites.json");
};

// ===============================
// Normalization & Validation
// ===============================

const normalizeFavoritesFile = (json: unknown): FavoritesFile => {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { version: 1, subscriptionIds: [] };
  }

  const file = json as Record<string, unknown>;

  // Validate subscriptionIds array
  let subscriptionIds: string[] = [];
  if (Array.isArray(file.subscriptionIds)) {
    subscriptionIds = file.subscriptionIds
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim().toLowerCase());
    // Remove duplicates
    subscriptionIds = [...new Set(subscriptionIds)];
  }

  return { version: 1, subscriptionIds };
};

// ===============================
// Load & Save
// ===============================

/**
 * Loads favorites for a specific user.
 * @param userId - Azure AD user ID (required)
 */
export const loadFavorites = async (userId: string): Promise<LoadedFavorites> => {
  const filePath = getFavoritesFilePath(userId);
  const result = await loadJsonFile(filePath, {
    normalize: normalizeFavoritesFile,
    label: "Invalid favorites file JSON",
  });
  return {
    filePath,
    data: result.data ?? { version: 1, subscriptionIds: [] },
    exists: result.exists,
  };
};

export const saveFavorites = async (filePath: string, data: FavoritesFile): Promise<void> => {
  await saveJsonFile(filePath, data);
};

// ===============================
// CRUD Operations
// ===============================

export const isFavorite = (data: FavoritesFile, subscriptionId: string): boolean => {
  const normalizedId = subscriptionId.trim().toLowerCase();
  return data.subscriptionIds.includes(normalizedId);
};

export const addFavorite = (data: FavoritesFile, subscriptionId: string): FavoritesFile => {
  const normalizedId = subscriptionId.trim().toLowerCase();
  if (data.subscriptionIds.includes(normalizedId)) {
    return data; // Already exists
  }
  return {
    ...data,
    subscriptionIds: [...data.subscriptionIds, normalizedId],
  };
};

export const removeFavorite = (data: FavoritesFile, subscriptionId: string): FavoritesFile => {
  const normalizedId = subscriptionId.trim().toLowerCase();
  return {
    ...data,
    subscriptionIds: data.subscriptionIds.filter((id) => id !== normalizedId),
  };
};

export const toggleFavorite = (data: FavoritesFile, subscriptionId: string): { data: FavoritesFile; added: boolean } => {
  const normalizedId = subscriptionId.trim().toLowerCase();
  if (data.subscriptionIds.includes(normalizedId)) {
    return { data: removeFavorite(data, subscriptionId), added: false };
  }
  return { data: addFavorite(data, subscriptionId), added: true };
};

export const clearFavorites = (data: FavoritesFile): FavoritesFile => {
  return { ...data, subscriptionIds: [] };
};

export const getFavoriteIds = (data: FavoritesFile): string[] => {
  return [...data.subscriptionIds];
};

// ===============================
// Import & Export
// ===============================

export type FavoritesExportFile = {
  version: 1;
  exportedAt: string;
  favorites: Array<{
    subscriptionId: string;
    displayName?: string;
  }>;
};

export const exportFavorites = async (data: FavoritesFile, outputPath: string, subscriptionNames?: Map<string, string>): Promise<void> => {
  const exportData: FavoritesExportFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    favorites: data.subscriptionIds.map((id) => ({
      subscriptionId: id,
      displayName: subscriptionNames?.get(id),
    })),
  };

  const dir = path.dirname(outputPath);
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify(exportData, null, 2);
  await writeFile(outputPath, `${payload}\n`, "utf8");
};

export type ImportResult = {
  imported: number;
  skipped: number;
  total: number;
};

export const importFavorites = async (
  currentData: FavoritesFile,
  inputPath: string,
  merge: boolean = true,
): Promise<{ data: FavoritesFile; result: ImportResult }> => {
  const raw = await readFile(inputPath, "utf8");
  const json = JSON.parse(raw) as unknown;

  if (!json || typeof json !== "object") {
    throw new Error(`Invalid favorites import file at ${inputPath}`);
  }

  const importFile = json as Record<string, unknown>;
  let importedIds: string[] = [];

  // Support both export format and simple format
  if (Array.isArray(importFile.favorites)) {
    // Export format: { favorites: [{ subscriptionId: "..." }] }
    importedIds = importFile.favorites
      .filter((item): item is { subscriptionId: string } => {
        return item && typeof item === "object" && typeof (item as Record<string, unknown>).subscriptionId === "string";
      })
      .map((item) => item.subscriptionId.trim().toLowerCase());
  } else if (Array.isArray(importFile.subscriptionIds)) {
    // Simple format: { subscriptionIds: ["..."] }
    importedIds = importFile.subscriptionIds
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim().toLowerCase());
  } else {
    throw new Error(`Invalid favorites import file format at ${inputPath}`);
  }

  const baseIds = merge ? [...currentData.subscriptionIds] : [];
  const existingSet = new Set(baseIds);

  let imported = 0;
  let skipped = 0;

  for (const id of importedIds) {
    if (existingSet.has(id)) {
      skipped++;
    } else {
      baseIds.push(id);
      existingSet.add(id);
      imported++;
    }
  }

  return {
    data: { version: 1, subscriptionIds: baseIds },
    result: {
      imported,
      skipped,
      total: importedIds.length,
    },
  };
};
