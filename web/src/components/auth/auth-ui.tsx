"use client";

import { Check, Circle } from "lucide-react";
import Link from "next/link";
import { forwardRef, useId } from "react";
import { PASSWORD_RULES } from "@/lib/auth-schema";

export const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 aria-[invalid=true]:border-red-600";

/** Centered card shared by sign-in, sign-up and password reset. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-12 sm:py-16">
      <div className="rounded-3xl border border-border p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && (
        <div className="mt-6 flex flex-col items-center gap-2 text-center text-sm text-muted">
          {footer}
        </div>
      )}
    </main>
  );
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: React.ReactNode;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, ...input },
  ref,
) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        className={inputClass}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        {...input}
      />
      {hint}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
});

export function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-full bg-brand px-5 py-2.5 font-semibold text-background hover:opacity-90 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
      role="alert"
    >
      {message}
    </p>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <output className="block rounded-xl bg-brand/10 px-3 py-2 text-sm">
      {children}
    </output>
  );
}

export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mt-1 grid gap-1 text-sm" aria-label="Password rules">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password);
        return (
          <li
            key={r.id}
            className={`flex items-center gap-2 ${ok ? "text-brand" : "text-muted"}`}
            data-met={ok}
          >
            {ok ? (
              <Check className="size-4 shrink-0" aria-hidden />
            ) : (
              <Circle className="size-3.5 shrink-0" aria-hidden />
            )}
            {r.label}
            <span className="sr-only">{ok ? "(done)" : "(not yet)"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function TextLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="font-medium text-brand hover:underline">
      {children}
    </Link>
  );
}
