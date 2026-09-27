"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ApiStatus } from "@/components/api-status";
import { useAuth } from "@/components/auth-provider";

function NavLink({ href, children }: { href: string; children: string }) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium hover:bg-brand/10 ${active ? "bg-brand/10" : ""}`}
    >
      {children}
    </Link>
  );
}

// Phones: logo and account actions on the first row, links on a second row.
// Wider screens: one row.
export function SiteHeader() {
  const auth = useAuth();

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <Link href="/" className="mr-auto text-xl font-bold tracking-tight">
        <span className="text-brand">Rap</span>
        <span className="text-accent">port</span>
      </Link>
      <nav
        aria-label="Main"
        className="order-last -mx-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto"
      >
        <NavLink href="/getting-started/">How it works</NavLink>
        {auth.status === "signedIn" && (
          <>
            <NavLink href="/dashboard/">My reports</NavLink>
            <NavLink href="/profile/">Profile</NavLink>
          </>
        )}
      </nav>
      <div className="flex items-center gap-3">
        <ApiStatus />
        {auth.status === "signedIn" && (
          <button
            type="button"
            onClick={() => auth.signOut()}
            className="rounded-full border border-border px-3 py-1 text-sm hover:bg-brand/10"
          >
            Sign out
          </button>
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
