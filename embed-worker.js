/* ===========================================================================
 * embed-worker.js — the on-device question embedder (worker side).
 *
 * Runs Xenova/multilingual-e5-small through transformers.js, entirely in the
 * browser: the question never leaves the device, and after the one-time model
 * download the meaning search works offline. The vectors it produces match the
 * ones in HadithData/index/vectors.bin.gz, which were built offline with the
 * same model (see tools/lib/embedder.mjs — the pooling below is its twin).
 *
 * Only questions are embedded here. The corpus was embedded offline, because
 * 20,000 hadiths take minutes, not milliseconds.
 *
 * Protocol (postMessage):
 *   in : { type:'load', prefer:'auto'|'webgpu'|'wasm' }
 *   in : { type:'embed', id, text }
 *   out: { type:'status', stage:'runtime'|'files'|'init'|'retry'|'slow', device? }
 *   out: { type:'progress', file, loaded, total }   raw bytes of ONE file
 *   out: { type:'ready', device, dtype, dims, ms }
 *   out: { type:'embedding', id, vector }           Float32Array, transferred
 *   out: { type:'error', id?, message }
 *
 * The worker never sends a sentence — only a stage. The page owns the wording,
 * because it alone knows the language the reader chose. Progress events are
 * per file; search.js adds them up against its own size table so the bar
 * measures the whole download, not whichever file happens to be moving.
 *
 * The attempt ladder and the "fresh module per attempt" trick come from
 * QuranHifz/memorize-asr-worker.js: a failed WebGPU session poisons
 * onnxruntime-web's module-global state, so the next attempt needs a new copy.
 * =========================================================================== */

'use strict';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const MODEL_ID = 'Xenova/multilingual-e5-small';
const WINDOW = 512;
const SLOW_MS = 45000;          // no bytes and no news for this long → say so
const WEIGHTS_QUIET_MS = 15000; // the weights file never reported bytes → we are past them

/* WebGPU first when the browser has it, then the path that always works. */
const ATTEMPTS = [
    { device: 'webgpu', dtype: 'fp16' },
    { device: 'wasm', dtype: 'q8' }
];

let encoder = null;
let tokenizer = null;
let dims = 0;
let loaded = null;          // { device, dtype }

function post(message, transfer) {
    self.postMessage(message, transfer || []);
}

/* ------------------------------------------------------------ watching ---
   Three things the page cannot know on its own: how long the silence lasts,
   whether bytes have started moving at all (a cached model moves none), and
   when the weights have fully arrived so the parse/build phase begins. */

let lastNewsAt = 0;
let weightsStarted = false;
let weightsDone = false;
let initAnnounced = false;
let quietTimer = 0;

function news() {
    lastNewsAt = Date.now();
}

function announceInit() {
    if (initAnnounced) return;
    initAnnounced = true;
    post({ type: 'status', stage: 'init' });
}

function startWatch() {
    news();
    clearInterval(quietTimer);
    quietTimer = setInterval(() => {
        const quiet = Date.now() - lastNewsAt;
        if (quiet >= SLOW_MS) {
            post({ type: 'status', stage: 'slow' });
            news();
        }
        /* Bytes stopped arriving after the weights were read: from here on the
           device is parsing them and building the session, which is work with
           nothing measurable to report. */
        if (weightsDone && quiet >= 4000) announceInit();
    }, 2000);
}

function stopWatch() {
    clearInterval(quietTimer);
    quietTimer = 0;
}

/* Mean pooling over the attention mask, then L2 normalisation — the same
   recipe as the offline build, written out so a silently skipped step (which
   still returns vectors, just useless ones) cannot happen here either. */
function pool(hidden, mask) {
    const [batch, sequence, size] = hidden.dims;
    const data = hidden.data;
    const maskData = mask.data;
    const vector = new Float32Array(size);
    let count = 0;
    for (let token = 0; token < sequence; token += 1) {
        if (!Number(maskData[token])) continue;          // batch of one
        count += 1;
        const base = token * size;
        for (let d = 0; d < size; d += 1) vector[d] += data[base + d];
    }
    if (count) for (let d = 0; d < size; d += 1) vector[d] /= count;
    let norm = 0;
    for (let d = 0; d < size; d += 1) norm += vector[d] * vector[d];
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < size; d += 1) vector[d] /= norm;
    return vector;
}

async function load(prefer) {
    if (encoder) return loaded;
    const attempts = prefer === 'wasm' ? ATTEMPTS.filter(item => item.device === 'wasm')
        : prefer === 'webgpu' ? ATTEMPTS.filter(item => item.device === 'webgpu')
            : ATTEMPTS;
    let lastError = null;
    weightsStarted = false;
    weightsDone = false;

    for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        post({ type: 'status', stage: 'runtime', device: attempt.device });
        startWatch();
        initAnnounced = false;
        let quietForWeights = 0;
        try {
            /* A fresh copy of the runtime per attempt: see the note at the top. */
            const module = await import(`${TRANSFORMERS_URL}?fresh=${index}`);
            const options = {
                dtype: attempt.dtype,
                device: attempt.device,
                progress_callback: info => {
                    if (!info) return;
                    if (info.status === 'progress' && info.total) {
                        const file = info.file || '';
                        if (file.endsWith('.onnx')) {
                            if (!weightsStarted) {
                                weightsStarted = true;
                                clearTimeout(quietForWeights);
                            }
                            if (info.loaded >= info.total && !weightsDone) {
                                weightsDone = true;
                                announceInit();
                            }
                        }
                        news();
                        post({ type: 'progress', file, loaded: info.loaded, total: info.total });
                    }
                }
            };
            const started = Date.now();
            /* If the weights never report a byte (they came straight out of the
               browser cache), say that the build phase has begun anyway. */
            quietForWeights = setTimeout(() => {
                if (!weightsStarted) {
                    weightsDone = true;
                    announceInit();
                }
            }, WEIGHTS_QUIET_MS);
            try {
                tokenizer = await module.AutoTokenizer.from_pretrained(MODEL_ID, options);
                encoder = await module.AutoModel.from_pretrained(MODEL_ID, options);
            } finally {
                clearTimeout(quietForWeights);
                stopWatch();
            }
            dims = encoder.config.hidden_size;
            loaded = { device: attempt.device, dtype: attempt.dtype };
            post({ type: 'ready', device: attempt.device, dtype: attempt.dtype, dims, ms: Date.now() - started });
            return loaded;
        } catch (error) {
            lastError = error;
            encoder = null;
            tokenizer = null;
            stopWatch();
            post({ type: 'status', stage: 'retry', device: attempt.device });
        }
    }
    throw lastError || new Error('could not load the embedding model');
}

async function embed(id, text) {
    if (!encoder) await load('auto');
    if (encoder.config.hidden_size !== dims && dims) {
        throw new Error('the model changed size mid-session');
    }
    const query = text.startsWith('query:') ? text : `query: ${text}`;
    const encoded = await tokenizer([query], {
        padding: true,
        truncation: true,
        max_length: WINDOW
    });
    const outputs = await encoder({
        input_ids: encoded.input_ids,
        attention_mask: encoded.attention_mask
    });
    const vector = pool(outputs.last_hidden_state, encoded.attention_mask);
    post({ type: 'embedding', id, vector, dims: vector.length }, [vector.buffer]);
}

self.onmessage = async event => {
    const message = event.data || {};
    try {
        if (message.type === 'load') {
            await load(message.prefer || 'auto');
        } else if (message.type === 'embed') {
            await embed(message.id, message.text);
        }
    } catch (error) {
        post({ type: 'error', id: message.id, message: error.message || String(error) });
    }
};
