import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  API_BASE,
  askRapport,
  type ChatTurn,
  getHealth,
  type Health,
} from "./api";

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

describe("askRapport", () => {
  const turn = (status: ChatTurn["status"], reply: string | null = null) =>
    ({
      turn_id: "T1",
      status,
      reply,
      draft_id: null,
      actions: [],
      off_topic: false,
    }) satisfies ChatTurn;

  test("polls a queued turn until the agent answers", async () => {
    const replies = [
      turn("pending"),
      turn("pending"),
      turn("done", "Draft ready."),
    ];
    const fetchMock = mock(async () => Response.json(replies.shift()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await askRapport("sess-1234", "pothole", { pollMs: 1 });
    expect(result.reply).toBe("Draft ready.");
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toEqual([
      `${API_BASE}/api/agent/chat`,
      `${API_BASE}/api/agent/turns/T1`,
      `${API_BASE}/api/agent/turns/T1`,
    ]);
  });

  test("answers straight away when no agent is needed", async () => {
    const fetchMock = mock(async () =>
      Response.json(turn("done", "Off topic.")),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(askRapport("sess-1234", "poem")).resolves.toMatchObject({
      reply: "Off topic.",
    });
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  test("gives up after the timeout", async () => {
    globalThis.fetch = mock(async () =>
      Response.json(turn("pending")),
    ) as unknown as typeof fetch;
    await expect(
      askRapport("sess-1234", "pothole", { pollMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow("timed out");
  });
});
