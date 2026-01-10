import { Box, Text } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import type { AuthContext } from "../../auth";
import { deactivateAzureRole, listActiveAzureRolesForUser, type ActiveAzureRole } from "../../azure-pim";
import { EmptyState, ErrorState } from "../components";
import type { NavigateAction, ScreenId } from "../router";
import { CheckboxList } from "../widgets/CheckboxList";
import { ConfirmPrompt } from "../widgets/ConfirmPrompt";

export type DeactivateFlowState = {
  activeRoles?: ActiveAzureRole[];
  selectedLinkedIds: string[];
  results?: Array<{ linkedId: string; ok: boolean; error?: string }>;
};

export type DeactivateFlowProps = {
  authContext: AuthContext;
  screen: ScreenId;
  state: DeactivateFlowState;
  setState: (updater: (prev: DeactivateFlowState) => DeactivateFlowState) => void;
  navigate: (action: NavigateAction) => void;
};

export const DeactivateFlow: React.FC<DeactivateFlowProps> = ({ authContext, screen, state, setState, navigate }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (screen !== "deactivate/roles") return;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const roles = await listActiveAzureRolesForUser(authContext.credential, authContext.userId);
        if (cancelled) return;
        setState((prev) => ({ ...prev, activeRoles: roles }));
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [screen, authContext.credential, authContext.userId, setState]);

  const roleItems = useMemo(() => {
    const roles = state.activeRoles ?? [];
    return roles.map((r) => ({
      key: r.linkedRoleEligibilityScheduleId,
      label: `${r.roleName} — ${r.scopeDisplayName}`,
      meta: `${r.subscriptionName} (${r.subscriptionId})`,
    }));
  }, [state.activeRoles]);

  useEffect(() => {
    if (screen !== "deactivate/progress") return;
    if (!state.activeRoles || state.selectedLinkedIds.length === 0) {
      navigate({ type: "home" });
      return;
    }

    const activeRoles = state.activeRoles;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      setState((prev) => ({ ...prev, results: [] }));

      const results: Array<{ linkedId: string; ok: boolean; error?: string }> = [];

      for (const linkedId of state.selectedLinkedIds) {
        if (cancelled) return;
        const role = activeRoles.find((r) => r.linkedRoleEligibilityScheduleId === linkedId);
        if (!role) {
          results.push({ linkedId, ok: false, error: "Role not found" });
          setState((prev) => ({ ...prev, results: [...results] }));
          continue;
        }

        try {
          await deactivateAzureRole(
            authContext.credential,
            role.scope,
            role.linkedRoleEligibilityScheduleId,
            role.subscriptionId,
            authContext.userId,
            role.roleDefinitionId
          );
          results.push({ linkedId, ok: true });
        } catch (e: unknown) {
          results.push({ linkedId, ok: false, error: e instanceof Error ? e.message : String(e) });
        }

        setState((prev) => ({ ...prev, results: [...results] }));
      }

      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [screen, state.activeRoles, state.selectedLinkedIds, authContext, navigate, setState]);

  if (error) {
    return <ErrorState message="Deactivation flow error" details={error} />;
  }

  if (screen === "deactivate/roles") {
    const roles = state.activeRoles;
    if (!roles && isLoading) return <Text dimColor>Loading active roles…</Text>;
    if (!roles) return <Text dimColor>Loading…</Text>;
    if (roles.length === 0) return <EmptyState message="No active roles found." />;

    return (
      <Box flexDirection="column" gap={1}>
        <Text>Select active roles to deactivate:</Text>
        <CheckboxList
          items={roleItems}
          onSubmit={(selectedKeys) => {
            if (selectedKeys.length === 0) return;
            setState((prev) => ({ ...prev, selectedLinkedIds: selectedKeys }));
            navigate({ type: "push", route: { id: "deactivate/confirm" } });
          }}
        />
        <Text dimColor>Tip: press “a” to toggle all.</Text>
      </Box>
    );
  }

  if (screen === "deactivate/confirm") {
    return (
      <ConfirmPrompt
        message={`Deactivate ${state.selectedLinkedIds.length} role(s)?`}
        onConfirm={() => navigate({ type: "push", route: { id: "deactivate/progress" } })}
        onCancel={() => navigate({ type: "back" })}
      />
    );
  }

  if (screen === "deactivate/progress") {
    const results = state.results ?? [];
    const total = state.selectedLinkedIds.length;
    const done = results.length;
    const ok = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;

    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          Progress: {done}/{total} (ok: {ok}, failed: {fail})
        </Text>
        <Box flexDirection="column">
          {results.slice(-8).map((r) => (
            <Text key={r.linkedId} color={r.ok ? "green" : "red"}>
              {r.ok ? "✓" : "✗"} {r.linkedId}
            </Text>
          ))}
        </Box>
        {done === total && !isLoading ? <Text dimColor>Done. Press m for menu.</Text> : <Text dimColor>Working…</Text>}
      </Box>
    );
  }

  return <Text dimColor>Unknown deactivate screen.</Text>;
};
