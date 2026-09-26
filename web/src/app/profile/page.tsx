"use client";

import { useAuth } from "@/components/auth-provider";
import { ProfileForm } from "@/components/profile-form";

export default function ProfilePage() {
  const auth = useAuth();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12 sm:px-8">
      <section className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your profile</h1>
          <p className="mt-2 text-muted">
            We use this contact info to fill in your service requests, just like
            the NOLA 311 form. It&apos;s never shown publicly.
          </p>
        </div>

        {auth.status === "loading" && <p className="text-muted">Loading…</p>}
        {auth.status === "unavailable" && (
          <p className="text-muted">
            Sign-in isn&apos;t configured in this environment.
          </p>
        )}
        {auth.status === "signedOut" && (
          <div className="rounded-2xl border border-border p-6">
            <p>Sign in to set up your profile.</p>
            <button
              type="button"
              onClick={() => auth.signIn("/profile/")}
              className="mt-4 rounded-full bg-brand px-5 py-2 font-semibold text-background"
            >
              Sign in
            </button>
          </div>
        )}
        {auth.status === "signedIn" && <ProfileForm />}
      </section>
    </main>
  );
}
