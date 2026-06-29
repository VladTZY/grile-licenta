"use client";

import { useEffect, useState } from "react";
import { QUESTIONS, TREE, EXAM_SIZE, allocateExam, buildExamDeck } from "@/lib/questions";
import QuizRunner from "@/components/QuizRunner";
import type { Question } from "@/lib/types";

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
const SESSION_KEY = "grile_exam_session";

// Deterministic — safe to render on the server and during hydration.
const ALLOCATION = allocateExam(EXAM_SIZE);
const EXAM_TOTAL = ALLOCATION.reduce((a, p) => a + p.count, 0);

export default function ExamPage() {
  const [started, setStarted] = useState(false);
  const [deck, setDeck] = useState<Question[]>([]);
  const [mounted, setMounted] = useState(false);

  // restore a session in progress (deck + whether started)
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && Array.isArray(s.deckIds)) {
        setDeck(s.deckIds.map((id: string) => BY_ID.get(id)).filter(Boolean));
        setStarted(!!s.started);
      }
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  function persist(d: Question[], isStarted: boolean) {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ deckIds: d.map((q) => q.id), started: isStarted })
    );
  }

  function start() {
    const d = buildExamDeck(EXAM_SIZE);
    setDeck(d);
    setStarted(true);
    persist(d, true);
  }

  if (!mounted) {
    return <p className="py-12 text-center text-slate-400">Se încarcă…</p>;
  }

  if (started && deck.length) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">Simulare examen</h1>
          <button
            onClick={() => {
              setStarted(false);
              persist(deck, false);
            }}
            className="text-sm text-slate-600 hover:underline"
          >
            ← Înapoi
          </button>
        </div>
        <QuizRunner
          questions={deck}
          storageKey="exam"
          singlePass
          showGrade
          onRestart={start}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Simulare examen</h1>
        <p className="mt-1 text-sm text-slate-600">
          {EXAM_TOTAL} de întrebări la întâmplare, repartizate proporțional pe module.
          Răspunzi o singură dată la fiecare, apoi primești nota: fiecare grilă
          corectă valorează 0.25 puncte.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Repartizare</h2>
        <ul className="mt-2 space-y-1 text-sm text-slate-600">
          {ALLOCATION.map((p) => (
            <li key={p.module} className="flex justify-between">
              <span>{p.module}</span>
              <span className="tabular-nums text-slate-400">{p.count} întrebări</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={start}
        className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
      >
        Începe examenul
      </button>
    </div>
  );
}
