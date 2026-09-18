/* ===========================================================================
 * index.js — the app: ask a question, read the hadiths that answer it.
 *
 * The rule this file is built around: the app never writes an answer. It shows
 * the hadith text, its translation, its grading where the source has one, and
 * where it comes from — the ranking only decides what to show first.
 *
 * Everything Arabic is rendered with the source diacritics kept; matching
 * happens on a normalised copy of the text (hadith-core.js) and the matched
 * words are highlighted back onto the original.
 * =========================================================================== */

(function () {
    'use strict';

    const core = window.HadithCore;
    const lexicon = window.HadithIndex;
    const fusion = window.HadithSearch;
    const app = window.HadithSearchApp.create({ core, lexicon, fusion });

    const RESULTS_LIMIT = 15;
    const BROWSE_CHUNK = 40;

    const STRINGS = {
        ar: {
            title: 'أحاديث',
            subtitle: 'صحيح البخاري · صحيح مسلم · سنن أبي داود',
            tabAsk: 'اسأل',
            tabBrowse: 'تصفّح',
            askLabel: 'اكتب سؤالك عن مسألة إسلامية',
            askButton: 'ابحث عن الأحاديث',
            askHint: 'يبحث في ١٩٬٩٢١ حديثًا باللفظ والمعنى',
            askPlaceholder: 'مثال: ماذا قال النبي ﷺ عن الغضب؟',
            related: 'أحاديث أخرى ذات صلة',
            credits: 'نصوص الأحاديث من sunnah.com — صحيح البخاري، صحيح مسلم، سنن أبي داود. كل نتيجة تُظهر مرجعها في المجموعة الأصلية.',
            note: 'لا يُصدر هذا الموقع فتاوى ولا آراءً؛ يعرض النصوص ونسبتها فقط. أحكام الحديث الواردة هنا من تخريج الشيخ الألباني كما هي في المصدر.',
            searching: 'جارٍ البحث …',
            preparing: 'جارٍ تحضير الفهرس …',
            noResults: 'لم أجد حديثًا مطابقًا بوضوح. جرّب كلمات أخرى أو صياغة أقصر.',
            answerLabel: 'الحديث الأقرب لسؤالك',
            matchedWords: 'مطابقة باللفظ',
            matchedMeaning: 'مطابقة بالمعنى',
            matchedBoth: 'مطابقة باللفظ والمعنى',
            matchedWeak: 'أقرب النتائج',
            sanad: 'السند',
            translation: 'الترجمة',
            grade: 'الحكم',
            chapter: 'الباب',
            openOnSunnah: 'عرض في sunnah.com',
            copy: 'نسخ الحديث',
            copied: 'تم النسخ',
            modelChecking: 'جارٍ التحقق من نموذج الفهم …',
            modelNeeded: 'البحث يحتاج نموذج الفهم، ولم يبدأ التنزيل بعد',
            modelOff: 'البحث بالمعنى يحتاج نموذج الفهم: تنزيل واحد بحجم {size} ثم يعمل على جهازك بلا اتصال.',
            modelButton: 'تنزيل النموذج',
            modelDialogTitle: 'تنزيل نموذج الفهم',
            modelDialogBody: 'سيُنزّل نموذج الفهم ({size}) مرة واحدة ويُحفظ على جهازك، ثم يعمل البحث بلا اتصال. أسئلتك لا تُرسل إلى أي خادم. يُفضّل الاتصال بشبكة واي فاي.',
            modelDialogYes: 'تنزيل وبدء البحث',
            modelDialogNo: 'لاحقًا',
            modelRuntime: 'جارٍ تجهيز محرّك الفهم …',
            modelFiles: 'جارٍ تنزيل النموذج … {done} من {total} ({percent})',
            modelFilesCached: 'جارٍ قراءة النموذج من جهازك … {percent}',
            modelInit: 'جارٍ تهيئة النموذج على جهازك …',
            modelRetry: 'تعذّر المسار السريع، تنزيل نسخة متوافقة ({size} إضافية) …',
            modelSlow: 'الاتصال بطيء والنموذج ما زال ينزل …',
            modelReady: 'البحث بالمعنى يعمل على جهازك',
            modelFailed: 'تعذّر تشغيل النموذج، ولم يكتمل التنزيل. تحقق من الاتصال ثم أعد المحاولة.',
            modelRetryButton: 'إعادة المحاولة',
            modelPreparing: 'جارٍ تجهيز النموذج …',
            showMore: 'عرض المزيد',
            booksOf: 'كتب',
            hadiths: 'حديثًا',
            noBooks: 'جارٍ التحميل …',
            tabTopics: 'جميع الأبواب',
            browseHint: 'اختر كتابًا لتقرأ أحاديثه',
            topicsHint: 'كل الأبواب المسماة في المجموعات الثلاث في قائمة واحدة.',
            topicsFilter: 'ابحث في الأبواب أو الكتب …',
            topicsNone: 'لا باب يطابق هذا الاسم.',
            topicsWord: 'بابًا',
            fromBookStart: 'من بداية الكتاب',
            back: 'رجوع',
            error: 'حدث خطأ — تحقق من الاتصال وأعد المحاولة.'
        },
        en: {
            title: 'Hadith',
            subtitle: 'Sahih al-Bukhari · Sahih Muslim · Sunan Abi Dawud',
            tabAsk: 'Ask',
            tabBrowse: 'Browse',
            askLabel: 'Ask a question about an Islamic matter',
            askButton: 'Find the hadiths',
            askHint: 'Searches 19,921 hadiths by words and by meaning',
            askPlaceholder: 'e.g. What did the Prophet ﷺ say about anger?',
            related: 'Other related hadiths',
            credits: 'Hadith texts from sunnah.com — Sahih al-Bukhari, Sahih Muslim, Sunan Abi Dawud. Every result shows its reference in the original collection.',
            note: 'This site issues no rulings or opinions; it shows texts and their attribution. Grades shown are Al-Albani\u2019s, exactly as they appear in the source.',
            searching: 'Searching …',
            preparing: 'Loading the index …',
            noResults: 'No hadith clearly matches. Try different words or a shorter question.',
            answerLabel: 'Closest hadith to your question',
            matchedWords: 'matched by words',
            matchedMeaning: 'matched by meaning',
            matchedBoth: 'matched by words and meaning',
            matchedWeak: 'closest results',
            sanad: 'Chain of narration',
            translation: 'Translation',
            grade: 'Grade',
            chapter: 'Chapter',
            openOnSunnah: 'Open on sunnah.com',
            copy: 'Copy hadith',
            copied: 'Copied',
            modelChecking: 'Checking the understanding model …',
            modelNeeded: 'Search needs the understanding model — the download has not started',
            modelOff: 'Meaning search needs the understanding model: one {size} download, then it works on your device without a connection.',
            modelButton: 'Download the model',
            modelDialogTitle: 'Download the understanding model',
            modelDialogBody: 'The understanding model ({size}) is downloaded once and kept on your device; after that search works offline. Your questions are never sent to a server. Wi-Fi is recommended.',
            modelDialogYes: 'Download and search',
            modelDialogNo: 'Later',
            modelRuntime: 'Preparing the understanding engine …',
            modelFiles: 'Downloading the model … {done} of {total} ({percent})',
            modelFilesCached: 'Reading the model from your device … {percent}',
            modelInit: 'Building the model on your device …',
            modelRetry: 'The fast path was unavailable — downloading a compatible copy ({size} more) …',
            modelSlow: 'The connection is slow; the model is still coming …',
            modelReady: 'Meaning search runs on your device',
            modelFailed: 'The model could not start and the download did not finish. Check the connection and try again.',
            modelRetryButton: 'Try again',
            modelPreparing: 'Getting the model ready …',
            showMore: 'Show more',
            booksOf: 'books',
            hadiths: 'hadiths',
            noBooks: 'Loading …',
            tabTopics: 'All topics',
            browseHint: 'Pick a book to read its hadiths',
            topicsHint: 'Every named chapter of the three collections, in one list.',
            topicsFilter: 'Search a topic or a book …',
            topicsNone: 'No topic matches that name.',
            topicsWord: 'topics',
            fromBookStart: 'From the start of the book',
            back: 'Back',
            error: 'Something went wrong — check your connection and try again.'
        }
    };

    let language = 'ar';
    let lastQuestion = '';

    const elements = {
        status: document.getElementById('status'),
        answer: document.getElementById('answer'),
        results: document.getElementById('results'),
        resultsList: document.getElementById('results-list'),
        form: document.getElementById('ask-form'),
        input: document.getElementById('ask-input'),
        meaningText: document.getElementById('meaning-text'),
        meaningButton: document.getElementById('meaning-button'),
        meaningFill: document.getElementById('meaning-fill'),
        dialog: document.getElementById('model-dialog'),
        dialogBody: document.getElementById('model-dialog-body'),
        dialogYes: document.getElementById('model-dialog-yes'),
        dialogNo: document.getElementById('model-dialog-no'),
        browse: document.getElementById('browse'),
        panels: {
            ask: document.getElementById('panel-ask'),
            browse: document.getElementById('panel-browse')
        }
    };

    const html = {
        escape(value) {
            return String(value === undefined || value === null ? '' : value)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        },
        /* Matched words wrapped in <mark>, with the source spelling intact. */
        mark(text, query) {
            const source = String(text || '');
            if (!query) return html.escape(source);
            const ranges = core.highlightRanges(source, query);
            if (!ranges.length) return html.escape(source);
            let out = '';
            let at = 0;
            for (const range of ranges) {
                out += html.escape(source.slice(at, range.start))
                    + '<mark>' + html.escape(source.slice(range.start, range.end)) + '</mark>';
                at = range.end;
            }
            return out + html.escape(source.slice(at));
        }
    };

    /* The whole Arabic text — chain, matn and Quranic quotes — coloured the way
       the source page colours it, with the question's words still marked. */
    function arabicHtml(hadith, question, extraClass) {
        const segments = core.arabicSegments(hadith);
        if (!segments.length) return '';
        const body = segments.map(segment => {
            const className = segment.kind === 'sanad' ? 'ar-sanad'
                : segment.kind === 'quran' ? 'ar-quran' : 'ar-matn';
            return `<span class="${className}">${html.mark(segment.text, question)}</span>`;
        }).join(' ');
        const classes = `arabic${extraClass ? ' ' + extraClass : ''}`;
        return `<p class="${classes}" dir="rtl" lang="ar">${body}</p>`;
    }

    /* What to highlight in a result: the words the search engine kept as
       discriminating, not the whole question (which is mostly words like
       الله and صلى that appear in nearly every hadith). */
    function highlightQuery(entry) {
        return entry && entry.highlightTerms && entry.highlightTerms.length
            ? entry.highlightTerms.join(' ')
            : '';
    }

    function t(key) {
        return (STRINGS[language] && STRINGS[language][key]) || STRINGS.ar[key] || key;
    }

    function applyLanguage() {
        document.documentElement.lang = language;
        document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
        for (const element of document.querySelectorAll('[data-ui]')) {
            element.textContent = t(element.dataset.ui);
        }
        for (const element of document.querySelectorAll('[data-ui-placeholder]')) {
            element.placeholder = t(element.dataset.uiPlaceholder);
        }
        document.getElementById('language-button').textContent = language === 'ar' ? 'EN' : 'ع';
        renderMeaningBar();
    }

    /* ------------------------------------------------------------- theme --- */

    function applyTheme(next) {
        document.documentElement.setAttribute('data-theme', next);
        document.getElementById('theme-button').textContent = next === 'dark' ? '☾' : '☀';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', next === 'dark' ? '#0a0f10' : '#f7f5ef');
        try { localStorage.setItem('hadith-theme', next); } catch (error) { /* ignore */ }
    }

    /* --------------------------------------------------------- rendering --- */

    function collectionName(id) {
        const catalog = app.catalog;
        if (!catalog) return id;
        const entry = catalog.collections.find(item => item.id === id);
        return entry ? (language === 'ar' ? entry.arabic : entry.english) : id;
    }

    function referenceChips(hadith) {
        const chips = [];
        chips.push(`<span class="chip chip--accent">${html.escape(hadith.ref || hadith.slug)}</span>`);
        if (hadith.inBookRef) chips.push(`<span class="chip">${html.escape(hadith.inBookRef)}</span>`);
        if (hadith.chapter) {
            const name = language === 'ar' ? hadith.chapter.ar : hadith.chapter.en;
            const number = language === 'ar'
                ? (hadith.chapter.nAr || hadith.chapter.n)
                : (hadith.chapter.n || hadith.chapter.nAr);
            if (name) chips.push(`<span class="chip">${html.escape(t('chapter'))} ${html.escape(number || '')}: ${html.escape(name)}</span>`);
        }
        const grade = language === 'ar'
            ? (hadith.gradeAr || hadith.grade)
            : (hadith.grade || hadith.gradeAr);
        if (grade) chips.push(`<span class="chip">${html.escape(t('grade'))}: ${html.escape(grade)}</span>`);
        return chips.join('');
    }

    function whyMatched(entry) {
        const parts = [];
        if (entry.lexicalRank && entry.vectorRank) parts.push(t('matchedBoth'));
        else if (entry.lexicalRank) parts.push(t('matchedWords'));
        else if (entry.vectorRank) parts.push(t('matchedMeaning'));
        else parts.push(t('matchedWeak'));
        const words = (entry.highlightTerms && entry.highlightTerms.length)
            ? entry.highlightTerms
            : (entry.terms || []);
        if (words.length) {
            parts.push(words.slice(0, 6).map(term => html.escape(term)).join('، '));
        }
        return parts.join(' — ');
    }

    /* The answer: the hadith itself, nothing summarised, nothing invented. */
    function renderAnswer(hadith, question, confidence) {
        const fullArabic = hadith.ar
            ? [hadith.ar.sanad, hadith.ar.matn].filter(Boolean).join(' ')
            : '';
        const labels = { strong: t('matchedBoth'), good: t('matchedBoth'), fair: t('matchedWords'), weak: t('matchedWeak'), none: t('matchedWeak') };

        elements.answer.innerHTML = [
            `<div class="answer__head">`,
            `<span class="chip">${html.escape(t('answerLabel'))}</span>`,
            `<span class="chip chip--accent">${html.escape(labels[confidence] || '')}</span>`,
            `</div>`,
            `<div class="answer__head">${referenceChips(hadith)}</div>`,
            hadith.narrator ? `<p class="narrator" dir="ltr">${html.escape(hadith.narrator)}</p>` : '',
            arabicHtml(hadith, question),
            hadith.en ? `<p class="english" dir="ltr">${html.mark(hadith.en, question)}</p>` : '',
            `<div class="answer__foot">`,
            hadith.url ? `<a href="${html.escape(hadith.url)}" target="_blank" rel="noopener">${html.escape(t('openOnSunnah'))}</a>` : '',
            `<button type="button" class="btn btn--ghost" id="copy-button">${html.escape(t('copy'))}</button>`,
            `</div>`
        ].join('');
        elements.answer.hidden = false;

        const copy = document.getElementById('copy-button');
        if (copy) {
            copy.addEventListener('click', async () => {
                const text = [fullArabic, hadith.en, `${hadith.ref} — ${hadith.url || ''}`]
                    .filter(Boolean).join('\n\n');
                try {
                    await navigator.clipboard.writeText(text);
                    copy.textContent = t('copied');
                    setTimeout(() => { copy.textContent = t('copy'); }, 1600);
                } catch (error) { /* clipboard may be blocked */ }
            });
        }
    }

    /* Collections in the order readers expect to meet them: the two Sahihs
       first, then the Sunan. Ranking inside a collection is untouched — this
       decides the sections, not which hadith is best. */
    const COLLECTION_ORDER = ['bukhari', 'muslim', 'abudawud'];

    function resultCard(entry) {
        const hadith = entry.hadith;
        const highlight = highlightQuery(entry);
        return [
            `<article class="result">`,
            `<div class="result__head">${referenceChips(hadith)}</div>`,
            hadith.narrator ? `<p class="narrator" dir="ltr">${html.escape(hadith.narrator)}</p>` : '',
            arabicHtml(hadith, highlight),
            hadith.en ? `<p class="english english--muted" dir="ltr">${html.mark(hadith.en, highlight)}</p>` : '',
            `<div class="result__why">${whyMatched(entry)}`,
            hadith.url ? ` — <a href="${html.escape(hadith.url)}" target="_blank" rel="noopener">${html.escape(t('openOnSunnah'))}</a>` : '',
            `</div>`,
            `</article>`
        ].join('');
    }

    function renderResults(entries) {
        const groups = new Map();
        for (const entry of entries) {
            const collection = (entry.hadith && entry.hadith.collection) || 'other';
            if (!groups.has(collection)) groups.set(collection, []);
            groups.get(collection).push(entry);
        }
        const order = [
            ...COLLECTION_ORDER.filter(id => groups.has(id)),
            ...[...groups.keys()].filter(id => !COLLECTION_ORDER.includes(id))
        ];
        elements.resultsList.innerHTML = order.map(id => {
            const list = groups.get(id);
            const heading = `<h3 class="results-group">${html.escape(collectionName(id))}`
                + `<span class="chip">${list.length.toLocaleString(language === 'ar' ? 'ar-EG' : 'en')}</span></h3>`;
            return heading + list.map(resultCard).join('');
        }).join('');
        elements.results.hidden = entries.length === 0;
    }

    function setStatus(message, isError) {
        elements.status.textContent = message || '';
        elements.status.className = isError ? 'status status--error' : 'status';
    }

    /* --------------------------------------------------------------- ask --- */

    async function ask(question) {
        const trimmed = String(question || '').trim();
        if (trimmed.length < 3) return;
        lastQuestion = trimmed;
        elements.answer.hidden = true;
        /* No model, no search: the download comes first, and it never starts
           without its size having been said out loud. */
        if (modelState !== 'ready') {
            setStatus(t('modelPreparing'));
            const ready = await ensureModel();
            if (!ready) {
                setStatus(modelState === 'failed' ? t('modelFailed') : t('modelNeeded'), true);
                return;
            }
        }
        setStatus(t('searching'));
        try {
            /* The catalogue names the collections in the result headings. */
            await app.start();
            const outcome = await app.ask(trimmed, { limit: RESULTS_LIMIT });
            if (!outcome.results.length) {
                setStatus(t('noResults'));
                elements.results.hidden = true;
                return;
            }
            setStatus('');
            renderAnswer(outcome.results[0].hadith, highlightQuery(outcome.results[0]), outcome.confidence);
            renderResults(outcome.results.slice(1));
        } catch (error) {
            setStatus(`${t('error')} (${error.message})`, true);
        }
    }

    /* -------------------------------------------------------------- model ---
       Search is words + meaning, so it needs the model: nothing is searched
       until the model is on the device, and no download ever starts without
       saying how big it is first. The states a reader can meet:

         checking → is it already here?      (the browser cache, no network)
         off      → not here: state the size, wait for a yes
         active   → downloading / reading / building, with a bar that counts
         ready    → every search now runs on the device, offline included
         failed   → the download did not finish; offer to try again

       The bar counts real bytes against the sizes in search.js's table: the
       whole download, not whichever file happens to be moving at the moment. */

    const MODEL_FILES = window.HadithSearchApp.MODEL_FILES;

    let modelState = 'checking';
    let modelStage = '';
    let modelSlow = false;
    let modelShare = 0;
    let modelLoaded = 0;
    let modelTotal = 0;
    let modelPlan = 'wasm';
    let modelBytes = 0;
    let modelCached = false;
    let modelWait = null;
    let bootstrap = null;
    let barTimer = 0;

    function num(value) {
        return Number(value).toLocaleString(language === 'ar' ? 'ar-EG' : 'en');
    }

    function sizeText(bytes) {
        const amount = num(Math.round((bytes || 0) / 1e6));
        return language === 'ar' ? `${amount} م.ب` : `${amount} MB`;
    }

    function percentText(share) {
        return num(Math.round(share * 100)) + (language === 'ar' ? '٪' : '%');
    }

    function fill(template, values) {
        let text = template;
        for (const key of Object.keys(values)) text = text.split(`{${key}}`).join(values[key]);
        return text;
    }

    function modelText() {
        if (modelState === 'checking') return t('modelChecking');
        if (modelState === 'off') return fill(t('modelOff'), { size: sizeText(modelBytes) });
        if (modelState === 'ready') return t('modelReady');
        if (modelState === 'failed') return t('modelFailed');
        if (modelState !== 'active') return '';
        let text;
        if (modelStage === 'runtime') text = t('modelRuntime');
        else if (modelStage === 'init') text = t('modelInit');
        else if (modelStage === 'retry') {
            /* The fast path failed and the smaller copy is on its way: say what
               it adds, because it does add bytes. */
            const extra = modelPlan === 'webgpu' ? MODEL_FILES.weights.wasm.size : 0;
            text = fill(t('modelRetry'), { size: sizeText(extra) });
        } else {
            text = fill(modelCached ? t('modelFilesCached') : t('modelFiles'), {
                done: sizeText(modelLoaded),
                total: sizeText(modelTotal || modelBytes),
                percent: percentText(modelShare)
            });
        }
        return modelSlow ? `${text} — ${t('modelSlow')}` : text;
    }

    function renderMeaningBar() {
        let share = 0;
        if (modelState === 'checking') share = 6;
        else if (modelState === 'active') share = Math.max(6, Math.min(96, modelShare * 100));
        else if (modelState === 'ready') share = 100;
        elements.meaningFill.style.width = `${share}%`;
        elements.meaningFill.classList.toggle('is-pulse', modelState === 'active');
        elements.meaningText.textContent = modelText();
        const askable = modelState === 'off' || modelState === 'failed';
        elements.meaningButton.hidden = !askable;
        if (askable) {
            elements.meaningButton.textContent = modelState === 'failed' ? t('modelRetryButton') : t('modelButton');
        }
    }

    /* Progress arrives in bursts (a hundred a second from a big file); repaint
       on a timer instead, so the bar moves smoothly and the page stays still. */
    function scheduleBar() {
        if (barTimer) return;
        barTimer = setTimeout(() => {
            barTimer = 0;
            renderMeaningBar();
        }, 120);
    }

    async function activateModel() {
        if (modelState === 'ready') return true;
        if (modelWait) return modelWait;
        modelState = 'active';
        modelStage = 'runtime';
        modelSlow = false;
        modelShare = 0;
        modelLoaded = 0;
        modelTotal = modelBytes;
        renderMeaningBar();
        modelWait = (async () => {
            const ok = await app.enableMeaning({ prefer: modelPlan });
            modelWait = null;
            modelState = ok ? 'ready' : 'failed';
            if (ok) {
                modelStage = '';
                modelShare = 1;
            }
            renderMeaningBar();
            return ok;
        })();
        return modelWait;
    }

    function askToDownload() {
        const body = fill(t('modelDialogBody'), { size: sizeText(modelBytes) });
        if (!elements.dialog || typeof elements.dialog.showModal !== 'function') {
            return Promise.resolve(window.confirm(body));
        }
        elements.dialogBody.textContent = body;
        return new Promise(resolve => {
            let answered = false;
            const finish = answer => {
                if (answered) return;
                answered = true;
                elements.dialogYes.removeEventListener('click', onYes);
                elements.dialogNo.removeEventListener('click', onNo);
                elements.dialog.removeEventListener('cancel', onCancel);
                elements.dialog.close();
                resolve(answer);
            };
            const onYes = () => finish(true);
            const onNo = () => finish(false);
            const onCancel = event => {
                event.preventDefault();
                finish(false);
            };
            elements.dialogYes.addEventListener('click', onYes);
            elements.dialogNo.addEventListener('click', onNo);
            elements.dialog.addEventListener('cancel', onCancel);
            elements.dialog.showModal();
        });
    }

    /* The one gate every search goes through: true means the model is on the
       device and the question may be embedded. Never starts a download without
       the size warning having been answered. */
    async function ensureModel() {
        if (bootstrap) await bootstrap;
        if (modelState === 'ready') return true;
        if (modelState === 'active') return Boolean(await modelWait);
        if (modelState === 'failed') return activateModel();   // a retry button is an answer
        if (modelCached) return activateModel();
        return (await askToDownload()) ? activateModel() : false;
    }

    /* ------------------------------------------------------------- browse --- */

    /* Four tabs: the three collections, each listing its own books, and one list
       of every named chapter of all three. That list is built offline
       (index/topics.json.gz — 7,151 topics in 386 KB) so the browser never has
       to read 35 MB of book files just to name the chapters. */
    const BROWSE_TABS = ['bukhari', 'muslim', 'abudawud', 'topics'];
    let browseTab = 'bukhari';
    let browseStack = [];        // [] | [[collection, book, chapter|null]]
    let topicQuery = '';

    function go(hash) {
        if (location.hash === hash) route();
        else location.hash = hash;
    }

    function tabBar(active) {
        return `<div class="subtabs" role="tablist">` + BROWSE_TABS.map(id => [
            `<button type="button" role="tab" aria-selected="${id === active}"`,
            ` class="subtab${id === active ? ' is-active' : ''}" data-browse-tab="${id}">`,
            `${html.escape(id === 'topics' ? t('tabTopics') : collectionName(id))}</button>`
        ].join('')).join('') + `</div>`;
    }

    /* The same normalisation the search uses, so «الأيمان» finds «باب الأيمان»
       and «kitab» finds «Kitab al-Iman». */
    function normalizeText(text) {
        return String(text || '').toLowerCase().split(/\s+/)
            .map(word => core.normalizeArabicWord(word) || core.normalizeEnglishWord(word))
            .filter(Boolean)
            .join(' ');
    }

    function collectionOf(id) {
        return app.catalog ? app.catalog.collections.find(item => item.id === id) : null;
    }

    function bookNameOf(collectionId, bookNumber) {
        const collection = collectionOf(collectionId);
        const book = collection && collection.books.find(item => item.number === Number(bookNumber));
        return book ? (language === 'ar' ? book.arabic : book.english) : '';
    }

    function renderBrowseTabs(active) {
        const bar = document.createElement('div');
        bar.innerHTML = tabBar(active);
        elements.browse.appendChild(bar);
    }

    function renderBooks(collectionId) {
        const collection = collectionOf(collectionId);
        if (!collection) return;
        const section = document.createElement('section');
        section.innerHTML = [
            `<p class="status">${html.escape(t('browseHint'))}`,
            ` <span class="chip">${num(collection.books.length)} ${html.escape(t('booksOf'))}</span>`,
            ` <span class="chip">${num(collection.hadiths)} ${html.escape(t('hadiths'))}</span></p>`,
            `<div class="books">`,
            collection.books.map(book => [
                `<button type="button" class="book" data-book="${html.escape(collection.id)}/${book.number}">`,
                `<strong>${html.escape(language === 'ar' ? book.arabic : book.english)}</strong>`,
                `<span>${html.escape(t('booksOf'))} ${book.number} · ${num(book.hadiths)} ${html.escape(t('hadiths'))}</span>`,
                `</button>`
            ].join('')).join(''),
            `</div>`
        ].join('');
        elements.browse.appendChild(section);
    }

    /* Every named chapter of the three collections, filterable by topic, book or
       collection, opening the hadiths of the one that is chosen. */
    async function renderTopics() {
        const holder = document.createElement('div');
        holder.innerHTML = `<p class="status">${html.escape(t('noBooks'))}</p>`;
        elements.browse.appendChild(holder);

        let data;
        try {
            data = await app.topics();
        } catch (error) {
            holder.innerHTML = `<p class="status status--error">${html.escape(t('error'))}</p>`;
            return;
        }
        holder.remove();

        const head = document.createElement('div');
        head.className = 'topics__head';
        head.innerHTML = `<p class="status">${html.escape(t('topicsHint'))} <span class="chip" id="topics-count"></span></p>`;
        const count = head.querySelector('#topics-count');

        const filter = document.createElement('input');
        filter.type = 'search';
        filter.id = 'topics-filter';
        filter.className = 'topics__filter';
        filter.placeholder = t('topicsFilter');
        filter.setAttribute('aria-label', t('topicsFilter'));
        filter.value = topicQuery;

        const list = document.createElement('div');
        list.className = 'topics';
        const empty = document.createElement('p');
        empty.className = 'status';
        empty.textContent = t('topicsNone');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'btn';
        more.textContent = t('showMore');

        /* Normalised once per topic, then reused for every keystroke. */
        function keyOf(topic) {
            if (!topic.key) {
                topic.key = normalizeText([
                    topic.ar, topic.en,
                    bookNameOf(topic.collection, topic.book),
                    collectionName(topic.collection)
                ].join(' '));
            }
            return topic.key;
        }

        let matches = [];
        let shown = 0;

        function renderChunk() {
            for (const topic of matches.slice(shown, shown + BROWSE_CHUNK)) {
                const name = (language === 'ar' ? (topic.ar || topic.en) : (topic.en || topic.ar))
                    .replace(/^باب\s+/, '');
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'topic';
                item.dataset.topic = `${topic.collection}/${topic.book}/${topic.chapter}`;
                item.innerHTML = [
                    `<span class="topic__n">${html.escape(num(topic.n))}</span>`,
                    `<span class="topic__name">${html.escape(name)}`,
                    `<span class="topic__meta">`,
                    `<span class="chip chip--accent">${html.escape(collectionName(topic.collection))}</span>`,
                    `<span class="chip">${html.escape(bookNameOf(topic.collection, topic.book))}</span>`,
                    topic.hadiths ? `<span class="chip">${html.escape(num(topic.hadiths))} ${html.escape(t('hadiths'))}</span>` : '',
                    `</span></span>`
                ].join('');
                list.appendChild(item);
            }
            shown += Math.min(BROWSE_CHUNK, matches.length - shown);
            more.hidden = shown >= matches.length;
            empty.hidden = matches.length > 0;
        }

        function apply(value) {
            topicQuery = value;
            const needle = normalizeText(value);
            matches = needle ? data.topics.filter(topic => keyOf(topic).includes(needle)) : data.topics;
            shown = 0;
            list.innerHTML = '';
            count.textContent = `${num(matches.length)} ${t('topicsWord')}`;
            renderChunk();
        }

        filter.addEventListener('input', () => apply(filter.value));
        more.addEventListener('click', renderChunk);
        elements.browse.append(head, filter, list, more, empty);
        apply(topicQuery);
    }

    async function renderBrowse() {
        if (!app.catalog) {
            elements.browse.innerHTML = `<p class="status">${html.escape(t('noBooks'))}</p>`;
            try {
                await app.start();
            } catch (error) {
                elements.browse.innerHTML = `<p class="status status--error">${html.escape(t('error'))}</p>`;
                return;
            }
        }
        elements.browse.innerHTML = '';
        if (browseStack.length) {
            renderBrowseTabs(browseStack[0][0]);
            await renderBook(browseStack[0][0], browseStack[0][1], browseStack[0][2]);
            return;
        }
        renderBrowseTabs(browseTab);
        if (browseTab === 'topics') await renderTopics();
        else renderBooks(browseTab);
    }

    /* One book, read chapter by chapter. Arriving from a topic starts at that
       chapter; otherwise the book opens at its first hadith. */
    async function renderBook(collectionId, bookNumber, chapter) {
        const body = document.createElement('div');
        body.innerHTML = `<p class="status">${html.escape(t('noBooks'))}</p>`;
        elements.browse.appendChild(body);
        const page = await app.bookOf(collectionId, Number(bookNumber));
        const startAt = chapter === null || chapter === undefined
            ? 0
            : Math.max(0, page.hadiths.findIndex(hadith => hadith.ch === chapter));
        let shown = startAt;
        const list = document.createElement('div');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'btn';
        more.textContent = t('showMore');

        function renderChunk() {
            const slice = page.hadiths.slice(shown, shown + BROWSE_CHUNK);
            let lastChapter = shown > 0 ? page.hadiths[shown - 1].ch : -2;
            for (const hadith of slice) {
                if (hadith.ch !== lastChapter && hadith.ch >= 0 && page.chapters[hadith.ch]) {
                    const heading = page.chapters[hadith.ch];
                    const name = language === 'ar' ? heading.ar : heading.en;
                    if (name) {
                        const title = document.createElement('h2');
                        title.className = 'results-meta';
                        title.textContent = name;
                        list.appendChild(title);
                    }
                }
                lastChapter = hadith.ch;
                const card = document.createElement('article');
                card.className = 'result';
                card.innerHTML = [
                    `<div class="result__head">${referenceChips(hadith)}</div>`,
                    hadith.narrator ? `<p class="narrator" dir="ltr">${html.escape(hadith.narrator)}</p>` : '',
                    arabicHtml(hadith, ''),
                    hadith.en ? `<p class="english english--muted" dir="ltr">${html.escape(hadith.en)}</p>` : '',
                    hadith.url ? `<div class="result__why"><a href="${html.escape(hadith.url)}" target="_blank" rel="noopener">${html.escape(t('openOnSunnah'))}</a></div>` : ''
                ].join('');
                list.appendChild(card);
            }
            shown += slice.length;
            more.hidden = shown >= page.hadiths.length;
        }

        const opened = startAt > 0 ? page.chapters[page.hadiths[startAt].ch] : null;
        const header = document.createElement('div');
        header.className = 'browse__head';
        header.innerHTML = [
            `<h2 class="results-meta">${html.escape(language === 'ar' ? page.book.arabic : page.book.english)}`,
            ` <span class="chip">${html.escape(collectionName(collectionId))}</span></h2>`,
            opened ? `<p class="status">${html.escape(t('chapter'))} ${html.escape(num(opened.nAr || opened.n))}: `
                + `${html.escape(language === 'ar' ? (opened.ar || opened.en) : (opened.en || opened.ar))}</p>` : '',
            `<div class="browse__actions">`,
            startAt > 0 ? `<button type="button" class="btn btn--ghost" data-book-start>${html.escape(t('fromBookStart'))}</button>` : '',
            `<button type="button" class="btn btn--ghost" data-browse-back>${html.escape(t('back'))}</button>`,
            `</div>`
        ].join('');
        body.innerHTML = '';
        body.append(header, list, more);
        more.addEventListener('click', renderChunk);
        renderChunk();
    }

    /* ------------------------------------------------------------ routing --- */

    function showTab(name) {
        for (const key of Object.keys(elements.panels)) {
            elements.panels[key].hidden = key !== name;
        }
        for (const tab of document.querySelectorAll('.tab')) {
            tab.classList.toggle('is-active', tab.dataset.tab === name);
        }
        if (name === 'browse') renderBrowse();
    }

    function route() {
        const hash = location.hash.replace(/^#\/?/, '');
        const parts = hash.split('/').filter(Boolean);
        if (parts[0] === 'browse') {
            if (parts.length >= 3) {
                const chapter = parts.length >= 4 ? Number(parts[3]) : NaN;
                browseStack = [[parts[1], parts[2], Number.isFinite(chapter) ? chapter : null]];
            } else {
                browseStack = [];
                if (BROWSE_TABS.includes(parts[1])) browseTab = parts[1];
            }
            showTab('browse');
            return;
        }
        showTab('ask');
    }

    /* --------------------------------------------------------------- wire --- */

    try {
        language = localStorage.getItem('hadith-language') || 'ar';
    } catch (error) { /* ignore */ }
    applyLanguage();
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    renderMeaningBar();
    /* Fetching the catalogue now makes the first answer's headings named and
       the browse tab instant; a failure here is not worth reporting. */
    app.start().catch(() => { });

    /* The model is required, so look for it at once: if this device already has
       the files, switch it on without asking anything (nothing will be
       downloaded); if it does not, stop here — the size warning comes first. */
    bootstrap = (async () => {
        let info = null;
        try {
            info = await app.inspectModel();
        } catch (error) {
            info = null;
        }
        if (info) {
            modelPlan = info.plan;
            modelBytes = info.bytes;
            modelCached = info.cached;
        } else {
            /* Could not read the cache at all: warn with the smaller plan. */
            modelBytes = MODEL_FILES.shared.reduce((sum, item) => sum + item.size, MODEL_FILES.runtime)
                + MODEL_FILES.weights.wasm.size;
        }
        if (info && info.cached) return activateModel();
        modelState = 'off';
        renderMeaningBar();
        return false;
    })();

    elements.form.addEventListener('submit', event => {
        event.preventDefault();
        ask(elements.input.value);
    });
    elements.meaningButton.addEventListener('click', async () => {
        const ready = await ensureModel();
        if (ready && lastQuestion) await ask(lastQuestion);
    });
    document.getElementById('theme-button').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
    });
    document.getElementById('language-button').addEventListener('click', () => {
        language = language === 'ar' ? 'en' : 'ar';
        try { localStorage.setItem('hadith-language', language); } catch (error) { /* ignore */ }
        applyLanguage();
        if (lastQuestion) ask(lastQuestion);
        if (!elements.panels.browse.hidden) renderBrowse();
    });
    for (const tab of document.querySelectorAll('.tab')) {
        tab.addEventListener('click', () => {
            location.hash = tab.dataset.tab === 'browse' ? '#browse' : '';
            showTab(tab.dataset.tab);
        });
    }
    document.getElementById('browse').addEventListener('click', event => {
        const tab = event.target.closest('[data-browse-tab]');
        if (tab) {
            go(`#browse/${tab.dataset.browseTab}`);
            return;
        }
        const book = event.target.closest('[data-book]');
        if (book) {
            go(`#browse/${book.dataset.book}`);
            return;
        }
        const topic = event.target.closest('[data-topic]');
        if (topic) {
            go(`#browse/${topic.dataset.topic}`);
            return;
        }
        if (event.target.closest('[data-book-start]')) {
            const where = browseStack[0] || [];
            go(`#browse/${where[0]}/${where[1]}`);
            return;
        }
        if (event.target.closest('[data-browse-back]')) {
            const where = browseStack[0] || [];
            go(where[0] ? `#browse/${where[0]}` : '#browse');
        }
    });
    window.addEventListener('hashchange', route);

    app.onModelEvent = message => {
        if (!message) return;
        if (message.type === 'status') {
            if (message.stage === 'slow') {
                modelSlow = true;               // the stage stays; the text gains a note
            } else {
                modelSlow = false;
                if (message.stage === 'runtime') {
                    modelPlan = message.device === 'wasm' ? 'wasm' : 'webgpu';
                }
                if (message.stage === 'retry') {
                    /* The fast path failed and the fallback file is one this
                       device has never read: it is a download again. */
                    modelCached = false;
                }
                modelStage = message.stage || modelStage;
            }
            scheduleBar();
            return;
        }
        if (message.type === 'progress') {
            modelSlow = false;
            modelLoaded = message.loaded || 0;
            modelTotal = message.total || modelTotal;
            modelShare = message.share || 0;
            if (modelStage !== 'init') modelStage = 'files';
            scheduleBar();
            return;
        }
        if (message.type === 'ready') {
            modelState = 'ready';
            modelStage = '';
            modelShare = 1;
            renderMeaningBar();
        }
    };

    route();
}());
