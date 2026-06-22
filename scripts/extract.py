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


# Superscript / subscript Unicode maps (for exponents like n^2 and indices k_1).
SUP_MAP = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶",
    "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽",
    ")": "⁾", "n": "ⁿ", "i": "ⁱ", "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ",
    "e": "ᵉ", "f": "ᶠ", "g": "ᵍ", "h": "ʰ", "j": "ʲ", "k": "ᵏ", "l": "ˡ",
    "m": "ᵐ", "o": "ᵒ", "p": "ᵖ", "r": "ʳ", "s": "ˢ", "t": "ᵗ", "u": "ᵘ",
    "v": "ᵛ", "w": "ʷ", "x": "ˣ", "y": "ʸ", "z": "ᶻ", " ": " ",
}
SUB_MAP = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆",
    "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍",
    ")": "₎", "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ", "k": "ₖ",
    "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ", "p": "ₚ", "r": "ᵣ", "s": "ₛ",
    "t": "ₜ", "u": "ᵤ", "v": "ᵥ", "x": "ₓ", " ": " ",
}


def to_script(text: str, sup: bool) -> str:
    """Render a super/subscript run as Unicode, falling back to ^()/plain."""
    table = SUP_MAP if sup else SUB_MAP
    if all(c in table for c in text):
        return "".join(table[c] for c in text)
    if sup:  # caret notation for exponents we can't map (e.g. n^(k+1))
        return "^" + (text if len(text) == 1 else "(" + text + ")")
    return text  # leave odd subscripts (arrows, ∞) inline


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
    if not spans:
        return []

    # Cluster lines by the baseline of body-size text, then attach smaller
    # super/subscript spans to the nearest baseline. Grouping by the span top
    # fails in dense math, where a line's subscripts and the next line's
    # superscripts interleave vertically.
    body = [s for s in spans if s["text"].strip() and round(s["size"]) >= 9]
    body.sort(key=lambda s: s["bbox"][3])
    lines = []
    for s in body:
        b = s["bbox"][3]
        for ln in lines:
            if abs(ln["bot"] - b) < 5:
                ln["spans"].append(s)
                ln["bot"] = (ln["bot"] * (len(ln["spans"]) - 1) + b) / len(ln["spans"])
                break
        else:
            lines.append({"bot": b, "spans": [s]})

    for s in spans:  # attach small / blank spans to the nearest baseline
        if s["text"].strip() and round(s["size"]) >= 9:
            continue
        b = s["bbox"][3]
        if lines:
            min(lines, key=lambda ln: abs(ln["bot"] - b))["spans"].append(s)
        else:
            lines.append({"bot": b, "spans": [s]})

    lines.sort(key=lambda ln: ln["bot"])
    return [
        {"y": min(s["bbox"][1] for s in ln["spans"]),
         "spans": sorted(ln["spans"], key=lambda s: s["bbox"][0])}
        for ln in lines
    ]


def line_info(row):
    """Return (text, x0, y0, is_header, all_code, any_red, code_ratio)."""
    spans = row["spans"]
    # determine the dominant (body) font size and its baseline, so we can spot
    # smaller raised/lowered spans as super/subscripts.
    sized = [s for s in spans if s["text"].strip()]
    body_size = 10.0
    body_bot = 0.0
    if sized:
        szs = [round(s["size"], 1) for s in sized]
        body_size = max(set(szs), key=szs.count)
        bots = sorted(s["bbox"][3] for s in sized if round(s["size"], 1) == body_size)
        body_bot = bots[len(bots) // 2] if bots else 0.0

    def script_class(s):
        if not s["text"].strip() or s["size"] > body_size - 1.5:
            return None
        return "sup" if s["bbox"][3] < body_bot - 1.5 else "sub"  # raised vs lowered

    # rebuild the row text, inserting a space wherever spans are separated by a
    # horizontal gap but no explicit space char (e.g. a header number + title).
    parts = []
    prev = None
    i = 0
    while i < len(spans):
        s = spans[i]
        # drop tiny whitespace artifacts (kerning space around a superscript);
        # real spacing is handled by the x-gap check below.
        if not s["text"].strip() and s["size"] <= body_size - 1.5:
            i += 1
            continue
        cls = script_class(s)
        if cls is None:
            if prev is not None:
                gap = s["bbox"][0] - prev["bbox"][2]
                if gap > 1.2 and parts and not parts[-1].endswith(" ") and not s["text"].startswith(" "):
                    parts.append(" ")
            parts.append(s["text"])
            prev = s
            i += 1
            continue
        # a super/subscript attaches to its base, so no leading space here.
        # gather a run of consecutive same-class super/subscript spans
        j = i
        run = ""
        while j < len(spans) and script_class(spans[j]) == cls:
            run += spans[j]["text"]
            j += 1
        # short run -> a real exponent/index; long run -> a stacked fraction
        # part (f(n)/g(n)), which we keep as plain text rather than mangle.
        parts.append(to_script(normalize(run), cls == "sup") if len(run.strip()) <= 2 else run)
        prev = spans[j - 1]
        i = j
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
LIST_RE = re.compile(r"^\d+\.\s")
SOLUTION_RE = re.compile(r"^Solution\b[:.]?\s*(.*)$", re.I | re.S)
# Code is sometimes typeset in a normal/roman font (OOP class listings, HTML),
# so the monospace-font test isn't enough. These strong markers flag a line as
# code regardless of font; once inside a code block, indented/`;`-bearing lines
# keep it going until a clear prose line appears.
STRONG_CODE = re.compile(
    r"[{}]|::|<<|>>|#include|\bcout\b|\bcin\b|\bprintf\b|\bscanf\b|\bvoid\b|"
    r"\bclass\b|\bstruct\b|\b(?:public|private|protected)\s*:|</?[A-Za-z][\w.]*[\s>/=]"
)
WEAK_CODE = re.compile(r"[;()]")
PUBLIC_FIG = ROOT / "public" / "figures"


def extract_pdf(path: Path, module_num: int):
    doc = fitz.open(path)
    module = f"Modulul {module_num}"
    questions = []
    section_name = None
    q = None  # current question dict
    mode = None  # "q" | "options"
    in_code = False
    in_solution = False

    def add_text(line):
        c = q["content"]
        if c and c[-1]["type"] == "text":
            sep = "\n" if LIST_RE.match(line) else " "
            c[-1]["value"] = (c[-1]["value"] + sep + line) if c[-1]["value"] else line
        else:
            c.append({"type": "text", "value": line})

    def add_code(x, line):
        c = q["content"]
        if c and c[-1]["type"] == "code":
            c[-1]["_lines"].append((x, line))
        else:
            c.append({"type": "code", "value": "", "_lines": [(x, line)]})

    def add_math(pg, spans):
        # grow the bounding box of a centred display-math region (rasterised later)
        x0 = min(s["bbox"][0] for s in spans); y0 = min(s["bbox"][1] for s in spans)
        x1 = max(s["bbox"][2] for s in spans); y1 = max(s["bbox"][3] for s in spans)
        m = q.get("_math")
        if not m or m["pg"] != pg:
            q["_math"] = {"pg": pg, "x0": x0, "y0": y0, "x1": x1, "y1": y1}
        else:
            m["x0"] = min(m["x0"], x0); m["y0"] = min(m["y0"], y0)
            m["x1"] = max(m["x1"], x1); m["y1"] = max(m["y1"], y1)

    def finalize():
        nonlocal q
        if q is None:
            return
        for blk in q["content"]:
            if blk["type"] == "code":  # reconstruct indentation from x positions
                lines = blk.pop("_lines")
                base = min(x for x, _ in lines)
                blk["value"] = "\n".join(
                    " " * max(0, round((x - base) / CHAR_W)) + t for x, t in lines
                ).rstrip()
        q["content"] = [b for b in q["content"] if b["type"] == "image" or b["value"].strip()]
        q["text"] = " ".join(b["value"] for b in q["content"] if b["type"] == "text").strip()
        for opt in q["options"]:
            opt["text"] = opt["text"].strip()
        if q.get("explanation"):
            q["explanation"] = q["explanation"].strip()
        q["correctCount"] = sum(1 for o in q["options"] if o["correct"])
        questions.append(q)
        q = None

    for page_idx, page in enumerate(doc):
        for row in page_rows(page):
            text, x0, y0, is_header, all_code, any_red, code_ratio = line_info(row)
            stripped = text.strip()
            if not stripped:
                continue
            if y0 > 740 and FOOTER_RE.match(stripped):
                continue
            # figure captions ("Figure 1: ...") are redundant with the image
            if re.match(r"^Figure\s+\d+", stripped):
                continue

            if is_header:
                m = HEADER_RE.match(stripped)
                if m:
                    finalize()
                    section_name = m.group(2).strip()
                    continue

            mq = QUESTION_RE.match(stripped)
            if mq and x0 < 88 and not all_code and section_name:
                finalize()
                num = int(mq.group(1))
                q = {
                    "id": f"m{module_num}-{slug(section_name)}-{num}",
                    "module": module, "section": section_name, "number": num,
                    "content": [], "text": "", "options": [], "correctCount": 0,
                    "_pg": page_idx, "_y": y0,
                }
                intro = mq.group(2).strip()
                if intro:
                    q["content"].append({"type": "text", "value": intro})
                mode = "q"
                in_code = False
                in_solution = False
                continue

            if q is None:
                continue

            mo = OPTION_RE.match(stripped)
            if mo and x0 > 110:
                if "_optpg" not in q:
                    q["_optpg"], q["_opty"] = page_idx, y0
                q["options"].append({
                    "label": mo.group(1), "text": mo.group(2),
                    "isCode": code_ratio > 0.6, "correct": any_red,
                })
                mode = "options"
                continue

            if mode == "options":
                ms = SOLUTION_RE.match(stripped)
                if ms or in_solution:  # an explanation block after the options
                    in_solution = True
                    add = ms.group(1) if ms else stripped
                    q["explanation"] = (q.get("explanation", "") + " " + add).strip()
                elif all_code and q["options"]:
                    q["options"][-1]["text"] += "\n" + text
                elif q["options"]:
                    q["options"][-1]["text"] += " " + stripped
                continue

            # centred display math (recurrence/piecewise formulas) is 2-D and
            # doesn't linearise; capture its region to rasterise as an image.
            row_x0 = min(s["bbox"][0] for s in row["spans"])
            if row_x0 > 200:
                add_math(page_idx, row["spans"])
                in_code = False
                continue
            # a formula brace sometimes shares a line with prose ("...forma {").
            # Require a large gap before it so we don't grab braces in code.
            rs = row["spans"]
            braces = [s for i, s in enumerate(rs)
                      if s["text"].strip() in ("{", "}") and s["bbox"][0] > 200
                      and s["bbox"][0] - (rs[i - 1]["bbox"][2] if i else 0) > 40]
            if braces:
                add_math(page_idx, braces)
                stripped = re.sub(r"\s*[{}]\s*$", "", stripped).strip()
                if not stripped:
                    continue

            # question/code region: classify line as code vs prose
            strong = all_code or bool(STRONG_CODE.search(stripped))
            # a wordy line or one ending in ":" is a prose lead-in, not code
            prose_like = stripped.endswith(":") or len(re.findall(r"[^\W\d_]{3,}", stripped)) >= 4
            if strong:
                in_code = True
                add_code(x0, text)
            elif in_code and not prose_like and (x0 >= 96 or WEAK_CODE.search(stripped)):
                add_code(x0, text)  # continuation of the current code block
            else:
                in_code = False
                add_text(stripped)

    finalize()
    extract_figures(doc, questions)
    doc.close()
    return questions


def extract_figures(doc, questions):
    """Render diagrams (raster trees + vector graphs) per question to PNGs.

    A figure sits between the question text and the first option, so we scan
    that region for raster images / vector drawings, union their bounding
    boxes, and rasterise that clip to public/figures/<id>-N.png.
    """
    PUBLIC_FIG.mkdir(parents=True, exist_ok=True)
    cache = {}

    def graphics(pg):
        if pg not in cache:
            page = doc[pg]
            imgs = [info["bbox"] for info in page.get_image_info()]
            draws = [d["rect"] for d in page.get_drawings()
                     if (d["rect"][2] - d["rect"][0]) > 2 and (d["rect"][3] - d["rect"][1]) > 2]
            cache[pg] = (imgs, draws)
        return cache[pg]

    for i, q in enumerate(questions):
        spg, sy = q["_pg"], q["_y"]
        if "_optpg" in q:
            epg, ey = q["_optpg"], q["_opty"]
        elif i + 1 < len(questions) and questions[i + 1]["_pg"] >= spg:
            epg, ey = questions[i + 1]["_pg"], questions[i + 1]["_y"]
        else:
            epg, ey = spg, doc[spg].rect.height

        paths = []
        for pg in range(spg, min(epg, len(doc) - 1) + 1):
            page = doc[pg]
            y_lo = sy if pg == spg else 0
            y_hi = ey if pg == epg else page.rect.height
            imgs, draws = graphics(pg)
            rects = [b for b in imgs if b[1] >= y_lo - 2 and b[3] <= y_hi + 2]
            has_raster = bool(rects)
            dr = [b for b in draws if b[1] >= y_lo - 2 and b[3] <= y_hi + 2]
            rects += dr
            if not rects:
                continue
            x0 = min(r[0] for r in rects); yy0 = min(r[1] for r in rects)
            x1 = max(r[2] for r in rects); yy1 = max(r[3] for r in rects)
            w, h = x1 - x0, yy1 - yy0
            # require a real figure: a raster image, or a sizeable cluster of strokes
            if not has_raster and (len(dr) < 5 or w < 30 or h < 30):
                continue
            if w < 12 or h < 12:
                continue
            clip = fitz.Rect(x0 - 6, yy0 - 6, x1 + 6, yy1 + 6)
            pix = page.get_pixmap(clip=clip, matrix=fitz.Matrix(2.5, 2.5))
            fname = f"{q['id']}-{len(paths) + 1}.png"
            pix.save(str(PUBLIC_FIG / fname))
            paths.append(f"/figures/{fname}")

        for p in paths:
            q["content"].append({"type": "image", "value": p})

        # rasterise a centred display-math region (recurrence/piecewise formula)
        m = q.get("_math")
        if m:
            # tight top padding so the question-text line just above isn't clipped in
            clip = fitz.Rect(m["x0"] - 8, m["y0"] - 1, m["x1"] + 8, m["y1"] + 4)
            pix = doc[m["pg"]].get_pixmap(clip=clip, matrix=fitz.Matrix(3, 3))
            fname = f"{q['id']}-math.png"
            pix.save(str(PUBLIC_FIG / fname))
            q["content"].append({"type": "image", "value": f"/figures/{fname}"})

    for q in questions:  # drop temp position keys
        for k in ("_pg", "_y", "_optpg", "_opty", "_math"):
            q.pop(k, None)


def main():
    # clear stale figures so removed/renamed ones don't linger
    if PUBLIC_FIG.exists():
        for f in PUBLIC_FIG.glob("*.png"):
            f.unlink()

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
    n_img = sum(1 for q in all_q for b in q["content"] if b["type"] == "image")
    q_img = sum(1 for q in all_q if any(b["type"] == "image" for b in q["content"]))
    q_code = sum(1 for q in all_q if any(b["type"] == "code" for b in q["content"]))
    q_expl = sum(1 for q in all_q if q.get("explanation"))
    print(f"Figures: {n_img} images across {q_img} questions | "
          f"questions with code: {q_code} | explanations: {q_expl}")


if __name__ == "__main__":
    main()
