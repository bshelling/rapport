import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  API_BASE,
  announceDataChanged,
  askRapport,
  type ChatTurn,
  DATA_CHANGED,
  getHealth,
  type Health,
  refreshReport,
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

describe("live refresh", () => {
  test("refreshReport asks the API to check the City's data now", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          id: "R1",
          city_checked_at: "2026-10-02T15:00:00+00:00",
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const detail = await refreshReport("R1");
    expect(detail.city_checked_at).toBe("2026-10-02T15:00:00+00:00");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/api/reports/R1/refresh`);
    expect(init.method).toBe("POST");
  });

  test("announceDataChanged notifies listeners", () => {
    const target = new EventTarget();
    globalThis.window = target as unknown as Window & typeof globalThis;
    let heard = 0;
    target.addEventListener(DATA_CHANGED, () => {
      heard += 1;
    });
    announceDataChanged();
    expect(heard).toBe(1);
  });
});
