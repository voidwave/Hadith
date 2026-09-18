#!/usr/bin/env node
/* ===========================================================================
 * build-topics-index.mjs — every named chapter of the three collections in one
 * file, so the browse screen can offer "all topics" without pulling 196 book
 * files (35 MB) into the browser just to list them.
 *
 *   input : HadithData/catalog.json + HadithData/<collection>/<book>.json
 *   output: HadithData/index/topics.json.gz   (~300 KB, the app gunzips it)
 *           HadithData/index/manifest.json    (updated with the topics details)
 *
 * A chapter whose title is nothing but "باب" is left out: as a row in a topic
 * list it would say nothing at all. 7,151 of the 7,206 chapters carry a real
 * title; the rest are still readable inside their book.
 *
 * `chapter` is the index inside the book (what hadith.ch points at), `n` is the
 * chapter's own number — for Sunan Abi Dawud those differ, so both are kept.
 *
 * Usage: node tools/build-topics-index.mjs
 * =========================================================================== */

import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'HadithData');
const ORDER = ['bukhari', 'muslim', 'abudawud'];

const catalog = JSON.parse(await readFile(path.join(DATA, 'catalog.json'), 'utf8'));
const collections = catalog.collections
    .slice()
    .sort((a, b) => {
        const left = ORDER.indexOf(a.id);
        const right = ORDER.indexOf(b.id);
        return (left < 0 ? ORDER.length : left) - (right < 0 ? ORDER.length : right);
    });

const topics = [];
for (const collection of collections) {
    for (const book of collection.books) {
        const page = JSON.parse(await readFile(path.join(DATA, book.file), 'utf8'));

        /* How many hadiths each chapter holds. */
        const counts = new Map();
        for (const hadith of page.hadiths) {
            counts.set(hadith.ch, (counts.get(hadith.ch) || 0) + 1);
        }

        page.chapters.forEach((chapter, index) => {
            const ar = (chapter.ar || '').trim();
            const en = (chapter.en || '').trim();
            const named = ar.replace(/^باب\s*/, '').length > 2 || en.length > 2;
            if (!named) return;
            topics.push({
                collection: collection.id,
                book: book.number,
                chapter: index,
                n: chapter.nAr || chapter.n || index + 1,
                ar,
                en,
                hadiths: counts.get(index) || 0
            });
        });
    }
}

const payload = {
    built: new Date().toISOString().slice(0, 10),
    count: topics.length,
    collections: collections.map(collection => collection.id),
    topics
};
const bytes = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
await writeFile(path.join(DATA, 'index', 'topics.json.gz'), bytes);

/* The manifest is shared with the lexical and vector indexes — merge into it. */
const manifestPath = path.join(DATA, 'index', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.topics = {
    file: 'index/topics.json.gz',
    count: topics.length,
    built: payload.built
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 1));

const perCollection = collections.map(collection => {
    const count = topics.filter(topic => topic.collection === collection.id).length;
    return `${collection.id} ${count.toLocaleString('en')}`;
}).join(' · ');
console.log(`named chapters: ${topics.length.toLocaleString('en')}  (${perCollection})`);
console.log(`written: HadithData/index/topics.json.gz — ${(bytes.length / 1024).toFixed(0)} KB`);
console.log('manifest updated (topics section)');
