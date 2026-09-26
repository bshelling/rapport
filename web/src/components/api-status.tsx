"use client";

import { useEffect, useState } from "react";
import { getHealth, type Health } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: Health }
  | { kind: "error" };

export function ApiStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((health) => setState({ kind: "ok", health }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error(err);
          setState({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, []);

  const dot =
    state.kind === "ok"
      ? "bg-emerald-500"
      : state.kind === "error"
        ? "bg-red-500"
        : "bg-amber-400 animate-pulse";
  const label =
    state.kind === "ok"
      ? `Service online · ${state.health.version.slice(0, 7)}`
      : state.kind === "error"
        ? "Service unavailable"
        : "Checking service…";

  return (
    <p
      data-testid="api-status"
      data-state={state.kind}
      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm text-muted"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {label}
    </p>
  );
}
