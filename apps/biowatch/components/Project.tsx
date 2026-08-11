import Image from "next/image";

export type Project = {
  key: string;
  badge: string;
  /** The project's own name, in its own language first. */
  name: string;
  latin: string;
  place: string;
  href: string;
  /** What it watches, in one line. */
  watches: string;
  body: string;
  /** Headline figures. `note` marks anything not read live from the project. */
  stats: { value: string; label: string }[];
  live: boolean;
  cta: string;
};

/**
 * One project, as a door.
 *
 * The badge does the identifying — these two were drawn as a set and a visitor
 * recognises them faster than they read a name. So the card leads with it at a
 * size where the animal is legible, not at favicon scale.
 */
export default function ProjectCard({ p }: { p: Project }) {
  return (
    <a
      href={p.href}
      className="group flex flex-col rounded-2xl border border-ink-900/12 bg-paper-100 p-7 transition hover:border-ink-900/25 hover:shadow-[0_12px_40px_rgba(22,36,28,0.10)] sm:p-8"
    >
      <div className="flex items-start gap-5">
        <Image
          src={p.badge}
          alt=""
          width={96}
          height={96}
          className="shrink-0 rounded-full"
        />
        <div className="min-w-0">
          <h3 className="text-xl font-semibold text-ink-900">{p.name}</h3>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.22em] text-ember-700">
            {p.latin}
          </p>
          <p className="mt-2 text-sm text-ink-500">{p.place}</p>
        </div>
      </div>

      <p className="mt-5 text-sm font-medium text-ink-800">{p.watches}</p>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">
        {p.body}
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-ink-900/10 pt-5">
        {p.stats.map((s) => (
          <div key={s.label}>
            <dd className="text-lg font-semibold tabular-nums text-ink-900">
              {s.value}
            </dd>
            <dt className="mt-0.5 text-[11px] leading-tight text-ink-500">
              {s.label}
            </dt>
          </div>
        ))}
      </dl>

      <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ember-700">
        {p.cta}
        <span aria-hidden className="transition group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </a>
  );
}
