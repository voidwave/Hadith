/* ===========================================================================
 * pwa.js — register the service worker and offer the install button.
 *
 * The worker is registered relative to this script's own URL, so the page can
 * live at /Hadith/ (or any sub-path) without hard-coding where that is.
 * =========================================================================== */

(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) return;

    const source = document.currentScript && document.currentScript.src;
    const swUrl = new URL('sw.js', source || location.href).href;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' }).catch(error => {
            console.warn('service worker registration failed:', error.message);
        });
    });

    function isInstalled() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    let deferred = null;

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferred = event;
        if (isInstalled() || document.getElementById('install-button')) return;
        const tools = document.querySelector('.appbar__tools');
        if (!tools) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'install-button';
        button.className = 'btn';
        button.textContent = 'تثبيت';
        button.addEventListener('click', async () => {
            if (!deferred) return;
            deferred.prompt();
            try { await deferred.userChoice; } catch (error) { /* ignore */ }
            deferred = null;
            button.remove();
        });
        tools.insertBefore(button, tools.firstChild);
    });

    window.addEventListener('appinstalled', () => {
        const button = document.getElementById('install-button');
        if (button) button.remove();
        deferred = null;
    });
}());
