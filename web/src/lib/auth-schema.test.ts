import { expect, test } from "bun:test";
import {
  authErrorMessage,
  codeSchema,
  PASSWORD_RULES,
  signInSchema,
  signUpSchema,
} from "./auth-schema";

function failing(p: string) {
  return PASSWORD_RULES.filter((r) => !r.test(p)).map((r) => r.id);
}

test("password rules mirror the user pool policy", () => {
  expect(failing("short")).toEqual(["length", "upper", "number"]);
  expect(failing("alllowercase1")).toEqual(["upper"]);
  expect(failing("Neworleans2026")).toEqual([]);
});

test("sign-up needs a valid email, a strong password and a match", () => {
  const ok = signUpSchema.safeParse({
    email: "  Resident@Example.com ",
    password: "Neworleans2026",
    confirm: "Neworleans2026",
  });
  expect(ok.success && ok.data.email).toBe("resident@example.com");

  const mismatch = signUpSchema.safeParse({
    email: "a@b.co",
    password: "Neworleans2026",
    confirm: "Neworleans2025",
  });
  expect(mismatch.error?.issues[0].path).toEqual(["confirm"]);

  expect(
    signUpSchema.safeParse({ email: "nope", password: "x", confirm: "x" })
      .success,
  ).toBe(false);
});

test("sign-in and code fields", () => {
  expect(
    signInSchema.safeParse({ email: "a@b.co", password: "" }).success,
  ).toBe(false);
  expect(codeSchema.safeParse({ code: " 123456 " }).success).toBe(true);
  expect(codeSchema.safeParse({ code: "12345" }).success).toBe(false);
});

test("Cognito errors become plain messages", () => {
  const err = (name: string, message = "") =>
    Object.assign(new Error(message), { name });
  expect(authErrorMessage(err("NotAuthorizedException"))).toMatch(
    /don't match/,
  );
  expect(
    authErrorMessage(
      err("NotAuthorizedException", "Password attempts exceeded"),
    ),
  ).toMatch(/Too many attempts/);
  expect(authErrorMessage(err("UsernameExistsException"))).toMatch(/already/);
  expect(authErrorMessage(new Error("?"))).toMatch(/Something went wrong/);
});
