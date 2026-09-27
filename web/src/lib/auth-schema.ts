import { z } from "zod";

/** The user pool's password policy (infra/modules/auth), shown as a live checklist. */
export const PASSWORD_RULES = [
  {
    id: "length",
    label: "At least 10 characters",
    test: (p: string) => p.length >= 10,
  },
  {
    id: "lower",
    label: "A lowercase letter",
    test: (p: string) => /[a-z]/.test(p),
  },
  {
    id: "upper",
    label: "An uppercase letter",
    test: (p: string) => /[A-Z]/.test(p),
  },
  { id: "number", label: "A number", test: (p: string) => /\d/.test(p) },
] as const;

const email = z
  .string()
  .trim()
  .min(1, "Enter your email.")
  .pipe(z.email("Enter a valid email address."))
  .transform((v) => v.toLowerCase());

const newPassword = z
  .string()
  .refine((p) => PASSWORD_RULES.every((r) => r.test(p)), {
    message: "Your password doesn't meet all the rules yet.",
  });

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z
  .object({ email, password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The passwords don't match.",
  });

export const emailSchema = z.object({ email });

export const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from the email."),
});

export const resetSchema = z
  .object({
    code: codeSchema.shape.code,
    password: newPassword,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The passwords don't match.",
  });

/** Friendly text for Cognito errors (by exception name). */
export function authErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  switch (name) {
    case "NotAuthorizedException":
      return /attempts exceeded/i.test(message)
        ? "Too many attempts. Wait a few minutes or reset your password."
        : "That email and password don't match.";
    case "UserNotFoundException":
      return "That email and password don't match.";
    case "UsernameExistsException":
      return "There's already an account with this email. Sign in instead.";
    case "InvalidPasswordException":
      return "That password doesn't meet the rules.";
    case "CodeMismatchException":
      return "That code isn't right. Check the email and try again.";
    case "ExpiredCodeException":
      return "That code has expired. Send a new one.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "NetworkError":
      return "We couldn't reach the sign-in service. Check your connection.";
    default:
      return "Something went wrong. Please try again.";
  }
}
