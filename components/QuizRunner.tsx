"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Question } from "@/lib/types";
import { applyOverrides, loadOverrides } from "@/lib/overrides";
import QuestionCard from "./QuestionCard";

interface Props {
  questions: Question[];
  /** Called to restart/reshuffle (random mode); defaults to a simple reset. */
  onRestart?: () => void;
  emptyMessage?: string;
  /** When set, progress persists across refreshes. */
  storageKey?: string;
  /** Hard mode: also shuffle (and relabel) the answer options. */
  hard?: boolean;
}

const LABELS = "ABCDEFGHIJKLMN";

/** Deterministic per-question shuffle so option order is stable across renders
 *  and refreshes (no jumping around, resume-safe). */
function shuffleOptions(q: Question): Question {
  let seed = 0;
  for (let i = 0; i < q.id.length; i++) seed = (seed * 31 + q.id.charCodeAt(i)) | 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const opts = [...q.options];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return { ...q, options: opts.map((o, i) => ({ ...o, label: LABELS[i] ?? o.label })) };
}

/** Order-sensitive fingerprint of the original deck, so saved progress only
 *  restores onto the exact same set of questions. */
function fingerprint(list: Question[]): string {
  let h = 0;
  for (const q of list) {
    for (let i = 0; i < q.id.length; i++) h = (h * 31 + q.id.charCodeAt(i)) | 0;
  }
  return `${list.length}:${h}`;
}

interface Saved {
  fp: string;
  round: number;
  queueIds: string[];
  pos: number;
  wrongIds: string[];
  correct: number;
  attempted: number;
  done: boolean;
}

export default function QuizRunner({
  questions,
  onRestart,
  emptyMessage,
  storageKey,
  hard = false,
}: Props) {
  const [overrides, setOverrides] = useState<ReturnType<typeof loadOverrides>>({});
  const [mounted, setMounted] = useState(false);

  // round-based state
  const [round, setRound] = useState(1);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [pos, setPos] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [correct, setCorrect] = useState(0); // total correct answers given
  const [attempted, setAttempted] = useState(0); // total answers given
  const [done, setDone] = useState(false);
  const [showRoundEnd, setShowRoundEnd] = useState(false);

  const list = useMemo(() => {
    const applied = applyOverrides(questions, overrides);
    return hard ? applied.map(shuffleOptions) : applied;
  }, [questions, overrides, hard]);
  const byId = useMemo(() => new Map(list.map((q) => [q.id, q])), [list]);
  const fp = fingerprint(questions);
  const progressKey = storageKey ? `grile_progress_${storageKey}` : null;

  function startFresh(src: Question[] = questions) {
    setRound(1);
    setQueueIds(src.map((q) => q.id));
    setPos(0);
    setWrongIds([]);
    setCorrect(0);
    setAttempted(0);
    setDone(false);
    setShowRoundEnd(false);
  }

  // mount: load answer-edits + restore saved progress
  useEffect(() => {
    const ov = loadOverrides();
    setOverrides(ov);
    let restored = false;
    if (progressKey) {
      try {
        const s: Saved | null = JSON.parse(localStorage.getItem(progressKey) || "null");
        if (s && s.fp === fp && s.queueIds.every((id) => questions.some((q) => q.id === id))) {
          setRound(s.round);
          setQueueIds(s.queueIds);
          setPos(s.pos);
          setWrongIds(s.wrongIds);
          setCorrect(s.correct);
          setAttempted(s.attempted);
          setDone(s.done);
          restored = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (!restored) startFresh();
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reset when the deck genuinely changes (new filter / reshuffle)
  const prevFp = useRef(fp);
  useEffect(() => {
    if (!mounted) return;
    if (prevFp.current !== fp) {
      prevFp.current = fp;
      startFresh();
    }
  }, [fp, mounted]);

  // persist
  useEffect(() => {
    if (!mounted || !progressKey) return;
    const data: Saved = { fp, round, queueIds, pos, wrongIds, correct, attempted, done };
    localStorage.setItem(progressKey, JSON.stringify(data));
  }, [mounted, progressKey, fp, round, queueIds, pos, wrongIds, correct, attempted, done]);

  if (!mounted) {
    return <p className="py-12 text-center text-slate-400">Se încarcă…</p>;
  }

  if (!list.length) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-600">
        {emptyMessage ?? "Nicio întrebare disponibilă."}
      </p>
    );
  }

  const queue = queueIds.map((id) => byId.get(id)).filter(Boolean) as Question[];

  if (done) {
    const pct = attempted ? Math.round((correct / attempted) * 100) : 0;
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <h2 className="text-xl font-bold text-green-600">Toate corecte! 🎉</h2>
        <p className="mt-2 text-slate-700">
          Ai răspuns corect la toate cele {questions.length} întrebări.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {round} {round === 1 ? "rundă" : "runde"} · {correct}/{attempted} răspunsuri corecte ({pct}%)
        </p>
        <button
          onClick={() => {
            onRestart?.();
            startFresh();
          }}
          className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          De la capăt
        </button>
      </div>
    );
  }

  // interstitial between rounds: only wrong questions get repeated
  if (showRoundEnd) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <h2 className="text-lg font-bold text-slate-900">Runda {round} terminată</h2>
        <p className="mt-2 text-slate-700">
          Ai {wrongIds.length}{" "}
          {wrongIds.length === 1 ? "întrebare greșită" : "întrebări greșite"} de reluat.
        </p>
        <button
          onClick={() => {
            setQueueIds(wrongIds);
            setWrongIds([]);
            setPos(0);
            setRound((r) => r + 1);
            setShowRoundEnd(false);
          }}
          className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Reia greșelile →
        </button>
      </div>
    );
  }

  const q = queue[pos];
  if (!q) return null;
  const isLastInRound = pos === queue.length - 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500 sm:gap-3">
        {round > 1 && (
          <span className="flex-none rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            Runda {round}
          </span>
        )}
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-slate-900 transition-all"
            style={{ width: `${(pos / queue.length) * 100}%` }}
          />
        </div>
        <span className="flex-none tabular-nums">
          {pos + 1}/{queue.length}
        </span>
        <button
          onClick={() => startFresh()}
          title="Ia de la capăt"
          className="flex-none text-xs text-slate-400 hover:text-slate-600 hover:underline"
        >
          reset
        </button>
      </div>

      <QuestionCard
        key={`${round}:${pos}:${q.id}:${hard}`}
        question={q}
        index={pos}
        total={queue.length}
        isLast={isLastInRound}
        onResult={(ok) => {
          setAttempted((a) => a + 1);
          if (ok) setCorrect((c) => c + 1);
          else setWrongIds((w) => (w.includes(q.id) ? w : [...w, q.id]));
        }}
        onNext={() => {
          if (!isLastInRound) {
            setPos((p) => p + 1);
          } else if (wrongIds.length === 0) {
            setDone(true); // every question answered correctly
          } else {
            setShowRoundEnd(true); // repeat the wrong ones next round
          }
        }}
      />
    </div>
  );
}
