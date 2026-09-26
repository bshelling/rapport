import { expect, test } from "bun:test";
import { inNewOrleans } from "./geo";
import { fitWithin } from "./image";

test("fitWithin scales the long edge down and never up", () => {
  expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
  expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
  expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
});

test("inNewOrleans matches the API bounds", () => {
  expect(inNewOrleans(29.9511, -90.0715)).toBe(true); // CBD
  expect(inNewOrleans(30.4515, -91.1871)).toBe(false); // Baton Rouge
});
