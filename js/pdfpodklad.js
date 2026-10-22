/* TEK-INW — podkład PDF (wersja 0.2: także punkty przyciągania z wektorów PDF): odczyt i rysowanie stron biblioteką pdf.js (Mozilla, licencja Apache 2.0) — ta sama wersja co w TEK-AUDYTOR.
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
  function zamknij(plikId) { // zwolnienie pamięci; w pdf.js 6 dokument zamyka się przez zadanie wczytania (loadingTask)
    const d = dokumenty.get(plikId); if (!d) return; dokumenty.delete(plikId);
    try { if (typeof d.destroy === 'function') d.destroy(); else if (d.loadingTask) d.loadingTask.destroy(); } catch (e) { console.warn(e); }
  }
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
  /* Punkty przyciągania z wektorowego PDF (np. wydruk z ZWCAD): wierzchołki ścieżek + skrzyżowania długich odcinków.
     pdf.js podaje listę poleceń rysowania strony; śledzimy macierz przekształceń (save/restore/transform), żeby punkty
     trafiły w układ arkusza. Skan (obraz) nie ma wektorów — wtedy punktów nie będzie. */
  async function punktySnap(page) {
    const l = await laduj(), O = l.OPS, vp = page.getViewport({ scale: 1 });
    const ol = await page.getOperatorList();
    const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
    let M = vp.transform.slice(); const stos = [], pkt = [], odc = [], widziane = new Set(); const LIMIT = 600000;
    const dodaj = (x, y) => { const k = Math.round(x * 20) + ',' + Math.round(y * 20); if (widziane.has(k)) return; widziane.add(k); pkt.push([x, y]); };
    for (let i = 0; i < ol.fnArray.length && pkt.length < LIMIT; i++) {
      const f = ol.fnArray[i], a = ol.argsArray[i];
      if (f === O.save) stos.push(M); else if (f === O.restore) M = stos.pop() || M;
      else if (f === O.transform) M = mul(M, a);
      else if (f === O.paintFormXObjectBegin) { stos.push(M); if (a && a[0]) M = mul(M, a[0]); }
      else if (f === O.paintFormXObjectEnd) M = stos.pop() || M;
      else if (f === O.constructPath) {
        const d = a && a[1] && a[1][0]; if (!d || !d.length) continue;
        let px = null, py = null, sx = null, sy = null;
        for (let k = 0; k < d.length;) {
          const c = d[k++]; let x, y;
          if (c === 0 || c === 1) { x = d[k++]; y = d[k++]; }
          else if (c === 2) { k += 4; x = d[k++]; y = d[k++]; }
          else if (c === 3) { k += 2; x = d[k++]; y = d[k++]; }
          else if (c === 4) { if (px !== null && sx !== null) odc.push([[px, py], [sx, sy]]); px = sx; py = sy; continue; }
          else break;
          const X = M[0] * x + M[2] * y + M[4], Y = M[1] * x + M[3] * y + M[5];
          dodaj(X, Y);
          if (c === 1 && px !== null) odc.push([[px, py], [X, Y]]);
          if (c === 0) { sx = X; sy = Y; }
          px = X; py = Y;
        }
      }
    }
    const rozp = Math.max(vp.width, vp.height);
    const dlugie = odc.filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > rozp / 40).sort((u, v) => Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1]) - Math.hypot(u[1][0] - u[0][0], u[1][1] - u[0][1])).slice(0, 1500);
    for (let i = 0; i < dlugie.length; i++) for (let j = i + 1; j < dlugie.length; j++) { const p = Geom.przeciecie(dlugie[i][0], dlugie[i][1], dlugie[j][0], dlugie[j][1]); if (p) dodaj(p[0], p[1]); }
    return { indeks: Geom.indeksPunktow(pkt, rozp / 150), ile: pkt.length, pelny: pkt.length >= LIMIT };
  }
  return { laduj, otworz, zamknij, strona, wymiary, rysuj, obrazBazowy, miniatura, punktySnap };
})();
