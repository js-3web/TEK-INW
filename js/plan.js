/* TEK-INW — widok planu: wyświetlanie podkładu, przesuwanie i przybliżanie, znaczniki, narzędzia rysunkowe.

   Jak to działa (w skrócie):
   • ekran = arkusz · s + t  (s — powiększenie w pikselach na jednostkę arkusza, t — przesunięcie),
   • podkład rysujemy na osobnym, niewidocznym płótnie „tło”; podczas gestu (przesuwanie, szczypanie) tylko
     przesuwamy i skalujemy gotowy obraz tła — dlatego ruch jest płynny także na iPadzie 9; po zakończeniu gestu
     tło rysuje się od nowa w pełnej ostrości,
   • znaczniki i podgląd narzędzia rysujemy na bieżąco na wierzchu,
   • na palcu punkt ustawia „celownik” przesunięty nad palec (palec nie zasłania miejsca) + lupa; punkt zapisuje się
     po oderwaniu palca. Rysikiem i myszą punkt jest dokładnie pod końcówką. */
'use strict';

const Plan = (() => {
  const KOLORY = { F: '#0A8FB0', wymiar: '#c2410c', nowy: '#15803d', brak: '#b91c1c', uwaga: '#7c3aed', szkic: '#57534e' };
  const PAPIER = '#0b1428', OFFSET_CELOWNIKA = 78, R_LUPY = 64, ZOOM_LUPY = 3; // PAPIER = tło „biurka” wokół arkusza (granat jak w TEK-BIURO BUDOWY); sam arkusz jest biały
  let host, cv, g, tlo, gt, dpr = 1, W = 0, H = 0;
  let A = null, Z = [];                       // bieżący arkusz (dane robocze) i jego znaczniki
  let v = { s: 1, tx: 0, ty: 0 };             // bieżący widok
  let vt = null;                              // widok, dla którego narysowano płótno tła
  let narz = 'przegladaj', podtryb = 'linia', punkty = [], celownik = null, hover = null, zazn = null;
  let opcje = { snap: true, orto: false, palec: false, kolory: false, tylkoRysik: false };
  const wsk = new Map(); let gest = null; let cb = {};
  let rysujZadanie = 0, tloZadanie = 0, detal = null, detalZadania = [], detalTimer = 0, foto = null, szkic = null, pomiar = null;

  /* ---------- montowanie ---------- */
  function montuj(el, callbacks) {
    host = el; cb = callbacks || {};
    host.innerHTML = '<canvas class="plan-cv"></canvas>';
    cv = host.querySelector('canvas'); g = cv.getContext('2d');
    tlo = document.createElement('canvas'); gt = tlo.getContext('2d', { alpha: false });
    new ResizeObserver(rozmiar).observe(host); rozmiar();
    cv.addEventListener('pointerdown', dol); cv.addEventListener('pointermove', ruch); cv.addEventListener('pointerup', gora); cv.addEventListener('pointercancel', anulujWsk);
    cv.addEventListener('pointerleave', () => { if (!wsk.size) { hover = null; planuj(); } });
    cv.addEventListener('wheel', kolko, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => cv.addEventListener(t, (e) => e.preventDefault())); // Safari: blokada powiększania całej strony
  }
  function rozmiar() {
    if (!host) return;
    const r = host.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    tlo.width = cv.width; tlo.height = cv.height; vt = null; detal = null;
    if (A && !A.widokUstawiony) { dopasuj(); A.widokUstawiony = true; }
    odswiezTlo();
  }

  /* ---------- arkusz ---------- */
  function ustawArkusz(a, znaczniki, widok) {
    anulujDetal(); A = a; Z = znaczniki || []; punkty = []; celownik = null; zazn = null; detal = null; vt = null; pomiar = null;
    if (widok && widok.s) { v = { ...widok }; A.widokUstawiony = true; } else { A.widokUstawiony = false; if (W > 1) { dopasuj(); A.widokUstawiony = true; } }
    if (A && A.typ === 'dxf' && !A.sciezki) zbudujSciezki();
    odswiezTlo();
  }
  function zbudujSciezki() {
    A.lWierz = A.dxf.grupy.reduce((n, gr) => n + gr.linie.reduce((m, l) => m + l.length / 2, 0), 0);
    A.sciezki = A.dxf.grupy.map(gr => { const p = new Path2D(); for (const a of gr.linie) { p.moveTo(a[0], a[1]); for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], a[i + 1]); } return { warstwa: gr.warstwa, kolor: gr.kolor, p }; });
  }
  const zasieg = () => A ? (A.typ === 'dxf' ? A.dxf.widok : { minx: 0, miny: 0, maxx: A.w, maxy: A.h }) : { minx: 0, miny: 0, maxx: 1, maxy: 1 };
  function dopasuj(r) {
    const z = r || zasieg(), w = Math.max(1e-9, z.maxx - z.minx), h = Math.max(1e-9, z.maxy - z.miny);
    const s = Math.min((W - 40) / w, (H - 40) / h);
    v = { s, tx: (W - w * s) / 2 - z.minx * s, ty: (H - h * s) / 2 - z.miny * s };
    odswiezTlo(); zmianaWidoku();
  }
  function pokaz(sx, sy, s) { const ns = s || Math.max(v.s, 3 * (W / Math.max(1e-9, zasieg().maxx - zasieg().minx))); v = { s: ns, tx: W / 2 - sx * ns, ty: H / 2 - sy * ns }; odswiezTlo(); zmianaWidoku(); }
  const zmianaWidoku = () => { if (cb.naWidok) cb.naWidok({ ...v }); };
  const naEkran = (x, y) => [x * v.s + v.tx, y * v.s + v.ty];
  const naArkusz = (X, Y) => [(X - v.tx) / v.s, (Y - v.ty) / v.s];

  /* ---------- tło (podkład) ---------- */
  function odswiezTlo() { cancelAnimationFrame(tloZadanie); tloZadanie = requestAnimationFrame(rysujTlo); }
  function rysujTlo() {
    if (!gt) return;
    gt.setTransform(1, 0, 0, 1, 0, 0); gt.fillStyle = PAPIER; gt.fillRect(0, 0, tlo.width, tlo.height);
    if (A) {
      if (A.typ === 'pdf') rysujPdf(); else rysujDxf();
    }
    vt = { ...v }; planuj();
    if (A && A.typ === 'pdf') planujDetal();
  }
  function rysujPdf() {
    const s = v.s * dpr;
    gt.setTransform(s, 0, 0, s, v.tx * dpr, v.ty * dpr);
    gt.fillStyle = '#fff'; gt.shadowColor = 'rgba(0,0,0,.25)'; gt.shadowBlur = 10; gt.fillRect(0, 0, A.w, A.h); gt.shadowBlur = 0;
    if (A.baza) { gt.imageSmoothingEnabled = true; gt.imageSmoothingQuality = 'high'; gt.drawImage(A.baza.canvas, 0, 0, A.w, A.h); }
    if (detal && Math.abs(Math.log(detal.s / v.s)) < 0.01) {
      gt.setTransform(1, 0, 0, 1, 0, 0);
      const [x, y] = naEkran(detal.x0, detal.y0); gt.drawImage(detal.canvas, x * dpr, y * dpr);
    }
  }
  function kolorWarstwy(k) {
    if (!opcje.kolory) return '#2f2f2b';
    const n = parseInt(k.slice(1), 16), r = n >> 16 & 255, gg = n >> 8 & 255, b = n & 255;
    const L = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
    if (L > 0.72) { const f = 0.72 / L; return `rgb(${Math.round(r * f * 0.7)},${Math.round(gg * f * 0.7)},${Math.round(b * f * 0.7)})`; }
    return k;
  }
  function rysujDxf() {
    const s = v.s * dpr, d = A.dxf, wid = A.warstwyWid || {};
    gt.setTransform(s, 0, 0, s, v.tx * dpr, v.ty * dpr);
    { const z = d.zasieg, m = 0.03 * Math.max(z.maxx - z.minx, z.maxy - z.miny); // biały arkusz pod rysunkiem DXF
      gt.fillStyle = '#fff'; gt.shadowColor = 'rgba(0,0,0,.35)'; gt.shadowBlur = 14; gt.fillRect(z.minx - m, z.miny - m, z.maxx - z.minx + 2 * m, z.maxy - z.miny + 2 * m); gt.shadowBlur = 0; }
    gt.lineWidth = 0.85 / v.s; gt.lineJoin = 'round'; gt.lineCap = 'round';
    for (const p of A.sciezki) { if (wid[p.warstwa] === false) continue; gt.strokeStyle = kolorWarstwy(p.kolor); gt.stroke(p.p); }
    // teksty: tylko czytelne (≥ 3 px) i w polu widzenia
    const [x0, y0] = naArkusz(0, 0), [x1, y1] = naArkusz(W, H);
    gt.setTransform(1, 0, 0, 1, 0, 0); gt.textBaseline = 'alphabetic';
    let n = 0;
    for (const t of d.teksty) {
      if (wid[t.war] === false) continue;
      const hp = t.h * v.s; if (hp < 3 || hp > 400) continue;
      const m = t.h * Math.max(4, t.t.length * 0.7);
      if (t.x + m < x0 || t.x - m > x1 || t.y + m < y0 || t.y - m > y1) continue;
      if (++n > 5000) break;
      const [X, Y] = naEkran(t.x, t.y);
      gt.save(); gt.translate(X * dpr, Y * dpr); gt.rotate(t.rot);
      gt.font = `${hp * dpr}px Nunito, sans-serif`; gt.fillStyle = kolorWarstwy(t.kol);
      gt.textAlign = t.poz === 'C' ? 'center' : t.poz === 'R' ? 'right' : 'left';
      const linie = t.t.split('\n'), lh = hp * dpr * 1.25;
      let dy = t.pion === 'T' ? hp * dpr : t.pion === 'M' ? hp * dpr * 0.5 - (linie.length - 1) * lh / 2 : -(linie.length - 1) * lh;
      if (!t.mt && t.pion === 'B') dy = 0;
      for (const l of linie) { gt.fillText(l, 0, dy); dy += lh; }
      gt.restore();
    }
  }
  /* Szczegół PDF: po zatrzymaniu widoku dorysowujemy widoczny fragment w pełnej ostrości. */
  function anulujDetal() { clearTimeout(detalTimer); detalZadania.forEach(t => { try { t.cancel(); } catch (e) { } }); detalZadania = []; }
  function planujDetal() {
    anulujDetal();
    if (!A || !A.page || !A.baza) return;
    if (v.s * dpr <= A.baza.skala * 1.15) { detal = null; return; }
    if (detal && Math.abs(Math.log(detal.s / v.s)) < 0.01 && detal.tx === v.tx && detal.ty === v.ty) return;
    const pamA = A, pv = { ...v };
    detalTimer = setTimeout(async () => {
      try {
        const [x0, y0] = naArkusz(0, 0);
        const c = await PdfPodklad.rysuj(pamA.page, pv.s * dpr, x0, y0, W * dpr, H * dpr, detalZadania);
        if (A !== pamA) return;
        detal = { canvas: c, x0, y0, s: pv.s, tx: pv.tx, ty: pv.ty };
        if (v.s === pv.s && v.tx === pv.tx && v.ty === pv.ty) { odswiezTlo(); }
      } catch (e) { if (e && e.name !== 'RenderingCancelledException') console.warn(e); }
    }, 260);
  }

  /* ---------- rysowanie klatki ---------- */
  function planuj() { cancelAnimationFrame(rysujZadanie); rysujZadanie = requestAnimationFrame(rysuj); }
  function rysuj() {
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = PAPIER; g.fillRect(0, 0, cv.width, cv.height);
    if (vt) { // gotowe tło przesunięte/przeskalowane do bieżącego widoku
      const k = v.s / vt.s; g.imageSmoothingEnabled = true;
      g.setTransform(k, 0, 0, k, (v.tx - vt.tx * k) * dpr, (v.ty - vt.ty * k) * dpr); g.drawImage(tlo, 0, 0);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!A) { g.fillStyle = '#94a2bb'; g.font = "15px Nunito, sans-serif"; g.textAlign = 'center'; g.fillText('Dodaj podkład (PDF lub DXF) w zakładce „2. Podkłady”.', W / 2, H / 2); return; }
    for (const z of Z) if (z.id !== zazn) rysujZnacznik(z, false);
    const zz = Z.find(z => z.id === zazn); if (zz) rysujZnacznik(zz, true);
    rysujPodglad();
    if (celownik) rysujCelownik(celownik, true); else if (hover) rysujCelownik(hover, false);
  }
  function etykieta(x, y, tekst, kol, wyb) {
    g.font = "600 11px 'IBM Plex Mono', monospace"; const w = g.measureText(tekst).width + 10;
    g.fillStyle = wyb ? '#ffb000' : kol; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - 9, w, 18, 4) : g.rect(x - w / 2, y - 9, w, 18); g.fill(); g.stroke();
    g.fillStyle = wyb ? '#1d1d1b' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tekst, x, y + 0.5);
    return [x - w / 2, y - 9, w, 18];
  }
  function rysujZnacznik(z, wyb) {
    const kol = z.rodzaj === 'F' ? KOLORY.F : (KOLORY[z.typZ] || '#444');
    const P = (z.geom && z.geom.pkt || []).map(p => naEkran(p[0], p[1])); if (!P.length) return;
    g.save();
    if (z.rodzaj === 'F') {
      const [x, y] = P[0];
      if (z.kier !== null && z.kier !== undefined) {
        g.fillStyle = wyb ? 'rgba(255,176,0,.28)' : 'rgba(34,195,230,.22)'; g.strokeStyle = wyb ? '#c98a00' : 'rgba(10,143,176,.85)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y); g.arc(x, y, 48, z.kier - 0.5, z.kier + 0.5); g.closePath(); g.fill(); g.stroke();
      }
      g.beginPath(); g.arc(x, y, wyb ? 13 : 11, 0, Math.PI * 2); g.fillStyle = wyb ? '#ffb000' : kol; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = wyb ? '#1d1d1b' : '#fff'; g.font = "600 10px 'IBM Plex Mono', monospace"; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(parseInt(z.nr.slice(2), 10)), x, y + 0.5);
      if ((z.zdjecia || []).length > 1) { g.fillStyle = '#1d1d1b'; g.font = "500 9px 'IBM Plex Mono', monospace"; g.fillText('×' + z.zdjecia.length, x + 17, y - 10); }
    } else {
      g.strokeStyle = wyb ? '#ffb000' : kol; g.lineWidth = wyb ? 3.5 : 2.5; g.lineJoin = 'round'; g.lineCap = 'round';
      if (z.typZ === 'brak') g.setLineDash([7, 5]);
      if (P.length > 1) { g.beginPath(); g.moveTo(...P[0]); for (const p of P.slice(1)) g.lineTo(...p); if (z.geom.zamkn) g.closePath(); g.stroke(); }
      g.setLineDash([]);
      if (z.typZ === 'brak' && P.length > 2) { // przekreślenie
        const xs = P.map(p => p[0]), ys = P.map(p => p[1]); g.lineWidth = 1.5; g.beginPath();
        g.moveTo(Math.min(...xs), Math.min(...ys)); g.lineTo(Math.max(...xs), Math.max(...ys)); g.moveTo(Math.max(...xs), Math.min(...ys)); g.lineTo(Math.min(...xs), Math.max(...ys)); g.stroke();
      }
      if (z.typZ === 'wymiar' && P.length === 2) { // kreski wymiarowe
        const [a, b] = P, d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / d * 7, ny = (b[0] - a[0]) / d * 7;
        g.lineWidth = 2; g.beginPath(); for (const p of P) { g.moveTo(p[0] - nx + ny * 0.6, p[1] - ny - nx * 0.6); g.lineTo(p[0] + nx - ny * 0.6, p[1] + ny + nx * 0.6); } g.stroke();
      }
      if (z.typZ === 'uwaga' || z._punktowy) { const [x, y] = P[0]; g.fillStyle = wyb ? '#ffb000' : kol; g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y); g.closePath(); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
      const [lx, ly] = z.typZ === 'wymiar' && P.length === 2 ? [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2 - 14] : (z.typZ === 'uwaga' || z._punktowy) ? [P[0][0] + 24, P[0][1] - 14] : [P[0][0], P[0][1] - 14];
      let tekst = 'Z' + parseInt(z.nr.slice(2), 10);
      if (z.typZ === 'wymiar' && Number.isFinite(z.wymPom)) tekst += ' · ' + (cb.formatWym ? cb.formatWym(z) : '');
      etykieta(lx, ly, tekst, kol, wyb);
      if ((z.zdjecia || []).length) { g.fillStyle = kol; g.font = "500 9px 'IBM Plex Mono', monospace"; g.textAlign = 'left'; g.fillText('foto ' + z.zdjecia.length, lx + 22, ly - 12); }
    }
    g.restore();
  }
  function rysujPodglad() {
    const P = punkty.map(p => naEkran(p[0], p[1])), c = celownik || hover;
    g.save(); g.strokeStyle = '#d9480f'; g.fillStyle = '#d9480f'; g.lineWidth = 2; g.setLineDash([6, 4]);
    if (A && A.obszar) { const a0 = naEkran(A.obszar[0], A.obszar[1]), a1 = naEkran(A.obszar[2], A.obszar[3]); g.save(); g.setLineDash([10, 6]); g.strokeStyle = '#0A8FB0'; g.lineWidth = 1.5; g.strokeRect(a0[0], a0[1], a1[0] - a0[0], a1[1] - a0[1]); g.restore(); }
    if (narz === 'obszar' && punkty.length === 1 && c) { const a0 = naEkran(...punkty[0]), a1 = naEkran(c.x, c.y); g.strokeRect(a0[0], a0[1], a1[0] - a0[0], a1[1] - a0[1]); }
    if (narz === 'kalibracja') { punkty.forEach((p, i) => { const [x, y] = naEkran(p[0], p[1]); krzyz(x, y, 12, '#d9480f'); g.font = "600 12px 'IBM Plex Mono', monospace"; g.fillText(String(i + 1), x + 9, y - 9); }); }
    else if (P.length && narz !== 'obszar') {
      g.beginPath(); g.moveTo(...P[0]); for (const p of P.slice(1)) g.lineTo(...p);
      if (c && narz !== 'szkic') {
        const q = naEkran(c.x, c.y);
        if (podtrybProst()) { const R = prostokat(punkty[0], [c.x, c.y]).map(p => naEkran(p[0], p[1])); g.moveTo(...R[0]); for (const p of R.slice(1)) g.lineTo(...p); g.closePath(); }
        else g.lineTo(...q);
      }
      g.stroke(); g.setLineDash([]); for (const p of P) { g.beginPath(); g.arc(p[0], p[1], 3.5, 0, Math.PI * 2); g.fill(); }
      if (c && P.length && cb.opisOdcinka) { const q = naEkran(c.x, c.y); const t = cb.opisOdcinka(punkty[punkty.length - 1], [c.x, c.y]); if (t) etykieta((P[P.length - 1][0] + q[0]) / 2, (P[P.length - 1][1] + q[1]) / 2 - 16, t, '#d9480f', false); }
    }
    if (szkic && szkic.length > 1) { g.setLineDash([]); g.strokeStyle = KOLORY.szkic; g.lineWidth = 2.5; g.beginPath(); const S0 = szkic.map(p => naEkran(p[0], p[1])); g.moveTo(...S0[0]); for (const p of S0) g.lineTo(...p); g.stroke(); }
    if (foto) { const [x, y] = naEkran(foto.x, foto.y); g.setLineDash([]); g.fillStyle = 'rgba(34,195,230,.25)'; g.strokeStyle = KOLORY.F;
      if (foto.kier !== null) { g.beginPath(); g.moveTo(x, y); g.arc(x, y, 48, foto.kier - 0.5, foto.kier + 0.5); g.closePath(); g.fill(); g.stroke(); }
      g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fillStyle = KOLORY.F; g.fill(); }
    if (pomiar) { const a = naEkran(...pomiar[0]), b = naEkran(...pomiar[1]); g.setLineDash([]); g.strokeStyle = '#1a4d5c'; g.lineWidth = 2; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); krzyz(...a, 8, '#1a4d5c'); krzyz(...b, 8, '#1a4d5c'); if (cb.opisOdcinka) etykieta((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 14, cb.opisOdcinka(pomiar[0], pomiar[1]), '#1a4d5c', false); }
    g.restore();
  }
  function krzyz(x, y, r, kol) { g.save(); g.setLineDash([]); g.strokeStyle = kol; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke(); g.restore(); }
  function rysujCelownik(c, zLupa) {
    const [x, y] = naEkran(c.x, c.y);
    if (zLupa && c.lupa) {
      const lx = clamp(c.palec[0] - 95, R_LUPY + 6, W - R_LUPY - 6), ly = clamp(c.palec[1] - 150, R_LUPY + 6, H - R_LUPY - 6);
      g.save(); g.beginPath(); g.arc(lx, ly, R_LUPY, 0, Math.PI * 2); g.clip();
      g.fillStyle = A.typ === 'dxf' ? '#fff' : PAPIER; g.fillRect(lx - R_LUPY, ly - R_LUPY, 2 * R_LUPY, 2 * R_LUPY); // lupa DXF rysuje wektory na białym
      if (A.typ === 'dxf' && A.lWierz < 400000) { // DXF: lupa rysuje wektory — ostra przy każdym powiększeniu
        const s = v.s * ZOOM_LUPY, wid = A.warstwyWid || {};
        g.save(); g.translate(lx - c.x * s, ly - c.y * s); g.scale(s, s); g.lineWidth = 1.1 / s;
        for (const q of A.sciezki) { if (wid[q.warstwa] === false) continue; g.strokeStyle = kolorWarstwy(q.kolor); g.stroke(q.p); }
        g.restore();
      } else if (vt) { const k = v.s / vt.s, sx = ((x - v.tx) / k + vt.tx) * dpr, sy = ((y - v.ty) / k + vt.ty) * dpr, rr = R_LUPY / ZOOM_LUPY / k * dpr;
        g.drawImage(tlo, sx - rr, sy - rr, rr * 2, rr * 2, lx - R_LUPY, ly - R_LUPY, 2 * R_LUPY, 2 * R_LUPY); }
      g.strokeStyle = c.snap ? '#15803d' : '#d9480f'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(lx - R_LUPY, ly); g.lineTo(lx + R_LUPY, ly); g.moveTo(lx, ly - R_LUPY); g.lineTo(lx, ly + R_LUPY); g.stroke();
      g.restore(); g.save(); g.beginPath(); g.arc(lx, ly, R_LUPY, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#0d1830'; g.stroke(); g.lineWidth = 1; g.strokeStyle = '#fff'; g.stroke(); g.restore();
    }
    krzyz(x, y, 16, c.snap ? '#15803d' : '#d9480f');
    if (c.snap) { g.save(); g.strokeStyle = '#15803d'; g.lineWidth = 2; g.strokeRect(x - 6, y - 6, 12, 12); g.restore(); }
    if (cb.naCelownik) cb.naCelownik(c);
  }

  /* ---------- przyciąganie i orto ---------- */
  function przyciagnij(sx, sy) {
    let x = sx, y = sy, snap = false;
    const ix = A && (A.snap || (A.dxf && A.dxf.snap)); // DXF albo punkty wyciągnięte z wektorowego PDF
    if (opcje.snap && ix) { const p = ix.najblizszy(sx, sy, 14 / v.s); if (p) { x = p[0]; y = p[1]; snap = true; } }
    if (!snap && opcje.orto && punkty.length && narz !== 'kalibracja' && narz !== 'obszar') {
      const o = punkty[punkty.length - 1], al = A && A.T ? -Geom.katOsiX(A.T) : 0; // kierunek osi X świata na arkuszu
      const dx = x - o[0], dy = y - o[1], c = Math.cos(al), s = Math.sin(al);
      const u = dx * c + dy * s, w = -dx * s + dy * c;
      if (Math.abs(u) >= Math.abs(w)) { x = o[0] + u * c; y = o[1] + u * s; } else { x = o[0] - w * s; y = o[1] + w * c; }
    }
    return { x, y, snap };
  }
  const podtrybProst = () => (narz === 'nowy' || narz === 'brak') && podtryb === 'prost' && punkty.length === 1;
  function prostokat(p, q) { // narożniki prostokąta równoległego do osi świata
    if (!A || !A.T) return [p, [q[0], p[1]], q, [p[0], q[1]]];
    const a = Geom.zastosuj(A.T, ...p), b = Geom.zastosuj(A.T, ...q), Ti = A.Ti;
    return [a, [b[0], a[1]], b, [a[0], b[1]]].map(w => Geom.zastosuj(Ti, w[0], w[1]));
  }
  const potrzebaPunktow = () => ({ wymiar: 2, uwaga: 1, pomiar: 2, kalibracja: 2, obszar: 2 }[narz] || ((narz === 'nowy' || narz === 'brak') ? (podtryb === 'polilinia' ? Infinity : 2) : 0));

  /* ---------- obsługa wskaźnika (palec, rysik, mysz) ---------- */
  const xy = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function dol(e) {
    if (!A) return;
    cv.setPointerCapture(e.pointerId); const p = xy(e);
    wsk.set(e.pointerId, { p, start: p, t: performance.now(), typ: e.pointerType });
    if (e.pointerType === 'pen' && !opcje.tylkoRysik) { opcje.tylkoRysik = true; if (cb.naRysik) cb.naRysik(); }
    if (wsk.size === 2) { // szczypanie: przerywamy celowanie, zostawiamy zebrane punkty
      celownik = null; foto = null; if (szkic) szkic = null;
      const [a, b] = [...wsk.values()].map(w => w.p);
      gest = { typ: 'szczyp', d0: Math.hypot(b[0] - a[0], b[1] - a[1]), m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...v } };
      planuj(); return;
    }
    if (wsk.size > 2) return;
    const palecPrzesuwa = e.pointerType === 'touch' && (opcje.palec || opcje.tylkoRysik);
    if (e.pointerType === 'mouse' && e.button !== 0) { gest = { typ: 'przesun', p0: p, v0: { ...v }, tap: false }; return; }
    if (narz === 'przesunZn' && !palecPrzesuwa) {
      const z = znajdz(p); if (z) { zazn = z.id; gest = { typ: 'przesunZn', z, p0: p, orig: z.geom.pkt.map(q => q.slice()), ruszyl: false }; if (cb.naWybor) cb.naWybor(z.id); planuj(); return; }
      gest = { typ: 'przesun', p0: p, v0: { ...v }, tap: false }; return;
    }
    if (narz === 'przegladaj' || palecPrzesuwa) { gest = { typ: 'przesun', p0: p, v0: { ...v }, tap: true }; return; }
    if (narz === 'foto') { const [sx, sy] = naArkusz(...p); foto = { x: sx, y: sy, kier: null, p0: p }; gest = { typ: 'foto' }; planuj(); return; }
    if (narz === 'szkic') { szkic = [naArkusz(...p)]; gest = { typ: 'szkic' }; planuj(); return; }
    if (potrzebaPunktow()) {
      const palec = e.pointerType === 'touch';
      const q = palec ? [p[0], p[1] - OFFSET_CELOWNIKA] : p;
      celownik = { ...przyciagnij(...naArkusz(...q)), palec: p, lupa: e.pointerType !== 'mouse' };
      gest = { typ: 'celuj', palec }; planuj();
    }
  }
  function ruch(e) {
    const w = wsk.get(e.pointerId); const p = xy(e);
    if (!w) { // mysz bez przycisku: podgląd celownika i przyciągania
      if (e.pointerType === 'mouse' && A && potrzebaPunktow()) { hover = { ...przyciagnij(...naArkusz(...p)), palec: p, lupa: false }; planuj(); }
      return;
    }
    w.p = p;
    if (!gest) return;
    if (gest.typ === 'szczyp' && wsk.size >= 2) {
      const [a, b] = [...wsk.values()].map(x => x.p), d = Math.hypot(b[0] - a[0], b[1] - a[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const k = d / Math.max(1, gest.d0), s = clamp(gest.v0.s * k, 1e-7, 1e7);
      const ax = (gest.m0[0] - gest.v0.tx) / gest.v0.s, ay = (gest.m0[1] - gest.v0.ty) / gest.v0.s;
      v = { s, tx: m[0] - ax * s, ty: m[1] - ay * s }; planuj(); return;
    }
    if (gest.typ === 'przesunZn') {
      let dx = (p[0] - gest.p0[0]) / v.s, dy = (p[1] - gest.p0[1]) / v.s; if (Math.hypot(p[0] - gest.p0[0], p[1] - gest.p0[1]) > 3) gest.ruszyl = true;
      const c = przyciagnij(gest.orig[0][0] + dx, gest.orig[0][1] + dy); if (c.snap) { dx = c.x - gest.orig[0][0]; dy = c.y - gest.orig[0][1]; } // pierwszy punkt przyciąga się do rysunku
      gest.z.geom.pkt = gest.orig.map(q => [q[0] + dx, q[1] + dy]); planuj(); return;
    }
    if (gest.typ === 'przesun') {
      if (gest.tap && Math.hypot(p[0] - gest.p0[0], p[1] - gest.p0[1]) > 8) gest.tap = false;
      v = { ...v, tx: gest.v0.tx + p[0] - gest.p0[0], ty: gest.v0.ty + p[1] - gest.p0[1] }; planuj(); return;
    }
    if (gest.typ === 'foto' && foto) { const dx = p[0] - foto.p0[0], dy = p[1] - foto.p0[1]; foto.kier = Math.hypot(dx, dy) > 14 ? Math.atan2(dy, dx) : null; planuj(); return; }
    if (gest.typ === 'szkic' && szkic) { const q = naArkusz(...p), o = szkic[szkic.length - 1]; if (Math.hypot(q[0] - o[0], q[1] - o[1]) * v.s > 3) { szkic.push(q); planuj(); } return; }
    if (gest.typ === 'celuj') { const q = gest.palec ? [p[0], p[1] - OFFSET_CELOWNIKA] : p; celownik = { ...przyciagnij(...naArkusz(...q)), palec: p, lupa: celownik && celownik.lupa }; planuj(); }
  }
  function gora(e) {
    const w = wsk.get(e.pointerId); wsk.delete(e.pointerId);
    if (!gest) return;
    if (gest.typ === 'szczyp') { if (wsk.size === 0) { gest = null; odswiezTlo(); zmianaWidoku(); } return; }
    if (gest.typ === 'przesunZn') { const gz = gest; gest = null; const d = [gz.z.geom.pkt[0][0] - gz.orig[0][0], gz.z.geom.pkt[0][1] - gz.orig[0][1]]; gz.z.geom.pkt = gz.orig; if (gz.ruszyl && cb.naPrzesun) cb.naPrzesun(gz.z.id, d); planuj(); return; }
    if (gest.typ === 'przesun') {
      const tap = gest.tap && w && performance.now() - w.t < 450; gest = null; odswiezTlo(); zmianaWidoku();
      if (tap) trafienie(w.p); return;
    }
    if (gest.typ === 'foto' && foto) { const f = foto; foto = null; gest = null; planuj(); if (cb.naFoto) cb.naFoto([f.x, f.y], f.kier, e); return; }
    if (gest.typ === 'szkic' && szkic) { const s = szkic; szkic = null; gest = null; planuj(); if (s.length > 1 && cb.naKoniec) cb.naKoniec({ typZ: 'szkic', geom: { typ: 'odr', pkt: uprosc(s, 1.5 / v.s) } }); return; }
    if (gest.typ === 'celuj' && celownik) { const c = celownik; celownik = null; gest = null; dodajPunkt([c.x, c.y]); planuj(); return; }
    gest = null;
  }
  function anulujWsk(e) { wsk.delete(e.pointerId); if (!wsk.size) { gest = null; celownik = null; foto = null; szkic = null; odswiezTlo(); } }
  function kolko(e) {
    e.preventDefault(); if (!A) return;
    const p = xy(e);
    const pan = !e.ctrlKey && (Math.abs(e.deltaX) > 0 || (e.deltaMode === 0 && e.deltaY % 1 !== 0));
    if (pan) { v = { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }; }
    else { const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), s = clamp(v.s * k, 1e-7, 1e7); const ax = (p[0] - v.tx) / v.s, ay = (p[1] - v.ty) / v.s; v = { s, tx: p[0] - ax * s, ty: p[1] - ay * s }; }
    planuj(); clearTimeout(kolko._t); kolko._t = setTimeout(() => { odswiezTlo(); zmianaWidoku(); }, 160);
  }
  function uprosc(pts, tol) { // upraszczanie linii odręcznej (Douglas–Peucker)
    if (pts.length < 3) return pts;
    const d2 = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; if (!L) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L; t = clamp(t, 0, 1); return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2; };
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) { const [i, j] = st.pop(); let m = -1, md = tol * tol; for (let k = i + 1; k < j; k++) { const d = d2(pts[k], pts[i], pts[j]); if (d > md) { md = d; m = k; } } if (m > 0) { keep[m] = 1; st.push([i, m], [m, j]); } }
    return pts.filter((_, i) => keep[i]);
  }

  /* ---------- punkty narzędzi ---------- */
  function dodajPunkt(p) {
    if (narz === 'kalibracja') { punkty.push(p); if (punkty.length === 2) { const pk = punkty; punkty = []; if (cb.naKalibracje) cb.naKalibracje(pk); } planuj(); return; }
    if (narz === 'obszar') { punkty.push(p); if (punkty.length === 2) { const pk = punkty; punkty = []; if (cb.naObszar) cb.naObszar(pk); } planuj(); return; }
    if (narz === 'pomiar') { punkty.push(p); if (punkty.length === 2) { pomiar = punkty; punkty = []; if (cb.naPomiar) cb.naPomiar(pomiar); } else pomiar = null; planuj(); return; }
    if (podtrybProst()) { const R = prostokat(punkty[0], p); punkty = []; koniec({ typ: 'polilinia', pkt: R, zamkn: true }); return; }
    punkty.push(p);
    const n = potrzebaPunktow();
    if (punkty.length >= n) koniec();
    if (cb.naPunkty) cb.naPunkty(punkty.length);
    planuj();
  }
  function koniec(geomGotowa) {
    const pk = punkty; punkty = [];
    let geom = geomGotowa;
    if (!geom) {
      if (narz === 'uwaga') geom = { typ: 'punkt', pkt: pk };
      else if (narz === 'wymiar') geom = { typ: 'linia', pkt: pk };
      else geom = { typ: pk.length === 2 ? 'linia' : 'polilinia', pkt: pk, zamkn: false };
    }
    if (cb.naKoniec) cb.naKoniec({ typZ: narz, geom });
    if (cb.naPunkty) cb.naPunkty(0);
    planuj();
  }
  function zakonczPolilinie(zamknij) { if (punkty.length < 2) return false; const pk = punkty; punkty = []; if (cb.naKoniec) cb.naKoniec({ typZ: narz, geom: { typ: 'polilinia', pkt: pk, zamkn: !!zamknij && pk.length > 2 } }); if (cb.naPunkty) cb.naPunkty(0); planuj(); return true; }
  function cofnijPunkt() { punkty.pop(); if (cb.naPunkty) cb.naPunkty(punkty.length); planuj(); }
  function wpisz(tekst) { // punkt z klawiatury (współrzędne świata)
    if (!A || !A.T) throw new Error('Podkład nie jest skalibrowany — najpierw kalibracja.');
    if (!potrzebaPunktow()) throw new Error('Wybierz narzędzie rysowania (wymiar, nowy element…).');
    const prev = punkty.length ? Geom.zastosuj(A.T, ...punkty[punkty.length - 1]) : null;
    const w = Geom.parsujWpis(tekst, prev, cb.zUzytkownika || ((x) => x));
    if (!w) return; dodajPunkt(Geom.zastosuj(A.Ti, w[0], w[1]));
  }

  /* ---------- trafienie w znacznik ---------- */
  function trafienie(p) { const best = znajdz(p); zazn = best ? best.id : null; planuj(); if (cb.naWybor) cb.naWybor(zazn); }
  function znajdz(p) {
    let best = null, bd = 18;
    for (const z of Z) {
      const P = (z.geom.pkt || []).map(q => naEkran(q[0], q[1]));
      let d = Infinity;
      if (z.rodzaj === 'F' || P.length === 1) d = Math.hypot(P[0][0] - p[0], P[0][1] - p[1]);
      else for (let i = 0; i < P.length - (z.geom.zamkn ? 0 : 1); i++) d = Math.min(d, odlOdc(p, P[i], P[(i + 1) % P.length]));
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }
  function odlOdc(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = clamp(t, 0, 1); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }

  return {
    montuj, ustawArkusz, dopasuj, pokaz, odswiezTlo, planuj, zakonczPolilinie, cofnijPunkt, wpisz, rozmiar,
    narzedzie(n, pt) { narz = n; if (pt) podtryb = pt; punkty = []; celownik = null; hover = null; pomiar = null; planuj(); if (cb.naPunkty) cb.naPunkty(0); },
    podtryb(pt) { podtryb = pt; punkty = []; planuj(); },
    stan: () => ({ narz, podtryb, punkty: punkty.length, opcje: { ...opcje } }),
    opcja(k, val) { opcje[k] = val; if (k === 'kolory') odswiezTlo(); planuj(); },
    zaznacz(id) { zazn = id; planuj(); },
    widok: () => ({ ...v }),
    znaczniki(lista) { Z = lista || []; planuj(); },
    arkusz: () => A,
    zniszcz() { anulujDetal(); A = null; host = null; g = null; gt = null; }
  };
})();
