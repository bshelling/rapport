"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { StepContact } from "@/components/report/step-contact";
import { StepDescribe } from "@/components/report/step-describe";
import { StepType } from "@/components/report/step-type";
import {
  SubmittedReport,
  SupportedReport,
} from "@/components/report/submitted";
import {
  ApiError,
  createDraft,
  type Draft,
  duplicateCheckKey,
  getDraft,
  type Report,
} from "@/lib/api";

const DRAFT_KEY = "rapport.draftId";
const STEPS = ["Request type", "Contact info", "Describe the request"] as const;

function storedDraftId(): string | null {
  try {
    return sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

export function storeDraftId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(DRAFT_KEY, id);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage unavailable; the draft just won't resume after a reload
  }
}

/** True once background AI work for the draft's current state has finished. */
function settled(d: Draft): boolean {
  const triageDone =
    d.photos.length === 0 ||
    d.triage?.status === "done" ||
    d.triage?.status === "error";
  const dupesDone =
    !d.location ||
    !d.request_type ||
    d.duplicates?.checked_for ===
      duplicateCheckKey(d.request_type, d.location.lat, d.location.lng);
  return triageDone && dupesDone;
}

async function loadOrCreateDraft(): Promise<Draft> {
  const id = storedDraftId();
  if (id) {
    try {
      return await getDraft(id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }
  const draft = await createDraft();
  storeDraftId(draft.id);
  return draft;
}

export function ReportFlow({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  // Effects can run twice (React dev mode, fast auth changes); only ever load
  // one draft at a time so we don't create orphans.
  const loading = useRef(false);
  // While AI triage runs in the background, poll the draft for its insights.
  const [watching, setWatching] = useState(false);
  const watch = useCallback(() => setWatching(true), []);

  const draftId = draft?.id;
  useEffect(() => {
    if (!watching || !draftId) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const latest = await getDraft(draftId);
        setDraft(latest);
        if (settled(latest) || tries >= 30) setWatching(false);
      } catch {
        if (tries >= 30) setWatching(false);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [watching, draftId]);

  useEffect(() => {
    if (auth.status !== "signedIn" || draft || loading.current) return;
    loading.current = true;
    loadOrCreateDraft()
      .then((d) => {
        setDraft(d);
        setStep(Math.min(Math.max(d.step, 1), 3));
      })
      .catch((err) => {
        console.error(err);
        setFailed(true);
      })
      .finally(() => {
        loading.current = false;
      });
  }, [auth.status, draft]);

  const goTo = useCallback(
    (next: number) => {
      setDirection(next > step ? 1 : -1);
      setStep(next);
    },
    [step],
  );

  const onSubmitted = useCallback((r: Report) => {
    storeDraftId(null);
    setReport(r);
  }, []);
  const [supported, setSupported] = useState<string | null>(null);
  const onSupported = useCallback((reportId: string) => {
    storeDraftId(null);
    setSupported(reportId);
  }, []);

  const startOver = useCallback(() => {
    setReport(null);
    setDraft(null);
    setStep(1);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-8">
        <Dialog.Title className="text-lg font-semibold">
          {report
            ? "Report submitted"
            : supported
              ? "Thanks!"
              : "Report an issue"}
        </Dialog.Title>
        <Dialog.Close
          className="rounded-full p-2 text-muted hover:bg-brand/10"
          aria-label="Close"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            aria-hidden="true"
            role="presentation"
          >
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </Dialog.Close>
      </div>

      {!report && !supported && auth.status === "signedIn" && draft && (
        <Progress step={step} />
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {auth.status === "signedOut" && (
          <Centered>
            <p className="text-lg font-semibold">Sign in to report an issue</p>
            <p className="text-muted">
              We&apos;ll keep track of your requests and their status.
            </p>
            <button
              type="button"
              onClick={() => auth.signIn("/report/")}
              className="mt-2 rounded-full bg-brand px-6 py-2 font-semibold text-background"
            >
              Sign in
            </button>
          </Centered>
        )}
        {auth.status === "unavailable" && (
          <Centered>
            <p className="text-muted">
              Reporting isn&apos;t available in this environment.
            </p>
          </Centered>
        )}
        {failed && (
          <Centered>
            <p className="text-red-600">
              We couldn&apos;t start your report. Please try again.
            </p>
          </Centered>
        )}
        {auth.status === "signedIn" && !draft && !failed && (
          <Centered>
            <p className="text-muted">Getting things ready…</p>
          </Centered>
        )}

        {report ? (
          <SubmittedReport
            report={report}
            onClose={onClose}
            onAnother={startOver}
          />
        ) : supported ? (
          <SupportedReport reportId={supported} onClose={onClose} />
        ) : (
          draft && (
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={step}
                custom={direction}
                variants={{
                  enter: (d: number) => ({ x: d * 48, opacity: 0 }),
                  center: { x: 0, opacity: 1 },
                  exit: (d: number) => ({ x: d * -48, opacity: 0 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="px-5 py-6 sm:px-8"
              >
                {step === 1 && (
                  <StepType
                    draft={draft}
                    onSaved={setDraft}
                    onNext={() => goTo(2)}
                    watching={watching}
                    watch={watch}
                  />
                )}
                {step === 2 && (
                  <StepContact
                    draft={draft}
                    onSaved={setDraft}
                    onBack={() => goTo(1)}
                    onNext={() => goTo(3)}
                  />
                )}
                {step === 3 && (
                  <StepDescribe
                    draft={draft}
                    onSaved={setDraft}
                    onBack={() => goTo(2)}
                    onSubmitted={onSubmitted}
                    onSupported={onSupported}
                    watching={watching}
                    watch={watch}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )
        )}
      </div>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="px-5 pt-4 sm:px-8">
      <ol className="flex gap-2" aria-label="Progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "todo";
          return (
            <li
              key={label}
              className="flex-1"
              aria-current={state === "current" ? "step" : undefined}
            >
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <motion.div
                  className="h-full rounded-full bg-brand"
                  initial={false}
                  animate={{ width: state === "todo" ? "0%" : "100%" }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p
                className={`mt-2 text-xs ${state === "current" ? "font-semibold text-foreground" : "text-muted"}`}
              >
                <span className="sr-only">Step {n} of 3: </span>
                {label}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 px-6 text-center">
      {children}
    </div>
  );
}
