<div dir="rtl" align="center">

# بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْم

</div>

# أحاديث — Hadith Search

An Arabic-first web app for asking a question about an Islamic matter and reading the **hadiths that answer it** — the Arabic text, its English translation, the narrator, the chapter, and the exact reference in its collection. No generated prose: every result is quoted and attributed, so nothing can be invented.

سؤال عن مسألة إسلامية → الأحاديث التي تعالجها، بنصّها ومرجعها، دون أي كلام مُنشأ.

**Contents:** Sahih al-Bukhari (7,277) · Sahih Muslim (7,368) · Sunan Abi Dawud (5,276) — **19,921 hadiths** across 196 books.

---

## ✨ How it works

- 🔤 **Words** — a BM25 index (`HadithData/index/lex.bin.gz`, 2.8 MB) over the Arabic matn, the chain of narration, the English translation and the chapter title. Arabic is normalised and stems are expanded by particle and pronoun (الصلاة ↔ صلاة, لأخيه ↔ أخ), so a question meets the text however either is written.
- 🧠 **Meaning** — every hadith also has a 384-dimension embedding (`index/vectors.bin.gz`, ~10 MB) from `multilingual-e5-small`. A question is embedded **on the user's device** by transformers.js in a worker (WebGPU, falling back to WASM), so it never leaves the browser and works offline after the one-time model download.
- ⚖️ **Both together** — the two rankings are fused with reciprocal rank fusion, so a hadith that both the words and the meaning like comes first. Each result says *why* it matched.
- 🎯 **Quoted, never written** — the answer card is the hadith itself with its reference chips, grade where the source has one, a copy button and a link to sunnah.com. The app issues no rulings and no opinions.
- � **The model is required, and says its size first** — search is words *and* meaning, so on a device that does not have the model yet the app states the exact download before anything moves (~258 MB with WebGPU, ~141 MB without) and starts only after a yes. Once it is on the device the app switches it on by itself, silently, on every later visit — and no question is ever searched without it.
- 📊 **A bar that counts bytes** — the download reports *loaded of total, whole download*, not whichever file happens to be moving; when the bytes stop the stage changes to building the model, and a long silence says so in words rather than looking stuck.
- 🌙 **Arabic-first** — RTL layout, dark/light themes, responsive, installable PWA, works offline.
- 📚 **Browse four ways** — a tab per collection (its books, then their chapters and hadiths) and one tab listing **every chapter of all three** (7,151 topics, filterable by topic name, book or collection), where a topic opens its book at that chapter.

## 📦 Data Sources & Credits

| Content | Source |
| --- | --- |
| Hadith texts (Arabic + English), book/chapter names, references | [sunnah.com](https://sunnah.com) |
| Narration grades for Sunan Abi Dawud | Al-Albani's grading, as published on sunnah.com |
| Embedding model | [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (Xenova ONNX build) |

### The model download, exactly

| File | Size | When |
| --- | --- | --- |
| `tokenizer.json` | 17.1 MB | always |
| `onnx/model_fp16.onnx` | 235.3 MB | devices with WebGPU (much faster per question) |
| `onnx/model_quantized.onnx` | 118.3 MB | without WebGPU — also the fallback if a WebGPU run fails |
| onnxruntime-web + transformers.js (jsDelivr) | ~6 MB | always, cached by the service worker |

The three model files are stored by transformers.js in the browser cache `transformers-cache`; the app checks exactly those files before it offers anything, which is why a device that already has them never sees the download notice. Sizes live in one place (`search.js`, `MODEL_FILES`) and were read from the host — re-read them if the model or the quantisation changes.

Please respect sunnah.com's terms when reusing this content. Bukhari and Muslim carry no grades in the source; Sunan Abi Dawud does, and the app shows exactly what the source says.

## 🚀 Running locally

```bash
node tools/serve.js          # http://localhost:8123/
node tools/serve.js 3000     # another port
```

The app fetches its data, so it must be served over HTTP — opening `index.html` from disk will not work.

## 🛠 Building the data

Run these from the project root, in order. The app itself has no build step and no dependencies; only `tools/` uses packages.

The model weights are deliberately **not** in this repository (the quantised file alone is 112.8 MB — see `.gitignore`). The first `build-embeddings.mjs` run downloads them from Hugging Face and caches them locally; set `HADITH_MODEL_CACHE=D:\some\dir` to keep that cache outside the project. Nothing large is needed to *use* the app either: the browser fetches the same model on demand and keeps it in its own cache.

| Command | What it does |
| --- | --- |
| `node tools/build-hadith-data.mjs [--clean]` | Parses the scraped pages into `HadithData/` (add `--clean` to delete `data/` once verified) |
| `node tools/test-parse.mjs` | Checks the JSON on its own: totals, record shape, numbering, known hadiths |
| `node tools/build-search-index.mjs` | Builds the BM25 index (`index/lex.bin.gz`, `index/docs.json`) |
| `node tools/build-topics-index.mjs` | Builds `index/topics.json.gz` — every named chapter of the three collections in one list (7,151 topics, 386 KB), so the browse screen never reads 35 MB of book files just to name the chapters |
| `node tools/build-embeddings.mjs [--limit N]` | Embeds every hadith (`index/vectors.bin.gz`) — ~20 minutes, one time |
| `node tools/test-core.mjs` | Checks the Arabic normalisation and highlighting rules |
| `node tools/eval-retrieval.mjs` | **The accuracy gate**: rare-token recall plus real Arabic/English questions, words-only vs words+meaning |

`tools/package.json` exists only for `tools/` (`npm install` inside that folder). The app ships with zero dependencies.

## 📁 Project structure

```
index.html                 # the app shell (styles inline, RTL, theme bootstrap)
index.js                   # ask / answer / browse logic
search.js                  # loads the indexes, owns the worker, returns results
hadith-core.js             # Arabic + English text rules (shared with the tools)
hadith-index.js            # the binary formats: lexical (HIL1) and vectors (HDV1)
hadith-search.js           # the ranking pipeline: words + meaning → one list
embed-worker.js            # transforms.js worker: question → vector, on device
sw.js, pwa.js              # offline cache + install button
manifest.webmanifest
HadithData/
  catalog.json             # collections → books (names in both languages, counts)
  bukhari/1..97.json       # one file per book: chapters + hadiths
  muslim/1..56.json
  abudawud/1..43.json
  index/lex.bin.gz         # BM25 index        (built by build-search-index.mjs)
  index/docs.json          # docId → collection/book/hadith
  index/topics.json.gz     # every named chapter (built by build-topics-index.mjs)
  index/vectors.bin.gz     # embeddings        (built by build-embeddings.mjs)
  index/manifest.json      # formats, counts, model, build date
tools/                     # the build and test scripts
```

## 🆓 Free to Use

This repository is **free to use** — read it, learn from it, copy it, modify it, personal or commercial.

The hadith texts belong to their source ([sunnah.com](https://sunnah.com)) and remain subject to its terms.

> أُسألُكم الدعاء — I ask only for your duaa. 🤲
