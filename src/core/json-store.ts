import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { logDebug } from "./ui";

export type JsonLoadOptions<T> = {
  /** Normalizes the parsed JSON into the expected shape. Return null/undefined to treat as empty. */
  normalize: (json: unknown) => T | null | undefined;
  /** Custom error message prefix for invalid JSON. Defaults to "Invalid JSON file". */
  label?: string;
};

export type JsonLoadResult<T> = {
  filePath: string;
  data: T | null;
  exists: boolean;
};

/**
 * Loads, parses, and normalizes a JSON file.
 *
 * Handles:
 * - ENOENT: file doesn't exist → returns { data: null, exists: false }
 * - SyntaxError: invalid JSON → throws descriptive error
 * - Normalization via the provided `normalize` function
 */
export const loadJsonFile = async <T>(filePath: string, options: JsonLoadOptions<T>): Promise<JsonLoadResult<T>> => {
  const { normalize, label = "Invalid JSON file" } = options;

  try {
    logDebug(`Loading JSON file: ${filePath}`);
    const raw = await readFile(filePath, "utf8");
    const json = JSON.parse(raw) as unknown;
    const data = normalize(json) ?? null;
    logDebug(`JSON file loaded successfully: ${filePath}`);
    return { filePath, data, exists: true };
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      logDebug(`JSON file does not exist: ${filePath}`);
      return { filePath, data: null, exists: false };
    }
    if (error instanceof SyntaxError) {
      logDebug(`JSON file contains invalid JSON: ${filePath}`);
      throw new Error(`${label} at ${filePath}`);
    }
    throw error;
  }
};

/**
 * Saves data as JSON to a file, creating parent directories as needed.
 * Appends a trailing newline for consistency.
 */
export const saveJsonFile = async <T>(filePath: string, data: T): Promise<void> => {
  logDebug(`Saving JSON file: ${filePath}`);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify(data, null, 2);
  await writeFile(filePath, `${payload}\n`, "utf8");
  logDebug(`JSON file saved successfully: ${filePath}`);
};

// Type guard for Node.js errors with `code` property
const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && "code" in error;
};
