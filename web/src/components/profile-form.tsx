"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ApiError,
  getMe,
  getNeighborhoods,
  type PhoneType,
  type Profile,
  putMe,
} from "@/lib/api";
import {
  formatPhone,
  type ProfileFormOutput,
  type ProfileFormValues,
  profileSchema,
} from "@/lib/profile-schema";

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

function toFormValues(p: Profile): ProfileFormValues {
  return {
    first_name: p.first_name,
    last_name: p.last_name,
    email: p.email ?? "",
    phone: formatPhone(p.phone),
    phone_type: p.phone_type ?? "",
    neighborhood: p.neighborhood ?? "",
  };
}

export function ProfileForm() {
  const id = useId();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues, unknown, ProfileFormOutput>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      phone_type: "",
      neighborhood: "",
    },
  });

  useEffect(() => {
    Promise.all([getMe(), getNeighborhoods()])
      .then(([me, names]) => {
        setProfile(me);
        setNeighborhoods(names);
        reset(toFormValues(me));
      })
      .catch((err) => {
        console.error(err);
        setLoadError(true);
      });
  }, [reset]);

  const onSubmit = async (values: ProfileFormOutput) => {
    setSaveState("idle");
    try {
      const saved = await putMe({
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        phone: values.phone || null,
        phone_type: (values.phone_type || null) as PhoneType | null,
        neighborhood: values.neighborhood || null,
      });
      setProfile(saved);
      reset(toFormValues(saved));
      setSaveState("saved");
    } catch (err) {
      // FastAPI 422s carry per-field errors; show them next to the inputs.
      if (
        err instanceof ApiError &&
        err.status === 422 &&
        applyFieldErrors(err.detail)
      )
        return;
      console.error(err instanceof ApiError ? err.detail : err);
      setSaveState("error");
    }
  };

  function applyFieldErrors(detail: unknown): boolean {
    const issues = (detail as { detail?: { loc?: unknown[]; msg?: string }[] })
      ?.detail;
    if (!Array.isArray(issues)) return false;
    let applied = false;
    for (const issue of issues) {
      const name = issue.loc?.at(-1);
      if (typeof name === "string" && name in profileSchema.shape) {
        setError(name as keyof ProfileFormValues, {
          message: (issue.msg ?? "Invalid value").replace(/^Value error, /, ""),
        });
        applied = true;
      }
    }
    return applied;
  }

  if (loadError) {
    return (
      <p className="text-red-600">
        We couldn&apos;t load your profile. Try again shortly.
      </p>
    );
  }
  if (!profile) return <p className="text-muted">Loading your profile…</p>;

  const field = (name: keyof ProfileFormValues) => `${id}-${name}`;
  const error = (name: keyof ProfileFormValues) =>
    errors[name] && (
      <p id={`${field(name)}-error`} className="mt-1 text-sm text-red-600">
        {errors[name]?.message}
      </p>
    );

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-5 rounded-2xl border border-border p-6"
      aria-label="Profile"
    >
      {!profile.complete && (
        <p
          className="rounded-xl bg-gold/15 px-4 py-3 text-sm"
          data-testid="profile-incomplete"
        >
          Add your name so we can fill in your first request.
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor={field("first_name")}
            className="mb-1 block text-sm font-medium"
          >
            First name
          </label>
          <input
            id={field("first_name")}
            autoComplete="given-name"
            className={inputClass}
            aria-invalid={!!errors.first_name}
            {...register("first_name")}
          />
          {error("first_name")}
        </div>
        <div>
          <label
            htmlFor={field("last_name")}
            className="mb-1 block text-sm font-medium"
          >
            Last name
          </label>
          <input
            id={field("last_name")}
            autoComplete="family-name"
            className={inputClass}
            aria-invalid={!!errors.last_name}
            {...register("last_name")}
          />
          {error("last_name")}
        </div>
      </div>

      <div>
        <label
          htmlFor={field("email")}
          className="mb-1 block text-sm font-medium"
        >
          Email
        </label>
        <input
          id={field("email")}
          type="email"
          autoComplete="email"
          className={inputClass}
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        {error("email")}
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
        <div>
          <label
            htmlFor={field("phone")}
            className="mb-1 block text-sm font-medium"
          >
            Phone <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id={field("phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(504) 555-0100"
            className={inputClass}
            aria-invalid={!!errors.phone}
            {...register("phone")}
          />
          {error("phone")}
        </div>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium">Phone type</legend>
          <div className="flex gap-4 py-2">
            {(["mobile", "home"] as const).map((t) => (
              <label
                key={t}
                className="flex items-center gap-2 text-sm capitalize"
              >
                <input type="radio" value={t} {...register("phone_type")} />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div>
        <label
          htmlFor={field("neighborhood")}
          className="mb-1 block text-sm font-medium"
        >
          Neighborhood{" "}
          <span className="font-normal text-muted">(optional)</span>
        </label>
        <select
          id={field("neighborhood")}
          className={inputClass}
          {...register("neighborhood")}
        >
          <option value="">Choose your neighborhood</option>
          {neighborhoods.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isSubmitting || !isDirty}
          className="rounded-full bg-brand px-6 py-2 font-semibold text-background disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Save profile"}
        </button>
        <output className="text-sm">
          {saveState === "saved" && <span className="text-brand">Saved.</span>}
          {saveState === "error" && (
            <span className="text-red-600">
              Couldn&apos;t save. Please try again.
            </span>
          )}
        </output>
      </div>
    </form>
  );
}
