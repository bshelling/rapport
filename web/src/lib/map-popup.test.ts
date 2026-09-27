import { expect, test } from "bun:test";
import type { MapReport } from "./api";
import { cityPopupHtml, reportPopupHtml } from "./map-popup";

const base: MapReport = {
  id: "r1",
  source: "rapport",
  request_type: "Drainage",
  request_reason: "Catch Basin Clogged",
  status: "submitted",
  lat: 29.95,
  lng: -90.07,
  supporter_count: 0,
  created_at: "2026-09-24T15:00:00+00:00",
};

const text = (html: string) =>
  html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

test("report popup reads as plain sentences", () => {
  expect(text(reportPopupHtml(base))).toBe(
    "|Catch Basin Clogged|Submitted · reported Sep 24, 2026|",
  );
  expect(reportPopupHtml({ ...base, supporter_count: 1 })).toContain(
    "1 neighbor sees this too",
  );
  expect(reportPopupHtml({ ...base, supporter_count: 3 })).toContain(
    "3 neighbors see this too",
  );
  expect(reportPopupHtml({ ...base, sample: true })).toContain(
    '<span class="rp-tag">Sample</span>',
  );
});

test("popups escape City and resident text", () => {
  const html = reportPopupHtml({ ...base, request_reason: "<b>x</b>" });
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  expect(
    text(cityPopupHtml({ ...base, source: "nola311", id: "2026-1322723" })),
  ).toBe(
    "|Catch Basin Clogged|NOLA 311 request #2026-1322723|Open since Sep 24, 2026|",
  );
});
