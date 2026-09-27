"use client";

import {
  Camera,
  Eye,
  MessageCircle,
  Send,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/components/auth-provider";
import { ReportButton } from "@/components/report-button";
import { StatusBadge } from "@/components/status-badge";
import type { ReportStatus } from "@/lib/api";

const STEPS = [
  {
    icon: Camera,
    title: "Tell us what and where",
    body: "Pick the problem, drop a pin or use your location, and add up to three photos. Rather type it out? Ask Rapport can draft the report from a sentence.",
  },
  {
    icon: Sparkles,
    title: "We help you get it right",
    body: "Your photo suggests the right category, we check for neighbors who already reported the same spot so you can +1 them, and we write a description the City can act on.",
  },
  {
    icon: Send,
    title: "Hand it to NOLA 311 and follow along",
    body: "Copy your report into NOLA 311 and save the request number. Every night we check the City's 311 data and update your report's status.",
  },
] as const;

const STATUSES: { status: ReportStatus; text: string }[] = [
  { status: "submitted", text: "Your report is saved and on the public map." },
  {
    status: "filed_with_311",
    text: "You added the NOLA 311 request number.",
  },
  { status: "in_progress", text: "The City is working on the request." },
  { status: "resolved", text: "The City closed the request." },
];

const GOOD_TO_KNOW = [
  {
    icon: ShieldAlert,
    text: "If anyone is in danger (a downed line, a cave-in, rising water), call 911 first.",
  },
  {
    icon: Eye,
    text: "The public map never shows your name or contact info. Photos with people or license plates stay private.",
  },
  {
    icon: MessageCircle,
    text: "Stuck? Ask Rapport, bottom right, can answer questions and check on your reports.",
  },
] as const;

export default function GettingStartedPage() {
  return (
    <Suspense>
      <GettingStarted />
    </Suspense>
  );
}

function GettingStarted() {
  const auth = useAuth();
  const welcome =
    useSearchParams().get("welcome") === "1" && auth.status === "signedIn";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-12 sm:px-8 sm:py-16">
      <section className="flex flex-col gap-4">
        <p className="text-sm font-semibold uppercase tracking-widest text-gold">
          {welcome ? "Your account is ready" : "Getting started"}
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          {welcome ? "Welcome to Rapport" : "How Rapport works"}
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Rapport turns a street or drainage problem you spot into a request the
          City can act on, and keeps you posted on what happens next.
        </p>
        <CallToAction welcome={welcome} />
      </section>

      <ol className="grid gap-4 md:grid-cols-3" aria-label="How it works">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-2xl border border-border p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-brand/10 text-brand">
                <s.icon className="size-5" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-muted">
                Step {i + 1}
              </span>
            </div>
            <h2 className="mt-4 text-lg font-semibold">{s.title}</h2>
            <p className="mt-2 text-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <section
        aria-labelledby="next-heading"
        className="grid gap-8 md:grid-cols-2"
      >
        <div>
          <h2 id="next-heading" className="text-xl font-semibold">
            What happens after you report
          </h2>
          <ol className="mt-4 flex flex-col gap-3">
            {STATUSES.map((s) => (
              <li key={s.status} className="flex items-start gap-3">
                <span className="w-32 shrink-0">
                  <StatusBadge status={s.status} />
                </span>
                <span className="text-muted">{s.text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Good to know</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {GOOD_TO_KNOW.map((g) => (
              <li key={g.text} className="flex items-start gap-3">
                <g.icon
                  className="mt-0.5 size-5 shrink-0 text-accent"
                  aria-hidden
                />
                <span className="text-muted">{g.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}

function CallToAction({ welcome }: { welcome: boolean }) {
  const auth = useAuth();
  const secondary =
    "rounded-full border border-border px-6 py-3 font-semibold hover:bg-brand/10";
  const primary =
    "rounded-full bg-brand px-6 py-3 font-semibold text-background shadow-sm hover:opacity-90";

  if (auth.status === "signedIn") {
    return (
      <div className="flex flex-wrap gap-3">
        {welcome ? (
          <>
            <Link href="/profile/" className={primary}>
              Set up your profile
            </Link>
            <ReportButton variant="secondary" />
          </>
        ) : (
          <ReportButton />
        )}
      </div>
    );
  }
  if (auth.status === "signedOut") {
    return (
      <div className="flex flex-wrap gap-3">
        <Link href="/sign-up/" className={primary}>
          Create an account
        </Link>
        <Link href="/sign-in/" className={secondary}>
          Sign in
        </Link>
      </div>
    );
  }
  return null;
}
