"use client";

import { useEffect, useState } from "react";
import type { Question } from "@/lib/types";
import QuestionContent from "./QuestionContent";

interface Props {
  question: Question;
  index?: number;
  total?: number;
  onNext?: () => void;
  onResult?: (correct: boolean) => void;
  isLast?: boolean;
}

export default function QuestionCard({
  question,
  index,
  total,
  onNext,
  onResult,
  isLast,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState(false);

  const correctLabels = new Set(
    question.options.filter((o) => o.correct).map((o) => o.label)
  );

  function toggle(label: string) {
    if (revealed) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  function check() {
    if (revealed) return;
    setRevealed(true);
    const isCorrect =
      selected.size === correctLabels.size &&
      [...selected].every((l) => correctLabels.has(l));
    onResult?.(isCorrect);
  }

  const isCorrectOverall =
    selected.size === correctLabels.size &&
    [...selected].every((l) => correctLabels.has(l));

  // Enter submits the answer; once revealed, Enter advances to the next question.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.repeat) return;
      e.preventDefault();
      if (!revealed) check();
      else onNext?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, selected, onNext]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-2 text-xs font-medium text-slate-500">
        <span className="min-w-0">
          {question.module} · {question.section}
        </span>
        {index != null && total != null && (
          <span className="flex-none tabular-nums">
            {index + 1} / {total}
          </span>
        )}
      </div>

      <QuestionContent content={question.content} />

      <ul className="mt-4 space-y-2">
        {question.options.map((opt) => {
          const picked = selected.has(opt.label);
          let cls = "border-slate-200 hover:border-slate-300";
          if (revealed) {
            if (opt.correct) cls = "border-green-500 bg-green-50";
            else if (picked) cls = "border-red-500 bg-red-50";
            else cls = "border-slate-200 opacity-70";
          } else if (picked) {
            cls = "border-slate-900 bg-slate-50";
          }
          return (
            <li key={opt.label}>
              <button
                type="button"
                onClick={() => toggle(opt.label)}
                disabled={revealed}
                className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition ${cls}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border text-xs font-bold ${
                    picked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-500"
                  }`}
                >
                  {opt.label}
                </span>
                {opt.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={opt.image} alt={opt.text} className="max-h-12 max-w-full" />
                ) : (
                  <span
                    className={`min-w-0 flex-1 text-sm text-slate-800 ${
                      opt.isCode
                        ? "whitespace-pre-wrap break-all font-mono"
                        : "whitespace-pre-line break-words"
                    }`}
                  >
                    {opt.text}
                  </span>
                )}
                {revealed && opt.correct && (
                  <span className="ml-auto text-green-600">✓</span>
                )}
                {revealed && !opt.correct && picked && (
                  <span className="ml-auto text-red-600">✗</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex items-center gap-3">
        {!revealed ? (
          <button
            onClick={check}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Verifică
          </button>
        ) : (
          <>
            {onNext && (
              <button
                onClick={onNext}
                autoFocus
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                {isLast ? "Termină" : "Continuă →"}
              </button>
            )}
            <span
              className={`text-sm font-semibold ${
                isCorrectOverall ? "text-green-600" : "text-red-600"
              }`}
            >
              {isCorrectOverall ? "Corect!" : "Greșit"}
            </span>
          </>
        )}
      </div>

      {revealed && correctLabels.size === 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Această întrebare nu are niciun răspuns marcat ca fiind corect.
        </p>
      )}

      {revealed && question.explanation && (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          <span className="font-semibold">Explicație: </span>
          {question.explanation}
        </div>
      )}
    </div>
  );
}
