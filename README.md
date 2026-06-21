# Grile

Next.js app for studying multiple-choice questions (grile) extracted from the
source PDFs. Three modes: sequential practice, random (filtered by chapter), and
a browse/edit view.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS
- No database — questions live in `data/questions.json`, generated from the PDFs
- Single shared-password gate (env var)
- Deploys on Vercel as-is

## Data

`data/questions.json` is generated from the PDFs in `pdfs/` by `scripts/extract.py`
(PyMuPDF). The script detects:

- **red text** → the correct answer(s)
- **section headers** → subcategory (e.g. _Algoritmi și programare_)
- **module** (PDF) → category (_Modulul 1/2/3_)
- **monospace font** → code blocks

Regenerate after changing the PDFs:

```bash
python3 -m venv .venv
.venv/bin/pip install PyMuPDF
.venv/bin/python scripts/extract.py
```

Each question:

```jsonc
{
  "id": "m1-algoritmi-si-programare-3",
  "module": "Modulul 1",
  "section": "Algoritmi și programare",
  "number": 3,
  "text": "Instrucțiunea k++ este echivalentă cu:",
  "code": null,
  "options": [{ "label": "A", "text": "k = k + 1", "isCode": true, "correct": true }],
  "correctCount": 3
}
```

A question may have **0, 1, or several** correct answers.

## Editing answers

The **Toate grilele** (Browse) page shows every question and lets you toggle which
options are correct. Edits are saved in your browser (localStorage). To make them
permanent: click **Exportă questions.json**, replace `data/questions.json` in the
repo with the downloaded file, commit, and redeploy.

## Local development

```bash
npm install
npm run dev            # http://localhost:3000
```

With no `APP_PASSWORD` set, the app is open (no login) — convenient for local dev.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import it in Vercel (framework auto-detected as Next.js).
3. Add an environment variable **`APP_PASSWORD`** = your chosen password.
4. Deploy. Visiting the URL prompts for the password once (cookie lasts 30 days).

To change the password later, update `APP_PASSWORD` in Vercel and redeploy.
