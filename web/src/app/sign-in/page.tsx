"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resendSignUpCode, signIn } from "aws-amplify/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import {
  AuthCard,
  Field,
  FormError,
  Notice,
  SubmitButton,
  TextLink,
} from "@/components/auth/auth-ui";
import { ConfirmSignUp } from "@/components/auth/confirm-sign-up";
import { useLeaveWhenSignedIn } from "@/components/auth/use-leave-when-signed-in";
import { configureAuth, consumeReturnTo } from "@/lib/auth";
import { authErrorMessage, signInSchema } from "@/lib/auth-schema";

type Values = { email: string; password: string };

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const router = useRouter();
  const reset = useSearchParams().get("reset") === "1";
  const leaving = useLeaveWhenSignedIn();
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<Values | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const submit = handleSubmit(async (values) => {
    setError(null);
    configureAuth();
    leaving.current = true;
    try {
      const { nextStep } = await signIn({
        username: values.email,
        password: values.password,
      });
      if (nextStep.signInStep === "DONE") {
        router.replace(consumeReturnTo("/dashboard/"));
        return;
      }
      leaving.current = false;
      if (nextStep.signInStep === "CONFIRM_SIGN_UP") {
        // Signed up earlier but never entered the code: send a fresh one.
        await resendSignUpCode({ username: values.email });
        setUnconfirmed(values);
      } else {
        setError("This account needs a step we can't complete here.");
      }
    } catch (err) {
      leaving.current = false;
      if (
        err instanceof Error &&
        err.name === "UserAlreadyAuthenticatedException"
      )
        router.replace(consumeReturnTo("/dashboard/"));
      else setError(authErrorMessage(err));
    }
  });

  if (unconfirmed) {
    return (
      <AuthCard title="Confirm your email">
        <ConfirmSignUp
          email={unconfirmed.email}
          password={unconfirmed.password}
          onSignedIn={() => {
            leaving.current = true;
            router.replace("/getting-started/?welcome=1");
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Report street and drainage problems and follow what happens next."
      footer={
        <p>
          New to Rapport?{" "}
          <TextLink href="/sign-up/">Create an account</TextLink>
        </p>
      }
    >
      <form
        onSubmit={submit}
        noValidate
        aria-label="Sign in"
        className="flex flex-col gap-4"
      >
        {reset && (
          <Notice>Your password was changed. Sign in with the new one.</Notice>
        )}
        <FormError message={error} />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          hint={
            <span className="text-right text-sm">
              <TextLink href="/forgot-password/">
                Forgot your password?
              </TextLink>
            </span>
          }
          {...register("password")}
        />
        <SubmitButton busy={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
