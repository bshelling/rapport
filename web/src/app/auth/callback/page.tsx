"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { consumeReturnTo } from "@/lib/auth";

// Cognito redirects here with ?code=...; the Amplify OAuth listener exchanges
// it for tokens, then we send the user back to where they started.
export default function AuthCallback() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "signedIn") router.replace(consumeReturnTo());
  }, [auth.status, router]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-20 text-center">
      {auth.status === "signedOut" ? (
        <>
          <p className="text-lg font-semibold">
            We couldn&apos;t finish signing you in.
          </p>
          <button
            type="button"
            onClick={() => auth.signIn(consumeReturnTo())}
            className="rounded-full bg-brand px-5 py-2 font-semibold text-background"
          >
            Try again
          </button>
        </>
      ) : (
        <output className="text-muted">Signing you in…</output>
      )}
    </main>
  );
}
