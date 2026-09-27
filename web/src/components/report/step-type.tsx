"use client";

import { Camera, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAnalyzing } from "@/components/report/insights";
import { StepNav } from "@/components/report/step-nav";
import { usePhotos } from "@/components/report/use-photos";
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
  watching,
  watch,
}: {
  draft: Draft;
  onSaved: (d: Draft) => void;
  onNext: () => void;
  watching: boolean;
  watch: () => void;
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

  // "Not sure?" shortcut: add a photo and let AI triage suggest a reason.
  const fileInput = useRef<HTMLInputElement>(null);
  const onUploaded = useCallback(
    (d: Draft) => {
      onSaved(d);
      watch();
    },
    [onSaved, watch],
  );
  const { photos, addFiles } = usePhotos(draft, { onUploaded });
  const triage = draft.triage;
  const suggestions =
    triage?.status === "done"
      ? [triage.suggested, ...(triage.alternatives ?? [])].filter(
          (o): o is NonNullable<typeof o> =>
            !!o?.request_type && o.probability >= 0.05,
        )
      : [];

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

      <div
        className="mt-6 rounded-2xl border border-dashed border-border p-4"
        data-testid="photo-shortcut"
      >
        {photos.length === 0 ? (
          <label className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
            <Camera className="size-5 shrink-0 text-muted" aria-hidden />
            <span className="flex-1">
              <strong>Not sure?</strong> Add a photo and we&apos;ll suggest the
              right category.
            </span>
            <span className="rounded-full border border-border px-3 py-1 font-medium">
              Add photo
            </span>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              data-testid="type-photo-input"
              onChange={(e) => {
                addFiles(e.target.files);
                if (fileInput.current) fileInput.current.value = "";
              }}
            />
          </label>
        ) : (
          <div className="text-sm" aria-live="polite">
            {(isAnalyzing(draft) || watching) &&
              triage?.status !== "done" &&
              triage?.status !== "error" && (
                <p className="flex items-center gap-2 text-muted">
                  <Sparkles className="inline size-4 shrink-0" aria-hidden />{" "}
                  Looking at your photo…
                </p>
              )}
            {triage?.status === "error" && (
              <p className="text-muted">
                We couldn&apos;t analyze the photo. Pick the closest match
                above.
              </p>
            )}
            {triage?.status === "done" && suggestions.length === 0 && (
              <p className="text-muted">
                We don&apos;t see a street or drainage problem in that photo.
              </p>
            )}
            {suggestions.length > 0 && (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <Sparkles
                    className="size-4 shrink-0 text-accent"
                    aria-hidden
                  />{" "}
                  From your photo, this looks like:
                </p>
                <div
                  className="mt-2 flex flex-wrap gap-2"
                  data-testid="type-suggestions"
                >
                  {suggestions.map((o, i) => (
                    <motion.button
                      key={o.request_reason}
                      type="button"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06 }}
                      onClick={() => {
                        setType(o.request_type);
                        setReason(o.request_reason);
                      }}
                      className={`rounded-full border px-3 py-1.5 ${
                        o.request_reason === reason
                          ? "border-brand bg-brand text-background"
                          : "border-border hover:border-brand/50"
                      }`}
                    >
                      {o.request_reason} · {Math.round(o.probability * 100)}%
                    </motion.button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <StepNav busy={busy} disabled={!type || !reason} error={error} />
    </form>
  );
}
