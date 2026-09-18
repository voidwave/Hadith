#!/usr/bin/env node
/* ===========================================================================
 * build-search-index.mjs — build the lexical index the app searches with.
 *
 *   input : HadithData/catalog.json + HadithData/<collection>/<book>.json
 *   output: HadithData/index/lex.bin.gz   the inverted index (hadith-index.js)
 *           HadithData/index/docs.json    docId → collection/book/hadith
 *           HadithData/index/manifest.json counts, format and build settings
 *
 * What goes into a document: the Arabic matn and its chain, the English
 * translation, the narrator line, and the chapter title in both languages —
 * the chain is usually the same for hundreds of hadiths in a row, but it does
 * carry the names people search for, and the chapter title is the closest
 * thing the corpus has to a topic label.
 *
 * Terms are expanded by HadithCore (definite article, و/ف prefixes, plurals),
 * so the index holds the same variant spellings a query produces. Terms that
 * appear in more than DF_CUTOFF of all documents are dropped: they are the
 * function words (في، من، the, and) that carry no meaning for ranking.
 *
 * Usage: node tools/build-search-index.mjs
 * =========================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import core from '../hadith-core.js';
import lexicon from '../hadith-index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'HadithData');
const OUTPUT = path.join(DATA, 'index');

/* A term in more than this share of documents is a function word. */
const DF_CUTOFF = 0.2;

/* Field order of the document text; kept in one place so it is obvious what
   the index can and cannot find. */
function documentText(hadith, book, chapter) {
    return [
        hadith.ar && hadith.ar.matn,
        hadith.ar && hadith.ar.sanad,
        hadith.en,
        hadith.narrator,
        chapter && chapter.ar,
        chapter && chapter.en
    ].filter(Boolean).join('\n');
}

async function main() {
    const started = Date.now();
    const catalog = JSON.parse(await readFile(path.join(DATA, 'catalog.json'), 'utf8'));

    const pointers = [];        // docId → [collectionIndex, bookNumber, hadithIndex]
    const docLengths = [];
    const vocabulary = new Map();   // term → { df, docIds: [], tfs: [] }
    let tokenCount = 0;

    for (let collectionIndex = 0; collectionIndex < catalog.collections.length;
        collectionIndex += 1) {
        const collection = catalog.collections[collectionIndex];
        for (const book of collection.books) {
            const page = JSON.parse(await readFile(path.join(DATA, book.file), 'utf8'));
            for (let hadithIndex = 0; hadithIndex < page.hadiths.length; hadithIndex += 1) {
                const hadith = page.hadiths[hadithIndex];
                const chapter = hadith.ch >= 0 ? page.chapters[hadith.ch] : null;
                const text = documentText(hadith, page.book, chapter);

                /* Count the terms of this one document. Stopwords are skipped
                   as well: a query never carries them (queryTerms drops them),
                   so indexing them would only inflate the lengths BM25 divides
                   by. */
                const counts = new Map();
                for (const term of core.terms(text)) {
                    if (core.isStopword(term)) continue;
                    counts.set(term, (counts.get(term) || 0) + 1);
                }

                const docId = docLengths.length;
                let length = 0;
                for (const [term, count] of counts) {
                    let entry = vocabulary.get(term);
                    if (!entry) {
                        entry = { df: 0, docIds: [], tfs: [] };
                        vocabulary.set(term, entry);
                    }
                    entry.df += 1;
                    entry.docIds.push(docId);
                    entry.tfs.push(count);
                    length += count;
                }
                docLengths.push(length);
                tokenCount += length;
                pointers.push(collectionIndex, book.number, hadithIndex);
            }
        }
        process.stdout.write(`indexed ${collection.id}\n`);
    }

    /* Drop the function words, then write the survivors in term order. */
    const limit = Math.floor(docLengths.length * DF_CUTOFF);
    const terms = [];
    let dropped = 0;
    let postings = 0;
    for (const [term, entry] of vocabulary) {
        if (entry.df > limit) {
            dropped += 1;
            continue;
        }
        terms.push({ term, df: entry.df, docIds: entry.docIds, tfs: entry.tfs });
        postings += entry.df;
    }
    terms.sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
    vocabulary.clear();

    const bytes = lexicon.encode({
        docLengths,
        avgDocLength: tokenCount / (docLengths.length || 1),
        terms
    });
    const compressed = gzipSync(bytes, { level: 9 });

    await mkdir(OUTPUT, { recursive: true });
    await writeFile(path.join(OUTPUT, 'lex.bin.gz'), compressed);
    await writeFile(path.join(OUTPUT, 'docs.json'), JSON.stringify({
        collections: catalog.collections.map(collection => collection.id),
        docs: pointers
    }));

    /* Merge instead of overwrite: the embedding build writes its own section
       into this file, and rebuilding the words index must not erase it. */
    let manifest = {};
    try {
        manifest = JSON.parse(await readFile(path.join(OUTPUT, 'manifest.json'), 'utf8'));
    } catch (error) { /* first build */ }
    Object.assign(manifest, {
        format: lexicon.MAGIC,
        version: lexicon.VERSION,
        built: new Date().toISOString().slice(0, 10),
        tokenizer: 'hadith-core',
        docCount: docLengths.length,
        termCount: terms.length,
        postings,
        droppedTerms: dropped,
        avgDocLength: Math.round(tokenCount / (docLengths.length || 1)),
        dfCutoff: DF_CUTOFF,
        files: { lex: 'index/lex.bin.gz', docs: 'index/docs.json' }
    });
    await writeFile(path.join(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

    const mb = value => (value / (1024 * 1024)).toFixed(1);
    console.log(`\ndocuments ${docLengths.length}  terms ${terms.length} `
        + `(dropped ${dropped} common)  postings ${postings}`);
    console.log(`files     lex.bin.gz ${mb(compressed.length)} MB  `
        + `(raw ${mb(bytes.length)} MB)`);
    console.log(`built in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
