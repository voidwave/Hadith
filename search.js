/* ===========================================================================
 * search.js — the browser side of the search: files, worker, ranked results.
 *
 * Loads what is needed, when it is needed:
 *   catalog.json            always, on start (a few KB, fills the browse view)
 *   index/lex.bin.gz        on the first question (~3 MB, the word index)
 *   index/docs.json         with it (docId → collection/book/hadith)
 *   index/vectors.bin.gz    when the meaning model is switched on (~10 MB)
 *   the model itself        before any search — see below
 *   <collection>/<book>.json  the text of the hadiths that actually ranked
 *
 * The vectors live here and the model lives in a worker (embed-worker.js): the
 * worker turns a question into one vector, this file compares it against the
 * 20,000 stored ones and fuses the two rankings.
 *
 * The model is REQUIRED: a search is words + meaning, and meaning needs the
 * model. So this file also answers the three questions the page has to ask
 * before it may search — what will this device download (plan + exact size),
 * is it already on the device (CacheStorage under 'transformers-cache'), and
 * how far along is the download now (progress events are per file; the sizes
 * below are the denominator that turns them into one honest percentage).
 * =========================================================================== */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.HadithSearchApp = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PATHS = {
        catalog: 'HadithData/catalog.json',
        lexical: 'HadithData/index/lex.bin.gz',
        docs: 'HadithData/index/docs.json',
        vectors: 'HadithData/index/vectors.bin.gz',
        manifest: 'HadithData/index/manifest.json'
    };

    /* ----------------------------------------------------------- the model ---
       One table, three jobs: the size warning, the progress denominator and the
       "already downloaded" check. Sizes are bytes and were read from the host
       on 2026-09-18 (huggingface.co/api/models/Xenova/multilingual-e5-small);
       changing the model or the quantisation means re-reading them. */
    const MODEL_ID = 'Xenova/multilingual-e5-small';
    const MODEL_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/`;
    const MODEL_CACHE = 'transformers-cache';        // transformers.js's own cache
    const MODEL_FILES = {
        shared: [
            { file: 'config.json', size: 658 },
            { file: 'tokenizer.json', size: 17082730 },
            { file: 'tokenizer_config.json', size: 443 }
        ],
        weights: {
            webgpu: { file: 'onnx/model_fp16.onnx', size: 235336732 },
            wasm: { file: 'onnx/model_quantized.onnx', size: 118308185 }
        },
        /* onnxruntime-web's binaries and the transformers.js bundle, served from
           jsdelivr; the service worker caches them, not transformers.js */
        runtime: 6000000
    };

    function modelFiles(plan) {
        return MODEL_FILES.shared.concat([MODEL_FILES.weights[plan] || MODEL_FILES.weights.wasm]);
    }

    function planBytes(plan) {
        return modelFiles(plan).reduce((sum, item) => sum + item.size, MODEL_FILES.runtime);
    }

    function sizeOf(plan, file) {
        const item = modelFiles(plan).find(entry => entry.file === file);
        return item ? item.size : 0;
    }

    /* WebGPU is twice the download (fp16 weights) and much faster per question;
       asking the adapter before promising a size keeps the warning true. */
    async function planFor() {
        if (typeof navigator === 'undefined' || !navigator.gpu) return 'wasm';
        try {
            const adapter = await navigator.gpu.requestAdapter();
            return adapter ? 'webgpu' : 'wasm';
        } catch (error) {
            return 'wasm';
        }
    }

    /* planFor without the await, for the places that only need a denominator. */
    function syncPlan() {
        return (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm';
    }

    async function inspectModel() {
        const plan = await planFor();
        const files = modelFiles(plan);
        let missing = null;
        try {
            const cache = await caches.open(MODEL_CACHE);
            missing = [];
            for (const item of files) {
                const hit = await cache.match(MODEL_BASE + item.file, { ignoreSearch: true });
                if (!hit) missing.push(item.file);
            }
        } catch (error) {
            missing = null;          // cache unreadable: assume nothing is stored
        }
        return {
            plan,
            files: files.map(item => item.file),
            bytes: planBytes(plan),
            cached: missing !== null && missing.length === 0,
            known: missing !== null,
            missing: missing || files.map(item => item.file)
        };
    }

    /* gzip in, bytes out — the index files ship compressed; static hosts do not
       always compress a .bin, and 3 MB + 10 MB is worth controlling ourselves. */
    async function fetchGzip(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
        if (typeof DecompressionStream !== 'function') {
            throw new Error('this browser cannot decompress the index (DecompressionStream)');
        }
        const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).arrayBuffer();
    }

    async function fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
        return response.json();
    }

    function create(options) {
        const settings = options || {};
        const core = settings.core;
        const lexicon = settings.lexicon;
        const fusion = settings.fusion;

        const books = new Map();        // "bukhari/1" → parsed book file
        let catalog = null;
        let index = null;
        let docs = null;
        let vectors = null;
        let engine = null;
        let worker = null;
        let workerReady = null;
        let onModelEvent = () => { };

        const state = {
            ready: false,
            model: 'off',           // 'off' | 'loading' | 'ready' | 'failed'
            modelDevice: '',
            vectorsLoaded: false
        };

        /* -------------------------------------------------------- progress ---
           transformers.js reports bytes per file, and the big file is always
           last. Counting them into one total against the table above is what
           makes the bar mean "download", not "whatever is moving now". */

        let progress = null;
        let lastShare = -1;

        function resetProgress(plan) {
            progress = { plan, loaded: new Map(), seen: new Map() };
            lastShare = -1;
        }

        function planOf(device) {
            return device === 'webgpu' ? 'webgpu' : 'wasm';
        }

        function noteProgress(message) {
            if (!progress) return null;
            const file = message.file || 'model';
            const loaded = Math.max(message.loaded || 0, progress.loaded.get(file) || 0);
            progress.loaded.set(file, loaded);
            if (message.total) {
                progress.seen.set(file, Math.max(message.total, progress.seen.get(file) || 0));
            }
            let bytes = 0;
            for (const value of progress.loaded.values()) bytes += value;
            let total = planBytes(progress.plan);
            for (const [name, size] of progress.seen) {
                const expected = sizeOf(progress.plan, name);
                if (size > expected) total += size - expected;   // a file we did not count
            }
            const share = total ? Math.min(0.99, bytes / total) : 0;
            return { file, loaded: bytes, total, share };
        }

        /* -------------------------------------------------------- loading --- */

        async function start() {
            if (catalog) return catalog;
            catalog = await fetchJson(PATHS.catalog);
            state.ready = true;
            return catalog;
        }

        async function loadLexical() {
            if (index) return;
            const [lexicalBytes, docsJson] = await Promise.all([
                fetchGzip(PATHS.lexical),
                fetchJson(PATHS.docs)
            ]);
            index = lexicon.decode(lexicalBytes);
            docs = docsJson;
            engine = fusion.create({
                core,
                lexicon,
                index,
                vectors: null,
                embed: async question => {
                    const vector = await embedQuestion(question);
                    return vector;
                }
            });
        }

        async function loadVectors() {
            if (vectors) return;
            vectors = lexicon.decodeVectors(await fetchGzip(PATHS.vectors));
            state.vectorsLoaded = true;
            rebuildEngine();
        }

        function rebuildEngine() {
            engine = fusion.create({
                core,
                lexicon,
                index,
                vectors,
                embed: vectors ? embedQuestion : null
            });
        }

        /* --------------------------------------------------------- worker --- */

        function startWorker(prefer) {
            if (worker) return workerReady;
            state.model = 'loading';
            /* The device in the first 'runtime' message resets this anyway; this
               is only so the bar has a denominator from the very first byte. */
            resetProgress(prefer === 'webgpu' || prefer === 'wasm' ? prefer : syncPlan());
            worker = new Worker('embed-worker.js', { type: 'module' });
            workerReady = new Promise((resolve, reject) => {
                worker.addEventListener('message', event => {
                    const message = event.data || {};
                    if (message.type === 'ready') {
                        state.model = 'ready';
                        state.modelDevice = message.device;
                        onModelEvent(message);
                        resolve(message);
                    } else if (message.type === 'progress') {
                        const counted = noteProgress(message);
                        if (!counted) return;
                        /* Hundreds of these arrive per file; only the ones that
                           move the bar by a fifth of a percent are worth a
                           repaint. */
                        if (counted.share - lastShare < 0.002 && counted.share < 0.99) return;
                        lastShare = counted.share;
                        onModelEvent({
                            type: 'progress',
                            file: counted.file,
                            loaded: counted.loaded,
                            total: counted.total,
                            share: counted.share,
                            plan: progress.plan
                        });
                    } else if (message.type === 'error') {
                        if (message.id === undefined) {
                            state.model = 'failed';
                            reject(new Error(message.message));
                        }
                        onModelEvent(message);
                    } else {
                        if (message.type === 'status' && message.stage === 'runtime') {
                            /* A new attempt starts its own byte count (a failed
                               WebGPU run may have moved to the smaller file). */
                            resetProgress(message.device ? planOf(message.device) : progress.plan);
                        }
                        onModelEvent(message);
                    }
                });
                worker.addEventListener('error', error => {
                    state.model = 'failed';
                    reject(new Error(error.message || 'the embedding worker failed'));
                });
                worker.postMessage({ type: 'load', prefer: prefer || 'auto' });
            }).catch(error => {
                state.model = 'failed';
                throw error;
            });
            return workerReady;
        }

        let pending = 0;
        function embedQuestion(question) {
            if (!worker || state.model !== 'ready') return Promise.reject(new Error('model not ready'));
            pending += 1;
            const id = pending;
            return new Promise((resolve, reject) => {
                const listener = event => {
                    const message = event.data || {};
                    if (message.id !== id) return;
                    worker.removeEventListener('message', listener);
                    if (message.type === 'embedding') resolve(message.vector);
                    else if (message.type === 'error') reject(new Error(message.message));
                };
                worker.addEventListener('message', listener);
                worker.postMessage({ type: 'embed', id, text: question });
            });
        }

        /* Turn the model on. The vectors load first: if they are missing there
           is no point downloading a large model for nothing. A previous failed
           attempt is torn down here, so trying again really is a new attempt. */
        async function enableMeaning(options) {
            const prefer = (options && options.prefer) || 'auto';
            if (state.model === 'ready' && vectors) return true;
            if (state.model === 'failed') {
                if (worker) worker.terminate();
                worker = null;
                workerReady = null;
            }
            try {
                await loadVectors();
                await startWorker(prefer);
                rebuildEngine();
                return true;
            } catch (error) {
                state.model = 'failed';
                onModelEvent({ type: 'error', message: error.message });
                return false;
            }
        }

        /* ---------------------------------------------------------- query --- */

        async function ask(question, queryOptions) {
            const settings2 = queryOptions || {};
            await loadLexical();
            const outcome = await engine.search(question, {
                limit: settings2.limit || 20,
                pool: settings2.pool || 60,
                semantic: settings2.semantic !== false && state.model === 'ready'
            });
            const results = [];
            for (const entry of outcome.results) {
                const hadith = await hadithOf(entry.docId);
                if (!hadith) continue;
                results.push({
                    docId: entry.docId,
                    hadith,
                    score: entry.score,
                    lexicalRank: entry.lexicalRank,
                    vectorRank: entry.vectorRank,
                    terms: entry.terms,
                    highlightTerms: entry.highlightTerms || []
                });
            }
            return {
                results,
                confidence: outcome.confidence,
                semantic: outcome.semanticCount > 0
            };
        }

        /* ------------------------------------------------------- documents --- */

        async function bookOf(collection, bookNumber) {
            const key = `${collection}/${bookNumber}`;
            if (!books.has(key)) {
                books.set(key, fetchJson(`HadithData/${collection}/${bookNumber}.json`));
            }
            return books.get(key);
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
            if (!docs) return null;
            const pointer = pointerOf(docId);
            const page = await bookOf(pointer.collection, pointer.bookNumber);
            const hadith = page.hadiths[pointer.hadithIndex];
            if (!hadith) return null;
            return Object.assign({}, hadith, {
                collection: pointer.collection,
                bookNumber: pointer.bookNumber,
                book: page.book,
                chapter: hadith.ch >= 0 ? page.chapters[hadith.ch] : null,
                url: hadith.slug ? `https://sunnah.com/${hadith.slug}` : null
            });
        }

        return {
            start,
            ask,
            hadithOf,
            bookOf,
            enableMeaning,
            inspectModel,
            loadLexical,
            loadVectors,
            state,
            get catalog() { return catalog; },
            set onModelEvent(handler) { onModelEvent = handler || (() => { }); },
            paths: PATHS
        };
    }

    return { create, PATHS, MODEL_FILES, MODEL_ID };
}));
