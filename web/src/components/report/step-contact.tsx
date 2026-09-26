"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { StepNav } from "@/components/report/step-nav";
import {
  type Draft,
  getMe,
  type PhoneType,
  type Profile,
  patchDraft,
  putMe,
} from "@/lib/api";
import {
  type ContactFormOutput,
  type ContactFormValues,
  contactSchema,
  formatPhone,
} from "@/lib/profile-schema";

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export function StepContact({
  draft,
  onSaved,
  onBack,
  onNext,
}: {
  draft: Draft;
  onSaved: (d: Draft) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const id = useId();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saveToProfile, setSaveToProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues, unknown, ContactFormOutput>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      phone_type: "",
    },
  });

  useEffect(() => {
    getMe()
      .then((me) => {
        setProfile(me);
        setSaveToProfile(!me.complete);
        const c = draft.contact ?? me;
        // The form is usable before the profile arrives; never overwrite
        // anything the resident already typed.
        reset(
          {
            first_name: c.first_name ?? "",
            last_name: c.last_name ?? "",
            email: c.email ?? "",
            phone: formatPhone(c.phone),
            phone_type: c.phone_type ?? "",
          },
          { keepDirtyValues: true },
        );
      })
      .catch(() =>
        setError("Couldn't load your profile; you can still fill this in."),
      );
  }, [draft.contact, reset]);

  const onSubmit = async (v: ContactFormOutput) => {
    setError(null);
    const contact = {
      first_name: v.first_name,
      last_name: v.last_name,
      email: v.email,
      phone: v.phone || null,
      phone_type: (v.phone_type || null) as PhoneType | null,
    };
    try {
      onSaved(await patchDraft(draft.id, { step: 3, contact }));
      if (saveToProfile) {
        await putMe({
          ...contact,
          neighborhood: profile?.neighborhood ?? null,
        }).catch(() => {
          // The report still works; the profile just isn't updated.
        });
      }
      onNext();
    } catch {
      setError("Couldn't save. Please try again.");
    }
  };

  const f = (name: keyof ContactFormValues) => `${id}-${name}`;
  const err = (name: keyof ContactFormValues) =>
    errors[name] && (
      <p className="mt-1 text-sm text-red-600">{errors[name]?.message}</p>
    );

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Contact info"
    >
      <h2 className="text-xl font-semibold">How can the City reach you?</h2>
      <p className="mt-1 text-sm text-muted">
        NOLA 311 uses this to follow up. It&apos;s never shown publicly.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor={f("first_name")}
            className="mb-1 block text-sm font-medium"
          >
            First name
          </label>
          <input
            id={f("first_name")}
            autoComplete="given-name"
            className={inputClass}
            {...register("first_name")}
          />
          {err("first_name")}
        </div>
        <div>
          <label
            htmlFor={f("last_name")}
            className="mb-1 block text-sm font-medium"
          >
            Last name
          </label>
          <input
            id={f("last_name")}
            autoComplete="family-name"
            className={inputClass}
            {...register("last_name")}
          />
          {err("last_name")}
        </div>
        <div className="sm:col-span-2">
          <label
            htmlFor={f("email")}
            className="mb-1 block text-sm font-medium"
          >
            Email
          </label>
          <input
            id={f("email")}
            type="email"
            autoComplete="email"
            className={inputClass}
            {...register("email")}
          />
          {err("email")}
        </div>
        <div>
          <label
            htmlFor={f("phone")}
            className="mb-1 block text-sm font-medium"
          >
            Phone <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id={f("phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(504) 555-0100"
            className={inputClass}
            {...register("phone")}
          />
          {err("phone")}
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

      <label className="mt-5 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={saveToProfile}
          onChange={(e) => setSaveToProfile(e.target.checked)}
        />
        Save to my profile for next time
      </label>

      <StepNav onBack={onBack} busy={isSubmitting} error={error} />
    </form>
  );
}
