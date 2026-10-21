/* TEK-INW — podkład PDF: odczyt i rysowanie stron biblioteką pdf.js (Mozilla, licencja Apache 2.0) — ta sama wersja co w TEK-AUDYTOR.
   Strategia rysowania na iPadzie: płótno ma limit pikseli, więc
   (1) raz rysujemy całą stronę w umiarkowanej rozdzielczości („obraz bazowy”, do ok. 10 mln pikseli),
   (2) po przybliżeniu dorysowujemy w pełnej ostrości tylko widoczny fragment („obraz szczegółu”). */
'use strict';

const PdfPodklad = (() => {
  let lib = null; const dokumenty = new Map();
  const url = (p) => new URL(p, document.baseURI).href;
  async function laduj() {
    if (lib) return lib;
    lib = await import(url('vendor/pdfjs/pdf.min.mjs'));
    lib.GlobalWorkerOptions.workerSrc = url('vendor/pdfjs/pdf.worker.min.mjs');
    return lib;
  }
  async function otworz(plikId, buf) {
    if (dokumenty.has(plikId)) return dokumenty.get(plikId);
    const l = await laduj();
    const zad = l.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, verbosity: 0,
      standardFontDataUrl: url('vendor/pdfjs/standard_fonts/'), wasmUrl: url('vendor/pdfjs/wasm/'), useSystemFonts: false });
    const doc = await zad.promise; dokumenty.set(plikId, doc); return doc;
  }
  function zamknij(plikId) { const d = dokumenty.get(plikId); if (d) { d.destroy(); dokumenty.delete(plikId); } }
  async function strona(doc, nr) { return doc.getPage(nr); }
  function wymiary(page) { const v = page.getViewport({ scale: 1 }); return { w: v.width, h: v.height, obrot: page.rotate || 0, view: page.view.slice(), transform: v.transform.slice() }; }

  async function rysuj(page, skala, x0, y0, w, h, zadania) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const g = c.getContext('2d', { alpha: false }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const vp = page.getViewport({ scale: skala, offsetX: -x0 * skala, offsetY: -y0 * skala });
    const t = page.render({ canvas: c, canvasContext: g, viewport: vp, background: '#ffffff', annotationMode: 0 });
    if (zadania) zadania.push(t);
    await t.promise; return c;
  }
  async function obrazBazowy(page, maxPx = 10e6) {
    const { w, h } = wymiary(page);
    const s = Math.min(Math.sqrt(maxPx / (w * h)), 8192 / Math.max(w, h), 6);
    const c = await rysuj(page, s, 0, 0, w * s, h * s);
    return { canvas: c, skala: s };
  }
  async function miniatura(page, px = 360) { const { w, h } = wymiary(page); const s = px / Math.max(w, h); return rysuj(page, s, 0, 0, w * s, h * s); }
  return { laduj, otworz, zamknij, strona, wymiary, rysuj, obrazBazowy, miniatura };
})();
