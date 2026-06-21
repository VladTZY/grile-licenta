"use client";

import type { Question } from "./types";

// Edits to "which options are correct" are kept in localStorage as a map of
// questionId -> array of correct option labels. The repo JSON stays the source
// of truth; the Browse page can export a merged questions.json to commit back.
const KEY = "grile_overrides_v1";

export type Overrides = Record<string, string[]>;

export function loadOverrides(): Overrides {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveOverrides(o: Overrides) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(o));
}

/** Return a new question with `correct` flags applied from an override, if any. */
export function applyOverride(q: Question, o: Overrides): Question {
  const labels = o[q.id];
  if (!labels) return q;
  const set = new Set(labels);
  const options = q.options.map((opt) => ({ ...opt, correct: set.has(opt.label) }));
  return { ...q, options, correctCount: options.filter((x) => x.correct).length };
}

export function applyOverrides(questions: Question[], o: Overrides): Question[] {
  if (!Object.keys(o).length) return questions;
  return questions.map((q) => applyOverride(q, o));
}

/** True if this question's correct set differs from the original JSON. */
export function isEdited(q: Question, o: Overrides): boolean {
  return Object.prototype.hasOwnProperty.call(o, q.id);
}
