import { unlink } from "node:fs/promises";

import type { AzureSubscription } from "../azure/azure-pim";
import { loadJsonFile, saveJsonFile } from "../core/json-store";
import { getUserDataPath } from "../core/paths";

// ===============================
// Types
// ===============================

export type SubscriptionCacheFile = {
  version: 1;
  lastUpdated: string;
  subscriptions: AzureSubscription[];
};

export type LoadedSubscriptionCache = {
  filePath: string;
  data: SubscriptionCacheFile | null;
  exists: boolean;
  isFresh: boolean;
};

// ===============================
// Configuration
// ===============================

const SUBSCRIPTION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Returns the subscription cache file path for a specific user.
 * @returns user-specific path: <config-dir>/subscriptions-cache.json
 */
export const getCacheFilePath = (userId: string): string => {
  return getUserDataPath(userId, "subscriptions-cache.json");
};

// ===============================
// Normalization & Validation
// ===============================

const normalizeSubscriptionCacheFile = (json: unknown): SubscriptionCacheFile | null => {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }

  const file = json as Record<string, unknown>;

  // Validate lastUpdated
  if (typeof file.lastUpdated !== "string") {
    return null;
  }

  // Validate subscriptions array
  if (!Array.isArray(file.subscriptions)) {
    return null;
  }

  const subscriptions: AzureSubscription[] = [];
  for (const sub of file.subscriptions) {
    const entry = sub as Record<string, unknown>;
    if (entry && typeof entry === "object" && typeof entry.subscriptionId === "string" && typeof entry.displayName === "string") {
      subscriptions.push({
        subscriptionId: entry.subscriptionId,
        displayName: entry.displayName,
        tenantId: typeof entry.tenantId === "string" ? entry.tenantId : "",
      });
    }
  }

  return {
    version: 1,
    lastUpdated: file.lastUpdated,
    subscriptions,
  };
};

// ===============================
// Load & Save
// ===============================

/**
 * Loads cached subscriptions for a specific user.
 * @param userId - Azure AD user ID (required)
 */
export const loadCachedSubscriptions = async (userId: string): Promise<LoadedSubscriptionCache> => {
  const filePath = getCacheFilePath(userId);
  const result = await loadJsonFile(filePath, {
    normalize: normalizeSubscriptionCacheFile,
    label: "Invalid subscription cache JSON",
  });

  if (!result.data) {
    return { filePath, data: null, exists: result.exists, isFresh: false };
  }

  // Check if cache is fresh
  const lastUpdatedMs = Date.parse(result.data.lastUpdated);
  const now = Date.now();
  const isFresh = Number.isFinite(lastUpdatedMs) && now - lastUpdatedMs < SUBSCRIPTION_CACHE_TTL_MS;

  return { filePath, data: result.data, exists: true, isFresh };
};

/**
 * Saves cached subscriptions for a specific user.
 * @param userId - Azure AD user ID (required)
 * @param subscriptions - List of subscriptions to cache
 */
export const saveCachedSubscriptions = async (userId: string, subscriptions: AzureSubscription[]): Promise<void> => {
  const filePath = getCacheFilePath(userId);

  const data: SubscriptionCacheFile = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    subscriptions,
  };

  await saveJsonFile(filePath, data);
};

/**
 * Invalidates (deletes) the subscription cache for a specific user.
 * @param userId - Azure AD user ID (required)
 */
export const invalidateCache = async (userId: string): Promise<boolean> => {
  const filePath = getCacheFilePath(userId);
  try {
    await unlink(filePath);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return false; // File didn't exist
    }
    throw error;
  }
};

// ===============================
// Subscription Validation
// ===============================

export type SubscriptionValidationResult = {
  valid: boolean;
  subscription?: AzureSubscription;
};

/**
 * Validates a subscription ID against the cache for a specific user.
 * @param userId - Azure AD user ID (required)
 * @param subscriptionId - Subscription ID to validate
 */
export const validateSubscriptionId = async (userId: string, subscriptionId: string): Promise<SubscriptionValidationResult> => {
  const normalizedId = subscriptionId.trim().toLowerCase();

  const cache = await loadCachedSubscriptions(userId);
  if (!cache.data || cache.data.subscriptions.length === 0) {
    return { valid: false };
  }

  const subscription = cache.data.subscriptions.find((sub) => sub.subscriptionId.toLowerCase() === normalizedId);

  if (subscription) {
    return { valid: true, subscription };
  }

  return { valid: false };
};

// ===============================
// Utilities
// ===============================

/**
 * Returns the age of the subscription cache in milliseconds for a specific user.
 * @param userId - Azure AD user ID (required)
 */
export const getCacheAge = async (userId: string): Promise<number | null> => {
  const cache = await loadCachedSubscriptions(userId);
  if (!cache.data) {
    return null;
  }

  const lastUpdatedMs = Date.parse(cache.data.lastUpdated);
  if (!Number.isFinite(lastUpdatedMs)) {
    return null;
  }

  return Date.now() - lastUpdatedMs;
};

export const formatCacheAge = (ageMs: number | null): string => {
  if (ageMs === null) {
    return "no cache";
  }

  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return `${seconds}s ago`;
};

/**
 * Returns a map of subscription ID to display name for a specific user.
 * @param userId - Azure AD user ID (required)
 */
export const getSubscriptionNameMap = async (userId: string): Promise<Map<string, string>> => {
  const cache = await loadCachedSubscriptions(userId);
  const map = new Map<string, string>();

  if (cache.data) {
    for (const sub of cache.data.subscriptions) {
      map.set(sub.subscriptionId.toLowerCase(), sub.displayName);
    }
  }

  return map;
};
