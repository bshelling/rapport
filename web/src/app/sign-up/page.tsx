"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signUp } from "aws-amplify/auth";
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
import { ConfirmSignUp } from "@/components/auth/confirm-sign-up";
import { useLeaveWhenSignedIn } from "@/components/auth/use-leave-when-signed-in";
import { configureAuth } from "@/lib/auth";
import { authErrorMessage, signUpSchema } from "@/lib/auth-schema";

type Values = { email: string; password: string; confirm: string };

export default function SignUpPage() {
  const router = useRouter();
  const leaving = useLeaveWhenSignedIn();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Values | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "", confirm: "" },
  });
  const password = watch("password");

  const submit = handleSubmit(async (values) => {
    setError(null);
    configureAuth();
    try {
      await signUp({
        username: values.email,
        password: values.password,
        options: {
          userAttributes: { email: values.email },
          autoSignIn: true,
        },
      });
      setPending(values);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  });

  if (pending) {
    return (
      <AuthCard title="Check your email">
        <ConfirmSignUp
          email={pending.email}
          password={pending.password}
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
      title="Create your account"
      subtitle="It takes a minute. We'll email you a code to confirm it's you."
      footer={
        <p>
          Already have an account? <TextLink href="/sign-in/">Sign in</TextLink>
        </p>
      }
    >
      <form
        onSubmit={submit}
        noValidate
        aria-label="Create your account"
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
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          hint={<PasswordChecklist password={password} />}
          {...register("password")}
        />
        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...register("confirm")}
        />
        <SubmitButton busy={isSubmitting}>
          {isSubmitting ? "Creating your account…" : "Create account"}
        </SubmitButton>
        <p className="text-xs text-muted">
          Your email is used to sign in and to fill in your reports. It&apos;s
          never shown publicly.
        </p>
      </form>
    </AuthCard>
  );
}
