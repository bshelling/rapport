export function StepNav({
  onBack,
  nextLabel = "Continue",
  busy = false,
  disabled = false,
  error,
}: {
  onBack?: () => void;
  nextLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
}) {
  return (
    <div className="mt-8 flex flex-col gap-3">
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full px-4 py-2 font-medium text-muted hover:bg-brand/10"
          >
            Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={busy || disabled}
          className="rounded-full bg-brand px-6 py-2.5 font-semibold text-background disabled:opacity-50"
        >
          {busy ? "Saving…" : nextLabel}
        </button>
      </div>
    </div>
  );
}
