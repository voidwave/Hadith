#!/usr/bin/env node
/* ===========================================================================
 * explain-match.mjs — why did this hadith come back for this question?
 *
 * Prints the query's terms with their weights, what each one contributed to
 * the score of one hadith, and which words in the text produced the match.
 * The BM25 arithmetic here mirrors hadith-index.js — if the two ever disagree,
 * this file is wrong, not the index.
 *
 * Usage: node tools/explain-match.mjs "ماهو اللذي ينبغي للمسلم لبسه" muslim:2162a
 * =========================================================================== */

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import core from '../hadith-core.js';
import lexicon from '../hadith-index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'HadithData');
const K1 = 1.2;
const B = 0.75;

const question = process.argv[2];
const slug = process.argv[3];
if (!question || !slug) {
    console.error('usage: node tools/explain-match.mjs "<question>" <collection:number>');
    process.exit(1);
}

const index = lexicon.decode(gunzipSync(await readFile(path.join(DATA, 'index/lex.bin.gz'))));
const docs = JSON.parse(await readFile(path.join(DATA, 'index/docs.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(DATA, 'catalog.json'), 'utf8'));

/* Find the hadith and its document id (same order the index was built in). */
let docId = -1;
let hadith = null;
let book = null;
let chapter = null;
let cursor = 0;
for (const collection of catalog.collections) {
    for (const entry of collection.books) {
        const page = JSON.parse(await readFile(path.join(DATA, entry.file), 'utf8'));
        for (const item of page.hadiths) {
            if (item.slug === slug) {
                docId = cursor;
                hadith = item;
                book = page.book;
                chapter = item.ch >= 0 ? page.chapters[item.ch] : null;
            }
            cursor += 1;
        }
    }
}
if (docId < 0) {
    console.error(`no hadith with the slug "${slug}" in HadithData`);
    process.exit(1);
}

const text = [hadith.ar && hadith.ar.matn, hadith.ar && hadith.ar.sanad, hadith.en]
    .filter(Boolean).join(' ');
const terms = core.queryTerms(question);
const words = core.splitWords(text);

console.log(`question : ${question}`);
console.log(`terms    : ${terms.map(entry => `${entry.term}(${entry.weight.toFixed(2)})`).join(' ')}`);
console.log(`hadith   : ${hadith.ref} — ${hadith.inBookRef}`);
console.log(`book     : ${book.arabic || book.english}${chapter ? ` · ${chapter.ar || chapter.en}` : ''}`);
console.log(`arabic   : ${(hadith.ar.matn || hadith.ar.sanad || '').slice(0, 220)}`);
console.log(`english  : ${(hadith.en || '').slice(0, 160)}`);
console.log(`docId    : ${docId}  length ${index.docLengths[docId]} tokens  `
    + `(average ${index.avgDocLength})`);

/* Which words of the hadith produced each match, and what it scored. Mirrors
   hadith-index.js search(): the spellings of one word are one group, worth the
   idf of the most common spelling among them. */
console.log('\nwhat matched:');
const groups = new Map();
for (const item of terms) {
    const key = item.group === undefined ? item.term : item.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
}

let total = 0;
for (const spellings of groups.values()) {
    let idf = Infinity;
    let bestTf = 0;
    const via = new Set();
    for (const item of spellings) {
        const posting = index.terms.get(item.term);
        if (!posting) continue;
        const value = Math.log(1 + (index.docCount - posting.df + 0.5) / (posting.df + 0.5));
        idf = Math.min(idf, value);
        const { docIds, tfs } = lexicon.readPostings(index, posting);
        const at = docIds.indexOf(docId);
        if (at < 0) continue;
        if (tfs[at] > bestTf) bestTf = tfs[at];
        for (const word of words) {
            const variants = core.isArabic(word)
                ? core.arabicVariants(core.normalizeArabicWord(word))
                : core.englishVariants(core.normalizeEnglishWord(word));
            if (variants.includes(item.term)) via.add(word);
        }
    }
    const label = spellings.map(item => {
        const posting = index.terms.get(item.term);
        return posting ? `${item.term}(df ${posting.df})` : `${item.term}(absent)`;
    }).join(' / ');
    if (!bestTf) {
        console.log(`  ${label}: no match in this hadith`);
        continue;
    }
    const length = index.docLengths[docId] || 1;
    const score = idf * (bestTf * (K1 + 1)) / (bestTf + K1 * (1 - B + B * (length / index.avgDocLength)));
    total += score;
    console.log(`  ${label}`);
    console.log(`    tf ${bestTf}  idf ${idf.toFixed(2)}  score ${score.toFixed(3)}   `
        + `from: ${[...via].slice(0, 5).join(', ')}`);
}
console.log(`  total score for this hadith: ${total.toFixed(3)}`);

/* Where it actually ranked. */
const ranked = lexicon.search(index, terms, { limit: index.docCount });
const rank = ranked.findIndex(hit => hit.docId === docId) + 1;
console.log(`\nrank: ${rank} of ${ranked.length} documents that match anything`);
if (rank > 1) {
    console.log('above it:');
    for (const hit of ranked.slice(Math.max(0, rank - 4), rank - 1)) {
        const doc = docs.docs;
        const pointer = [docs.collections[doc[hit.docId * 3]], doc[hit.docId * 3 + 1], doc[hit.docId * 3 + 2]];
        console.log(`  #${ranked.indexOf(hit) + 1} score ${hit.score.toFixed(3)}  `
            + `${pointer[0]}/${pointer[1]} #${pointer[2]}  via ${hit.terms.slice(0, 4).join(', ')}`);
    }
}
