#!/usr/bin/env node
/* ===========================================================================
 * build-embeddings.mjs — embed every hadith so the app can search by meaning.
 *
 *   input : HadithData/catalog.json + HadithData/<collection>/<book>.json
 *   output: HadithData/index/vectors.bin.gz   (hadith-index.js, HDV1 format)
 *           HadithData/index/manifest.json    (updated with the vector details)
 *
 * The document order is exactly the one the lexical index uses (catalogue
 * order → book → hadith), so a docId means the same thing in both indexes.
 *
 * What is embedded per hadith: the Arabic matn, the English translation and
 * the chapter title in both languages. The chain of narration is left out on
 * purpose — it is boilerplate (the same names repeat across whole books, and
 * a name search belongs to the lexical index), while the meaning of a hadith
 * is in its matn and its translation.
 *
 * This is an offline, one-time build (the model runs here in Node at ~20
 * hadiths/s, so the full corpus takes a while). Pass --limit to smoke-test it.
 *
 * The model weights are not in this repository: the first run downloads them
 * from Hugging Face (~118 MB, printed as it arrives) and caches them. Set
 * HADITH_MODEL_CACHE to keep that cache outside the project.
 *
 * Usage: node tools/build-embeddings.mjs [--limit 500] [--out tools/probe.bin.gz]
 * =========================================================================== */

import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEmbedder } from './lib/embedder.mjs';
import lexicon from '../hadith-index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'HadithData');
const MODEL = process.env.HADITH_MODEL || 'Xenova/multilingual-e5-small';
const DTYPE = process.env.HADITH_DTYPE || 'q8';
const TEXTS_PER_CALL = 512;

function flag(name, fallback) {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : fallback;
}

const LIMIT = Number(flag('limit', 0));
const OUTPUT = flag('out', path.join(DATA, 'index/vectors.bin.gz'));

function passageOf(hadith, chapter) {
    return [
        hadith.ar && hadith.ar.matn,
        hadith.en,
        chapter && chapter.ar,
        chapter && chapter.en
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

async function collectPassages() {
    const catalog = JSON.parse(await readFile(path.join(DATA, 'catalog.json'), 'utf8'));
    const passages = [];
    for (const collection of catalog.collections) {
        for (const book of collection.books) {
            const page = JSON.parse(await readFile(path.join(DATA, book.file), 'utf8'));
            for (const hadith of page.hadiths) {
                const chapter = hadith.ch >= 0 ? page.chapters[hadith.ch] : null;
                passages.push(passageOf(hadith, chapter));
            }
        }
    }
    return passages;
}

async function main() {
    const started = Date.now();
    const passages = await collectPassages();
    const total = LIMIT ? Math.min(LIMIT, passages.length) : passages.length;

    const manifestPath = path.join(DATA, 'index/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!LIMIT && total !== manifest.docCount) {
        throw new Error(`collected ${total} passages but the lexical index has `
            + `${manifest.docCount} documents — both indexes must agree`);
    }

    console.log(`embedding ${total} hadiths with ${MODEL} (${DTYPE}) …`);
    const embedder = await loadEmbedder({ model: MODEL, dtype: DTYPE });
    console.log(`model ready: ${embedder.dims} dims, ${embedder.window}-token window\n`);

    const docIds = [];
    const vectors = [];
    let done = 0;
    let lastReport = Date.now();
    for (let start = 0; start < total; start += TEXTS_PER_CALL) {
        const slice = passages.slice(start, start + TEXTS_PER_CALL);
        const embedded = await embedder.embed(slice, 'passage');
        embedded.forEach((list, index) => {
            for (const vector of list) {
                docIds.push(start + index);
                vectors.push(vector);
            }
        });
        done += slice.length;
        /* Report on the clock, not on a stride: the call size changes how often
           a stride would fire, and a silent build looks like a hung one. */
        const now = Date.now();
        if (now - lastReport > 5000 || done >= total) {
            lastReport = now;
            const rate = done / ((now - started) / 1000);
            const left = (total - done) / rate;
            console.log(`  ${done}/${total}  ${rate.toFixed(1)} texts/s  `
                + `${left > 90 ? `${Math.round(left / 60)} min` : `${Math.round(left)} s`} left`);
        }
    }

    /* If pooling or normalisation silently did not happen, the vectors would
       still "work" but rank nonsense — so check before writing anything. */
    let norm = 0;
    for (const value of vectors[0]) norm += value * value;
    norm = Math.sqrt(norm);
    console.log(`\nfirst vector: ${vectors[0].length} dims, norm ${norm.toFixed(4)}`);
    if (vectors[0].length !== embedder.dims) throw new Error('unexpected vector size');
    if (Math.abs(norm - 1) > 0.01) throw new Error('vectors are not unit length — check pooling');

    const bytes = lexicon.encodeVectors({
        docCount: LIMIT ? Math.max(...docIds) + 1 : passages.length,
        dims: embedder.dims,
        docIds,
        vectors
    });
    const compressed = gzipSync(bytes, { level: 9 });
    await writeFile(OUTPUT, compressed);
    console.log(`wrote ${path.relative(ROOT, OUTPUT)} — ${(compressed.length / 1048576).toFixed(1)} MB `
        + `(${vectors.length} vectors for ${total} hadiths, raw ${(bytes.length / 1048576).toFixed(1)} MB)`);

    if (!LIMIT) {
        manifest.vectors = {
            file: 'index/vectors.bin.gz',
            model: MODEL,
            dtype: DTYPE,
            dims: embedder.dims,
            vectorCount: vectors.length,
            maxTokens: embedder.window
        };
        await writeFile(manifestPath, JSON.stringify(manifest, null, 1));
        console.log('manifest.json updated');
    }
    console.log(`built in ${((Date.now() - started) / 60000).toFixed(1)} min`);
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
