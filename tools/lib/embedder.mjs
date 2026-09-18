/* ===========================================================================
 * embedder.mjs — the sentence embedder behind the vector index.
 *
 * Model: Xenova/multilingual-e5-small (384 dims, Arabic + English + ~100 more).
 * E5 is an instruction model: passages must be embedded as "passage: …" and
 * questions as "query: …", or the vectors land in the wrong place.
 *
 * Nothing here relies on the pipeline shortcuts. Tokenising, mean pooling over
 * the attention mask and L2 normalisation are done by hand, because a silently
 * skipped pooling step still returns vectors that "work" — they just rank
 * nonsense (measured: cosines of 13.6 instead of ≤ 1).
 *
 * Long hadiths: e5-small's window is 512 tokens and a third of this corpus is
 * longer than that (p99 ≈ 2,300 tokens). A long hadith is therefore split into
 * overlapping windows of whole words and embedded once per window; the caller
 * keeps every vector pointing at the same document.
 *
 * The weights are NOT part of this repository (112.8 MB — see .gitignore), so
 * the first build fetches them from Hugging Face and keeps them in a local
 * cache:
 *   - default: the library's own cache, inside tools/node_modules (ignored)
 *   - HADITH_MODEL_CACHE=/some/dir points it elsewhere — outside the repo,
 *     ideally, so re-installing the dev dependencies does not cost 118 MB again
 * =========================================================================== */

import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';

if (process.env.HADITH_MODEL_CACHE) env.cacheDir = process.env.HADITH_MODEL_CACHE;
env.allowRemoteModels = true;   // fetch what is not cached
env.allowLocalModels = false;   // a stray folder named like the model must not shadow it

const WINDOW = 512;         // e5-small's input window, special tokens included
const HEADROOM = 24;        // room for "query: "/"passage: " and <s>/</s>
const OVERLAP_SHARE = 0.2;  // how much neighbouring windows share
const MAX_BATCH = 32;
const SHORT_ENOUGH = 900;   // characters that cannot possibly fill the window
const MAX_WINDOWS = 4;      // ~2,000 tokens: past that a hadith is summarised by its start

/* What the model needs, once a second, so the first build of a fresh clone does
   not look like a hang. A cached file finishes in one report or none, so a warm
   build stays nearly silent. */
function downloadReporter() {
    const mb = value => (value / 1048576).toFixed(1);
    const fetching = new Set();
    let last = 0;
    let previous = '';
    return info => {
        if (!info || !info.file) return;
        if (info.status === 'download') {
            fetching.add(info.file);
            previous = '';
            console.log(`   downloading ${info.file} …`);
            return;
        }
        if (info.status !== 'progress' || !info.total || !fetching.has(info.file)) return;
        if (info.total < 1048576) return;                 // tiny files: the line above is enough
        const now = Date.now();
        if (info.loaded < info.total && now - last < 1000) return;
        last = now;
        const line = `   ${info.file}: ${mb(info.loaded)} of ${mb(info.total)} MB`;
        if (line === previous) return;                    // the last chunk repeats 100%
        previous = line;
        console.log(line);
    };
}

export async function loadEmbedder(options) {
    const settings = options || {};
    const model = settings.model || 'Xenova/multilingual-e5-small';
    const dtype = settings.dtype || 'q8';
    let tokenizer;
    let encoder;
    try {
        tokenizer = await AutoTokenizer.from_pretrained(model, { progress_callback: downloadReporter() });
        encoder = await AutoModel.from_pretrained(model, { dtype, progress_callback: downloadReporter() });
    } catch (error) {
        throw new Error(`could not load ${model} — the first run downloads it from Hugging Face, so it needs a connection (set HADITH_MODEL_CACHE to reuse a cache): ${error.message}`);
    }
    const dims = encoder.config.hidden_size;

    /* How many tokens a text takes (no truncation, no padding). */
    async function countTokens(text) {
        const ids = await tokenizer(text);
        return ids.input_ids.dims[1];
    }

    /* One text → the texts that get embedded for it: usually itself, and for a
       long hadith a few overlapping windows of whole words. */
    async function windowsFor(text, kind) {
        const prefixed = `${kind}: ${text}`;
        /* Counting tokens costs a pass over the text; short passages cannot
           reach the window, so they skip it. */
        if (prefixed.length <= SHORT_ENOUGH) return [prefixed];
        const length = await countTokens(prefixed);
        const budget = WINDOW - HEADROOM;
        if (length <= WINDOW) return [prefixed];

        const words = text.split(/\s+/).filter(Boolean);
        const pieces = Math.max(2, Math.ceil(length / budget));
        const size = Math.max(1, Math.ceil(words.length / pieces));
        const step = Math.max(1, Math.round(size * (1 - OVERLAP_SHARE)));
        const out = [];
        for (let start = 0; start < words.length; start += step) {
            out.push(`${kind}: ${words.slice(start, start + size).join(' ')}`);
            if (start + size >= words.length) break;
        }
        return out.slice(0, MAX_WINDOWS);
    }

    /* Mean pooling over the attention mask, then L2 normalisation — the
       sentence-transformers recipe, written out so it cannot be skipped. */
    function pool(hidden, mask) {
        const [batch, sequence, size] = hidden.dims;
        const data = hidden.data;
        const maskData = mask.data;
        const vectors = [];
        for (let item = 0; item < batch; item += 1) {
            const vector = new Float32Array(size);
            let count = 0;
            for (let token = 0; token < sequence; token += 1) {
                if (!Number(maskData[item * sequence + token])) continue;
                count += 1;
                const base = (item * sequence + token) * size;
                for (let d = 0; d < size; d += 1) vector[d] += data[base + d];
            }
            if (count) for (let d = 0; d < size; d += 1) vector[d] /= count;
            let norm = 0;
            for (let d = 0; d < size; d += 1) norm += vector[d] * vector[d];
            norm = Math.sqrt(norm) || 1;
            for (let d = 0; d < size; d += 1) vector[d] /= norm;
            vectors.push(vector);
        }
        return vectors;
    }

    /* Embed a batch of texts of one kind. Returns one array of vectors per
       text (one vector normally, several for a long hadith). */
    async function embed(texts, kind) {
        const purpose = kind || 'passage';
        const groups = [];
        for (const text of texts) groups.push(await windowsFor(text, purpose));

        /* Shortest windows first: batching by length wastes far less padding. */
        const jobs = [];
        groups.forEach((list, owner) => {
            list.forEach((window, index) => jobs.push({ owner, index, text: window }));
        });
        jobs.sort((a, b) => a.text.length - b.text.length);
        for (let start = 0; start < jobs.length; start += MAX_BATCH) {
            const chunk = jobs.slice(start, start + MAX_BATCH);
            const encoded = await tokenizer(chunk.map(job => job.text), {
                padding: true,
                truncation: true,
                max_length: WINDOW
            });
            const outputs = await encoder({
                input_ids: encoded.input_ids,
                attention_mask: encoded.attention_mask
            });
            const vectors = pool(outputs.last_hidden_state, encoded.attention_mask);
            vectors.forEach((vector, item) => {
                chunk[item].vector = vector;
            });
        }

        const out = groups.map(list => new Array(list.length));
        for (const job of jobs) out[job.owner][job.index] = job.vector;
        return out;
    }

    return { embed, countTokens, dims, model, dtype, window: WINDOW };
}
