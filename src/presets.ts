import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ENV_PRESETS_PATH, getUserDataPath } from "./paths";
import { logDebug } from "./ui";

export type PresetCommandName = "activate" | "deactivate";

export type ActivatePresetOptions = {
  subscriptionId?: string;
  roleNames?: string[];
  durationHours?: number;
  justification?: string;
  allowMultiple?: boolean;
};

export type DeactivatePresetOptions = {
  subscriptionId?: string;
  roleNames?: string[];
  justification?: string;
  allowMultiple?: boolean;
};

export type PresetEntry = {
  description?: string;
  activate?: ActivatePresetOptions;
  deactivate?: DeactivatePresetOptions;
};

export type PresetsFile = {
  version: 1;
  defaults?: {
    activatePreset?: string;
    deactivatePreset?: string;
    activate?: ActivatePresetOptions;
    deactivate?: DeactivatePresetOptions;
  };
  presets?: Record<string, PresetEntry>;
};

export type LoadedPresets = {
  filePath: string;
  data: PresetsFile;
  exists: boolean;
};

export type TemplateContext = {
  userId?: string;
  userPrincipalName?: string;
  now?: Date;
};

/**
 * Returns the presets file path for a specific user.
 * If AZPIM_PRESETS_PATH env is set, uses that as absolute override.
 * Otherwise returns user-specific path: %APPDATA%/azpim/users/<userId>/presets.json
 */
export const getPresetsFilePath = (userId: string): string => {
  const envOverride = process.env[ENV_PRESETS_PATH];
  if (envOverride && envOverride.trim()) {
    logDebug("Using presets file path override from environment variable", {
      path: envOverride.trim(),
      env: ENV_PRESETS_PATH,
    });
    return envOverride.trim();
  }
  const defaultPath = getUserDataPath(userId, "presets.json");
  logDebug("Using default presets file path", { path: defaultPath });
  return defaultPath;
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  return strings;
};

const validateActivateOptions = (value: unknown): ActivatePresetOptions | undefined => {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error("Invalid presets file: defaults.activate/presets[].activate must be an object");

  const roleNames = normalizeStringArray(value.roleNames);
  const subscriptionId = typeof value.subscriptionId === "string" ? value.subscriptionId : undefined;
  const durationHours = typeof value.durationHours === "number" ? value.durationHours : undefined;
  const justification = typeof value.justification === "string" ? value.justification : undefined;
  const allowMultiple = typeof value.allowMultiple === "boolean" ? value.allowMultiple : undefined;

  return {
    subscriptionId,
    roleNames,
    durationHours,
    justification,
    allowMultiple,
  };
};

const validateDeactivateOptions = (value: unknown): DeactivatePresetOptions | undefined => {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error("Invalid presets file: defaults.deactivate/presets[].deactivate must be an object");

  const roleNames = normalizeStringArray(value.roleNames);
  const subscriptionId = typeof value.subscriptionId === "string" ? value.subscriptionId : undefined;
  const justification = typeof value.justification === "string" ? value.justification : undefined;
  const allowMultiple = typeof value.allowMultiple === "boolean" ? value.allowMultiple : undefined;

  return { subscriptionId, roleNames, justification, allowMultiple };
};

const validatePresetEntry = (value: unknown): PresetEntry => {
  if (!isObject(value)) throw new Error("Invalid presets file: each preset must be an object");

  const description = typeof value.description === "string" ? value.description : undefined;
  const activate = validateActivateOptions(value.activate);
  const deactivate = validateDeactivateOptions(value.deactivate);

  return { description, activate, deactivate };
};

export const normalizePresetsFile = (value: unknown): PresetsFile => {
  if (!isObject(value)) {
    throw new Error("Invalid presets file: expected a JSON object at the top level");
  }

  const version = value.version;
  if (version !== 1) {
    throw new Error(`Invalid presets file: expected { version: 1 }, got version=${String(version)}`);
  }

  const defaultsRaw = value.defaults;
  let defaults: PresetsFile["defaults"] | undefined;
  if (defaultsRaw !== undefined) {
    if (!isObject(defaultsRaw)) throw new Error("Invalid presets file: defaults must be an object");
    defaults = {
      activatePreset: typeof defaultsRaw.activatePreset === "string" ? defaultsRaw.activatePreset : undefined,
      deactivatePreset: typeof defaultsRaw.deactivatePreset === "string" ? defaultsRaw.deactivatePreset : undefined,
      activate: validateActivateOptions(defaultsRaw.activate),
      deactivate: validateDeactivateOptions(defaultsRaw.deactivate),
    };
  }

  const presetsRaw = value.presets;
  let presets: Record<string, PresetEntry> | undefined;
  if (presetsRaw !== undefined) {
    if (!isObject(presetsRaw)) throw new Error("Invalid presets file: presets must be an object map");

    presets = {};
    for (const [name, entry] of Object.entries(presetsRaw)) {
      presets[name] = validatePresetEntry(entry);
    }
  }

  return {
    version: 1,
    defaults,
    presets,
  };
};

/**
 * Loads presets for a specific user.
 * @param userId - Azure AD user ID (required)
 */
export const loadPresets = async (userId: string): Promise<LoadedPresets> => {
  const filePath = getPresetsFilePath(userId);
  logDebug("Loading presets file", { filePath });
  try {
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as unknown;
    const normalized = normalizePresetsFile(json);
    const presetCount = Object.keys(normalized.presets ?? {}).length;
    logDebug("Presets file loaded successfully", {
      filePath,
      presetCount,
      hasDefaultActivate: Boolean(normalized.defaults?.activatePreset),
      hasDefaultDeactivate: Boolean(normalized.defaults?.deactivatePreset),
    });
    return { filePath, data: normalizePresetsFile(json), exists: true };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      logDebug("Presets file does not exist, returning empty presets", { filePath });
      return { filePath, data: { version: 1, presets: {} }, exists: false };
    }
    if (error instanceof SyntaxError) {
      logDebug("Presets file contains invalid JSON", { filePath, error: error.message });
      throw new Error(`Invalid presets file JSON at ${filePath}`);
    }
    throw error;
  }
};

export const savePresets = async (filePath: string, data: PresetsFile): Promise<void> => {
  logDebug("Saving presets file", { filePath, presetCount: Object.keys(data.presets ?? {}).length });
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify(data, null, 2);
  await writeFile(filePath, `${payload}\n`, "utf8");
  logDebug("Presets file saved successfully", { filePath });
};

export const listPresetNames = (data: PresetsFile): string[] => {
  const presets = data.presets ?? {};
  return Object.keys(presets).sort((a, b) => a.localeCompare(b));
};

export const getPreset = (data: PresetsFile, name: string): PresetEntry | undefined => {
  return data.presets?.[name];
};

export const upsertPreset = (data: PresetsFile, name: string, entry: PresetEntry): PresetsFile => {
  const next: PresetsFile = {
    version: 1,
    defaults: data.defaults,
    presets: { ...(data.presets ?? {}) },
  };
  next.presets![name] = entry;
  return next;
};

export const removePreset = (data: PresetsFile, name: string): PresetsFile => {
  const current = data.presets ?? {};
  const { [name]: _removed, ...rest } = current;
  return { version: 1, defaults: data.defaults, presets: rest };
};

export const setDefaultPresetName = (data: PresetsFile, command: PresetCommandName, name: string | undefined): PresetsFile => {
  const defaults = { ...(data.defaults ?? {}) };
  if (command === "activate") {
    defaults.activatePreset = name;
  } else {
    defaults.deactivatePreset = name;
  }
  return { version: 1, defaults, presets: data.presets ?? {} };
};

export const resolveActivatePresetOptions = (data: PresetsFile, presetName?: string): ActivatePresetOptions => {
  logDebug("Resolving activate preset options", {
    presetName,
    hasDefaultActivate: Boolean(data.defaults?.activatePreset),
    hasPreset: presetName ? Boolean(data.presets?.[presetName]) : false,
  });
  const base = data.defaults?.activate ?? {};
  const fromPreset = presetName ? (data.presets?.[presetName]?.activate ?? {}) : {};
  const resolved = {
    subscriptionId: fromPreset.subscriptionId ?? base.subscriptionId,
    roleNames: fromPreset.roleNames ?? base.roleNames,
    durationHours: fromPreset.durationHours ?? base.durationHours,
    justification: fromPreset.justification ?? base.justification,
    allowMultiple: fromPreset.allowMultiple ?? base.allowMultiple,
  };
  logDebug("Resolved activate preset options", { resolved });
  return resolved;
};

export const resolveDeactivatePresetOptions = (data: PresetsFile, presetName?: string): DeactivatePresetOptions => {
  logDebug("Resolving deactivate preset options", {
    presetName,
    hasDefaultDeactivate: Boolean(data.defaults?.deactivatePreset),
    hasPreset: presetName ? Boolean(data.presets?.[presetName]) : false,
  });
  const base = data.defaults?.deactivate ?? {};
  const fromPreset = presetName ? (data.presets?.[presetName]?.deactivate ?? {}) : {};
  const resolved = {
    subscriptionId: fromPreset.subscriptionId ?? base.subscriptionId,
    roleNames: fromPreset.roleNames ?? base.roleNames,
    justification: fromPreset.justification ?? base.justification,
    allowMultiple: fromPreset.allowMultiple ?? base.allowMultiple,
  };
  logDebug("Resolved deactivate preset options", { resolved });
  return resolved;
};

export const expandTemplate = (template: string, context: TemplateContext = {}): string => {
  const now = context.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const datetime = now.toISOString();

  return template.replace(/\$\{([^}]+)\}/g, (_match, keyRaw) => {
    const key = String(keyRaw).trim();
    if (key === "date") return date;
    if (key === "datetime") return datetime;
    if (key === "userPrincipalName") return context.userPrincipalName ?? "";
    if (key === "userId") return context.userId ?? "";
    return _match;
  });
};
