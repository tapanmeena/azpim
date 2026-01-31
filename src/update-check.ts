import "isomorphic-fetch";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBaseConfigDir } from "./paths";

export type UpdateCheckMode = "auto" | "force";

export type UpdateCheckResult = {
  ok: boolean;
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  checkedAt: string;
  cached: boolean;
  error?: string;
};

type UpdateCheckStateFile = {
  lastCheckedAt: string;
  latestVersion: string;
};

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 1500;

const getUpdateStateFilePath = (): string => {
  const configDir = getBaseConfigDir();
  return path.join(configDir, "update-check.json");
};

const parseSemver = (value: string): [number, number, number] | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const isUpdateAvailable = (currentVersion: string, latestVersion: string): boolean | undefined => {
  const current = parseSemver(currentVersion);
  const latest = parseSemver(latestVersion);
  if (!current || !latest) return undefined;

  const [c0, c1, c2] = current;
  const [l0, l1, l2] = latest;

  if (c0 !== l0) return c0 < l0;
  if (c1 !== l1) return c1 < l1;
  if (c2 !== l2) return c2 < l2;
  return false;
};

const isDisabledByEnv = (): boolean => {
  const keys = ["AZPIM_NO_UPDATE_NOTIFIER", "AZPIM_DISABLE_UPDATE_CHECK"];
  for (const key of keys) {
    const value = process.env[key];
    if (!value) continue;
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  }
  return false;
};

const readState = async (filePath: string): Promise<UpdateCheckStateFile | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as unknown;
    if (!json || typeof json !== "object") return undefined;

    const lastCheckedAt = (json as any).lastCheckedAt;
    const latestVersion = (json as any).latestVersion;

    if (typeof lastCheckedAt !== "string" || typeof latestVersion !== "string") return undefined;
    return { lastCheckedAt, latestVersion };
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    return undefined;
  }
};

const writeState = async (filePath: string, state: UpdateCheckStateFile): Promise<void> => {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const fetchLatestVersion = async (packageName: string, timeoutMs: number): Promise<string> => {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "azpim-update-check",
      },
    });

    if (!res.ok) {
      throw new Error(`npm registry request failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as any;
    const version = typeof json?.version === "string" ? json.version : undefined;
    if (!version) throw new Error("npm registry response missing version");
    return version;
  } finally {
    clearTimeout(timeout);
  }
};

export const checkForUpdate = async (options: {
  packageName: string;
  currentVersion: string;
  mode?: UpdateCheckMode;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<UpdateCheckResult> => {
  const packageName = options.packageName;
  const currentVersion = options.currentVersion;
  const mode: UpdateCheckMode = options.mode ?? "auto";
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const stateFilePath = getUpdateStateFilePath();
  const now = new Date();

  if (mode === "auto" && isDisabledByEnv()) {
    return {
      ok: true,
      packageName,
      currentVersion,
      checkedAt: now.toISOString(),
      cached: true,
    };
  }

  const state = await readState(stateFilePath);
  if (mode === "auto" && state) {
    const lastCheckedAtMs = Date.parse(state.lastCheckedAt);

    // Use cached result if within interval i.e. 24 hours
    if (Number.isFinite(lastCheckedAtMs) && now.getTime() - lastCheckedAtMs < intervalMs) {
      const updateAvailable = isUpdateAvailable(currentVersion, state.latestVersion);
      return {
        ok: true,
        packageName,
        currentVersion,
        latestVersion: state.latestVersion,
        updateAvailable,
        checkedAt: now.toISOString(),
        cached: true,
      };
    }
  }

  try {
    const latestVersion = await fetchLatestVersion(packageName, timeoutMs);
    const updateAvailable = isUpdateAvailable(currentVersion, latestVersion);

    await writeState(stateFilePath, {
      lastCheckedAt: now.toISOString(),
      latestVersion,
    });

    return {
      ok: true,
      packageName,
      currentVersion,
      latestVersion,
      updateAvailable,
      checkedAt: now.toISOString(),
      cached: false,
    };
  } catch (error: any) {
    return {
      ok: false,
      packageName,
      currentVersion,
      checkedAt: now.toISOString(),
      cached: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
