import { Command } from "commander";
import { authenticate, type AuthContext } from "../azure/auth";
import { handleCommandError, type OutputFormat } from "../core/errors";
import { migrateGlobalFilesToUser } from "../core/paths";
import { configureUi, showHeader } from "../core/ui";

/**
 * Common context available to every command handler.
 */
export interface CommandContext {
  /** Resolved output format (text or json). */
  output: OutputFormat;
  /** Whether non-essential output is suppressed. */
  quiet: boolean;
  /** Whether debug logging is enabled. */
  debug: boolean;
}

/**
 * Extended context that also includes authenticated user info.
 * Provided when `auth: true` (the default) is passed to `withCommandHandler`.
 */
export interface AuthenticatedCommandContext extends CommandContext {
  authContext: AuthContext;
}

/**
 * Options for `withCommandHandler`.
 */
interface HandlerOptions {
  /**
   * Whether this command requires authentication.
   * When true (default), the handler receives an `AuthenticatedCommandContext`.
   * When false, the handler receives a plain `CommandContext`.
   */
  auth?: boolean;
  /**
   * Whether to show the banner/header before the command runs.
   * Defaults to true.
   */
  showHeader?: boolean;
}

/** Extracts output & quiet from any command options bag. */
const resolveOutputOptions = (cmd: Record<string, unknown>): { output: OutputFormat; quiet: boolean } => {
  const output = ((cmd.output as string) ?? "text") as OutputFormat;
  const quiet = Boolean(cmd.quiet || output === "json");
  return { output, quiet };
};

/**
 * Creates a Commander `.action()` callback that handles:
 * - configureUi (quiet, debug)
 * - showHeader
 * - optional authentication + file migration
 * - consistent error handling via `handleCommandError`
 *
 * This eliminates ~20 lines of duplicated boilerplate per command.
 *
 * @example
 * ```ts
 * .action(withCommandHandler(program, async (cmd, ctx) => {
 *   // ctx.authContext is available here
 *   logSuccess("Done");
 * }))
 * ```
 */
export function withCommandHandler<TCmdOpts extends Record<string, unknown>>(
  program: Command,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (cmd: TCmdOpts, ctx: any, command: Command) => Promise<void>,
  options: HandlerOptions = {},
): (cmd: TCmdOpts, command: Command) => Promise<void> {
  const { auth = true, showHeader: doShowHeader = true } = options;

  return async (cmd: TCmdOpts, command: Command) => {
    const { output, quiet } = resolveOutputOptions(cmd as Record<string, unknown>);
    const debug = Boolean(program.opts().debug);

    configureUi({ quiet, debug });

    if (doShowHeader) {
      showHeader();
    }

    try {
      if (auth) {
        const authContext = await authenticate();
        await migrateGlobalFilesToUser(authContext.userId);
        await handler(cmd, { output, quiet, debug, authContext }, command);
      } else {
        await handler(cmd, { output, quiet, debug }, command);
      }
    } catch (error: unknown) {
      handleCommandError(error, output);
    }
  };
}
