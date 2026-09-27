"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  autoSignIn,
  confirmSignUp,
  resendSignUpCode,
  signIn,
} from "aws-amplify/auth";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Field,
  FormError,
  Notice,
  SubmitButton,
} from "@/components/auth/auth-ui";
import { configureAuth } from "@/lib/auth";
import { authErrorMessage, codeSchema } from "@/lib/auth-schema";

/** "Check your email" step: confirm the code, then sign the new account in. */
export function ConfirmSignUp({
  email,
  password,
  onSignedIn,
}: {
  email: string;
  password: string;
  onSignedIn: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ code: string }>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });

  const submit = handleSubmit(async ({ code }) => {
    setError(null);
    configureAuth();
    try {
      const { nextStep } = await confirmSignUp({
        username: email,
        confirmationCode: code,
      });
      // Straight after sign-up Amplify can finish the sign-in itself; coming
      // from the sign-in page we still have the password the resident typed.
      if (nextStep.signUpStep === "COMPLETE_AUTO_SIGN_IN") await autoSignIn();
      else await signIn({ username: email, password });
      onSignedIn();
    } catch (err) {
      setError(authErrorMessage(err));
    }
  });

  const resend = async () => {
    setError(null);
    configureAuth();
    try {
      await resendSignUpCode({ username: email });
      setResent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Confirm your email"
      className="flex flex-col gap-4"
    >
      <p>
        We sent a 6-digit code to <strong>{email}</strong>. Enter it below to
        finish creating your account.
      </p>
      {resent && <Notice>We sent a new code. It can take a minute.</Notice>}
      <FormError message={error} />
      <Field
        label="Verification code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={errors.code?.message}
        {...register("code")}
      />
      <SubmitButton busy={isSubmitting}>
        {isSubmitting ? "Confirming…" : "Confirm and continue"}
      </SubmitButton>
      <button
        type="button"
        onClick={resend}
        className="text-sm font-medium text-brand hover:underline"
      >
        Send a new code
      </button>
    </form>
  );
}
