import { loadJsonFile, saveJsonFile } from "../core/json-store";
import { ENV_PRESETS_PATH, getUserDataPath } from "../core/paths";
import { logDebug } from "../core/ui";

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

/**
 * Validates a preset options object for either activate or deactivate.
 * The `durationHours` field is only included for activate presets.
 */
const validatePresetCommandOptions = (value: unknown, type: PresetCommandName): ActivatePresetOptions | DeactivatePresetOptions | undefined => {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`Invalid presets file: defaults.${type}/presets[].${type} must be an object`);

  const roleNames = normalizeStringArray(value.roleNames);
  const subscriptionId = typeof value.subscriptionId === "string" ? value.subscriptionId : undefined;
  const justification = typeof value.justification === "string" ? value.justification : undefined;
  const allowMultiple = typeof value.allowMultiple === "boolean" ? value.allowMultiple : undefined;

  const base = { subscriptionId, roleNames, justification, allowMultiple };

  if (type === "activate") {
    const durationHours = typeof value.durationHours === "number" ? value.durationHours : undefined;
    return { ...base, durationHours } as ActivatePresetOptions;
  }

  return base as DeactivatePresetOptions;
};

const validatePresetEntry = (value: unknown): PresetEntry => {
  if (!isObject(value)) throw new Error("Invalid presets file: each preset must be an object");

  const description = typeof value.description === "string" ? value.description : undefined;
  const activate = validatePresetCommandOptions(value.activate, "activate") as ActivatePresetOptions | undefined;
  const deactivate = validatePresetCommandOptions(value.deactivate, "deactivate") as DeactivatePresetOptions | undefined;

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
      activate: validatePresetCommandOptions(defaultsRaw.activate, "activate") as ActivatePresetOptions | undefined,
      deactivate: validatePresetCommandOptions(defaultsRaw.deactivate, "deactivate") as DeactivatePresetOptions | undefined,
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

  const result = await loadJsonFile(filePath, {
    normalize: normalizePresetsFile,
    label: "Invalid presets file JSON",
  });

  if (result.data) {
    const presetCount = Object.keys(result.data.presets ?? {}).length;
    logDebug("Presets file loaded successfully", {
      filePath,
      presetCount,
      hasDefaultActivate: Boolean(result.data.defaults?.activatePreset),
      hasDefaultDeactivate: Boolean(result.data.defaults?.deactivatePreset),
    });
    return { filePath, data: result.data, exists: result.exists };
  }

  logDebug("Presets file does not exist, returning empty presets", {
    filePath,
  });
  return { filePath, data: { version: 1, presets: {} }, exists: false };
};

export const savePresets = async (filePath: string, data: PresetsFile): Promise<void> => {
  logDebug("Saving presets file", {
    filePath,
    presetCount: Object.keys(data.presets ?? {}).length,
  });
  await saveJsonFile(filePath, data);
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

/**
 * Resolves effective preset options by merging base defaults with preset-specific overrides.
 */
const resolvePresetCommandOptions = (
  data: PresetsFile,
  type: PresetCommandName,
  presetName?: string,
): ActivatePresetOptions | DeactivatePresetOptions => {
  logDebug(`Resolving ${type} preset options`, {
    presetName,
    hasDefault: Boolean(data.defaults?.[type === "activate" ? "activatePreset" : "deactivatePreset"]),
    hasPreset: presetName ? Boolean(data.presets?.[presetName]) : false,
  });

  const base = (type === "activate" ? data.defaults?.activate : data.defaults?.deactivate) ?? {};
  const fromPreset = presetName ? (data.presets?.[presetName]?.[type] ?? {}) : {};

  const resolved: Record<string, unknown> = {
    subscriptionId: fromPreset.subscriptionId ?? base.subscriptionId,
    roleNames: fromPreset.roleNames ?? base.roleNames,
    justification: fromPreset.justification ?? base.justification,
    allowMultiple: fromPreset.allowMultiple ?? base.allowMultiple,
  };

  if (type === "activate") {
    resolved.durationHours = (fromPreset as ActivatePresetOptions).durationHours ?? (base as ActivatePresetOptions).durationHours;
  }

  logDebug(`Resolved ${type} preset options`, { resolved });
  return resolved as ActivatePresetOptions | DeactivatePresetOptions;
};

export const resolveActivatePresetOptions = (data: PresetsFile, presetName?: string): ActivatePresetOptions => {
  return resolvePresetCommandOptions(data, "activate", presetName) as ActivatePresetOptions;
};

export const resolveDeactivatePresetOptions = (data: PresetsFile, presetName?: string): DeactivatePresetOptions => {
  return resolvePresetCommandOptions(data, "deactivate", presetName) as DeactivatePresetOptions;
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
