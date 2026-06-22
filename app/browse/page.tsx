"use client";

import { useEffect, useMemo, useState } from "react";
import { QUESTIONS, TREE } from "@/lib/questions";
import Filters, { sectionKey } from "@/components/Filters";
import QuestionContent from "@/components/QuestionContent";
import {
  Overrides,
  applyOverride,
  isEdited,
  loadOverrides,
  saveOverrides,
} from "@/lib/overrides";
import type { Question } from "@/lib/types";

const ALL_KEYS = new Set(
  TREE.flatMap((m) => m.sections.map((s) => sectionKey(m.module, s.section)))
);

export default function BrowsePage() {
  const [selected, setSelected] = useState<Set<string>>(new Set(ALL_KEYS));
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<Overrides>({});
  const [showFilters, setShowFilters] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load saved edits before the first visible render so refreshes never flash
  // the original (unedited) answers.
  useEffect(() => {
    setOverrides(loadOverrides());
    setMounted(true);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return QUESTIONS.filter(
      (item) =>
        selected.has(sectionKey(item.module, item.section)) &&
        (!q ||
          item.text.toLowerCase().includes(q) ||
          item.options.some((o) => o.text.toLowerCase().includes(q)))
    );
  }, [selected, search]);

  function setCorrect(q: Question, label: string) {
    const current = applyOverride(q, overrides);
    const labels = new Set(
      current.options.filter((o) => o.correct).map((o) => o.label)
    );
    labels.has(label) ? labels.delete(label) : labels.add(label);
    const next = { ...overrides, [q.id]: [...labels].sort() };
    setOverrides(next);
    saveOverrides(next);
  }

  function resetAll() {
    setOverrides({});
    saveOverrides({});
  }

  function exportJson() {
    const merged = QUESTIONS.map((q) => applyOverride(q, overrides));
    const blob = new Blob([JSON.stringify(merged, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "questions.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const editedCount = Object.keys(overrides).length;

  if (!mounted) {
    return <p className="py-12 text-center text-slate-400">Se încarcă…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Toate grilele</h1>
        <div className="flex items-center gap-2">
          {editedCount > 0 && (
            <button
              onClick={resetAll}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Resetează ({editedCount})
            </button>
          )}
          <button
            onClick={exportJson}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Exportă questions.json
          </button>
        </div>
      </div>

      {editedCount > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Ai {editedCount} întrebări modificate (salvate local). Exportă fișierul și
          înlocuiește <code>data/questions.json</code> în repo pentru a le face permanente.
        </p>
      )}

      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Caută în întrebări..."
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          onClick={() => setShowFilters((s) => !s)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Capitole
        </button>
      </div>

      {showFilters && <Filters tree={TREE} selected={selected} onChange={setSelected} />}

      <p className="text-sm text-slate-500">{filtered.length} întrebări</p>

      <div className="space-y-3">
        {filtered.map((base) => {
          const q = applyOverride(base, overrides);
          return (
            <div
              key={q.id}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="mb-2 flex items-start justify-between gap-2 text-xs text-slate-500">
                <span className="min-w-0">
                  {q.module} · {q.section} · #{q.number}
                </span>
                {isEdited(base, overrides) && (
                  <span className="flex-none rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
                    modificat
                  </span>
                )}
              </div>
              <QuestionContent content={q.content} />
              <ul className="mt-3 space-y-1">
                {q.options.map((o) => (
                  <li key={o.label}>
                    <label
                      className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm ${
                        o.correct ? "bg-green-50 text-green-800" : "text-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={o.correct}
                        onChange={() => setCorrect(base, o.label)}
                        className="mt-1 h-4 w-4 flex-none rounded border-slate-300"
                      />
                      <span className="flex-none font-semibold">{o.label}.</span>
                      <span
                        className={`min-w-0 flex-1 ${
                          o.isCode ? "whitespace-pre-wrap break-all font-mono" : "break-words"
                        }`}
                      >
                        {o.text}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
