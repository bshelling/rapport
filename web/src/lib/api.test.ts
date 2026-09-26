import { afterEach, describe, expect, mock, test } from "bun:test";
import { API_BASE, getHealth, type Health } from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("getHealth", () => {
  test("returns the parsed health payload", async () => {
    const payload: Health = {
      status: "ok",
      service: "rapport-api",
      version: "abc",
      environment: "prod",
    };
    const fetchMock = mock(async (_input: RequestInfo | URL) =>
      Response.json(payload),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getHealth()).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE}/api/health`);
  });

  test("throws on a non-2xx response", async () => {
    globalThis.fetch = mock(
      async () => new Response("nope", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(getHealth()).rejects.toThrow("health check failed: 503");
  });
});
