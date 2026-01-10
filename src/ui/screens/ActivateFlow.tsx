import { Box, Text } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import type { AuthContext } from "../../auth";
import {
  activateAzureRole,
  type AzureActivationRequest,
  type AzureSubscription,
  type EligibleAzureRole,
  fetchEligibleRolesForSubscription,
  fetchSubscriptions,
} from "../../azure-pim";
import { EmptyState, ErrorState } from "../components";
import type { NavigateAction, ScreenId } from "../router";
import { CheckboxList } from "../widgets/CheckboxList";
import { ConfirmPrompt } from "../widgets/ConfirmPrompt";
import { NumberPrompt } from "../widgets/NumberPrompt";
import { SelectList, type SelectListItem } from "../widgets/SelectList";
import { TextPrompt } from "../widgets/TextPrompt";

export type ActivateFlowState = {
  subscription?: AzureSubscription;
  eligibleRoles?: EligibleAzureRole[];
  selectedRoleIds: string[];
  durationHours?: number;
  justification?: string;
  results?: Array<{ roleId: string; ok: boolean; error?: string }>;
};

export type ActivateFlowProps = {
  authContext: AuthContext;
  screen: ScreenId;
  state: ActivateFlowState;
  setState: (updater: (prev: ActivateFlowState) => ActivateFlowState) => void;
  navigate: (action: NavigateAction) => void;
};

export const ActivateFlow: React.FC<ActivateFlowProps> = ({ authContext, screen, state, setState, navigate }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1) subscriptions
  const [subscriptions, setSubscriptions] = useState<AzureSubscription[] | null>(null);

  useEffect(() => {
    if (screen !== "activate/subscriptions") return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const subs = await fetchSubscriptions(authContext.credential);
        if (cancelled) return;
        setSubscriptions(subs);
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
  }, [screen, authContext.credential]);

  const subscriptionItems: SelectListItem<AzureSubscription>[] = useMemo(() => {
    return (subscriptions ?? []).map((s) => ({
      key: s.subscriptionId,
      label: s.displayName,
      meta: s.subscriptionId,
      value: s,
    }));
  }, [subscriptions]);

  // 2) eligible roles
  useEffect(() => {
    if (screen !== "activate/eligible-roles") return;
    const subscription = state.subscription;
    if (!subscription) {
      navigate({ type: "replace", route: { id: "activate/subscriptions" } });
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const roles = await fetchEligibleRolesForSubscription(
          authContext.credential,
          subscription.subscriptionId,
          subscription.displayName,
          authContext.userId
        );
        if (cancelled) return;
        setState((prev) => ({ ...prev, eligibleRoles: roles }));
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
  }, [screen, state.subscription, authContext.credential, authContext.userId, navigate, setState]);

  const roleItems = useMemo(() => {
    const roles = state.eligibleRoles ?? [];
    return roles.map((r) => ({
      key: r.id,
      label: `${r.roleName} — ${r.scopeDisplayName}`,
    }));
  }, [state.eligibleRoles]);

  // 3) progress
  useEffect(() => {
    if (screen !== "activate/progress") return;
    if (!state.subscription || !state.eligibleRoles || state.selectedRoleIds.length === 0 || !state.durationHours || !state.justification) {
      navigate({ type: "home" });
      return;
    }

    const subscription = state.subscription;
    const eligibleRoles = state.eligibleRoles;
    const durationHours = state.durationHours;
    const justification = state.justification;

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      setState((prev) => ({ ...prev, results: [] }));

      const results: Array<{ roleId: string; ok: boolean; error?: string }> = [];

      for (const roleId of state.selectedRoleIds) {
        if (cancelled) return;
        const role = eligibleRoles.find((r) => r.id === roleId);
        if (!role) {
          results.push({ roleId, ok: false, error: "Role not found" });
          setState((prev) => ({ ...prev, results: [...results] }));
          continue;
        }

        const req: AzureActivationRequest = {
          principalId: authContext.userId,
          roleDefinitionId: role.roleDefinitionId,
          roleName: `${role.roleName} - ${role.scopeDisplayName}`,
          roleEligibilityScheduleId: role.roleEligibilityScheduleId,
          scope: role.scope,
          durationHours,
          justification,
        };

        try {
          await activateAzureRole(authContext.credential, req, subscription.subscriptionId);
          results.push({ roleId, ok: true });
        } catch (e: unknown) {
          results.push({ roleId, ok: false, error: e instanceof Error ? e.message : String(e) });
        }

        setState((prev) => ({ ...prev, results: [...results] }));
      }

      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    screen,
    state.subscription,
    state.eligibleRoles,
    state.selectedRoleIds,
    state.durationHours,
    state.justification,
    authContext,
    navigate,
    setState,
  ]);

  // Render
  if (error) {
    return <ErrorState message="Activation flow error" details={error} />;
  }

  if (screen === "activate/subscriptions") {
    if (isLoading && !subscriptions) return <Text dimColor>Loading subscriptions…</Text>;
    if (!subscriptions) return <Text dimColor>Loading…</Text>;
    if (subscriptions.length === 0) return <EmptyState message="No subscriptions found." />;

    return (
      <Box flexDirection="column" gap={1}>
        <Text>Select a subscription:</Text>
        <SelectList
          items={subscriptionItems}
          isLoading={isLoading}
          onSelect={(sub) => {
            setState((prev) => ({ ...prev, subscription: sub, eligibleRoles: undefined, selectedRoleIds: [] }));
            navigate({ type: "push", route: { id: "activate/eligible-roles" } });
          }}
        />
      </Box>
    );
  }

  if (screen === "activate/eligible-roles") {
    const roles = state.eligibleRoles;
    if (!roles && isLoading) return <Text dimColor>Loading eligible roles…</Text>;
    if (!roles) return <Text dimColor>Loading…</Text>;
    if (roles.length === 0) return <EmptyState message="No eligible roles found for this subscription." />;

    return (
      <Box flexDirection="column" gap={1}>
        <Text>Pick eligible roles to activate:</Text>
        <CheckboxList
          items={roleItems}
          onSubmit={(selectedKeys) => {
            if (selectedKeys.length === 0) return;
            setState((prev) => ({ ...prev, selectedRoleIds: selectedKeys }));
            navigate({ type: "push", route: { id: "activate/duration" } });
          }}
        />
        <Text dimColor>Tip: press “a” to toggle all.</Text>
      </Box>
    );
  }

  if (screen === "activate/duration") {
    return (
      <NumberPrompt
        label="Duration in hours (1-8):"
        initialValue={state.durationHours ?? 8}
        min={1}
        max={8}
        onSubmit={(hours) => {
          setState((prev) => ({ ...prev, durationHours: hours }));
          navigate({ type: "push", route: { id: "activate/justification" } });
        }}
      />
    );
  }

  if (screen === "activate/justification") {
    return (
      <TextPrompt
        label="Justification:"
        initialValue={state.justification ?? "Activated via azp-cli"}
        validate={(v) => (v.trim().length >= 5 ? true : "Justification should be at least 5 characters")}
        onSubmit={(value) => {
          setState((prev) => ({ ...prev, justification: value }));
          navigate({ type: "push", route: { id: "activate/confirm" } });
        }}
      />
    );
  }

  if (screen === "activate/confirm") {
    const subscriptionName = state.subscription?.displayName ?? "(unknown)";
    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          Activate <Text bold>{state.selectedRoleIds.length}</Text> role(s) on <Text bold>{subscriptionName}</Text>?
        </Text>
        <Text dimColor>Duration: {state.durationHours ?? "?"}h</Text>
        <Text dimColor>Justification: {state.justification ?? "?"}</Text>
        <ConfirmPrompt
          message="Confirm activation?"
          onConfirm={() => navigate({ type: "push", route: { id: "activate/progress" } })}
          onCancel={() => navigate({ type: "back" })}
        />
      </Box>
    );
  }

  if (screen === "activate/progress") {
    const results = state.results ?? [];
    const total = state.selectedRoleIds.length;
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
            <Text key={r.roleId} color={r.ok ? "green" : "red"}>
              {r.ok ? "✓" : "✗"} {r.roleId}
            </Text>
          ))}
        </Box>
        {done === total && !isLoading ? <Text dimColor>Done. Press m for menu.</Text> : <Text dimColor>Working…</Text>}
      </Box>
    );
  }

  return <Text dimColor>Unknown activate screen.</Text>;
};
