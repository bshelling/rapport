import { beforeEach, describe, expect, test } from "bun:test";
import { consumeReturnTo, rememberReturnTo } from "./auth";

const store = new Map<string, string>();
globalThis.sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage;

describe("return-to after sign-in", () => {
  beforeEach(() => store.clear());

  test("returns the remembered path once", () => {
    rememberReturnTo("/profile/");
    expect(consumeReturnTo("/")).toBe("/profile/");
    expect(consumeReturnTo("/")).toBe("/");
  });

  test.each([
    "https://evil.example",
    "//evil.example",
    "javascript:alert(1)",
  ])("ignores unsafe target %s", (target) => {
    rememberReturnTo(target);
    expect(consumeReturnTo("/profile/")).toBe("/profile/");
  });
});
