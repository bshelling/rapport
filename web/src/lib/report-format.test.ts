import { expect, test } from "bun:test";
import type { ReportDetail } from "./api";
import { nola311Summary, shortRef } from "./report-format";

const report = {
  request_type: "Drainage",
  request_reason: "Catch Basin Clogged",
  location: {
    lat: 29.9212,
    lng: -90.1027,
    address: "Napoleon & Magazine",
    source: "gps",
  },
  description_html:
    "<p>Full of <strong>leaves</strong> &amp; trash</p><ul><li>deep</li><li>smelly</li></ul>",
} as ReportDetail;

test("nola311Summary turns the report into pasteable text", () => {
  expect(nola311Summary(report)).toBe(
    [
      "Request type: Drainage",
      "Request reason: Catch Basin Clogged",
      "Location: Napoleon & Magazine (29.92120, -90.10270)",
      "",
      "Full of leaves & trash",
      "- deep",
      "- smelly",
    ].join("\n"),
  );
});

test("nola311Summary without an address uses coordinates", () => {
  const r = {
    ...report,
    location: { ...report.location, address: null },
  } as ReportDetail;
  expect(nola311Summary(r)).toContain("Location: 29.92120, -90.10270");
});

test("shortRef", () => {
  expect(shortRef("01M3FFGM7VG66557ARZZEARDCN")).toBe("ZZEARDCN");
});
