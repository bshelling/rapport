import { describe, expect, test } from "bun:test";
import { formatPhone, profileSchema } from "./profile-schema";

const valid = {
  first_name: " Alex ",
  last_name: "Robichaux",
  email: "alex@example.com",
  phone: "(504) 555-0100",
  phone_type: "mobile" as const,
  neighborhood: "Uptown",
};

describe("profileSchema", () => {
  test("trims names and normalizes phone to 10 digits", () => {
    const out = profileSchema.parse(valid);
    expect(out.first_name).toBe("Alex");
    expect(out.phone).toBe("5045550100");
  });

  test("accepts +1 prefix and an empty phone", () => {
    expect(
      profileSchema.parse({ ...valid, phone: "+1 504 555 0100" }).phone,
    ).toBe("5045550100");
    expect(
      profileSchema.parse({ ...valid, phone: "", phone_type: "" }).phone,
    ).toBe("");
  });

  test.each([
    [{ phone: "555-0100" }, "phone"],
    [{ first_name: "   " }, "first_name"],
    [{ email: "nope" }, "email"],
  ])("rejects %j", (patch, path) => {
    const res = profileSchema.safeParse({ ...valid, ...patch });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual([path]);
  });
});

test("formatPhone", () => {
  expect(formatPhone("5045550100")).toBe("(504) 555-0100");
  expect(formatPhone(null)).toBe("");
});
