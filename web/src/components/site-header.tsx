"use client";

import Link from "next/link";
import { ApiStatus } from "@/components/api-status";
import { useAuth } from "@/components/auth-provider";

export function SiteHeader() {
  const auth = useAuth();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/" className="text-xl font-bold tracking-tight">
        <span className="text-brand">Rap</span>
        <span className="text-accent">port</span>
      </Link>
      <div className="flex items-center gap-3">
        <ApiStatus />
        {auth.status === "signedIn" && (
          <>
            <Link
              href="/dashboard/"
              className="rounded-full px-3 py-1 text-sm font-medium hover:bg-brand/10"
            >
              My reports
            </Link>
            <Link
              href="/profile/"
              className="rounded-full px-3 py-1 text-sm font-medium hover:bg-brand/10"
            >
              Profile
            </Link>
            <button
              type="button"
              onClick={() => auth.signOut()}
              className="rounded-full border border-border px-3 py-1 text-sm hover:bg-brand/10"
            >
              Sign out
            </button>
          </>
        )}
        {auth.status === "signedOut" && (
          <button
            type="button"
            onClick={() => auth.signIn()}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-background hover:opacity-90"
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
