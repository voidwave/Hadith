#!/usr/bin/env node
/* ===========================================================================
 * test-core.mjs — checks the text rules in hadith-core.js.
 *
 * Arabic normalisation and highlight ranges are the two places where a quiet
 * mistake costs search quality (or highlights the wrong words), so they are
 * pinned down here with the shapes that actually occur in the corpus.
 *
 * Usage: node tools/test-core.mjs
 * =========================================================================== */

import core from '../hadith-core.js';

let failures = 0;

function equal(actual, expected, what) {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (!same) {
        failures += 1;
        console.error(`FAIL ${what}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
    }
}

function ok(value, what) {
    if (!value) {
        failures += 1;
        console.error(`FAIL ${what}`);
    }
}

/* --------------------------------------------------------- normalising --- */

equal(core.normalizeArabicWord('الصَّلَاةِ'), 'الصلاه', 'harakat come off, ة → ه');
equal(core.normalizeArabicWord('الْأَعْمَالُ'), 'الاعمال', 'أ → ا');
equal(core.normalizeArabicWord('إِنَّمَا'), 'انما', 'إ → ا and shadda drop');
equal(core.normalizeArabicWord('صَلَّى'), 'صلي', 'ى → ي');
equal(core.normalizeArabicWord('الْمُغِيرَةِ'), 'المغيره', 'ة inside a word');
equal(core.normalizeArabicWord('قُرْءَان'), 'قران', 'ءا → ا');
equal(core.normalizeArabicWord('يَتَوَضَّأُ'), 'يتوضا', 'final hamza on alef');
equal(core.normalizeArabicWord('مُحَمَّدٌ'), 'محمد', 'plain word with marks');
equal(core.normalizeArabicWord('بِسْمِ'), 'بسم', 'kasra drops');
equal(core.normalizeArabicWord('ﷺ'), '', 'the salutation ligature is not a word');
ok(core.stripDiacritics('الْحَمْدُ').includes('ا'), 'strip leaves the letters');

equal(core.normalizeEnglishWord("Allah's"), 'allahs', 'apostrophes go');
equal(core.normalizeEnglishWord('Prayer,'), 'prayer', 'punctuation goes');

/* ------------------------------------------------------------- variants --- */

/* Variants are generated from already-normalised words, so ة is a ه by then. */
equal(core.arabicVariants('والصلاة'), ['والصلاة', 'صلاة'], 'وال + word');
equal(core.arabicVariants('الصلاة'), ['الصلاة', 'صلاة'], 'ال + word');
equal(core.arabicVariants('الصلاه'), ['الصلاه', 'صلاه'], 'the ه of a ة-word is not a pronoun');
equal(core.arabicVariants('صلاة'), ['صلاة'], 'bare word has no variant');
equal(core.arabicVariants('للكتاب'), ['للكتاب', 'كتاب'], 'لل + word');
equal(core.arabicVariants('لاخيه'), ['لاخيه', 'اخيه', 'اخ'], 'ل + word + pronoun');
equal(core.arabicVariants('لنفسك'), ['لنفسك', 'نفسك', 'نفس'], 'ل + word + ك');
equal(core.arabicVariants('لبن'), ['لبن'], 'a word that starts with ل keeps its first letter');
equal(core.arabicVariants('كتابه'), ['كتابه', 'كتاب'], 'pronoun endings come off');
equal(core.arabicVariants('بالصلاة'), ['بالصلاة', 'صلاة'], 'بال + word');
equal(core.arabicVariants('للكتاب'), ['للكتاب', 'كتاب'], 'لل + word');
ok(core.englishVariants('prayers').includes('prayer'), 'plural folds');
ok(core.englishVariants('duties').includes('duty'), 'ies → y');
equal(core.englishVariants('class'), ['class'], 'ss is left alone');

/* ------------------------------------------------------------- terms ----- */

equal(core.uniqueTerms('الصلاة على النبي'), ['الصلاه', 'صلاه', 'علي', 'النبي', 'نبي'], 'query terms expand');
ok(core.uniqueTerms('لأخيه').includes('اخ'), 'the same word written with a pronoun still meets its bare form');
ok(core.uniqueTerms('لنفسك').includes('نفس') && core.uniqueTerms('لنفسه').includes('نفس'),
    'the same word meets across different pronouns');
ok(core.terms('الصلاة الصلاة').length > core.uniqueTerms('الصلاة الصلاة').length,
    'terms() keeps repeats so frequencies can be counted');
equal(core.uniqueTerms('a I x'), [], 'one-letter words are dropped');
equal(core.uniqueTerms('of to'), ['of', 'to'], 'two-letter words are kept for the index');
const weights = core.queryTerms('الأعمال');
ok(weights.length === 2 && Math.abs(weights[0].weight - 0.5) < 1e-9,
    'the variants of one word share a single unit of weight');
ok(core.queryTerms('الصلاة').every(item => item.weight === 0.5), 'article and bare form are one word');
ok(core.queryTerms('كتب').every(item => item.weight === 1), 'a word without variants keeps full weight');

/* A question is about its topic, not about the words that ask it. */
equal(core.queryTerms('ماذا قال النبي عن يوم القيامة؟').map(item => item.term).sort(),
    ['القيامه', 'قيام', 'قيامه', 'يوم'], 'question words are dropped, the topic stays');
equal(core.queryTerms('what did the Prophet say about anger?').map(item => item.term).sort(),
    ['anger'], 'English framing words are dropped too');
ok(core.queryTerms('من هو').length > 0, 'an all-stopword question still searches something');

/* -------------------------------------------------------- highlighting --- */

equal(core.highlightRanges('إنما الأعمال بالنيات', 'الأعمال'), [{ start: 5, end: 12 }],
    'whole word is highlighted');
const marked = core.highlightRanges('إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ', 'الأعمال');
ok(marked.length === 1, 'diacritised text still highlights');
equal(core.normalizeArabicWord('إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ'.slice(marked[0].start, marked[0].end)),
    'الاعمال', 'the range covers the marked word without its neighbours');
const article = core.highlightRanges('حَافِظُوا عَلَى الصَّلَوَاتِ', 'صلاة');
ok(article.length === 0, 'a bare query does not highlight an unrelated spelling');
const prayers = core.highlightRanges('حَافِظُوا عَلَى الصَّلَوَاتِ', 'الصلوات');
ok(prayers.length === 1 && core.normalizeArabicWord('حَافِظُوا عَلَى الصَّلَوَاتِ'.slice(prayers[0].start, prayers[0].end)) === 'الصلوات',
    'the article form highlights the article word');
ok(core.highlightRanges('صلاة', 'لا').length === 0, 'terms shorter than 3 letters never hunt inside words');
equal(core.highlightRanges('prayer and fasting', 'prayer'), [{ start: 0, end: 6 }], 'English highlights too');

/* ------------------------------------------------------------ reading ---- */

equal(core.readableArabic({ ar: { sanad: 'حَدَّثَنَا', matn: 'إِنَّمَا الْأَعْمَالُ' } }), 'إِنَّمَا الْأَعْمَالُ',
    'the matn is what is shown');
equal(core.readableArabic({ ar: { sanad: 'حَدَّثَنَا', matn: '' } }), 'حَدَّثَنَا',
    'a hadith with only a chain still shows its text');

/* The source page colours the chain, the matn and the Quranic quotes apart. */
const segments = core.arabicSegments({
    ar: {
        sanad: 'حَدَّثَنَا عَبْدُ اللَّهِ',
        matn: 'قَالَ {إِنَّا أَعْطَيْنَاكَ} ثُمَّ {وَالْفَجْرِ}'
    }
});
equal(segments.map(segment => segment.kind), ['sanad', 'matn', 'quran', 'matn', 'quran'],
    'chain, matn and quotes are told apart');
equal(segments[0].text, 'حَدَّثَنَا عَبْدُ اللَّهِ', 'the chain keeps its own text');
equal(core.arabicSegments({ ar: { sanad: '', matn: 'إِنَّمَا الْأَعْمَالُ' } }).length, 1,
    'an empty chain adds nothing');

if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
}
console.log('All text checks passed.');
