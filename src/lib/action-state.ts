// Shared between server actions and client forms (no server-only imports here).
export type ActionState =
  | { status: "idle" }
  | { status: "success"; message?: string }
  | { status: "error"; message: string; fields?: Record<string, string>; values?: Record<string, string> };

export const idle: ActionState = { status: "idle" };
