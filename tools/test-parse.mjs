#!/usr/bin/env node
/* ===========================================================================
 * test-parse.mjs — checks the JSON in HadithData/ on its own.
 *
 * Once data/ is deleted these files are the source of truth, so this test only
 * reads HadithData/: it re-checks the totals, the shape of every record, the
 * in-book numbering, chapter links and a few known hadiths by their text.
 *
 * Usage: node tools/test-parse.mjs
 * =========================================================================== */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'HadithData');

/* Totals taken from the scrape — the numbers sunnah.com's own pages added up
   to, so a re-parse that loses or duplicates hadiths fails here. */
const EXPECTED = {
    bukhari: { books: 97, hadiths: 7277 },
    muslim: { books: 56, hadiths: 7368 },
    abudawud: { books: 43, hadiths: 5276 }
};

const problems = [];
const notes = [];

function fail(message) {
    problems.push(message);
}

/* Search text without diacritics, for the known-hadith checks. */
function plain(text) {
    return (text || '')
        .replace(/[\u0640\u064B-\u065F\u0610-\u061A\u06D6-\u06ED]/g, '')
        .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
        .replace(/\s+/g, ' ')
        .trim();
}

const catalog = JSON.parse(await readFile(path.join(DATA, 'catalog.json'), 'utf8'));
if (!Array.isArray(catalog.collections) || !catalog.collections.length) {
    fail('catalog.json has no collections');
}

const counts = new Map();
for (const collection of catalog.collections) {
    const expected = EXPECTED[collection.id];
    if (!expected) {
        notes.push(`${collection.id}: no expected totals on file`);
    } else {
        if (collection.books.length !== expected.books) {
            fail(`${collection.id}: ${collection.books.length} books, expected ${expected.books}`);
        }
        if (collection.hadiths !== expected.hadiths) {
            fail(`${collection.id}: ${collection.hadiths} hadiths, expected ${expected.hadiths}`);
        }
    }

    const slugs = new Set();
    let hadiths = 0;

    for (const book of collection.books) {
        if (!book.file.startsWith(`${collection.id}/`)) {
            fail(`${collection.id}: book ${book.number} points at ${book.file}`);
        }
        const page = JSON.parse(await readFile(path.join(DATA, book.file), 'utf8'));
        if (page.collection !== collection.id) {
            fail(`${book.file}: collection is "${page.collection}"`);
        }
        if (page.book.number !== book.number) {
            fail(`${book.file}: book number ${page.book.number} != ${book.number}`);
        }
        if (!page.book.english) fail(`${book.file}: no English book name`);
        if (!page.book.arabic) fail(`${book.file}: no Arabic book name`);
        if (page.hadiths.length !== book.hadiths) {
            fail(`${book.file}: ${page.hadiths.length} hadiths, catalog says ${book.hadiths}`);
        }
        if (page.chapters.length !== book.chapters) {
            fail(`${book.file}: ${page.chapters.length} chapters, catalog says ${book.chapters}`);
        }

        page.chapters.forEach((chapter, index) => {
            if (!chapter.en && !chapter.ar) fail(`${book.file}: chapter ${index + 1} is empty`);
        });

        let previousInBook = 0;
        let arabicOnly = 0;
        let englishOnly = 0;
        let graded = 0;
        let narrated = 0;

        page.hadiths.forEach((hadith, index) => {
            const where = `${book.file} #${hadith.ref || index + 1}`;
            if (!hadith.ref) fail(`${where}: no reference label`);
            if (!hadith.slug) fail(`${where}: no slug`);
            if (hadith.slug && !hadith.slug.startsWith(`${collection.id}:`)) {
                fail(`${where}: slug "${hadith.slug}" is not a ${collection.id} link`);
            }
            if (hadith.number === null || Number.isNaN(hadith.n)) fail(`${where}: no number`);
            if (!hadith.inBookRef) fail(`${where}: no in-book reference`);
            if (hadith.ch < -1 || hadith.ch >= page.chapters.length) {
                fail(`${where}: chapter index ${hadith.ch} is out of range`);
            }
            const hasArabic = Boolean(hadith.ar.sanad || hadith.ar.matn);
            if (!hasArabic && !hadith.en) fail(`${where}: no text at all`);
            if (!hasArabic) englishOnly += 1;
            if (!hadith.en) arabicOnly += 1;
            if (hadith.grade || hadith.gradeAr) graded += 1;
            if (hadith.narrator) narrated += 1;

            /* The <a name=N> anchor counts hadiths inside the kitab. */
            if (hadith.inBook !== null) {
                if (hadith.inBook !== previousInBook + 1) {
                    notes.push(`${where}: in-book number ${hadith.inBook} follows ${previousInBook}`);
                }
                previousInBook = hadith.inBook;
            }
            slugs.add(hadith.slug);
        });

        hadiths += page.hadiths.length;
        if (collection.id === 'abudawud' && graded === 0 && page.hadiths.length > 20) {
            fail(`${book.file}: no grades at all, expected some for Sunan Abi Dawud`);
        }
        if (collection.id !== 'abudawud' && graded > 0) {
            notes.push(`${book.file}: ${graded} graded hadiths (${collection.id} has no grade data)`);
        }
    }

    if (hadiths !== collection.hadiths) {
        fail(`${collection.id}: ${hadiths} hadiths across files, catalog says ${collection.hadiths}`);
    }
    if (slugs.size !== hadiths) {
        fail(`${collection.id}: ${hadiths - slugs.size} duplicate slug(s)`);
    }
    counts.set(collection.id, hadiths);
}

/* Known hadiths, checked by their text rather than by number. */
async function hadithBySlug(slug) {
    const [collection, number] = slug.split(':');
    const entry = catalog.collections.find(item => item.id === collection);
    if (!entry) return null;
    for (const book of entry.books) {
        const page = JSON.parse(await readFile(path.join(DATA, book.file), 'utf8'));
        const found = page.hadiths.find(hadith => hadith.slug === slug);
        if (found) return found;
    }
    return null;
}

const spotChecks = [
    {
        slug: 'bukhari:1',
        inside: 'ar.matn',
        expect: 'إنما الأعمال بالنيات',
        what: 'the intention hadith reads correctly in Arabic'
    },
    {
        slug: 'bukhari:1',
        inside: 'narrator',
        expect: "Narrated 'Umar bin Al-Khattab:",
        what: 'the narrator line was split off the body'
    },
    {
        slug: 'abudawud:1',
        inside: 'grade',
        expect: 'Hasan Sahih',
        what: 'the Al-Albani grade was picked up'
    },
    {
        slug: 'muslim:8a',
        inside: 'slug',
        expect: 'muslim:8a',
        what: 'lettered reference numbers survive'
    }
];

for (const check of spotChecks) {
    const hadith = await hadithBySlug(check.slug);
    if (!hadith) {
        fail(`${check.slug}: not found (${check.what})`);
        continue;
    }
    const value = check.inside.split('.').reduce((node, key) => node?.[key], hadith);
    if (!plain(String(value || '')).includes(plain(check.expect))) {
        fail(`${check.slug}: expected ${check.what} — looked for "${check.expect}" `
            + `in ${check.inside}, got "${String(value).slice(0, 80)}"`);
    }
}

if (counts.size) {
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    console.log(`collections: ${[...counts.entries()].map(([id, n]) => `${id} ${n}`).join(', ')}`);
    console.log(`total: ${total} hadiths`);
}
for (const note of notes.slice(0, 20)) console.log(`note: ${note}`);
if (notes.length > 20) console.log(`note: …and ${notes.length - 20} more`);

if (problems.length) {
    for (const problem of problems) console.error(`FAIL: ${problem}`);
    console.error(`\n${problems.length} problem(s).`);
    process.exit(1);
}
console.log('All checks passed.');
