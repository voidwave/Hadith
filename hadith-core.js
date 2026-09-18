/* ===========================================================================
 * hadith-core.js — the text rules the whole app agrees on.
 *
 * Arabic is written many ways for the same word: with or without harakat,
 * أ/إ/آ/ٱ written as ا, ة written as ه, ى written as ي, and the definite
 * article attached (الصلاة) or not (صلاة). Search only works if a query is
 * normalised exactly like the text it is matched against, so both the index
 * builder (tools/build-search-index.mjs) and the browser use these functions.
 *
 * Every word is turned into the terms that represent it: the word itself plus
 * a couple of stripped variants. Indexing and querying expand the same way, so
 * "صلاة" finds "الصلاة" and the other way round.
 *
 * Loaded as a classic script in the browser (window.HadithCore) and required
 * from the tools (module.exports), like QuranHifz/memorize-core.js.
 * =========================================================================== */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.HadithCore = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* Letters and marks that make up a searchable word, in any script. */
    const WORD_RE = /[\p{L}\p{M}\u0640]+/gu;

    /* A word is Arabic when it contains Arabic-script letters. */
    const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F]/;

    const MIN_TERM_LENGTH = 2;      // one-letter tokens carry no information

    /* ------------------------------------------------------- normalising --- */

    /* Drop everything that is decoration: tatweel, harakat, Quranic marks.
       The dagger alef (U+0670) is a vowel here, so it becomes an alef. */
    function stripDiacritics(word) {
        return String(word || '')
            .replace(/\u0670/g, '\u0627')
            .replace(/[\u0640\u064B-\u065F\u0610-\u061A\u06D6-\u06ED]/g, '');
    }

    /* One Arabic word → its canonical spelling: no marks, no hamza forms,
       ة→ه, ى→ي, nothing but letters. */
    function normalizeArabicWord(word) {
        return stripDiacritics(word)
            .replace(/[\u0622\u0623\u0625\u0671-\u0673\u0675]/g, '\u0627')  // آأإٱ… → ا
            .replace(/[\u0626\u0624]/g, '\u0621')                            // ئ ؤ → ء
            .replace(/\u0621\u0627/g, '\u0627')                              // ءا → ا
            .replace(/\u0629/g, '\u0647')                                    // ة → ه
            .replace(/\u0649/g, '\u064A')                                    // ى → ي
            .replace(/[^\u0621-\u064A]/g, '');                               // letters only
    }

    /* One Latin word → lowercase letters and digits only. */
    function normalizeEnglishWord(word) {
        return String(word || '')
            .toLowerCase()
            .replace(/[\u2019\u2018'`]/g, '')       // Allah's → allahs
            .replace(/[^a-z0-9]/g, '');
    }

    /* Arabic attaches its particles in front of a word and its pronouns behind
       it, so one word turns up as الصلاة / صلاة, وبالصلاة / صلاة, لأخيه / أخ.
       Every word therefore offers its stripped forms as extra terms; the index
       and the queries expand the same way, so any of them can match. */
    const ARABIC_LEADING = ['\u0648\u0627\u0644', '\u0641\u0627\u0644', '\u0628\u0627\u0644',
        '\u0643\u0627\u0644', '\u0644\u0644', '\u0627\u0644'];
    const ARABIC_PARTICLES = ['\u0648', '\u0641'];
    const ARABIC_SINGLE = ['\u0644'];
    const ARABIC_ENDINGS = ['\u0647\u0627', '\u0647\u0645', '\u0647\u0646', '\u0643\u0645',
        '\u0643\u0646', '\u0646\u0627', '\u064A\u0647', '\u0647', '\u0643', '\u064A'];

    function arabicVariants(term) {
        const variants = [term];
        let core = term;

        for (const prefix of ARABIC_LEADING) {
            if (core.length > prefix.length + 1 && core.startsWith(prefix)) {
                core = core.slice(prefix.length);
                variants.push(core);
                break;
            }
        }
        for (const particle of ARABIC_PARTICLES) {
            if (core.length > 3 && core.startsWith(particle)) {
                core = core.slice(1);
                variants.push(core);
                break;
            }
        }
        /* A single ل is usually the particle "to/for" (لأخيه → أخيه), but it
           also opens real words (لبن, لسان), so it is only taken off a longer
           remainder and never off ب/ك, which open more words than particles. */
        for (const letter of ARABIC_SINGLE) {
            if (core.length > 4 && core.startsWith(letter)) {
                core = core.slice(1);
                variants.push(core);
                break;
            }
        }
        for (const ending of ARABIC_ENDINGS) {
            if (core.length <= ending.length + 1 || !core.endsWith(ending)) continue;
            const stem = core.slice(0, core.length - ending.length);
            /* A long ending only has to leave two letters (اخيه → اخ); a
               single one has to leave a real word (كتابه → كتاب), which
               leaves علي and نبي alone. */
            if (stem.length < (ending.length > 1 ? 2 : 3)) continue;
            /* …اه is how a word ending in ة is spelled without its marks, so
               the ه there belongs to the word, not to a pronoun. */
            if (ending === '\u0647' && stem.endsWith('\u0627')) continue;
            variants.push(stem);
            break;
        }
        return [...new Set(variants)];
    }

    /* The same idea for English plurals — deliberately conservative. */
    function englishVariants(term) {
        const variants = [term];
        if (term.length > 3 && term.endsWith('ies')) {
            variants.push(term.slice(0, -3) + 'y');            // duties → duty
        } else if (term.length > 4 && term.endsWith('es')) {
            variants.push(term.slice(0, -2));                  // prayers → prayer? (kept below)
        }
        if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) {
            variants.push(term.slice(0, -1));                  // prayers → prayer
        }
        return variants;
    }

    /* ----------------------------------------------------------- words ---- */

    function splitWords(text) {
        return String(text || '').split(/\s+/).filter(Boolean);
    }

    function isArabic(word) {
        return ARABIC_RE.test(word);
    }

    function normalizeWord(word) {
        return isArabic(word) ? normalizeArabicWord(word) : normalizeEnglishWord(word);
    }

    /* The word itself plus every variant worth indexing, in order. Kept with
       duplicates so the same list can count term frequencies. */
    function terms(text) {
        const out = [];
        for (const raw of splitWords(text)) {
            const word = normalizeWord(raw);
            if (word.length < MIN_TERM_LENGTH) continue;
            const variants = isArabic(raw) ? arabicVariants(word) : englishVariants(word);
            for (const variant of variants) {
                if (variant.length >= MIN_TERM_LENGTH) out.push(variant);
            }
        }
        return out;
    }

    /* The same list without repeats — what a query is turned into. */
    function uniqueTerms(text) {
        return [...new Set(terms(text))];
    }

    /* Words that ask the question instead of describing the topic. A question
       like «ماذا قال النبي عن يوم القيامة؟» is about القيامة; leaving ماذا / قال /
       النبي in the query makes BM25 rank hadiths that merely contain those
       ubiquitous words. Only *queries* are filtered — the index keeps every
       word, so a hadith that uses one of them is still searchable by it. */
    const STOPWORDS = new Set([
        /* question words — including the colloquial forms people actually type */
        'ما', 'ماذا', 'هل', 'كيف', 'لماذا', 'متي', 'اين', 'كم', 'اي', 'من', 'لم', 'لن',
        'اذا', 'الا', 'اما', 'ايش', 'وش', 'شو', 'ماهو', 'ماهي', 'ماهذا', 'ماهذه', 'مهو',
        /* relative pronouns — people often type a doubled ل (اللذي، اللتي) */
        'الذي', 'التي', 'الذين', 'اللذي', 'اللتي', 'اللذين', 'اللذان', 'اللتان',
        'اللواتي', 'ذي', 'لذي', 'لتي',
        /* modal verbs: they say what kind of answer is wanted, not what it is
           about («ينبغي» made a question about clothing search for "should") */
        'ينبغي', 'يجب', 'يجوز', 'يحل', 'يحرم', 'يستحب', 'يكره', 'يمكن', 'يقال',
        'اريد', 'ابحث', 'اعرف', 'معرفه', 'استفسار', 'سوال',
        /* particles, pronouns, and the verbs of being */
        'في', 'الي', 'علي', 'عن', 'مع', 'عند', 'بعد', 'قبل', 'بين', 'حتي', 'ثم', 'او', 'و',
        'قد', 'لقد', 'كل', 'بعض', 'غير', 'مثل', 'اكثر', 'اقل', 'جدا', 'ايضا', 'فقط', 'لكن',
        'هذا', 'هذه', 'ذلك', 'تلك', 'الذي', 'التي', 'الذين', 'هو', 'هي', 'هم', 'هن', 'انا',
        'نحن', 'انت', 'به', 'له', 'لها', 'لهم', 'فيه', 'فيها', 'منه', 'منها', 'عليه',
        'عليها', 'اليه', 'اليها', 'كان', 'كانت', 'كانوا', 'يكون', 'تكون', 'ليس', 'ليست',
        /* how people ask about hadith */
        'حديث', 'الحديث', 'احاديث', 'روي', 'رواه', 'يروي', 'اخبر', 'اخبرنا', 'حدثنا',
        'حدثني', 'قال', 'قالت', 'قالوا', 'يقول', 'تقول', 'قول', 'قوله', 'النبي', 'نبي',
        'الرسول', 'رسول', 'صلي', 'وسلم', 'السلام', 'عليه',
        /* English question words and framing */
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did',
        'of', 'to', 'in', 'on', 'for', 'about', 'with', 'and', 'or', 'but', 'that', 'this',
        'these', 'those', 'it', 'its', 'as', 'at', 'by', 'from', 'than', 'then', 'there',
        'here', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'say',
        'says', 'said', 'prophet', 'hadith', 'narrate', 'narrated', 'tell', 'told',
        'mention', 'mentioned', 'according'
    ]);

    function isStopword(term) {
        return STOPWORDS.has(term);
    }

    /* A question keeps its words apart. Every word expands into variants, and
       they share one unit of weight between them, so a word written with the
       article (الصلاة) does not outvote the rest of the question just because
       it matched three spellings. Words that only ask the question are dropped
       — unless that would leave nothing at all. Returns [{ term, weight }]. */
    function queryTerms(text) {
        const groups = new Map();
        const all = [];
        for (const raw of splitWords(text)) {
            const word = normalizeWord(raw);
            if (word.length < MIN_TERM_LENGTH || groups.has(word)) continue;
            const variants = isArabic(raw) ? arabicVariants(word) : englishVariants(word);
            const group = new Set([word]);
            for (const variant of variants) {
                if (variant.length >= MIN_TERM_LENGTH) group.add(variant);
            }
            groups.set(word, group);
            all.push(group);
        }

        /* A word counts as scaffolding when any of its spellings is one: the
           ending strip turns ينبغي into the junk variant ينبغ, and one junk
           spelling was enough to smuggle the whole word past the filter. */
        const asked = all.filter(group => ![...group].some(isStopword));
        const chosen = asked.length ? asked : all;
        const out = [];
        let groupId = 0;
        for (const group of chosen) {
            const weight = 1 / group.size;
            for (const term of group) out.push({ term, weight, group: groupId });
            groupId += 1;
        }
        return out;
    }

    /* --------------------------------------------------- highlighting ----- */

    /* Ranges in `text` worth highlighting for this query, expanded to whole
       words so the display keeps its diacritics. Matching happens on the
       normalised form, which is why "صلاة" highlights "الصَّلَاةِ". */
    function highlightRanges(text, query, options) {
        const source = String(text || '');
        const limit = (options && options.limit) || 40;
        const wanted = uniqueTerms(query).filter(term => term.length >= 3);
        if (!wanted.length) return [];
        const wantedSet = new Set(wanted);

        const ranges = [];
        WORD_RE.lastIndex = 0;
        let match;
        while ((match = WORD_RE.exec(source))) {
            const word = normalizeWord(match[0]);
            if (word.length < MIN_TERM_LENGTH) continue;
            let hit = false;
            if (wantedSet.has(word)) {
                hit = true;
            } else {
                for (const term of wanted) {
                    if (word.includes(term)) { hit = true; break; }
                }
            }
            if (!hit) continue;
            ranges.push({ start: match.index, end: match.index + match[0].length });
            if (ranges.length >= limit) break;
        }
        return mergeRanges(ranges);
    }

    function mergeRanges(ranges) {
        if (ranges.length < 2) return ranges;
        const sorted = ranges.slice().sort((a, b) => a.start - b.start);
        const merged = [sorted[0]];
        for (let i = 1; i < sorted.length; i += 1) {
            const last = merged[merged.length - 1];
            if (sorted[i].start <= last.end) {
                last.end = Math.max(last.end, sorted[i].end);
            } else {
                merged.push(sorted[i]);
            }
        }
        return merged;
    }

    /* Plain reading copy of a hadith: the sanad (chain) is dropped, because on
       screen the matn is what the reader came for. */
    function readableArabic(hadith) {
        if (!hadith || !hadith.ar) return '';
        return (hadith.ar.matn || hadith.ar.sanad || '').trim();
    }

    /* The Arabic of a hadith cut into the pieces the source page colours:
       the chain of narration, the matn, and any Quranic quote inside either
       (the source wraps those in braces, and the braces survive parsing, which
       is what marks one here). Returns [{ text, kind }] in reading order. */
    function arabicSegments(hadith) {
        const parts = [];
        const push = (text, kind) => {
            const value = String(text || '').trim();
            if (value) parts.push({ text: value, kind });
        };
        const split = (text, kind) => {
            const source = String(text || '');
            const pattern = /\{[^{}]*\}/g;
            let at = 0;
            let match;
            while ((match = pattern.exec(source))) {
                push(source.slice(at, match.index), kind);
                push(match[0], 'quran');
                at = match.index + match[0].length;
            }
            push(source.slice(at), kind);
        };
        if (hadith && hadith.ar) {
            split(hadith.ar.sanad, 'sanad');
            split(hadith.ar.matn, 'matn');
        }
        return parts;
    }

    return {
        stripDiacritics,
        normalizeArabicWord,
        normalizeEnglishWord,
        normalizeWord,
        arabicVariants,
        englishVariants,
        splitWords,
        isArabic,
        terms,
        uniqueTerms,
        queryTerms,
        isStopword,
        highlightRanges,
        mergeRanges,
        readableArabic,
        arabicSegments
    };
}));
