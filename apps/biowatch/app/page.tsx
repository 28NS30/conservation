import ProjectCard from "@/components/Project";
import { formosawatchCounts, projects } from "@/lib/projects";

export const revalidate = 3600;

const CONTACT =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@biowatchintl.org";

/**
 * The organisation, and the door to each project.
 *
 * Deliberately not a map. Both projects lead with one, and a third would say
 * "here is another map" rather than "here is what these have in common". What
 * this page has to establish is that they are one method applied twice, so the
 * third is worth starting.
 */
export default async function Home() {
  const formosa = await formosawatchCounts();
  const list = projects(formosa);

  return (
    <main>
      {/* ---------------- header ---------------- */}
      <header className="border-b border-ink-900/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-5">
          <span className="leading-none">
            <span className="block text-base font-semibold tracking-[0.2em] text-ink-900">
              BIOWATCH
            </span>
            <span className="mt-1 block text-[9px] font-medium uppercase tracking-[0.3em] text-ink-500">
              International
            </span>
          </span>
          <nav className="flex items-center gap-5 text-xs text-ink-600">
            <a href="#projects" className="transition hover:text-ink-900">
              Projects
            </a>
            <a href="#method" className="transition hover:text-ink-900">
              Method
            </a>
            <a href="#involved" className="transition hover:text-ink-900">
              Get involved
            </a>
          </nav>
        </div>
      </header>

      {/* ---------------- what this is ---------------- */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-ember-700">
          Open environmental monitoring
        </p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.12] text-ink-900 sm:text-5xl">
          The damage nobody writes down is the damage nobody fixes.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-600 sm:text-lg">
          Most environmental harm is witnessed by someone and recorded by no one
          — a dead pangolin on a mountain road, a fire on the next ridge.
          BioWatch builds the tools that turn those sightings into open public
          data, with the people who live there.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="#projects"
            className="rounded-full bg-ember-500 px-6 py-3 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
          >
            See the projects
          </a>
          <a
            href="#method"
            className="rounded-full border border-ink-900/25 px-6 py-3 text-sm font-medium text-ink-800 transition hover:bg-ink-900/5"
          >
            How it works
          </a>
        </div>
      </section>

      {/* ---------------- the projects ---------------- */}
      <section
        id="projects"
        className="scroll-mt-16 border-y border-ink-900/10 bg-paper-100/50"
      >
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <h2 className="text-2xl font-semibold text-ink-900 sm:text-3xl">
            Two places, one method
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-600 sm:text-base">
            Each project is run in its own language, for its own country,
            against the threat that matters most there. They share an approach,
            not a template.
          </p>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {list.map((p) => (
              <ProjectCard key={p.key} p={p} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- the method ---------------- */}
      <section id="method" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-ember-700">
            The method
          </p>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold leading-snug text-ink-900 sm:text-3xl">
            Anyone can report it. Everyone can see it.
          </h2>

          <ol className="mt-12 grid gap-10 sm:grid-cols-3">
            {[
              {
                n: "1",
                h: "Someone sees it",
                b: "A photo from the roadside, a pin on a map. No account, no training, no app to install. The people who witness this are already there — the barrier has to be near zero or the data never exists.",
              },
              {
                n: "2",
                h: "It gets identified",
                b: "Open models do the first pass — species from a photograph, matched against the national checklist rather than the whole world. Confident results stand; uncertain ones go to a human instead of guessing.",
              },
              {
                n: "3",
                h: "It becomes public data",
                b: "Everything lands on an open map and open statistics, published back to the global biodiversity record. Sensitive locations are coarsened first, because a precise map of an endangered animal is a map for poachers.",
              },
            ].map((s) => (
              <li key={s.n}>
                <span className="flex size-9 items-center justify-center rounded-full border border-ember-700/40 text-xs font-semibold text-ember-700">
                  {s.n}
                </span>
                <h3 className="mt-5 text-base font-semibold text-ink-900">
                  {s.h}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">
                  {s.b}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------- why it travels ---------------- */}
      <section className="border-y border-ink-900/10 bg-paper-100/50">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold leading-snug text-ink-900 sm:text-3xl">
                Built to be copied
              </h2>
              <p className="mt-5 text-sm leading-relaxed text-ink-600 sm:text-base">
                Nothing here is specific to roadkill or to fire. The pattern —
                low-friction reporting, open identification, a public map,
                honest handling of sensitive locations — is the same whether the
                subject is a burnt hectare in Atlántico or a leopard cat in
                Miaoli.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-ink-600 sm:text-base">
                Two countries is enough to prove it travels. If you are working
                on something this fits, we would rather help you run it than run
                it for you.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-6 self-start">
              {[
                { v: "Open data", k: "CC BY, published back to GBIF" },
                { v: "Open models", k: "No proprietary classifier" },
                { v: "No accounts", k: "Reporting needs no sign-up" },
                { v: "Local first", k: "Each project in its own language" },
              ].map((x) => (
                <div
                  key={x.v}
                  className="rounded-xl border border-ink-900/12 bg-paper-50 p-5"
                >
                  <dt className="text-sm font-semibold text-ink-900">{x.v}</dt>
                  <dd className="mt-1.5 text-xs leading-relaxed text-ink-500">
                    {x.k}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ---------------- get involved ---------------- */}
      <section id="involved" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <h2 className="text-2xl font-semibold text-ink-900 sm:text-3xl">
            Get involved
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              {
                h: "Report something",
                b: "The most useful thing anyone can do. Pick the project for where you are — it takes about a minute.",
                cta: "Taiwan · Colombia",
                href: "#projects",
              },
              {
                h: "Use the data",
                b: "Everything published is open and attributed. Researchers, journalists and agencies are welcome to it, and we would like to hear what you do with it.",
                cta: `Write to us`,
                href: `mailto:${CONTACT}`,
              },
              {
                h: "Start one where you are",
                b: "If this method fits a threat in your region, get in touch. Everything we have learned is yours.",
                cta: "Write to us",
                href: `mailto:${CONTACT}`,
              },
            ].map((x) => (
              <div
                key={x.h}
                className="flex flex-col rounded-xl border border-ink-900/12 bg-paper-100 p-6"
              >
                <h3 className="text-base font-semibold text-ink-900">{x.h}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">
                  {x.b}
                </p>
                <a
                  href={x.href}
                  className="mt-5 text-sm font-medium text-ember-700 transition hover:underline"
                >
                  {x.cta} →
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- footer ---------------- */}
      <footer className="border-t border-ink-900/10 bg-paper-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="block text-sm font-semibold tracking-[0.2em] text-ink-900">
              BIOWATCH
            </span>
            <span className="mt-1 block text-[9px] font-medium uppercase tracking-[0.3em] text-ink-500">
              International
            </span>
            <p className="mt-4 max-w-sm text-xs leading-relaxed text-ink-500">
              Open environmental monitoring, built with the people who live
              there.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-xs text-ink-600 sm:items-end">
            {list.map((p) => (
              <a key={p.key} href={p.href} className="hover:text-ink-900">
                {p.latin} · {p.place}
              </a>
            ))}
            <a href={`mailto:${CONTACT}`} className="hover:text-ink-900">
              {CONTACT}
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
