export type ScreenId =
  | "main"
  | "help"
  | "activate/subscriptions"
  | "activate/eligible-roles"
  | "activate/duration"
  | "activate/justification"
  | "activate/confirm"
  | "activate/progress"
  | "deactivate/roles"
  | "deactivate/confirm"
  | "deactivate/progress";

export type Route = {
  id: ScreenId;
};

export type RouterState = {
  stack: Route[];
};

export type NavigateAction = { type: "push"; route: Route } | { type: "replace"; route: Route } | { type: "home" } | { type: "back" };

export const createRouterState = (initial: Route): RouterState => ({
  stack: [initial],
});

export const getActiveRoute = (state: RouterState): Route => state.stack[state.stack.length - 1] ?? { id: "main" };

export const reduceRouter = (state: RouterState, action: NavigateAction): RouterState => {
  switch (action.type) {
    case "push":
      return { stack: [...state.stack, action.route] };
    case "replace":
      return { stack: [...state.stack.slice(0, -1), action.route] };
    case "home":
      return { stack: [{ id: "main" }] };
    case "back":
      return { stack: state.stack.length > 1 ? state.stack.slice(0, -1) : state.stack };
    default:
      return state;
  }
};
