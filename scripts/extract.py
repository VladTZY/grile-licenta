#!/usr/bin/env python3
"""Extract quiz questions from the LaTeX-generated grile PDFs into questions.json.

Detection rules (verified against the source PDFs):
  - red span (color 0xFF0000)        -> that option is a CORRECT answer
  - bold span >=13pt (CMBX12)        -> section header  -> subcategory
  - PDF file (pdf_N -> "Modulul N")  -> category
  - monospace font (CMTT10)          -> code (block or inline option)
  - normal font (CMR10)              -> prose

Run:  .venv/bin/python scripts/extract.py
"""
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "pdfs"
OUT = ROOT / "data" / "questions.json"

RED = 0xFF0000
MONO = "CMTT10"
CHAR_W = 5.231  # CMTT10 advance width at 10pt; used to rebuild code indentation

# --- diacritics: Computer Modern emits the accent glyph next to the base
# letter, but the order is inconsistent (¸s -> ş, but t¸ -> ţ), so we handle
# both orders for every combination. ---
LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl"}


def normalize(s: str) -> str:
    for k, v in LIGATURES.items():
        s = s.replace(k, v)
    # circumflex U+02C6  (do î via dotless-i BEFORE collapsing ı -> i)
    s = re.sub(r"ˆ\s?ı", "î", s); s = re.sub(r"ıˆ", "î", s)
    s = re.sub(r"ˆ\s?i", "î", s); s = re.sub(r"iˆ", "î", s)
    s = re.sub(r"ˆ\s?a", "â", s); s = re.sub(r"aˆ", "â", s)
    s = re.sub(r"ˆ\s?I", "Î", s); s = re.sub(r"ˆ\s?A", "Â", s)
    # breve U+02D8  -> ă
    s = re.sub(r"˘\s?a", "ă", s); s = re.sub(r"a˘", "ă", s)
    s = re.sub(r"˘\s?A", "Ă", s)
    # cedilla/comma U+00B8 -> ş / ţ
    s = re.sub(r"¸\s?s", "ş", s); s = re.sub(r"s¸", "ş", s)
    s = re.sub(r"¸\s?t", "ţ", s); s = re.sub(r"t¸", "ţ", s)
    s = re.sub(r"¸\s?S", "Ş", s); s = re.sub(r"¸\s?T", "Ţ", s)
    s = s.replace("ı", "i")
    for mark in ("ˆ", "˘", "¸"):
        s = s.replace(mark, "")
    return s


def slug(s: str) -> str:
    s = normalize(s).lower()
    s = (s.replace("ă", "a").replace("â", "a").replace("î", "i")
          .replace("ş", "s").replace("ţ", "t"))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def page_rows(page):
    """Group all spans on the page into rows sharing a baseline, sorted by x.

    PyMuPDF sometimes splits a single visual line (e.g. a section header's
    number and title) into separate `line` objects, so we regroup by y.
    """
    spans = []
    for block in page.get_text("dict")["blocks"]:
        for ln in block.get("lines", []):
            for s in ln["spans"]:
                if s["text"] != "":
                    spans.append(s)
    spans.sort(key=lambda s: (round(s["bbox"][1] / 3), s["bbox"][0]))
    rows = []
    for s in spans:
        y = s["bbox"][1]
        if rows and abs(rows[-1]["y"] - y) < 4:
            rows[-1]["spans"].append(s)
        else:
            rows.append({"y": y, "spans": [s]})
    for r in rows:
        r["spans"].sort(key=lambda s: s["bbox"][0])
    return rows


def line_info(row):
    """Return (text, x0, y0, is_header, all_code, any_red, code_ratio)."""
    spans = row["spans"]
    # rebuild the row text, inserting a space wherever spans are separated by a
    # horizontal gap but no explicit space char (e.g. a header number + title).
    parts = []
    prev = None
    for s in spans:
        if prev is not None:
            gap = s["bbox"][0] - prev["bbox"][2]
            if gap > 1.2 and not parts[-1].endswith(" ") and not s["text"].startswith(" "):
                parts.append(" ")
        parts.append(s["text"])
        prev = s
    text = normalize("".join(parts))
    x0 = min(s["bbox"][0] for s in spans)
    y0 = row["y"]
    nonblank = [s for s in spans if s["text"].strip()]
    is_header = any(s["font"].startswith("CMBX") and s["size"] >= 13 for s in nonblank)
    all_code = bool(nonblank) and all(s["font"] == MONO for s in nonblank)
    any_red = any(s["color"] == RED for s in spans)
    code_chars = sum(len(s["text"]) for s in nonblank if s["font"] == MONO)
    total_chars = sum(len(s["text"]) for s in nonblank) or 1
    return text, x0, y0, is_header, all_code, any_red, code_chars / total_chars


FOOTER_RE = re.compile(r"^(Page\s+)?\d+$")
QUESTION_RE = re.compile(r"^(\d+)\.\s+(.*)$", re.S)
OPTION_RE = re.compile(r"^([A-Z])\.\s*(.*)$", re.S)
HEADER_RE = re.compile(r"^(\d+)\s+(\S.*)$")


def extract_pdf(path: Path, module_num: int):
    doc = fitz.open(path)
    module = f"Modulul {module_num}"
    questions = []
    section_num = None
    section_name = None
    q = None  # current question dict
    mode = None  # "question" | "code" | "options"

    def finalize():
        nonlocal q
        if q is None:
            return
        q["text"] = q["text"].strip()
        # rebuild code with indentation reconstructed from x positions
        code_lines = q.pop("code_lines")
        if code_lines:
            base = min(x for x, _ in code_lines)
            rendered = []
            for x, t in code_lines:
                indent = max(0, round((x - base) / CHAR_W))
                rendered.append(" " * indent + t)
            q["code"] = "\n".join(rendered).rstrip() or None
        else:
            q["code"] = None
        for opt in q["options"]:
            opt["text"] = opt["text"].strip()
        q["correctCount"] = sum(1 for o in q["options"] if o["correct"])
        questions.append(q)
        q = None

    for page in doc:
        for row in page_rows(page):
            text, x0, y0, is_header, all_code, any_red, code_ratio = line_info(row)
            stripped = text.strip()
            if not stripped:
                continue
            # footer / page number near the bottom of the page
            if y0 > 740 and FOOTER_RE.match(stripped):
                continue

            # section header -> subcategory
            if is_header:
                m = HEADER_RE.match(stripped)
                if m:
                    finalize()
                    section_num = int(m.group(1))
                    section_name = m.group(2).strip()
                    continue

            # new question
            mq = QUESTION_RE.match(stripped)
            if mq and x0 < 88 and not all_code and section_name:
                finalize()
                num = int(mq.group(1))
                q = {
                    "id": f"m{module_num}-{slug(section_name)}-{num}",
                    "module": module,
                    "section": section_name,
                    "number": num,
                    "text": mq.group(2),
                    "code": "",
                    "code_lines": [],
                    "options": [],
                    "correctCount": 0,
                }
                mode = "question"
                continue

            if q is None:
                continue

            # new option
            mo = OPTION_RE.match(stripped)
            if mo and x0 > 110:
                q["options"].append({
                    "label": mo.group(1),
                    "text": mo.group(2),
                    "isCode": code_ratio > 0.6,
                    "correct": any_red,
                })
                mode = "options"
                continue

            # code line
            if all_code:
                if mode == "options" and q["options"]:
                    q["options"][-1]["text"] += "\n" + text
                else:
                    q["code_lines"].append((x0, text))
                    mode = "code"
                continue

            # prose continuation
            if mode == "options" and q["options"]:
                q["options"][-1]["text"] += " " + stripped
            else:
                # keep numbered sub-list items (ordering questions) on their own line
                sep = "\n" if re.match(r"^\d+\.\s", stripped) else " "
                q["text"] += sep + stripped

    finalize()
    return questions


def main():
    all_q = []
    for n in (1, 2, 3):
        pdf = PDF_DIR / f"pdf_{n}.pdf"
        qs = extract_pdf(pdf, n)
        all_q.extend(qs)
        print(f"{pdf.name}: {len(qs)} questions")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(all_q, ensure_ascii=False, indent=2), encoding="utf-8")

    # --- summary report ---
    print(f"\nTotal: {len(all_q)} questions -> {OUT}")
    from collections import Counter, defaultdict
    by_mod = defaultdict(lambda: defaultdict(int))
    correct_dist = Counter()
    no_opts = 0
    for q in all_q:
        by_mod[q["module"]][q["section"]] += 1
        correct_dist[q["correctCount"]] += 1
        if not q["options"]:
            no_opts += 1
    print("\nBy module / section:")
    for mod in sorted(by_mod):
        print(f"  {mod}")
        for sec, c in by_mod[mod].items():
            print(f"     {c:4}  {sec}")
    print("\nCorrect-answer count distribution:", dict(sorted(correct_dist.items())))
    print(f"Questions with NO options parsed: {no_opts}")
    dup = [k for k, v in Counter(q["id"] for q in all_q).items() if v > 1]
    print(f"Duplicate ids: {len(dup)}", dup[:5])


if __name__ == "__main__":
    main()
