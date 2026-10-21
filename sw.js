/* TEK-INW — service worker (plik generowany przez zrodla/build.py — nie edytować ręcznie).
   Zapisuje pliki aplikacji w pamięci urządzenia przy pierwszym uruchomieniu; potem aplikacja działa bez internetu.
   Nowa wersja = nowa nazwa pamięci (tek-inw-0.1.0); stara jest usuwana po aktywacji. */
const CACHE = 'tek-inw-0.1.0';
const PLIKI = [
"./",
"css/baza.css",
"css/inw.css",
"fonts/IBMPlexMono-Medium.woff2",
"fonts/IBMPlexMono-Regular.woff2",
"fonts/IBMPlexMono_500Medium.ttf",
"fonts/IBMPlexSans-Medium.woff2",
"fonts/IBMPlexSans-Regular.woff2",
"fonts/IBMPlexSans-SemiBold.woff2",
"fonts/IBMPlexSans_400Regular.ttf",
"fonts/IBMPlexSans_600SemiBold.ttf",
"icons/favicon.svg",
"icons/icon-180.png",
"icons/icon-192.png",
"icons/icon-512.png",
"index.html",
"js/app.js",
"js/baza.js",
"js/dxf.js",
"js/eksport.js",
"js/geom.js",
"js/logo.js",
"js/narzedzia.js",
"js/pdfpodklad.js",
"js/plan.js",
"js/wersja.js",
"manifest.webmanifest",
"przyklad/hala_demo.dxf",
"przyklad/hala_demo_A1.pdf",
"vendor/dxf-parser.js",
"vendor/fflate.min.js",
"vendor/fontkit.umd.min.js",
"vendor/pdf-lib.min.js",
"vendor/pdfjs/pdf.min.mjs",
"vendor/pdfjs/pdf.worker.min.mjs",
"vendor/pdfjs/standard_fonts/FoxitDingbats.pfb",
"vendor/pdfjs/standard_fonts/FoxitFixed.pfb",
"vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb",
"vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
"vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
"vendor/pdfjs/standard_fonts/FoxitSerif.pfb",
"vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb",
"vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
"vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
"vendor/pdfjs/standard_fonts/FoxitSymbol.pfb",
"vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
"vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
"vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
"vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
"vendor/pdfjs/wasm/jbig2.wasm",
"vendor/pdfjs/wasm/openjpeg.wasm",
"vendor/pdfjs/wasm/qcms_bg.wasm"
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PLIKI))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith('tek-inw-') && n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener('message', (e) => { if (e.data && e.data.typ === 'aktywuj') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.endsWith('/version.json')) return; // zawsze z sieci
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).catch(() => e.request.mode === 'navigate' ? caches.match('./') : Response.error())));
});
