"use client";

import { useAuth } from "@/components/auth-provider";

export function SignInPrompt({
  message,
  returnTo,
}: {
  message: string;
  returnTo: string;
}) {
  const auth = useAuth();
  return (
    <div className="rounded-2xl border border-border p-6">
      <p>{message}</p>
      <button
        type="button"
        onClick={() => auth.signIn(returnTo)}
        className="mt-4 rounded-full bg-brand px-5 py-2 font-semibold text-background"
      >
        Sign in
      </button>
    </div>
  );
}
