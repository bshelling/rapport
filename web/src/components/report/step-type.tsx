"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { StepNav } from "@/components/report/step-nav";
import {
  type Draft,
  getServiceCatalog,
  patchDraft,
  type ServiceType,
} from "@/lib/api";

export function StepType({
  draft,
  onSaved,
  onNext,
}: {
  draft: Draft;
  onSaved: (d: Draft) => void;
  onNext: () => void;
}) {
  const [catalog, setCatalog] = useState<ServiceType[] | null>(null);
  const [type, setType] = useState(draft.request_type);
  const [reason, setReason] = useState(draft.request_reason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getServiceCatalog()
      .then(setCatalog)
      .catch(() => setError("Couldn't load request types."));
  }, []);

  const selected = catalog?.find((t) => t.name === type);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type || !reason) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await patchDraft(draft.id, {
          step: 2,
          request_type: type,
          request_reason: reason,
        }),
      );
      onNext();
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Request type">
      <h2 className="text-xl font-semibold">What do you want to report?</h2>
      <fieldset className="mt-5">
        <legend className="sr-only">Request type</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(catalog ?? []).map((t) => {
            const active = t.name === type;
            return (
              <label
                key={t.name}
                className={`cursor-pointer rounded-2xl border-2 p-4 transition-colors ${
                  active
                    ? "border-brand bg-brand/5"
                    : "border-border hover:border-brand/40"
                }`}
              >
                <input
                  type="radio"
                  name="request_type"
                  value={t.name}
                  checked={active}
                  onChange={() => {
                    setType(t.name);
                    if (t.name !== type) setReason(null);
                  }}
                  className="sr-only"
                />
                <span className="block font-semibold">{t.name}</span>
                <span className="mt-1 block text-sm text-muted">
                  {t.description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <AnimatePresence initial={false}>
        {selected && (
          <motion.fieldset
            key={selected.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6"
          >
            <legend className="mb-3 font-medium">
              What&apos;s the problem?
            </legend>
            <div className="flex flex-wrap gap-2">
              {selected.reasons.map((r, i) => {
                const active = r.name === reason;
                return (
                  <motion.label
                    key={r.name}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.03 }}
                    title={r.description}
                    className={`cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors ${
                      active
                        ? "border-brand bg-brand text-background"
                        : "border-border hover:border-brand/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="request_reason"
                      value={r.name}
                      checked={active}
                      onChange={() => setReason(r.name)}
                      className="sr-only"
                    />
                    {r.name}
                  </motion.label>
                );
              })}
            </div>
          </motion.fieldset>
        )}
      </AnimatePresence>

      <StepNav busy={busy} disabled={!type || !reason} error={error} />
    </form>
  );
}
