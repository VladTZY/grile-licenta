"use client";

import { useEffect, useMemo, useState } from "react";
import { QUESTIONS, TREE } from "@/lib/questions";
import QuizRunner from "@/components/QuizRunner";
import HardToggle from "@/components/HardToggle";
import Filters, { sectionKey } from "@/components/Filters";

const HARD_KEY = "grile_practice_hard";
const SELECTED_KEY = "grile_practice_selected";
const ALL_KEYS = new Set(
  TREE.flatMap((m) => m.sections.map((s) => sectionKey(m.module, s.section)))
);

export default function PracticePage() {
  const [hard, setHard] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(ALL_KEYS));
  const [showFilters, setShowFilters] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setHard(localStorage.getItem(HARD_KEY) === "1");
    try {
      const s = JSON.parse(localStorage.getItem(SELECTED_KEY) || "null");
      if (Array.isArray(s) && s.length) setSelected(new Set(s));
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  function toggleHard() {
    setHard((h) => {
      const next = !h;
      localStorage.setItem(HARD_KEY, next ? "1" : "0");
      return next;
    });
  }

  function changeSelected(next: Set<string>) {
    setSelected(next);
    localStorage.setItem(SELECTED_KEY, JSON.stringify([...next]));
  }

  // keep original order, just narrow to selected chapters
  const filtered = useMemo(
    () => QUESTIONS.filter((q) => selected.has(sectionKey(q.module, q.section))),
    [selected]
  );

  if (!mounted) {
    return <p className="py-12 text-center text-slate-400">Se încarcă…</p>;
  }

  const allSelected = selected.size === ALL_KEYS.size;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Pe rând</h1>
          <p className="text-sm text-slate-600">
            {filtered.length} întrebări{allSelected ? "" : " (filtrate)"}, în ordine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              allSelected
                ? "border-slate-300 text-slate-600 hover:bg-slate-100"
                : "border-slate-900 bg-slate-900 text-white"
            }`}
          >
            Capitole{allSelected ? "" : ` (${selected.size})`}
          </button>
          <HardToggle hard={hard} onToggle={toggleHard} />
        </div>
      </div>

      {showFilters && <Filters tree={TREE} selected={selected} onChange={changeSelected} />}

      <QuizRunner
        questions={filtered}
        storageKey="practice"
        hard={hard}
        emptyMessage="Niciun capitol selectat. Alege cel puțin unul din „Capitole”."
      />
    </div>
  );
}
