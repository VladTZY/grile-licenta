"use client";

import { useEffect, useMemo, useState } from "react";
import { QUESTIONS, TREE } from "@/lib/questions";
import Filters, { sectionKey } from "@/components/Filters";
import QuizRunner from "@/components/QuizRunner";
import HardToggle from "@/components/HardToggle";
import type { Question } from "@/lib/types";

const ALL_KEYS = new Set(
  TREE.flatMap((m) => m.sections.map((s) => sectionKey(m.module, s.section)))
);
const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
const SESSION_KEY = "grile_random_session";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function RandomPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set(ALL_KEYS));
  const [started, setStarted] = useState(false);
  const [deck, setDeck] = useState<Question[]>([]);
  const [hard, setHard] = useState(false);
  const [mounted, setMounted] = useState(false);

  // restore the previous session (filters + shuffled deck + whether started)
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s) {
        if (Array.isArray(s.selected)) setSelected(new Set(s.selected));
        if (Array.isArray(s.deckIds)) {
          setDeck(s.deckIds.map((id: string) => BY_ID.get(id)).filter(Boolean));
        }
        setStarted(!!s.started);
        setHard(!!s.hard);
      }
    } catch {
      /* ignore */
    }
    setMounted(true);
  }, []);

  function persist(next: {
    selected?: Set<string>;
    deck?: Question[];
    started?: boolean;
    hard?: boolean;
  }) {
    const sel = next.selected ?? selected;
    const dk = next.deck ?? deck;
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        selected: [...sel],
        deckIds: dk.map((q) => q.id),
        started: next.started ?? started,
        hard: next.hard ?? hard,
      })
    );
  }

  function toggleHard() {
    const next = !hard;
    setHard(next);
    persist({ hard: next });
  }

  const filtered = useMemo(
    () => QUESTIONS.filter((q) => selected.has(sectionKey(q.module, q.section))),
    [selected]
  );

  function start() {
    const d = shuffle(filtered);
    setDeck(d);
    setStarted(true);
    persist({ deck: d, started: true });
  }

  function changeSelected(next: Set<string>) {
    setSelected(next);
    persist({ selected: next });
  }

  if (!mounted) {
    return <p className="py-12 text-center text-slate-400">Se încarcă…</p>;
  }

  if (started) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">Aleatoriu</h1>
          <button
            onClick={() => {
              setStarted(false);
              persist({ started: false });
            }}
            className="text-sm text-slate-600 hover:underline"
          >
            ← Schimbă filtrele
          </button>
        </div>
        <QuizRunner
          questions={deck}
          storageKey="random"
          hard={hard}
          onRestart={() => {
            const d = shuffle(filtered);
            setDeck(d);
            persist({ deck: d });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Aleatoriu</h1>
          <p className="text-sm text-slate-600">
            Alege capitolele, apoi primești întrebările în ordine aleatorie.
          </p>
        </div>
        <HardToggle hard={hard} onToggle={toggleHard} />
      </div>

      <Filters tree={TREE} selected={selected} onChange={changeSelected} />

      <div className="flex items-center gap-4">
        <button
          onClick={start}
          disabled={filtered.length === 0}
          className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          Începe
        </button>
        <span className="text-sm text-slate-500">
          {filtered.length} întrebări selectate
        </span>
      </div>
    </div>
  );
}
