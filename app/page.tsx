import Link from "next/link";
import { QUESTIONS, TREE } from "@/lib/questions";

export default function Home() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold text-slate-900">Grile pentru examen</h1>
        <p className="mt-1 text-slate-600">
          {QUESTIONS.length} de întrebări din {TREE.length} module.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ModeCard
          href="/practice"
          title="Pe rând"
          desc="Parcurgi toate întrebările în ordine, cu feedback după fiecare."
        />
        <ModeCard
          href="/random"
          title="Aleatoriu"
          desc="Întrebări în ordine aleatorie, filtrate pe module și capitole."
        />
        <ModeCard
          href="/exam"
          title="Simulare examen"
          desc="40 de întrebări proporțional pe module, cu scor final."
        />
        <ModeCard
          href="/browse"
          title="Toate grilele"
          desc="Vezi și editează răspunsul corect pentru fiecare întrebare."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Conținut</h2>
        <div className="space-y-4">
          {TREE.map((m) => (
            <div key={m.module} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold text-slate-900">{m.module}</h3>
                <span className="text-sm text-slate-500">{m.count} întrebări</span>
              </div>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {m.sections.map((s) => (
                  <li key={s.section} className="flex justify-between">
                    <span>{s.section}</span>
                    <span className="tabular-nums text-slate-400">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ModeCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-400 hover:shadow-sm"
    >
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{desc}</p>
    </Link>
  );
}
