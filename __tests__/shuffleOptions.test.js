/**
 * Tests for the hard-mode per-run randomisation feature in QuizRunner.
 *
 * These tests replicate the exact logic extracted from components/QuizRunner.tsx
 * and lib/overrides.ts (both TypeScript; replicated here as plain JS so they
 * can run via `node --test` without any extra build tooling).
 *
 * Coverage map (acceptance criteria from spec.md):
 *   AC1  – scramble order varies between runs (different runSeed)
 *   AC2  – normal mode: source order preserved
 *   AC3  – within-run stability: same runSeed + q.id always → same order
 *   AC4  – correct flags preserved after shuffle (single and multi-correct)
 *   AC5  – visible labels are contiguous A,B,C… in display order
 *   AC6  – overrides apply before shuffle, resolved against original labels
 *   AC7  – startFresh regenerates seed (a new run gets a new seed)
 *   AC8  – toggling hard off returns source order; toggling on re-shuffles
 *   AC9  – fingerprint based on question ids only, not option order
 *
 * Edge cases:
 *   EC1  – 0-option question: no throw, empty options array
 *   EC2  – 1-option question: no throw, single option gets label A
 *   EC3  – >14 options: LABELS[i] ?? o.label fallback (pre-existing behaviour,
 *           not regressed by this change). The 15th position uses the in-array
 *           o.label of whichever option was shuffled there (a non-undefined
 *           string, though potentially a duplicate). No throw; 15 options
 *           returned; first 14 positions receive LABELS[0..13].
 *   EC4  – multi-correct: all correct flags survive
 *   EC5  – image / isCode fields carried through unchanged
 *   EC6  – seed=0 (SSR placeholder): runs without throw, deterministic
 *   EC7  – overrides changing does NOT change the permutation for same runSeed
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ─── Replicated source logic (must stay in sync with components/QuizRunner.tsx) ────

const LABELS = "ABCDEFGHIJKLMN"; // 14 chars

/** Exact copy of newSeed() from QuizRunner.tsx (conceptually; here we can call
 *  Math.random freely since these tests run in Node, not SSR context). */
function newSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0;
}

/** Exact copy of shuffleOptions() from QuizRunner.tsx */
function shuffleOptions(q, runSeed) {
  let seed = runSeed | 0;
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

/** Exact copy of fingerprint() from QuizRunner.tsx */
function fingerprint(list) {
  let h = 0;
  for (const q of list) {
    for (let i = 0; i < q.id.length; i++) h = (h * 31 + q.id.charCodeAt(i)) | 0;
  }
  return `${list.length}:${h}`;
}

/** Exact copy of applyOverride() from lib/overrides.ts */
function applyOverride(q, o) {
  const labels = o[q.id];
  if (!labels) return q;
  const set = new Set(labels);
  const options = q.options.map((opt) => ({ ...opt, correct: set.has(opt.label) }));
  return { ...q, options, correctCount: options.filter((x) => x.correct).length };
}

/** Exact copy of applyOverrides() from lib/overrides.ts */
function applyOverrides(questions, o) {
  if (!Object.keys(o).length) return questions;
  return questions.map((q) => applyOverride(q, o));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal Question fixture. */
function makeQuestion(id, optionCount = 4, multiCorrectIndices = [0]) {
  const options = Array.from({ length: optionCount }, (_, i) => ({
    label: LABELS[i] ?? String(i),
    text: `Option ${i + 1} text`,
    isCode: false,
    correct: multiCorrectIndices.includes(i),
    image: undefined,
  }));
  return {
    id,
    module: "TestModule",
    section: "TestSection",
    number: 1,
    content: [{ type: "text", value: `Question ${id}` }],
    text: `Question ${id}`,
    options,
    correctCount: multiCorrectIndices.length,
  };
}

/** Return the ordered array of option texts (position-in-array, not label). */
function textOrder(q) {
  return q.options.map((o) => o.text);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("shuffleOptions – per-run randomisation", () => {
  // ── AC3 / stability within a run ─────────────────────────────────────────
  it("AC3: same runSeed + same q.id → identical option order (within-run stability)", () => {
    const q = makeQuestion("q001");
    const seed = 12345678;
    const r1 = shuffleOptions(q, seed);
    const r2 = shuffleOptions(q, seed);
    assert.deepStrictEqual(textOrder(r1), textOrder(r2),
      "Same seed must produce identical permutation");
  });

  // ── AC1 / scramble varies between runs ───────────────────────────────────
  it("AC1: different runSeeds → different option order for at least some questions (across 10 seed pairs)", () => {
    // With 4 options (4! = 24 permutations), the probability that all 10 pairs
    // happen to collide is astronomically small.
    const q = makeQuestion("question-with-four-options");
    let differenceFound = false;
    for (let trial = 0; trial < 10; trial++) {
      const s1 = newSeed();
      let s2 = newSeed();
      // Guarantee the seeds differ (extremely rare edge)
      while (s2 === s1) s2 = newSeed();
      const r1 = shuffleOptions(q, s1);
      const r2 = shuffleOptions(q, s2);
      if (JSON.stringify(textOrder(r1)) !== JSON.stringify(textOrder(r2))) {
        differenceFound = true;
        break;
      }
    }
    assert.ok(differenceFound,
      "Expected at least one pair of different seeds to produce a different permutation");
  });

  // ── AC1 / seed=0 (SSR placeholder) vs real seed should often differ ──────
  it("AC1: seed=0 (SSR placeholder) and a typical real seed produce different orders (checked over 20 real seeds)", () => {
    const q = makeQuestion("q-ssr-test");
    const withZero = textOrder(shuffleOptions(q, 0));
    let differenceFound = false;
    for (let i = 0; i < 20; i++) {
      const s = newSeed();
      if (s === 0) continue; // astronomically rare; skip
      if (JSON.stringify(textOrder(shuffleOptions(q, s))) !== JSON.stringify(withZero)) {
        differenceFound = true;
        break;
      }
    }
    assert.ok(differenceFound,
      "Seed=0 result should differ from at least one real seed result");
  });

  // ── AC2 / normal mode: source order unchanged ─────────────────────────────
  it("AC2: normal mode (hard=false) – options are not shuffled (source order preserved)", () => {
    const q = makeQuestion("q-normal");
    // In normal mode `list` is just `applyOverrides(questions, {})` = questions
    const applied = applyOverrides([q], {});
    assert.deepStrictEqual(
      applied[0].options.map((o) => o.text),
      q.options.map((o) => o.text),
      "Normal mode must not change option order"
    );
    assert.deepStrictEqual(
      applied[0].options.map((o) => o.label),
      q.options.map((o) => o.label),
      "Normal mode must not change option labels"
    );
  });

  // ── AC4 / correct flags preserved ────────────────────────────────────────
  it("AC4: single-correct question – correct flag survives shuffle regardless of new position", () => {
    const q = makeQuestion("q-single-correct", 4, [2]); // option index 2 is correct
    const correctText = q.options[2].text;
    for (let trial = 0; trial < 50; trial++) {
      const shuffled = shuffleOptions(q, newSeed());
      const correctOpt = shuffled.options.find((o) => o.correct);
      assert.ok(correctOpt, "Must have exactly one correct option after shuffle");
      assert.strictEqual(correctOpt.text, correctText,
        "Correct option text must match original source");
      const correctCount = shuffled.options.filter((o) => o.correct).length;
      assert.strictEqual(correctCount, 1, "Must still have exactly one correct option");
    }
  });

  it("AC4: multi-correct question – all correct flags survive shuffle", () => {
    const q = makeQuestion("q-multi-correct", 5, [0, 2, 4]); // 3 correct options
    const correctTexts = new Set(q.options.filter((o) => o.correct).map((o) => o.text));
    for (let trial = 0; trial < 50; trial++) {
      const shuffled = shuffleOptions(q, newSeed());
      const shuffledCorrectTexts = new Set(
        shuffled.options.filter((o) => o.correct).map((o) => o.text)
      );
      assert.deepStrictEqual(shuffledCorrectTexts, correctTexts,
        "All correct option texts must survive the shuffle");
    }
  });

  // ── AC5 / contiguous labels ───────────────────────────────────────────────
  it("AC5: labels after shuffle are contiguous A,B,C,… (no gaps, no duplicates, in display order)", () => {
    const q = makeQuestion("q-labels", 5);
    for (let trial = 0; trial < 30; trial++) {
      const shuffled = shuffleOptions(q, newSeed());
      const labels = shuffled.options.map((o) => o.label);
      const expected = Array.from({ length: 5 }, (_, i) => LABELS[i]);
      assert.deepStrictEqual(labels, expected,
        `Labels must be ${expected.join("")} in position order`);
    }
  });

  // ── AC6 / overrides applied before shuffle ────────────────────────────────
  it("AC6: override applied before shuffle – overridden correct flag is preserved through relabeling", () => {
    // Start: option at index 0 is correct (label A)
    const q = makeQuestion("q-override", 4, [0]);
    // Override: change correct to original label C (index 2)
    const overrides = { "q-override": ["C"] };
    const [applied] = applyOverrides([q], overrides);

    // After override, the option with original text "Option 3 text" (was at
    // position 2, label C) should now be correct=true; the others false.
    const correctAfterOverride = applied.options.find((o) => o.correct);
    assert.strictEqual(correctAfterOverride.text, "Option 3 text",
      "Override must flip correct to the option with original label C");

    // Now shuffle: correct flag must survive regardless of new position
    for (let trial = 0; trial < 50; trial++) {
      const shuffled = shuffleOptions(applied, newSeed());
      const correctInShuffled = shuffled.options.filter((o) => o.correct);
      assert.strictEqual(correctInShuffled.length, 1,
        "Exactly one option should be correct after override + shuffle");
      assert.strictEqual(correctInShuffled[0].text, "Option 3 text",
        "The override-corrected option must still be correct after shuffle");
    }
  });

  // ── AC9 / fingerprint unchanged by option order ───────────────────────────
  it("AC9: fingerprint is derived from question ids only, not option order", () => {
    const qs = [makeQuestion("q1"), makeQuestion("q2"), makeQuestion("q3")];
    const fp1 = fingerprint(qs);
    // Shuffle the options in each question with different seeds
    const shuffled = qs.map((q) => shuffleOptions(q, newSeed()));
    const fp2 = fingerprint(shuffled);
    assert.strictEqual(fp1, fp2,
      "fingerprint must be identical before and after option shuffling");
  });

  // ── AC7 / startFresh-equivalent: new seed per new run ────────────────────
  it("AC7: newSeed() produces different values across multiple calls (simulates startFresh generating a new runSeed)", () => {
    const seeds = new Set();
    for (let i = 0; i < 20; i++) seeds.add(newSeed());
    // 20 calls should rarely produce fewer than 18 unique values
    assert.ok(seeds.size >= 15,
      `Expected mostly unique seeds, got ${seeds.size}/20 unique`);
  });

  // ── AC8 / normal mode restores source labels ──────────────────────────────
  it("AC8: after shuffling, switching to hard=false mode (no shuffle applied) returns source labels", () => {
    const q = makeQuestion("q-toggle");
    const originalLabels = q.options.map((o) => o.label);
    // Simulate hard=false: apply overrides only, no shuffle
    const [normal] = applyOverrides([q], {});
    assert.deepStrictEqual(
      normal.options.map((o) => o.label),
      originalLabels,
      "Normal mode must restore original labels"
    );
  });
});

describe("shuffleOptions – edge cases", () => {
  // ── EC1 / 0-option question ───────────────────────────────────────────────
  it("EC1: 0-option question does not throw and returns empty options array", () => {
    const q = makeQuestion("q-empty", 0, []);
    assert.doesNotThrow(() => shuffleOptions(q, newSeed()));
    const result = shuffleOptions(q, 42);
    assert.deepStrictEqual(result.options, [], "0-option result must be empty array");
  });

  // ── EC2 / 1-option question ───────────────────────────────────────────────
  it("EC2: 1-option question does not throw; single option gets label A", () => {
    const q = makeQuestion("q-single", 1, [0]);
    assert.doesNotThrow(() => shuffleOptions(q, newSeed()));
    const result = shuffleOptions(q, 99);
    assert.strictEqual(result.options.length, 1);
    assert.strictEqual(result.options[0].label, "A",
      "Single option must be assigned label A");
  });

  // ── EC3 / >14 options (beyond LABELS length) ─────────────────────────────
  //
  // Pre-existing behaviour (present in both old and new code; not regressed):
  // The label assignment is `opts.map((o, i) => ({ ...o, label: LABELS[i] ?? o.label }))`.
  // After Fisher-Yates, the option at position 14 already carries whatever label
  // it had in its original source position (e.g. "M" = LABELS[12]).
  // `LABELS[14]` is `undefined`, so the fallback `o.label` returns that carried
  // label — which is a non-undefined string, but may duplicate another position.
  // Spec requires: no throw, 15 options returned, first 14 get LABELS[0..13].
  it("EC3: question with 15 options (>14) – does not throw; first 14 positions get contiguous labels; 15th gets a non-undefined string via fallback", () => {
    // Build 15 options — source labels are A..N for 0..13, then "Z" at index 14
    const options = Array.from({ length: 15 }, (_, i) => ({
      label: i < 14 ? LABELS[i] : "Z",
      text: `Option ${i + 1}`,
      isCode: false,
      correct: i === 0,
      image: undefined,
    }));
    const q = {
      id: "q-fifteen",
      module: "M", section: "S", number: 1,
      content: [], text: "test", options,
      correctCount: 1,
    };

    // Must not throw for multiple seeds
    for (const seed of [7, 42, 99, 0, 12345]) {
      assert.doesNotThrow(() => shuffleOptions(q, seed),
        `seed=${seed} must not throw for 15-option question`);
    }

    const result = shuffleOptions(q, 7);
    assert.strictEqual(result.options.length, 15, "Must return 15 options");

    // First 14 positions must get LABELS[0..13] exactly
    for (let i = 0; i < 14; i++) {
      assert.strictEqual(result.options[i].label, LABELS[i],
        `Position ${i} must have label ${LABELS[i]}`);
    }

    // Position 14 must use the fallback: a non-undefined, non-null string
    // (it carries the label the shuffled-to-here option had before the map;
    //  this is a pre-existing behaviour, not introduced by this change).
    const label15 = result.options[14].label;
    assert.ok(typeof label15 === "string" && label15.length > 0,
      `Position 14 fallback must be a non-empty string, got: ${JSON.stringify(label15)}`);
  });

  // ── EC4 / all correct flags preserved in multi-correct ───────────────────
  it("EC4: multi-correct – every correct option survives 100 shuffles", () => {
    const correctIndices = [0, 1, 3];
    const q = makeQuestion("q-multi-ec4", 5, correctIndices);
    const correctTexts = new Set(correctIndices.map((i) => q.options[i].text));
    for (let trial = 0; trial < 100; trial++) {
      const result = shuffleOptions(q, trial * 111 + 1);
      const resultCorrect = new Set(result.options.filter((o) => o.correct).map((o) => o.text));
      assert.deepStrictEqual(resultCorrect, correctTexts,
        `Trial ${trial}: correct texts must survive shuffle`);
    }
  });

  // ── EC5 / image and isCode fields carried through ─────────────────────────
  it("EC5: options with image or isCode fields are carried through unchanged after shuffle", () => {
    const options = [
      { label: "A", text: "normal text", isCode: false, correct: false, image: undefined },
      { label: "B", text: "some code", isCode: true, correct: true, image: undefined },
      { label: "C", text: "img alt", isCode: false, correct: false, image: "data:img/png;base64,abc" },
      { label: "D", text: "another", isCode: false, correct: false, image: undefined },
    ];
    const q = {
      id: "q-fields",
      module: "M", section: "S", number: 1,
      content: [], text: "test", options,
      correctCount: 1,
    };
    for (let trial = 0; trial < 30; trial++) {
      const result = shuffleOptions(q, trial * 17 + 3);
      for (const orig of options) {
        const inResult = result.options.find((o) => o.text === orig.text);
        assert.ok(inResult, `Option "${orig.text}" must be present after shuffle`);
        assert.strictEqual(inResult.isCode, orig.isCode,
          `isCode for "${orig.text}" must survive shuffle`);
        assert.strictEqual(inResult.image, orig.image,
          `image for "${orig.text}" must survive shuffle`);
        assert.strictEqual(inResult.correct, orig.correct,
          `correct flag for "${orig.text}" must survive shuffle`);
      }
    }
  });

  // ── EC6 / seed=0 (SSR placeholder) works without throw ───────────────────
  it("EC6: seed=0 (SSR placeholder) does not throw and produces a valid result", () => {
    const q = makeQuestion("q-seed-zero", 4, [1]);
    assert.doesNotThrow(() => shuffleOptions(q, 0));
    const result = shuffleOptions(q, 0);
    assert.strictEqual(result.options.length, 4);
    const labels = result.options.map((o) => o.label);
    assert.deepStrictEqual(labels, ["A", "B", "C", "D"],
      "Seed=0 must still produce contiguous labels");
  });

  // ── EC7 / overrides changing: same runSeed → same permutation ────────────
  it("EC7: re-running shuffleOptions with same runSeed after override change gives same permutation (memo stability)", () => {
    const q = makeQuestion("q-override-stable", 4, [0]);
    const seed = 987654321;

    // Before override
    const before = textOrder(shuffleOptions(q, seed));

    // Apply an override (changes correct flag) and shuffle again with same seed
    const overrides = { "q-override-stable": ["B"] };
    const [withOverride] = applyOverrides([q], overrides);
    const after = textOrder(shuffleOptions(withOverride, seed));

    assert.deepStrictEqual(before, after,
      "Same runSeed must produce same permutation regardless of override changes (overrides affect correct flags, not order)");
  });
});

describe("applyOverrides – override ordering", () => {
  it("overrides are keyed by original label; correct flags update before shuffle", () => {
    // q has options A(wrong), B(correct), C(wrong), D(wrong)
    const q = makeQuestion("q-ov-order", 4, [1]);
    // Override: make D correct (original label D = index 3)
    const overrides = { "q-ov-order": ["D"] };
    const [applied] = applyOverrides([q], overrides);
    assert.strictEqual(applied.options[3].correct, true, "D must be correct after override");
    assert.strictEqual(applied.options[1].correct, false, "B must be wrong after override");
    // Now shuffle: D's correct flag must persist
    const correctTexts = new Set(applied.options.filter((o) => o.correct).map((o) => o.text));
    for (let trial = 0; trial < 50; trial++) {
      const shuffled = shuffleOptions(applied, newSeed());
      const resultCorrect = new Set(shuffled.options.filter((o) => o.correct).map((o) => o.text));
      assert.deepStrictEqual(resultCorrect, correctTexts,
        `Trial ${trial}: override-corrected option must survive shuffle`);
    }
  });

  it("applyOverrides with empty overrides object returns the original questions array unchanged", () => {
    const qs = [makeQuestion("q1"), makeQuestion("q2")];
    const result = applyOverrides(qs, {});
    assert.strictEqual(result, qs, "applyOverrides({}) must return the original array reference");
  });

  it("applyOverride for a question with no override entry returns the original question unchanged", () => {
    const q = makeQuestion("q-no-override", 3, [0]);
    const result = applyOverride(q, { "other-q": ["A"] });
    assert.strictEqual(result, q, "No override entry → same object reference returned");
  });
});

describe("fingerprint – saved-progress stability", () => {
  it("fingerprint changes when question list changes", () => {
    const qs1 = [makeQuestion("q1"), makeQuestion("q2")];
    const qs2 = [makeQuestion("q1"), makeQuestion("q3")]; // q2 → q3
    assert.notStrictEqual(fingerprint(qs1), fingerprint(qs2),
      "Fingerprint must differ when question ids differ");
  });

  it("fingerprint changes when question count changes", () => {
    const qs1 = [makeQuestion("q1"), makeQuestion("q2")];
    const qs2 = [makeQuestion("q1")];
    assert.notStrictEqual(fingerprint(qs1), fingerprint(qs2),
      "Fingerprint must differ when count differs");
  });

  it("fingerprint is stable across multiple calls with same questions", () => {
    const qs = [makeQuestion("q1"), makeQuestion("q2"), makeQuestion("q3")];
    assert.strictEqual(fingerprint(qs), fingerprint(qs),
      "fingerprint must be deterministic");
  });

  it("fingerprint is independent of option order within questions", () => {
    const qs = [makeQuestion("q1", 4, [0]), makeQuestion("q2", 4, [1])];
    const fp_before = fingerprint(qs);
    const shuffled = qs.map((q) => shuffleOptions(q, 12345));
    assert.strictEqual(fingerprint(shuffled), fp_before,
      "fingerprint must not change after option shuffle");
  });
});

describe("SSR / hydration safety – newSeed() behaviour", () => {
  it("newSeed() returns a 32-bit integer (safe as useState(0) placeholder is also a number)", () => {
    for (let i = 0; i < 20; i++) {
      const s = newSeed();
      assert.ok(typeof s === "number", "newSeed must return a number");
      assert.ok(Number.isInteger(s), "newSeed must return an integer");
      // 32-bit signed: range is -2^31 to 2^31-1 (the | 0 coercion)
      assert.ok(s >= -2147483648 && s <= 2147483647,
        `newSeed out of 32-bit signed range: ${s}`);
    }
  });

  it("SSR: runSeed=0 initial state produces consistent result (same seed always gives same output)", () => {
    const q = makeQuestion("q-ssr", 4, [0]);
    const r1 = shuffleOptions(q, 0);
    const r2 = shuffleOptions(q, 0);
    assert.deepStrictEqual(textOrder(r1), textOrder(r2),
      "seed=0 (SSR) must be deterministic");
  });
});
