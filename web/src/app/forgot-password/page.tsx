"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { confirmResetPassword, resetPassword } from "aws-amplify/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  AuthCard,
  Field,
  FormError,
  PasswordChecklist,
  SubmitButton,
  TextLink,
} from "@/components/auth/auth-ui";
import { configureAuth } from "@/lib/auth";
import { authErrorMessage, emailSchema, resetSchema } from "@/lib/auth-schema";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState<string | null>(null);
  return (
    <AuthCard
      title="Reset your password"
      subtitle={
        email
          ? undefined
          : "Enter your email and we'll send you a code to set a new password."
      }
      footer={
        <p>
          Remembered it? <TextLink href="/sign-in/">Sign in</TextLink>
        </p>
      }
    >
      {email ? (
        <NewPassword email={email} />
      ) : (
        <RequestCode onSent={setEmail} />
      )}
    </AuthCard>
  );
}

function RequestCode({ onSent }: { onSent: (email: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });

  const submit = handleSubmit(async ({ email }) => {
    setError(null);
    configureAuth();
    try {
      await resetPassword({ username: email });
      onSent(email);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  });

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Reset your password"
      className="flex flex-col gap-4"
    >
      <FormError message={error} />
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <SubmitButton busy={isSubmitting}>
        {isSubmitting ? "Sending…" : "Send code"}
      </SubmitButton>
    </form>
  );
}

type NewPasswordValues = { code: string; password: string; confirm: string };

function NewPassword({ email }: { email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: "", password: "", confirm: "" },
  });

  const submit = handleSubmit(async ({ code, password }) => {
    setError(null);
    configureAuth();
    try {
      await confirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword: password,
      });
      router.push("/sign-in/?reset=1");
    } catch (err) {
      setError(authErrorMessage(err));
    }
  });

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Choose a new password"
      className="flex flex-col gap-4"
    >
      <p>
        If there&apos;s an account for <strong>{email}</strong>, we sent it a
        6-digit code.
      </p>
      <FormError message={error} />
      <Field
        label="Verification code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={errors.code?.message}
        {...register("code")}
      />
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        hint={<PasswordChecklist password={watch("password")} />}
        {...register("password")}
      />
      <Field
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...register("confirm")}
      />
      <SubmitButton busy={isSubmitting}>
        {isSubmitting ? "Saving…" : "Set new password"}
      </SubmitButton>
    </form>
  );
}
