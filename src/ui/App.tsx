import { Box, Text, useApp, useInput } from "ink";
import React, { useMemo, useReducer, useState } from "react";
import type { AuthContext } from "../auth";
import { ExitConfirmModal, HelpOverlay, NavBar, Panel } from "./components";
import { createRouterState, getActiveRoute, reduceRouter, type Route, type ScreenId } from "./router";
import { ActivateFlow, type ActivateFlowState } from "./screens/ActivateFlow";
import { DeactivateFlow, type DeactivateFlowState } from "./screens/DeactivateFlow";
import { useExitConfirmation } from "./useExitConfirmation";

export type AppProps = {
  authContext: AuthContext;
  initialScreen?: ScreenId;
};

const screenTitle: Record<ScreenId, string> = {
  main: "Main Menu",
  "activate/subscriptions": "Activate · Subscription",
  "activate/eligible-roles": "Activate · Eligible Roles",
  "activate/duration": "Activate · Duration",
  "activate/justification": "Activate · Justification",
  "activate/confirm": "Activate · Confirm",
  "activate/progress": "Activate · Progress",
  "deactivate/roles": "Deactivate · Active Roles",
  "deactivate/confirm": "Deactivate · Confirm",
  "deactivate/progress": "Deactivate · Progress",
  help: "Help",
};

const MainMenu: React.FC = () => {
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Select an action:</Text>
      <Text>
        <Text color="cyan">1</Text> Activate role(s)
      </Text>
      <Text>
        <Text color="cyan">2</Text> Deactivate role(s)
      </Text>
      <Text>
        <Text color="cyan">3</Text> Exit
      </Text>
      <Text dimColor>Tip: use 1/2/3 or the global keys in the top bar.</Text>

      {/* numeric shortcuts handled by useInput in App */}
    </Box>
  );
};

export const App: React.FC<AppProps> = ({ authContext, initialScreen }) => {
  const { exit } = useApp();
  const initialRoute: Route = useMemo(() => {
    if (!initialScreen || initialScreen === "main") return { id: "main" };
    if (initialScreen === "help") return { id: "help" };
    // For now, treat initialScreen as a concrete ScreenId.
    return { id: initialScreen };
  }, [initialScreen]);
  const [router, dispatch] = useReducer(reduceRouter, initialRoute, createRouterState);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const { isExitConfirmOpen, openExitConfirm, closeExitConfirm } = useExitConfirmation();

  const [activateState, setActivateState] = useState<ActivateFlowState>({
    selectedRoleIds: [],
  });
  const [deactivateState, setDeactivateState] = useState<DeactivateFlowState>({
    selectedLinkedIds: [],
  });

  const route = getActiveRoute(router);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      openExitConfirm();
      return;
    }

    if (input === "?") {
      setIsHelpOpen((v) => !v);
      return;
    }

    if (input === "q") {
      openExitConfirm();
      return;
    }

    if (key.escape || input === "b") {
      dispatch({ type: "back" });
      return;
    }

    if (input === "m") {
      dispatch({ type: "home" });
      return;
    }

    if (isExitConfirmOpen) {
      if (input.toLowerCase() === "y") {
        exit();
      }
      if (input.toLowerCase() === "n") {
        closeExitConfirm();
      }
      return;
    }

    if (route.id === "main") {
      if (input === "1") dispatch({ type: "push", route: { id: "activate/subscriptions" } });
      if (input === "2") dispatch({ type: "push", route: { id: "deactivate/roles" } });
      if (input === "3") openExitConfirm();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <NavBar title={`azp-cli · ${screenTitle[route.id]}`} />

      <Panel heading={screenTitle[route.id]}>
        {route.id === "main" ? <MainMenu /> : null}
        {route.id.startsWith("activate/") ? (
          <ActivateFlow
            authContext={authContext}
            screen={route.id}
            state={activateState}
            setState={(updater) => setActivateState(updater)}
            navigate={dispatch}
          />
        ) : null}
        {route.id.startsWith("deactivate/") ? (
          <DeactivateFlow
            authContext={authContext}
            screen={route.id}
            state={deactivateState}
            setState={(updater) => setDeactivateState(updater)}
            navigate={dispatch}
          />
        ) : null}
        {route.id === "help" ? <HelpOverlay /> : null}
      </Panel>

      {isHelpOpen ? <HelpOverlay /> : null}
      {isExitConfirmOpen ? <ExitConfirmModal /> : null}

      <Text dimColor>Signed in as: {authContext.userPrincipalName}</Text>
    </Box>
  );
};
