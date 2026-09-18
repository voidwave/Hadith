/* ===========================================================================
 * hadith-search.js — the ranking pipeline: words, meaning, and the two combined.
 *
 * Two indexes answer a question differently and the app wants both:
 *
 *   the lexical index (hadith-index.js, BM25) knows exact words — names, rare
 *   terms, phrases the reader typed verbatim;
 *   the vector index (HDV1, e5 embeddings) knows meaning — it finds the hadith
 *   about anger even when the question never says «لا تغضب».
 *
 * They are combined by reciprocal rank fusion: each source contributes
 * 1 / (K + rank) for a document, so a hadith that both sources like wins, and
 * neither source has to be trusted with a comparable score scale.
 *
 * The return value explains itself — which ranks each document got and which
 * query terms found it — because the app shows the reader why a hadith came up
 * rather than asking them to trust a number.
 *
 * Loaded as a classic script in the browser (window.HadithSearch) and required
 * from the tools (module.exports).
 * =========================================================================== */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.HadithSearch = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const RRF_K = 60;           // the usual constant: dampens the difference between ranks
    const DEFAULT_POOL = 60;    // candidates taken from each source before fusing

    /* config: { core, lexicon, vectors?, embed? } — `embed` is the async
       function that turns "query: …" into a vector, supplied by the caller
       (the browser runs it in a worker, the tools run it in-process). */
    function create(config) {
        const core = config.core;
        const lexicon = config.lexicon;
        const vectors = config.vectors || null;
        const lexiconIndex = config.index;

        function lexical(question, pool) {
            if (!lexiconIndex) return [];
            return lexicon.search(lexiconIndex, core.queryTerms(question), { limit: pool });
        }

        async function semantic(question, pool) {
            if (!vectors || !config.embed) return [];
            const vector = await config.embed(question);
            if (!vector) return [];
            return lexicon.topSimilar(vectors, vector, { limit: pool });
        }

        function fuse(lexicalHits, semanticHits, options) {
            const lexicalWeight = options.lexicalWeight === undefined ? 1 : options.lexicalWeight;
            const vectorWeight = options.vectorWeight === undefined ? 1 : options.vectorWeight;
            const found = new Map();

            const note = docId => {
                let entry = found.get(docId);
                if (!entry) {
                    entry = { docId, score: 0, lexicalRank: 0, vectorRank: 0, terms: [] };
                    found.set(docId, entry);
                }
                return entry;
            };

            lexicalHits.forEach((hit, position) => {
                const entry = note(hit.docId);
                entry.lexicalRank = position + 1;
                entry.terms = hit.terms;
                entry.score += lexicalWeight / (RRF_K + position + 1);
            });
            semanticHits.forEach((hit, position) => {
                const entry = note(hit.docId);
                entry.vectorRank = position + 1;
                entry.vectorScore = hit.score;
                entry.score += vectorWeight / (RRF_K + position + 1);
            });

            /* Which words are worth highlighting: only the terms that actually
               discriminate in this corpus, rarest first — a question full of
               everyday words would otherwise paint a whole card yellow. */
            if (lexiconIndex) {
                const tooCommon = Math.round(lexiconIndex.docCount * 0.15);
                for (const entry of found.values()) {
                    entry.highlightTerms = [...new Set(entry.terms)]
                        .map(term => ({
                            term,
                            df: (lexiconIndex.terms.get(term) || { df: Infinity }).df
                        }))
                        .filter(item => item.df <= tooCommon)
                        .sort((a, b) => a.df - b.df)
                        .slice(0, 6)
                        .map(item => item.term);
                }
            }

            const results = [...found.values()];
            results.sort((a, b) => b.score - a.score || a.docId - b.docId);
            return results;
        }

        /* How much the app should trust the top of the list: both indexes
           agreeing early is strong, a single index alone is only a hint. */
        function confidenceOf(entry) {
            if (!entry) return 'none';
            const both = entry.lexicalRank > 0 && entry.vectorRank > 0;
            if (both && entry.lexicalRank <= 3 && entry.vectorRank <= 3) return 'strong';
            if (both) return 'good';
            if (entry.lexicalRank > 0 && entry.lexicalRank <= 3) return 'fair';
            if (entry.vectorRank > 0 && entry.vectorRank <= 3) return 'fair';
            return 'weak';
        }

        /* The whole question → ranked documents. `embed` may be omitted (or
           fail) and the result is then lexical only, which is the app's
           offline/no-model mode. */
        async function search(question, options) {
            const settings = options || {};
            const limit = settings.limit || 20;
            const pool = settings.pool || DEFAULT_POOL;
            const lexicalHits = lexical(question, pool);
            let semanticHits = [];
            let semanticFailed = false;
            if (vectors && config.embed && settings.semantic !== false) {
                try {
                    semanticHits = await semantic(question, pool);
                } catch (error) {
                    semanticFailed = true;
                    if (settings.onSemanticError) settings.onSemanticError(error);
                }
            }
            const results = fuse(lexicalHits, semanticHits, settings).slice(0, limit);
            return {
                results,
                confidence: confidenceOf(results[0]),
                lexicalCount: lexicalHits.length,
                semanticCount: semanticHits.length,
                semanticFailed
            };
        }

        return { search, fuse, confidenceOf, hasVectors: Boolean(vectors) };
    }

    return { create, RRF_K, DEFAULT_POOL };
}));
