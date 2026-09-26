"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Draft, ReasonOption, Triage } from "@/lib/api";

const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}%`;

const QUALITY_TIP: Record<string, string> = {
  blurry:
    "The photo is a bit blurry. A sharper one helps crews find the problem.",
  too_dark: "The photo is dark. A daylight photo helps crews find the problem.",
  too_far: "Try a closer photo of the problem itself.",
  not_a_street_scene:
    "We couldn't spot a street or drainage problem in this photo.",
};

export function isAnalyzing(draft: Draft): boolean {
  return (
    draft.photos.length > 0 &&
    (!draft.triage || draft.triage.status === "pending")
  );
}

/** Live AI insights for step 3. Every suggestion is opt-in (one tap). */
export function InsightsPanel({
  draft,
  watching,
  onSwitchReason,
  onUseDescription,
}: {
  draft: Draft;
  watching: boolean;
  onSwitchReason: (option: ReasonOption) => void;
  onUseDescription: (text: string) => void;
}) {
  const t = draft.triage;
  if (!t && !(watching && draft.photos.length > 0)) return null;

  return (
    <section
      aria-label="Photo insights"
      aria-live="polite"
      data-testid="insights"
      className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden>✨</span> What we see in your photo
      </h3>
      <AnimatePresence mode="popLayout">
        {(!t || t.status === "pending") && <Analyzing key="analyzing" />}
        {t?.status === "error" && (
          <motion.p
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-2 text-sm text-muted"
          >
            We couldn&apos;t analyze this photo. You can still submit your
            report.
          </motion.p>
        )}
        {t?.status === "done" && (
          <Chips
            key="done"
            t={t}
            draft={draft}
            onSwitchReason={onSwitchReason}
            onUseDescription={onUseDescription}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function Analyzing() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mt-3 flex flex-col gap-2"
    >
      <p className="text-sm text-muted">Looking at your photo…</p>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="h-7 rounded-full bg-accent/15"
          style={{ width: `${70 - i * 15}%` }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{
            duration: 1.2,
            repeat: Number.POSITIVE_INFINITY,
            delay: i * 0.15,
          }}
        />
      ))}
    </motion.div>
  );
}

function Chip({
  tone,
  children,
  index,
  testId,
}: {
  tone: "good" | "warn" | "info" | "danger";
  children: React.ReactNode;
  index: number;
  testId?: string;
}) {
  const tones = {
    good: "border-brand/40 bg-brand/10",
    warn: "border-gold/50 bg-gold/15",
    info: "border-border bg-background",
    danger: "border-red-500/40 bg-red-500/10",
  };
  return (
    <motion.li
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.08 }}
      className={`flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-sm ${tones[tone]}`}
      data-testid={testId}
    >
      {children}
    </motion.li>
  );
}

function Chips({
  t,
  draft,
  onSwitchReason,
  onUseDescription,
}: {
  t: Triage;
  draft: Draft;
  onSwitchReason: (option: ReasonOption) => void;
  onUseDescription: (text: string) => void;
}) {
  const obs = t.observation;
  const suggested = t.suggested;
  const selected = draft.request_reason;
  const isIssue = suggested?.request_type != null;
  const matches = t.matches_selection ?? null;
  const mismatch =
    isIssue &&
    suggested &&
    selected &&
    suggested.request_reason !== selected &&
    (matches ?? 1) < 0.5;
  let i = 0;

  return (
    <motion.ul
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mt-3 flex flex-col gap-2"
    >
      {!isIssue && (
        <Chip tone="warn" index={i++} testId="insight-not-issue">
          We don&apos;t see a street or drainage problem here. Double-check the
          photo.
        </Chip>
      )}
      {isIssue && suggested && !mismatch && (
        <Chip tone="good" index={i++} testId="insight-match">
          <span aria-hidden>✓</span>
          {selected === suggested.request_reason || matches === null ? (
            <span>
              Looks like <strong>{suggested.request_reason}</strong> (
              {pct(suggested.probability)})
            </span>
          ) : (
            <span>Photo matches your selection</span>
          )}
        </Chip>
      )}
      {mismatch && suggested && (
        <Chip tone="warn" index={i++} testId="insight-mismatch">
          <span>
            This looks more like <strong>{suggested.request_reason}</strong> (
            {pct(suggested.probability)}).
          </span>
          <button
            type="button"
            onClick={() => onSwitchReason(suggested)}
            className="rounded-full bg-foreground px-3 py-0.5 text-xs font-semibold text-background"
          >
            Switch
          </button>
        </Chip>
      )}
      {isIssue && t.severity && (
        <Chip
          tone={t.severity.level >= 3 ? "warn" : "info"}
          index={i++}
          testId="insight-severity"
        >
          Severity: <strong>{t.severity.label}</strong>
        </Chip>
      )}
      {isIssue && (t.safety_hazard ?? 0) >= 0.6 && (
        <Chip tone="danger" index={i++} testId="insight-hazard">
          Looks like a safety hazard. If someone is in danger right now, call
          911.
        </Chip>
      )}
      {obs && QUALITY_TIP[obs.image_quality] && isIssue && (
        <Chip tone="info" index={i++}>
          {QUALITY_TIP[obs.image_quality]}
        </Chip>
      )}
      {obs?.contains_person_or_plate && (
        <Chip tone="info" index={i++} testId="insight-private">
          Your photo shows a person or license plate, so only you will see it.
        </Chip>
      )}
      {isIssue && obs?.suggested_description && (
        <Chip tone="info" index={i++} testId="insight-description">
          <span className="flex-1 italic">
            &ldquo;{obs.suggested_description}&rdquo;
          </span>
          <button
            type="button"
            onClick={() => onUseDescription(obs.suggested_description)}
            className="rounded-full border border-border px-3 py-0.5 text-xs font-semibold"
          >
            Use this description
          </button>
        </Chip>
      )}
    </motion.ul>
  );
}
