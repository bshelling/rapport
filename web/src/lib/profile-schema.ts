import { z } from "zod";

// Mirrors api/app/models/profile.py so errors show before the round trip.
export const profileSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(50),
  last_name: z.string().trim().min(1, "Last name is required").max(50),
  email: z.email("Enter a valid email"),
  phone: z
    .string()
    .trim()
    .transform((v) => {
      const digits = v.replace(/\D/g, "");
      return digits.length === 11 && digits.startsWith("1")
        ? digits.slice(1)
        : digits;
    })
    .refine(
      (d) => d === "" || d.length === 10,
      "Enter a 10-digit US phone number",
    ),
  phone_type: z.enum(["", "mobile", "home"]),
  neighborhood: z.string(),
});

export type ProfileFormValues = z.input<typeof profileSchema>;
export type ProfileFormOutput = z.output<typeof profileSchema>;

export function formatPhone(digits: string | null | undefined): string {
  if (!digits || digits.length !== 10) return digits ?? "";
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
