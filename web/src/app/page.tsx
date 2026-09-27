import Link from "next/link";
import { Impact } from "@/components/impact";
import { PublicMap } from "@/components/map/public-map";
import { ReportButton } from "@/components/report-button";

const services = [
  {
    type: "Roads and Streets",
    reasons: [
      "Pothole",
      "Sidewalk Damaged or Missing",
      "Street Subsidence (Sinking)",
    ],
  },
  {
    type: "Drainage",
    reasons: [
      "Catch Basin Not Draining",
      "Catch Basin Clogged",
      "Catch Basin Frame and Cover Missing or Damaged",
      "Drainage Manhole Cover Missing or Damaged",
      "Street Flooding",
    ],
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-12 sm:px-8 sm:py-16">
      <section className="flex flex-col gap-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-gold">
          New Orleans
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Spot a pothole or a clogged catch basin? Report it in a minute.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Rapport helps you file street and drainage requests the way NOLA 311
          expects them, then keeps track of what happens next.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ReportButton />
          <Link
            href="/getting-started/"
            className="rounded-full px-4 py-3 font-semibold text-brand hover:bg-brand/10"
          >
            How it works
          </Link>
        </div>
      </section>

      <PublicMap />

      <Impact />

      <section
        className="grid gap-4 sm:grid-cols-2"
        aria-label="What you can report"
      >
        {services.map((s) => (
          <div key={s.type} className="rounded-2xl border border-border p-6">
            <h2 className="text-lg font-semibold">{s.type}</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {s.reasons.map((r) => (
                <li
                  key={r}
                  className="rounded-full bg-brand/10 px-3 py-1 text-sm text-foreground"
                >
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <footer className="mt-auto text-sm text-muted">
        Reports are not emergency calls. For emergencies, dial 911.
      </footer>
    </main>
  );
}
