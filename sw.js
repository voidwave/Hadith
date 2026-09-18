/* ===========================================================================
 * sw.js — the service worker: shell offline, indexes cached once.
 *
 * Three kinds of request:
 *   the app itself            → network first, the cached copy answers when the
 *                               network is slow or gone. While the app is being
 *                               developed, a cached copy of index.js must never
 *                               win over the file that was just edited.
 *   HadithData/**             → cache first: the corpus only changes when the
 *                               data is rebuilt, and the indexes are 3 MB and
 *                               10 MB, so they are worth keeping
 *   jsdelivr (transformers.js)→ stale-while-revalidate, because that runtime
 *                               must load for meaning search to work offline
 *
 * The embedding model itself is cached by transformers.js in its own cache, so
 * it is deliberately left alone here.
 * =========================================================================== */

'use strict';

const VERSION = 'v2';
const SHELL_CACHE = `hadith-shell-${VERSION}`;
const DATA_CACHE = 'hadith-data';
const RUNTIME_CACHE = 'hadith-runtime';

const SHELL_FILES = [
    './',
    'index.html',
    'index.js',
    'search.js',
    'hadith-core.js',
    'hadith-index.js',
    'hadith-search.js',
    'embed-worker.js',
    'manifest.webmanifest',
    'icons/icon.svg'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        for (const file of SHELL_FILES) {
            try {
                await cache.add(new Request(file, { cache: 'reload' }));
            } catch (error) {
                /* one missing file must not stop the install */
            }
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keep = new Set([SHELL_CACHE, DATA_CACHE, RUNTIME_CACHE]);
        for (const name of await caches.keys()) {
            if (name.startsWith('hadith-') && !keep.has(name)) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => null);
    return hit || (await network) || Response.error();
}

async function networkFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (error) {
        const hit = await cache.match(request, { ignoreSearch: true })
            || await cache.match('index.html')
            || await cache.match('./');
        if (hit) return hit;
        throw error;
    }
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (url.origin === location.origin) {
        if (url.pathname.includes('/HadithData/index/')) {
            event.respondWith(cacheFirst(request, DATA_CACHE));
            return;
        }
        if (url.pathname.includes('/HadithData/')) {
            event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
            return;
        }
        if (request.mode === 'navigate' || url.pathname.endsWith('/')) {
            event.respondWith(networkFirst(request));
            return;
        }
        /* Everything else that belongs to the app: network first as well, with
           the cache as the fallback that makes it work offline. */
        event.respondWith(networkFirst(request));
        return;
    }

    if (url.hostname === 'cdn.jsdelivr.net') {
        event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    }
    /* everything else (the model files on huggingface.co) is left to the
       library's own cache */
});
