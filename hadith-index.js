/* ===========================================================================
 * hadith-index.js — the lexical index format, read and written.
 *
 * One file holds everything needed to rank all 19,921 hadiths by words:
 *
 *   'HIL1'             magic + format marker
 *   u8 version         format version (1)
 *   varint docCount    number of hadiths
 *   varint termCount   number of indexed terms
 *   varint avgDocLen   mean length of a document, for BM25
 *   docCount × varint  length of every document, in tokens
 *   termCount × entry  varint termByteLength, term (UTF-8), varint df,
 *                      varint postingOffset (from the start of the postings)
 *   postings           per term, df × (varint docIdDelta, varint termFreq)
 *
 * Terms and posting lists are sorted, so the same corpus always produces the
 * same bytes. The browser and the tools share this file (window.HadithIndex /
 * module.exports); only the tools ever call encode().
 * =========================================================================== */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.HadithIndex = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAGIC = 'HIL1';
    const VERSION = 1;

    /* ------------------------------------------------------------ bytes --- */

    function varintLength(value) {
        let length = 1;
        let rest = Math.floor(value / 128);
        while (rest > 0) {
            length += 1;
            rest = Math.floor(rest / 128);
        }
        return length;
    }

    function readVarint(bytes, cursor) {
        let result = 0;
        let shift = 0;
        let byte;
        do {
            byte = bytes[cursor.pos];
            cursor.pos += 1;
            result += (byte & 0x7f) * Math.pow(2, shift);
            shift += 7;
        } while (byte & 0x80);
        return result;
    }

    function Writer() {
        this.bytes = new Uint8Array(1 << 16);
        this.length = 0;
    }

    Writer.prototype.ensure = function (count) {
        if (this.length + count <= this.bytes.length) return;
        let size = this.bytes.length * 2;
        while (size < this.length + count) size *= 2;
        const grown = new Uint8Array(size);
        grown.set(this.bytes.subarray(0, this.length));
        this.bytes = grown;
    };

    Writer.prototype.byte = function (value) {
        this.ensure(1);
        this.bytes[this.length] = value;
        this.length += 1;
    };

    Writer.prototype.raw = function (chunk) {
        this.ensure(chunk.length);
        this.bytes.set(chunk, this.length);
        this.length += chunk.length;
    };

    Writer.prototype.varint = function (value) {
        let rest = Math.floor(value);
        while (rest >= 128) {
            this.byte((rest % 128) | 128);
            rest = Math.floor(rest / 128);
        }
        this.byte(rest);
    };

    Writer.prototype.result = function () {
        return this.bytes.subarray(0, this.length);
    };

    /* ----------------------------------------------------------- encode --- */

    /* payload: { docLengths: number[], avgDocLength, terms: [{ term, df,
       docIds: number[], tfs: number[] }] } — docIds ascending, terms sorted. */
    function encode(payload) {
        const terms = payload.terms;
        const encoder = new TextEncoder();

        /* Posting sizes first: the dictionary stores where each list begins. */
        let offset = 0;
        for (const entry of terms) {
            entry.offset = offset;
            let previous = 0;
            for (let i = 0; i < entry.docIds.length; i += 1) {
                offset += varintLength(entry.docIds[i] - previous) + varintLength(entry.tfs[i]);
                previous = entry.docIds[i];
            }
        }

        const writer = new Writer();
        for (let i = 0; i < MAGIC.length; i += 1) writer.byte(MAGIC.charCodeAt(i));
        writer.byte(VERSION);
        writer.varint(payload.docLengths.length);
        writer.varint(terms.length);
        writer.varint(Math.round(payload.avgDocLength || 0));
        for (const length of payload.docLengths) writer.varint(length);

        for (const entry of terms) {
            const bytes = encoder.encode(entry.term);
            writer.varint(bytes.length);
            writer.raw(bytes);
            writer.varint(entry.df);
            writer.varint(entry.offset);
        }

        for (const entry of terms) {
            let previous = 0;
            for (let i = 0; i < entry.docIds.length; i += 1) {
                writer.varint(entry.docIds[i] - previous);
                writer.varint(entry.tfs[i]);
                previous = entry.docIds[i];
            }
        }
        return writer.result();
    }

    /* ----------------------------------------------------------- decode --- */

    /* Turns the bytes into { docCount, docLengths, terms, postingsBytes, ... }.
       Posting lists stay compressed until a term is actually searched, which
       keeps a 20,000-document index cheap to hold. */
    function decode(buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const first = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
        if (first !== MAGIC) throw new Error('not a hadith index (' + first + ')');
        const version = bytes[4];
        if (version !== VERSION) throw new Error('index format ' + version + ', expected ' + VERSION);

        const cursor = { pos: 5 };
        const docCount = readVarint(bytes, cursor);
        const termCount = readVarint(bytes, cursor);
        const avgDocLength = readVarint(bytes, cursor);

        const docLengths = new Uint32Array(docCount);
        for (let i = 0; i < docCount; i += 1) docLengths[i] = readVarint(bytes, cursor);

        const decoder = new TextDecoder();
        const terms = new Map();
        for (let i = 0; i < termCount; i += 1) {
            const length = readVarint(bytes, cursor);
            const term = decoder.decode(bytes.subarray(cursor.pos, cursor.pos + length));
            cursor.pos += length;
            const df = readVarint(bytes, cursor);
            const offset = readVarint(bytes, cursor);
            terms.set(term, { df, offset });
        }

        return {
            docCount,
            termCount,
            avgDocLength,
            docLengths,
            terms,
            postingsBytes: bytes,
            postingsStart: cursor.pos
        };
    }

    function readPostings(index, entry) {
        const bytes = index.postingsBytes;
        const cursor = { pos: index.postingsStart + entry.offset };
        const docIds = new Int32Array(entry.df);
        const tfs = new Int32Array(entry.df);
        let docId = 0;
        for (let i = 0; i < entry.df; i += 1) {
            docId += readVarint(bytes, cursor);
            docIds[i] = docId;
            tfs[i] = readVarint(bytes, cursor);
        }
        return { docIds, tfs };
    }

    /* ----------------------------------------------------------- search --- */

    /* Plain BM25 over the terms handed in — either strings, or { term, weight,
       group } as HadithCore.queryTerms produces.

       The spellings of one query word are scored as *one* word: they match with
       their best term frequency and are worth the idf of the most common
       spelling in the index. Without that, an unusual inflection can borrow the
       authority of a rare term — «للمسلم» occurs in six documents of this
       corpus, and scored as if the question were about that phrasing.

       Returns the best `limit` documents, each with the terms that found it,
       which is what the result card explains itself with. */
    function search(index, terms, options) {
        const settings = options || {};
        const k1 = settings.k1 || 1.2;
        const b = settings.b || 0.75;
        const limit = settings.limit || 20;
        const total = index.docCount;
        const average = index.avgDocLength || 1;

        const groups = new Map();
        for (const item of terms) {
            const term = typeof item === 'string' ? item : item.term;
            const entry = index.terms.get(term);
            if (!entry) continue;
            const key = (typeof item === 'object' && item.group !== undefined)
                ? `g${item.group}` : term;
            if (!groups.has(key)) {
                groups.set(key, { idf: Infinity, wordIdf: Infinity, spellings: [] });
            }
            const group = groups.get(key);
            const idf = Math.log(1 + (total - entry.df + 0.5) / (entry.df + 0.5));
            group.idf = Math.min(group.idf, idf);
            /* Only a spelling that is a word in its own right may speak for the
               group's commonness: the fragments the ending strip produces
               (وقتها → قت) are common, and letting one of them set the idf
               would quietly destroy the value of a rare term. */
            if (term.length >= 3) group.wordIdf = Math.min(group.wordIdf, idf);
            group.spellings.push({ entry, term });
        }

        const hits = new Map();
        for (const group of groups.values()) {
            const frequencies = new Map();
            const via = new Map();
            for (const spelling of group.spellings) {
                const postings = readPostings(index, spelling.entry);
                for (let i = 0; i < postings.docIds.length; i += 1) {
                    const docId = postings.docIds[i];
                    const tf = postings.tfs[i];
                    if (tf > (frequencies.get(docId) || 0)) {
                        frequencies.set(docId, tf);
                        via.set(docId, spelling.term);
                    }
                }
            }
            const idf = Number.isFinite(group.wordIdf) ? group.wordIdf : group.idf;
            for (const [docId, tf] of frequencies) {
                const length = index.docLengths[docId] || 1;
                const score = idf * (tf * (k1 + 1))
                    / (tf + k1 * (1 - b + b * (length / average)));
                let hit = hits.get(docId);
                if (!hit) {
                    hit = { docId, score: 0, terms: [] };
                    hits.set(docId, hit);
                }
                hit.score += score;
                hit.terms.push(via.get(docId));
            }
        }

        const results = [...hits.values()];
        results.sort((a, b2) => b2.score - a.score || a.docId - b.docId);
        return results.slice(0, limit);
    }

    /* --------------------------------------------------------- vectors ---- */

    /* 'HDV1' writes the embedding index:
     *
     *   'HDV1' u8 version
     *   varint docCount      number of hadiths
     *   varint vectorCount   number of vectors (a long hadith has several)
     *   varint dims
     *   vectorCount × varint docIdDelta      (ascending; a doc may repeat)
     *   per vector: float32 scale, dims × int8 (component = round(value/scale))
     *
     * Vectors are unit length, so a dot product is a cosine — the search below
     * skips both square roots and only rescales by the stored quantisation. */

    const VECTOR_MAGIC = 'HDV1';

    Writer.prototype.float32 = function (value) {
        this.ensure(4);
        new DataView(this.bytes.buffer, this.bytes.byteOffset + this.length, 4)
            .setFloat32(0, value, true);
        this.length += 4;
    };

    function encodeVectors(payload) {
        const dims = payload.dims;
        const vectors = payload.vectors;
        const writer = new Writer();
        for (let i = 0; i < VECTOR_MAGIC.length; i += 1) writer.byte(VECTOR_MAGIC.charCodeAt(i));
        writer.byte(VERSION);
        writer.varint(payload.docCount);
        writer.varint(vectors.length);
        writer.varint(dims);
        let previous = 0;
        for (const docId of payload.docIds) {
            writer.varint(docId - previous);
            previous = docId;
        }
        for (const vector of vectors) {
            let peak = 0;
            for (let d = 0; d < dims; d += 1) peak = Math.max(peak, Math.abs(vector[d]));
            const scale = peak / 127 || 1;
            writer.float32(scale);
            for (let d = 0; d < dims; d += 1) {
                const value = Math.max(-127, Math.min(127, Math.round(vector[d] / scale)));
                writer.byte(value & 0xff);
            }
        }
        return writer.result();
    }

    function decodeVectors(buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
        if (magic !== VECTOR_MAGIC) throw new Error('not a vector index (' + magic + ')');
        if (bytes[4] !== VERSION) throw new Error('vector format ' + bytes[4] + ', expected ' + VERSION);

        const cursor = { pos: 5 };
        const docCount = readVarint(bytes, cursor);
        const vectorCount = readVarint(bytes, cursor);
        const dims = readVarint(bytes, cursor);

        const docIds = new Uint32Array(vectorCount);
        let previous = 0;
        for (let i = 0; i < vectorCount; i += 1) {
            previous += readVarint(bytes, cursor);
            docIds[i] = previous;
        }

        const scales = new Float32Array(vectorCount);
        const data = new Int8Array(vectorCount * dims);
        const view = new DataView(bytes.buffer, bytes.byteOffset);
        for (let i = 0; i < vectorCount; i += 1) {
            scales[i] = view.getFloat32(cursor.pos, true);
            cursor.pos += 4;
            const base = i * dims;
            for (let d = 0; d < dims; d += 1) {
                data[base + d] = (bytes[cursor.pos] << 24) >> 24;    // sign-extend
                cursor.pos += 1;
            }
        }
        return { docCount, vectorCount, dims, docIds, scales, data };
    }

    /* Closest documents to a unit-length query. A document with several windows
       keeps the best one. */
    function topSimilar(vectors, query, options) {
        const limit = (options && options.limit) || 50;
        const dims = vectors.dims;
        const data = vectors.data;
        const scales = vectors.scales;
        const docIds = vectors.docIds;
        const best = new Float32Array(vectors.docCount).fill(-2);

        for (let v = 0; v < vectors.vectorCount; v += 1) {
            const base = v * dims;
            let dot = 0;
            for (let d = 0; d < dims; d += 1) dot += data[base + d] * query[d];
            dot *= scales[v];
            const docId = docIds[v];
            if (dot > best[docId]) best[docId] = dot;
        }

        const found = [];
        for (let docId = 0; docId < vectors.docCount; docId += 1) {
            if (best[docId] > -2) found.push(docId);
        }
        found.sort((a, b) => best[b] - best[a] || a - b);
        return found.slice(0, limit).map(docId => ({ docId, score: best[docId] }));
    }

    return {
        encode,
        decode,
        readPostings,
        search,
        encodeVectors,
        decodeVectors,
        topSimilar,
        varintLength,
        MAGIC,
        VECTOR_MAGIC,
        VERSION
    };
}));
