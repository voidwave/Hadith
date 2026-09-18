#!/usr/bin/env node
/* ===========================================================================
 * eval-retrieval.mjs — does the index actually find the right hadith?
 *
 * Two independent measures, both reproducible:
 *
 *  1. rare-token recall — take real hadiths at random, build a query from a few
 *     of their rarest words, and check the hadith comes back. This proves the
 *     postings decode correctly and that length normalisation is not punishing
 *     long hadiths too much.
 *
 *  2. real questions — natural Arabic and English questions a person would
 *     type, each with a phrase the answer must contain somewhere in the top 10.
 *     Markers are checked against the corpus, so a marker that nothing matches
 *     is reported instead of quietly counting as a miss.
 *
 * Run it after every change to hadith-core.js or the index: it is the thing
 * that says whether the app can answer a question at all.
 *
 * Usage: node tools/eval-retrieval.mjs [--samples 150] [--show 3]
 * =========================================================================== */

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import core from '../hadith-core.js';
import lexicon from '../hadith-index.js';
import search from '../hadith-search.js';
import { loadEmbedder } from './lib/embedder.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'HadithData');

function flag(name, fallback) {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? Number(process.argv[at + 1]) : fallback;
}

const SAMPLES = flag('samples', 150);
const SHOW = flag('show', 3);
const SEED = 20260918;

/* Questions with the phrases an answer may contain. A question only counts
   when one of its markers is really in the corpus — see `markerInCorpus`. */
const QUESTIONS = [
    { q: 'حديث عن النية في الأعمال', expect: ['إنما الأعمال بالنيات', 'إنما الأعمال بالنية'] },
    { q: 'ما هو الركن الأول من أركان الإسلام؟', expect: ['بني الإسلام على خمس'] },
    { q: 'أي العمل أحب إلى الله؟', expect: ['الصلاة على وقتها'] },
    { q: 'هل يجوز الوضوء بماء البحر؟', expect: ['الطهور ماؤه', 'ماؤه الحل ميتته'] },
    { q: 'ما يقال عند الغضب؟', expect: ['لا تغضب'] },
    { q: 'من غش الناس فليس منا', expect: ['من غشنا فليس منا'] },
    { q: 'حب الخير للأخ كما تحبه لنفسك', expect: ['يحب لأخيه ما يحب لنفسه'] },
    { q: 'الله يحب الرفق في كل الأمر', expect: ['يحب الرفق'] },
    { q: 'الصدق يهدي إلى البر', expect: ['عليكم بالصدق'] },
    { q: 'المسلم من سلم المسلمون من لسانه ويده', expect: ['سلم المسلمون من لسانه ويده'] },
    { q: 'النبي نهى عن الغلو في الدين', expect: ['لا تغلوا'] },
    { q: 'ما حكم من أحدث في الدين؟', expect: ['فرد', 'من أحدث في أمرنا'] },
    { q: 'what did the Prophet say about intentions?', expect: ['depends upon the intentions', 'reward of deeds'] },
    { q: 'he who cheats is not one of us', expect: ['who cheats', 'deceives'] },
    { q: 'who is the strong one when angry?', expect: ['controls himself', 'strong man'] },
    { q: 'is sea water pure for ablution?', expect: ['sea water', 'its water is pure'] }
];

/* ---------------------------------------------------------------- load --- */

const index = lexicon.decode(gunzipSync(await readFile(path.join(DATA, 'index/lex.bin.gz'))));
const docs = JSON.parse(await readFile(path.join(DATA, 'index/docs.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(DATA, 'catalog.json'), 'utf8'));

/* The vector index and the query model are optional: without them the harness
   still measures the lexical half, which is the app's no-model mode. */
let vectors = null;
let embed = null;
try {
    const manifest = JSON.parse(await readFile(path.join(DATA, 'index/manifest.json'), 'utf8'));
    if (manifest.vectors) {
        vectors = lexicon.decodeVectors(gunzipSync(await readFile(
            path.join(DATA, manifest.vectors.file))));
        const embedder = await loadEmbedder({
            model: manifest.vectors.model,
            dtype: manifest.vectors.dtype
        });
        embed = async question => (await embedder.embed([question], 'query'))[0][0];
        console.log(`vector index: ${vectors.vectorCount} vectors, ${vectors.dims} dims, `
            + `${manifest.vectors.model}`);
    }
} catch (error) {
    console.log(`note: no vector index — ${error.message}`);
}

const engine = search.create({ core, lexicon, index, vectors, embed });

const pages = new Map();
async function pageOf(collection, bookNumber) {
    const key = `${collection}/${bookNumber}`;
    if (!pages.has(key)) {
        pages.set(key, JSON.parse(await readFile(
            path.join(DATA, collection, `${bookNumber}.json`), 'utf8')));
    }
    return pages.get(key);
}

function pointerOf(docId) {
    const base = docId * 3;
    return {
        collection: docs.collections[docs.docs[base]],
        bookNumber: docs.docs[base + 1],
        hadithIndex: docs.docs[base + 2]
    };
}

async function hadithOf(docId) {
    const pointer = pointerOf(docId);
    const page = await pageOf(pointer.collection, pointer.bookNumber);
    return page.hadiths[pointer.hadithIndex];
}

/* Markers are compared word by word, in any order: these collections repeat a
   sentence with an interpolation in the middle (… لأخيه — أو قال لجاره — ما
   يحب لنفسه), so requiring a contiguous phrase would fail on a correct answer. */
function words(text) {
    return new Set(core.splitWords(text)
        .map(word => core.normalizeWord(word))
        .filter(word => word.length >= 3));
}

function answersWith(hadith, markers) {
    const present = words(textOf(hadith));
    return markers.some(marker => {
        const wanted = words(marker);
        if (!wanted.size) return false;
        for (const word of wanted) if (!present.has(word)) return false;
        return true;
    });
}

function snippet(hadith, limit) {
    const text = [hadith.ar && hadith.ar.matn, hadith.en].filter(Boolean).join(' | ');
    return text.replace(/\s+/g, ' ').slice(0, limit || 90);
}

function textOf(hadith) {
    return [hadith.ar && hadith.ar.matn, hadith.ar && hadith.ar.sanad, hadith.en]
        .filter(Boolean).join(' ');
}

/* Can the corpus answer this question at all? If not, the question is wrong
   and the miss must not be charged to the search. */
/* One flat, normalised copy of the whole corpus, built once: asking "is this
   phrase in the corpus at all?" must not depend on how a search ranks it. */
let flatCorpus = null;
async function corpusText() {
    if (flatCorpus) return flatCorpus;
    const parts = [];
    for (const collection of catalog.collections) {
        for (const book of collection.books) {
            const page = await pageOf(collection.id, book.number);
            for (const hadith of page.hadiths) parts.push([...words(textOf(hadith))].join(' '));
        }
    }
    flatCorpus = parts.join('\n');
    return flatCorpus;
}

async function markerInCorpus(markers) {
    const corpus = await corpusText();
    for (const marker of markers) {
        const wanted = [...words(marker)];
        if (!wanted.length) continue;
        /* contiguous first… */
        if (corpus.includes(wanted.join(' '))) return true;
        /* …then "every word is somewhere", for markers the source splits up
           with an interpolation (a note like "— أو قال لجاره —" in between). */
        if (wanted.every(word => corpus.includes(word))) {
            console.log(`  note: marker «${marker}» is in the corpus but not as one phrase`);
            return true;
        }
    }
    return false;
}

async function run(query, limit, semantic) {
    const started = process.hrtime.bigint();
    const outcome = await engine.search(query, {
        limit: limit || 20,
        semantic: semantic !== false
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    return { results: outcome.results, ms, confidence: outcome.confidence };
}

/* ------------------------------------------------------------ markers ---- */

/* Every question must be answerable: if a marker word is not even in the
   vocabulary, the question is wrong, not the search. */
function checkMarkers() {
    const broken = [];
    for (const question of QUESTIONS) {
        for (const marker of question.expect) {
            for (const word of core.uniqueTerms(marker)) {
                if (!index.terms.has(word)) broken.push(`${marker} → ${word}`);
            }
        }
    }
    if (broken.length) {
        console.log(`note: ${broken.length} marker word(s) not in the index: `
            + `${[...new Set(broken)].slice(0, 8).join(', ')}`);
    }
}

/* -------------------------------------------------------- rare tokens ---- */

function mulberry32(seed) {
    let state = seed >>> 0;
    return function () {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

async function rareTokenEval(samples) {
    const random = mulberry32(SEED);
    let asked = 0;
    let at1 = 0;
    let at5 = 0;
    let at10 = 0;
    let reciprocal = 0;
    let milliseconds = 0;
    const misses = [];

    for (let attempt = 0; attempt < samples * 3 && asked < samples; attempt += 1) {
        const docId = Math.floor(random() * index.docCount);
        const hadith = await hadithOf(docId);
        const text = [hadith.ar && hadith.ar.matn, hadith.en].filter(Boolean).join(' ');

        /* Rarest words of this hadith that the index still knows. */
        const scored = [];
        for (const term of new Set(core.terms(text))) {
            const entry = index.terms.get(term);
            if (entry && term.length >= 4 && entry.df >= 2 && entry.df <= 20) {
                scored.push({ term, df: entry.df });
            }
        }
        if (scored.length < 3) continue;
        scored.sort((a, b) => a.df - b.df);
        const query = scored.slice(0, 3).map(item => item.term).join(' ');

        const { results, ms } = await run(query, 10, false);
        milliseconds += ms;
        const rank = results.findIndex(result => result.docId === docId) + 1;
        asked += 1;
        if (rank === 1) at1 += 1;
        if (rank > 0 && rank <= 5) at5 += 1;
        if (rank > 0 && rank <= 10) { at10 += 1; reciprocal += 1 / rank; }
        else if (misses.length < 6) misses.push({ query, ref: hadith.ref, rank });
    }

    console.log(`\n== rare-token recall (${asked} hadiths) ==`);
    console.log(`  hit@1 ${(at1 / asked).toFixed(2)}   hit@5 ${(at5 / asked).toFixed(2)}   `
        + `hit@10 ${(at10 / asked).toFixed(2)}   MRR ${(reciprocal / asked).toFixed(2)}   `
        + `${(milliseconds / asked).toFixed(1)} ms/query`);
    for (const miss of misses) {
        console.log(`  miss rank ${miss.rank || '>10'} ${miss.ref}  «${miss.query}»`);
    }
    return { asked, at10, milliseconds };
}

/* ----------------------------------------------------------- questions --- */

async function questionEval() {
    const unanswerable = [];
    for (const question of QUESTIONS) {
        if (!(await markerInCorpus(question.expect))) unanswerable.push(question);
    }
    const answerable = QUESTIONS.filter(question => !unanswerable.includes(question));
    console.log(`\n== questions (${QUESTIONS.length}, ${answerable.length} answerable) ==`);

    const modes = [
        { label: 'words only   ', semantic: false },
        { label: 'words+meaning', semantic: true }
    ];
    for (const mode of modes) {
        if (mode.semantic && !vectors) {
            console.log('  words+meaning: skipped, no vector index');
            continue;
        }
        let passed = 0;
        let rank1 = 0;
        let milliseconds = 0;
        const failures = [];
        for (const question of answerable) {
            const { results, ms } = await run(question.q, 10, mode.semantic);
            milliseconds += ms;
            let rank = 0;
            for (let i = 0; i < results.length && !rank; i += 1) {
                if (answersWith(await hadithOf(results[i].docId), question.expect)) rank = i + 1;
            }
            if (rank === 1) rank1 += 1;
            if (rank) { passed += 1; continue; }

            const top = [];
            for (const result of results.slice(0, SHOW)) {
                const hadith = await hadithOf(result.docId);
                top.push(`${hadith.slug} «${snippet(hadith, 60)}»`);
            }
            failures.push(`  miss «${question.q}»\n    wanted: ${question.expect.join(' / ')}`
                + `\n    got: ${top.join('\n         ')}`);
        }
        console.log(`  ${mode.label}: top 10 ${passed}/${answerable.length}   `
            + `top 1 ${rank1}/${answerable.length}   `
            + `${(milliseconds / Math.max(1, answerable.length)).toFixed(1)} ms/query`);
        for (const failure of failures) console.log(failure);
    }

    for (const question of unanswerable) {
        console.log(`  unanswerable «${question.q}» — none of its markers is in the corpus: `
            + question.expect.join(' / '));
    }
    return { total: answerable.length };
}

checkMarkers();
const rare = await rareTokenEval(SAMPLES);
const questions = await questionEval();

console.log(`\nindex: ${index.docCount} documents, ${index.termCount} terms`);
if (vectors) {
    console.log(`vectors: ${vectors.vectorCount} vectors over ${vectors.docCount} documents`);
}
