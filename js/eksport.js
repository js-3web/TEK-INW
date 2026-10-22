/* TEK-INW — eksport: paczka ZIP z fotodokumentacją PDF, zdjęciami, zestawieniami, DXF zmian i kopią projektu.

   PDF budujemy biblioteką pdf-lib (MIT), czcionka IBM Plex Sans (licencja OFL) jest osadzana w pliku — polskie znaki
   wyświetlą się na każdym komputerze. Odnośniki w PDF są WEWNĘTRZNE (skok do innej strony tego samego pliku) —
   to działa w Acrobat Readerze, Edge, Chrome i na iPadzie bez ostrzeżeń, w odróżnieniu od linków do plików obok.
   Podkład planu wstawiamy jako wektor (jedna kopia w pliku, użyta na planie i na wszystkich mini-planach). */
'use strict';

const Eksport = (() => {
  const A4 = [841.89, 595.28];
  const KOL = { F: '#0A8FB0', wymiar: '#c2410c', nowy: '#15803d', brak: '#b91c1c', uwaga: '#7c3aed', szkic: '#57534e', // znaczniki (jak na ekranie)
    navy: '#0d1830', orange: '#e07b3c', tekst: '#1e2430', szary: '#5f6b7a', jasny: '#8a94a3', linia: '#d9dee5', linia2: '#b9c1cc', tlo: '#f2f4f7', tlo2: '#e3e8ef' }; // szata PDF (od 0.4.1)
  const TYPY = { wymiar: 'Inny wymiar / położenie', nowy: 'Nowy element', brak: 'Element nie istnieje', uwaga: 'Uwaga', szkic: 'Szkic / notatka odręczna' };
  const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
  const nazwaPl = (s, dl = 40) => ascii(bezpiecznaNazwa(s, dl));
  let bib = null;
  function wczytajSkrypt(src) { return new Promise((ok, zle) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => zle(new Error('Nie udało się wczytać ' + src)); document.head.appendChild(s); }); }
  async function biblioteki() {
    if (bib) return bib;
    if (typeof PDFLib === 'undefined') await wczytajSkrypt('vendor/pdf-lib.min.js');
    if (typeof fontkit === 'undefined') await wczytajSkrypt('vendor/fontkit.umd.min.js');
    const pobierzB = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
    bib = { R: await pobierzB('fonts/IBMPlexSans_400Regular.ttf'), B: await pobierzB('fonts/IBMPlexSans_600SemiBold.ttf'), L: await pobierzB('fonts/IBMPlexSans_300Light.ttf'), M: await pobierzB('fonts/IBMPlexMono_500Medium.ttf') };
    return bib;
  }
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  const nrZdj = (z, i) => `${z.nr}/${i + 1}`;
  const plikZdj = (z, i) => `${z.nr}_${i + 1}.jpg`;

  /* ---------- przygotowanie danych ---------- */
  function uporzadkuj(S) {
    const F = S.znaczniki.filter(z => z.rodzaj === 'F').sort((a, b) => a.nr.localeCompare(b.nr, 'pl', { numeric: true }));
    const Zm = S.znaczniki.filter(z => z.rodzaj === 'Z').sort((a, b) => a.nr.localeCompare(b.nr, 'pl', { numeric: true }));
    const zdjecia = [];
    for (const z of [...F, ...Zm]) (z.zdjecia || []).forEach((id, i) => zdjecia.push({ z, i, id }));
    return { F, Zm, zdjecia };
  }

  /* ---------- PDF ---------- */
  async function fotodokumentacja(S, R, postep, opcje = {}) {
    const f = await biblioteki(); // najpierw wczytanie pdf-lib i czcionek (dopiero przy eksporcie — oszczędza pamięć w terenie)
    const { PDFDocument, PDFName, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, rectangle, clip, endPath } = PDFLib;
    const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
    const fR = await doc.embedFont(f.R, { subset: true }), fB = await doc.embedFont(f.B, { subset: true }), fL = await doc.embedFont(f.L, { subset: true }), fM = await doc.embedFont(f.M, { subset: true });
    const m = S.meta;
    doc.setTitle(`Dokumentacja fotograficzna — ${m.nazwa || 'inwentaryzacja'}`); doc.setAuthor(m.autor || ''); doc.setSubject('Inwentaryzacja budowlana — dokumentacja fotograficzna');
    doc.setCreator(`${APP.nazwa} ${APP.wersja}`); doc.setProducer('TEK-INW · pdf-lib'); doc.setLanguage('pl-PL'); doc.setCreationDate(new Date());
    /* Tryb: „pelna” (plany robocze + zmiany + zdjęcia), „docelowa” (plany docelowe po poprawkach + zdjęcia, bez obrysów Z),
       „robocza” (zestawienie zmian Z + plany robocze, bez stron zdjęć — materiał dla projektanta). */
    const tryb = opcje.tryb || 'pelna';
    const { F, Zm } = uporzadkuj(S); const zdjecia = tryb === 'robocza' ? [] : uporzadkuj(S).zdjecia;
    const wlasne = (a) => S.znaczniki.filter(z => z.arkuszId === a.id && (tryb !== 'robocza' || z.rodzaj === 'Z'));
    const plany = (opcje.plany || S.arkusze.map(a => ({ a, znaczniki: wlasne(a), naglowek: true })))
      .filter(pl => R.get(pl.a.id) && pl.znaczniki.length);
    const arkusze = plany.map(pl => pl.a);
    if (tryb === 'robocza') { doc.setTitle(`Zestawienie zmian (materiał roboczy) — ${m.nazwa || 'inwentaryzacja'}`); doc.setSubject('Inwentaryzacja budowlana — zmiany względem rysunku'); }

    /* 1. Podkłady jako obiekty wektorowe (XObject) — wstawiane wielokrotnie bez powielania treści. */
    postep(0.02, 'Przygotowuję podkłady…');
    const PODK = new Map();
    for (const a of arkusze) {
      const r = R.get(a.id); if (!r) continue;
      if (a.typ === 'pdf') {
        const zr = await PDFDocument.load(r.bajty, { ignoreEncryption: true, updateMetadata: false });
        const st = zr.getPage(a.zrodlo.strona - 1); const vw = r.wym.view;
        const emb = await doc.embedPage(st, { left: vw[0], bottom: vw[1], right: vw[2], top: vw[3] });
        PODK.set(a.id, { emb, V: r.wym.transform, L: vw[0], B: vw[1], w: r.wym.w, h: r.wym.h, pl: { p: 1, ox: 0, oy: r.wym.h } });
      } else {
        PODK.set(a.id, await podkladDxf(PDFDocument, r, f, doc));
      }
    }
    /* sheet (vx,vy, y w dół) → strona (X,Y, y w górę):  X = p·vx + ox,  Y = −p·vy + oy;  macierz cm dla XObject podkładu */
    const cm = (P, p, ox, oy) => { const [a, b, c, d, e, ff] = P.V, L = P.L, B = P.B; return [p * a, -p * b, p * c, -p * d, p * (a * L + c * B + e) + ox, -p * (b * L + d * B + ff) + oy]; };
    function wstawPodklad(page, P, p, ox, oy, ramka) {
      const nazwa = page.node.newXObject('Podklad', P.emb.ref);
      const ops = [pushGraphicsState()];
      if (ramka) ops.push(rectangle(ramka[0], ramka[1], ramka[2], ramka[3]), clip(), endPath());
      ops.push(concatTransformationMatrix(...cm(P, p, ox, oy)), drawObject(nazwa), popGraphicsState());
      page.pushOperators(...ops);
    }
    function link(page, rect, cel, fitR) {
      const ctx = doc.context;
      const dest = fitR ? [cel.ref, PDFName.of('FitR'), ...fitR] : [cel.ref, PDFName.of('Fit')];
      const an = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], F: 4, Dest: dest }));
      let lista = page.node.lookup(PDFName.of('Annots'));
      if (!lista) { lista = ctx.obj([]); page.node.set(PDFName.of('Annots'), lista); }
      lista.push(an);
    }
    const tekst = (page, t, x, y, size, font = fR, color = KOL.tekst, o = {}) => page.drawText(String(t ?? ''), { x, y, size, font, color: hexRgb(color), ...o });
    const szer = (t, font, size) => font.widthOfTextAtSize(String(t ?? ''), size);
    function zawin(t, font, size, maxW, maxLinii = 99) {
      const out = []; for (const akap of String(t || '').split(/\r?\n/)) {
        let l = '';
        for (let s of akap.split(/\s+/)) {
          while (szer(s, font, size) > maxW && s.length > 1) { // słowo dłuższe niż kolumna (kod, adres www) — dzielimy po znakach, żeby nie wyszło poza stronę
            if (l) { out.push(l); l = ''; }
            let n = s.length - 1; while (n > 1 && szer(s.slice(0, n), font, size) > maxW) n--;
            out.push(s.slice(0, n)); s = s.slice(n);
          }
          const k = l ? l + ' ' + s : s; if (szer(k, font, size) > maxW && l) { out.push(l); l = s; } else l = k;
        }
        out.push(l);
      }
      if (out.length > maxLinii) { const o = out.slice(0, maxLinii); o[maxLinii - 1] = o[maxLinii - 1].replace(/\s*\S*$/, '') + ' …'; return o; }
      return out;
    }
    const skroc = (t, font, size, maxW) => { t = String(t || '').replace(/\s+/g, ' '); if (szer(t, font, size) <= maxW) return t; while (t.length > 1 && szer(t + '…', font, size) > maxW) t = t.slice(0, -1); return t + '…'; };
    /* ---------- elementy graficzne (od 0.4.1: szata „arkusza rysunkowego” — tabliczka jak na rysunku technicznym) ---------- */
    function rysujSvg(page, svg, x, y, h) { // znak / logo z js/logo.js, wektorowo — wysokość h, lewy dolny róg (x, y); zwraca szerokość
      const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), k = h / parseFloat(vb[2]), top = y + h;
      const atr = (t, n) => { const q = t.match(new RegExp(' ' + n + '="([^"]*)"')); return q ? q[1] : null; };
      for (const el of svg.match(/<(path|circle)\b[^>]*>/g) || []) {
        const fill = atr(el, 'fill'), st = atr(el, 'stroke'), sw = parseFloat(atr(el, 'stroke-width') || '0');
        const o = { color: fill && fill !== 'none' ? hexRgb(fill) : undefined, borderColor: st && st !== 'none' ? hexRgb(st) : undefined, borderWidth: st && st !== 'none' ? sw * k : 0 };
        if (el.startsWith('<path')) page.drawSvgPath(atr(el, 'd'), { x, y: top, scale: k, ...o });
        else page.drawCircle({ x: x + parseFloat(atr(el, 'cx')) * k, y: top - parseFloat(atr(el, 'cy')) * k, size: parseFloat(atr(el, 'r')) * k, ...o });
      }
      return parseFloat(vb[1]) * k;
    }
    const odmW = (n, j, d, w) => { const a = Math.abs(n), m10 = a % 10, m100 = a % 100; return a === 1 ? j : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? d : w; }; // 1 zdjęcie, 3 zdjęcia, 5 zdjęć
    const ile = (n, j, d, w) => `${n} ${odmW(n, j, d, w)}`;
    function prost(page, x, y, w, h, r, o) { // prostokąt z zaokrąglonymi rogami; (x, y) — lewy dolny róg
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      page.drawSvgPath(`M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`, { x, y: y + h, ...o });
    }
    function chip(page, t, x, yb, kol, size = 7.5) { // etykieta rodzaju znacznika; yb — linia bazowa tekstu; zwraca szerokość
      const w = szer(t, fB, size) + size * 1.7, hh = size * 1.9;
      prost(page, x, yb - size * 0.62, w, hh, hh / 2, { color: hexRgb(kol), opacity: 0.11 });
      tekst(page, t, x + size * 0.85, yb, size, fB, kol);
      return w;
    }
    function przycisk(page, t, x, y, cel, o = {}) { // przycisk nawigacji (odnośnik wewnętrzny); bez celu — wyszarzony
      const size = o.size || 8.5, w = szer(t, fB, size) + 22, hh = o.h || 20;
      prost(page, x, y, w, hh, hh / 2, cel ? { color: hexRgb(o.tlo || '#ffffff'), borderColor: hexRgb(o.ramka || KOL.linia2), borderWidth: 0.7 } : { color: hexRgb(KOL.tlo) });
      tekst(page, t, x + 11, y + hh / 2 - size * 0.34, size, fB, cel ? (o.kolor || KOL.navy) : KOL.jasny);
      if (cel) link(page, [x, y, x + w, y + hh], cel);
      return w;
    }
    const NAZWA_DOK = tryb === 'robocza' ? 'Zestawienie zmian i uwag' : 'Dokumentacja fotograficzna';
    function tabliczka(page, nr, razem) { // tabliczka u dołu strony A4 — jak na arkuszu rysunku
      const w = page.getWidth(), x0 = 28, x1 = w - 28, y0 = 20, hh = 30;
      page.drawLine({ start: { x: x0, y: y0 + hh }, end: { x: x1, y: y0 + hh }, thickness: 0.9, color: hexRgb(KOL.navy) });
      const kom = [[104, null], [0, 'Obiekt', m.nazwa || '—'], [156, 'Opracowanie', NAZWA_DOK], [100, 'Nr opracowania', m.nr || '—', true], [76, 'Data wizji', m.data || '—', true], [58, 'Strona', `${nr} / ${razem}`, true]];
      const elast = (x1 - x0) - kom.reduce((s, q) => s + q[0], 0);
      let x = x0;
      kom.forEach(([sz, et, wart, mono], i) => {
        const ww = sz || elast;
        if (i) page.drawLine({ start: { x, y: y0 + 4 }, end: { x, y: y0 + hh - 5 }, thickness: 0.5, color: hexRgb(KOL.linia) });
        if (!et) { const lw = rysujSvg(page, LOGO.znak, x, y0 + 5, 20); tekst(page, 'TEK-INW', x + lw + 5, y0 + 15.5, 8, fB, KOL.navy); tekst(page, `wersja ${APP.nr}`, x + lw + 5, y0 + 6.5, 6.5, fR, KOL.jasny); }
        else { const px = x + 9; tekst(page, et, px, y0 + hh - 11.5, 6.5, fB, KOL.jasny); tekst(page, skroc(wart, mono ? fM : fR, 8.5, ww - 16), px, y0 + 6.5, 8.5, mono ? fM : fR, KOL.tekst); }
        x += ww;
      });
    }
    function naglowekStrony(page, tytul, podtytul) {
      const [, h] = A4;
      page.drawRectangle({ x: 28, y: h - 31, width: 24, height: 2.6, color: hexRgb(KOL.orange) });
      tekst(page, tytul, 28, h - 54, 19, fB, KOL.navy);
      if (podtytul) tekst(page, podtytul, 28, h - 70, 9.5, fR, KOL.szary);
    }
    function glif(page, typ, x, y, s) { // symbol z legendy; (x, y) — lewy koniec, środek wysokości; szerokość ok. 12·s
      const k = hexRgb(KOL[typ] || '#444');
      if (typ === 'F') page.drawCircle({ x: x + 5 * s, y, size: 4.2 * s, color: k, borderColor: hexRgb('#ffffff'), borderWidth: 0.8 * s });
      else if (typ === 'wymiar') { page.drawLine({ start: { x, y }, end: { x: x + 12 * s, y }, thickness: 1.4 * s, color: k }); [x, x + 12 * s].forEach(q => page.drawLine({ start: { x: q, y: y - 3 * s }, end: { x: q, y: y + 3 * s }, thickness: 1.1 * s, color: k })); }
      else if (typ === 'nowy') page.drawRectangle({ x, y: y - 4 * s, width: 12 * s, height: 8 * s, borderColor: k, borderWidth: 1.4 * s });
      else if (typ === 'brak') { page.drawRectangle({ x, y: y - 4 * s, width: 12 * s, height: 8 * s, borderColor: k, borderWidth: 1.2 * s, borderDashArray: [2.4 * s, 1.6 * s] }); page.drawLine({ start: { x, y: y - 4 * s }, end: { x: x + 12 * s, y: y + 4 * s }, thickness: 0.9 * s, color: k }); page.drawLine({ start: { x, y: y + 4 * s }, end: { x: x + 12 * s, y: y - 4 * s }, thickness: 0.9 * s, color: k }); }
      else if (typ === 'uwaga') page.drawSvgPath(`M${6 * s} ${-5 * s} L${11 * s} 0 L${6 * s} ${5 * s} L${1 * s} 0 Z`, { x, y, color: k });
      else page.drawSvgPath(`M0 ${2 * s} C${3 * s} ${-5 * s} ${5 * s} ${5 * s} ${8 * s} ${-1 * s} S${11 * s} ${-2 * s} ${12 * s} ${0}`, { x, y, borderColor: k, borderWidth: 1.3 * s });
    }
    const NAZWY_LEG = { F: 'punkt foto', wymiar: 'inny wymiar', nowy: 'nowy element', brak: 'nie istnieje', uwaga: 'uwaga', szkic: 'szkic, notatka' };
    const typZnacznika = (z) => z.rodzaj === 'F' ? 'F' : (z.typZ || 'uwaga');

    /* 2. Układ stron (najpierw policzenie, potem rysowanie — odnośniki potrzebują gotowych stron). */
    const NA_STR_SPISU = 15;
    const strTytul = doc.addPage(A4);
    const strSpis = []; if (tryb !== 'robocza' && zdjecia.length) for (let i = 0; i < Math.ceil(zdjecia.length / NA_STR_SPISU); i++) strSpis.push(doc.addPage(A4));
    // zestawienie zmian: wiersze o zmiennej wysokości (opis zawija się), strony liczone z góry
    const KOLZ = [[28, 'Nr', 58], [92, 'Rodzaj zmiany', 104], [202, 'Element', 94], [302, 'Opis', 262], [572, 'Rysunek, pomiar, różnica', 150], [730, 'Źródło', 36], [772, 'Zdjęcia', 42]];
    const wierszZm = (z) => {
      const op = zawin(z.opis || '—', fR, 8.5, 258, 14), el = zawin(z.element || '—', fR, 8.5, 90, 2), rd = zawin(TYPY[z.typZ] || '—', fR, 8.5, 100, 2);
      const wy = z.typZ === 'wymiar' ? zawin(opisWymiaru(z, S, R), fR, 8.5, 146, 3) : ['—'];
      return { z, op, el, rd, wy, h: 13 + 11 * Math.max(op.length, el.length, rd.length, wy.length, 1) };
    };
    const strZmW = [];
    if (tryb !== 'docelowa' && Zm.length) { const MAXH = A4[1] - 100 - 22 - 60; let cur = [], hs = 0; for (const z of Zm) { const r = wierszZm(z); if (hs + r.h > MAXH && cur.length) { strZmW.push(cur); cur = []; hs = 0; } cur.push(r); hs += r.h; } strZmW.push(cur); }
    const strZm = strZmW.map(() => doc.addPage(A4));
    const stronaZm = new Map(); strZmW.forEach((ws, i) => ws.forEach(r => stronaZm.set(r.z.id, i)));
    const skA = (P) => clamp(P.w / 1190, 0.55, 2.2), naglA = (P) => 64 * skA(P); // nagłówek planu skalowany do wielkości arkusza
    const strPlan = new Map();
    for (const pl of plany) { const P = PODK.get(pl.a.id); if (!P) continue; strPlan.set(pl.a.id, doc.addPage([P.w, P.h + (pl.naglowek ? naglA(P) : 0)])); }
    const strZdj = zdjecia.map(() => doc.addPage(A4));
    const razem = doc.getPageCount();
    const nrStrony = (p) => doc.getPages().indexOf(p) + 1;
    const pierwszeZdj = new Map(); zdjecia.forEach((x, k) => { if (!pierwszeZdj.has(x.z.id)) pierwszeZdj.set(x.z.id, k); });
    const promienPlanu = (P) => clamp(Math.min(P.w, P.h) / 120, 7, 18); // A3: kółko ok. 5 mm — czytelne po wydruku
    const naPlanie = (a, q) => { const P = PODK.get(a.id), L = P.pl; return [L.p * q[0] + L.ox, -L.p * q[1] + L.oy]; }; // arkusz → strona planu (y w górę)
    const kolor = (z) => z.rodzaj === 'F' ? KOL.F : (KOL[z.typZ] || '#444');
    const gdzie = new Map(); // id znacznika → { a: arkusz planu w tym dokumencie, z: znacznik tak, jak leży na tym arkuszu }
    for (const pl of plany) for (const zz of pl.znaczniki) if (!gdzie.has(zz.id)) gdzie.set(zz.id, { a: pl.a, z: zz });
    const ZmF = Zm.filter(z => (z.zdjecia || []).length);

    /* 3. Strona tytułowa: granatowy pas z danymi opracowania + plan rozmieszczenia (miniatury arkuszy z punktami) */
    {
      const p = strTytul, [w, h] = A4, PW = 292;
      p.drawRectangle({ x: 0, y: 0, width: PW, height: h, color: hexRgb(KOL.navy) });
      p.drawRectangle({ x: PW, y: 0, width: 3, height: h, color: hexRgb(KOL.orange) });
      rysujSvg(p, LOGO.produktCiemne, 30, h - 66, 32);
      let y = h - 150;
      tekst(p, NAZWA_DOK, 34, y, 11.5, fB, '#f3a472'); y -= 16;
      tekst(p, tryb === 'robocza' ? 'Różnice względem rysunku — materiał roboczy' : 'Inwentaryzacja budowlana — stan istniejący', 34, y, 9.5, fR, '#b9c3d6'); y -= 44;
      { // nazwa obiektu: dzielenie także po łączniku („magazynowo-produkcyjna”), czcionka zmniejszana, aż zmieści się w 4 liniach
        const slowa = String(m.nazwa || 'Inwentaryzacja').split(/\s+/).flatMap(q => q.replace(/-(?=\S)/g, '-\u0001').split('\u0001')); // bez „lookbehind” — starsze Safari go nie znają
        const lam = (sz) => { const o = []; let l = ''; for (const q of slowa) { const k = !l ? q : l.endsWith('-') ? l + q : l + ' ' + q; if (szer(k, fL, sz) > PW - 64 && l) { o.push(l); l = q; } else l = k; } o.push(l); return o; };
        let sz = 27, L = lam(sz); while (sz > 15 && (L.length > 4 || L.some(t => szer(t, fL, sz) > PW - 64))) { sz -= 2; L = lam(sz); }
        if (L.length > 4) { L = L.slice(0, 4); L[3] = skroc(L[3] + ' …', fL, sz, PW - 64); }
        for (const t of L) { tekst(p, skroc(t, fL, sz, PW - 60), 34, y, sz, fL, '#ffffff'); y -= sz * 1.19; }
        y += sz * 1.19 - 24;
      }
      for (const t of zawin(m.adres || '', fR, 10, PW - 64, 2)) { if (t) tekst(p, t, 34, y, 10, fR, '#b9c3d6'); y -= 14; }
      const md = [['Zamawiający', m.inwestor], ['Nr opracowania', m.nr], ['Opracował', m.autor], ['Data wizji', m.data], ['Wygenerowano', dataCzas(Date.now())]].filter(([, v]) => v);
      let my = 52 + md.length * 31;
      p.drawLine({ start: { x: 34, y: my + 18 }, end: { x: PW - 30, y: my + 18 }, thickness: 0.6, color: hexRgb('#2b3d63') });
      for (const [k, v] of md) { tekst(p, k, 34, my, 7.5, fB, '#8fa0bd'); tekst(p, skroc(v, fR, 10, PW - 64), 34, my - 13.5, 10, fR, '#ffffff'); my -= 31; }
      tekst(p, `${APP.nazwa} ${APP.nr} — produkt marki TEKTORIA`, 34, 24, 7, fR, '#6f7f9c');
      // prawa część: plan rozmieszczenia
      const RX = PW + 38, RW = w - RX - 36;
      tekst(p, tryb === 'robocza' ? 'Plany robocze ze zmianami' : 'Plan rozmieszczenia zdjęć', RX, h - 54, 14, fB, KOL.navy);
      tekst(p, plany.length ? 'Stuknij arkusz, aby przejść do planu.' : 'Brak planu z naniesionymi punktami.', RX, h - 70, 9, fR, KOL.szary);
      const reg = [RX, 176, RW, h - 96 - 176], kafle = plany.filter(pl => PODK.get(pl.a.id)).slice(0, 6);
      if (kafle.length) {
        const g = 18, lab = 18; let best = null;
        for (let c = 1; c <= kafle.length; c++) {
          const rws = Math.ceil(kafle.length / c), cw = (reg[2] - g * (c - 1)) / c, chh = (reg[3] - (g + lab) * (rws - 1) - lab) / rws;
          const s = Math.min(...kafle.map(pl => { const P = PODK.get(pl.a.id); return Math.min(cw / P.w, chh / P.h); }));
          if (!best || s > best.s) best = { c, rws, cw, chh, s };
        }
        const t = best.s, rzad = (i) => kafle.slice(i * best.c, (i + 1) * best.c), wysR = (i) => Math.max(...rzad(i).map(pl => PODK.get(pl.a.id).h * t));
        const calaH = Array.from({ length: best.rws }, (_, i) => wysR(i) + lab).reduce((s, v) => s + v, 0) + g * (best.rws - 1);
        let top = reg[1] + reg[3] - Math.max(0, (reg[3] - calaH) / 2);
        for (let r = 0; r < best.rws; r++) {
          const wiersz = rzad(r), szerR = wiersz.reduce((s, pl) => s + PODK.get(pl.a.id).w * t, 0) + g * (wiersz.length - 1);
          let tx = reg[0] + (reg[2] - szerR) / 2;
          for (const pl of wiersz) {
            const P = PODK.get(pl.a.id), tw = P.w * t, th = P.h * t, ty = top - th, cel = strPlan.get(pl.a.id);
            p.drawRectangle({ x: tx + 3, y: ty - 3, width: tw, height: th, color: hexRgb(KOL.tlo2) });
            p.drawRectangle({ x: tx, y: ty, width: tw, height: th, color: hexRgb('#ffffff') });
            wstawPodklad(p, P, t * P.pl.p, tx + t * P.pl.ox, ty + t * P.pl.oy, [tx, ty, tw, th]);
            p.drawRectangle({ x: tx, y: ty, width: tw, height: th, borderColor: hexRgb(KOL.linia2), borderWidth: 0.6 });
            for (const z of pl.znaczniki) {
              const Q = z.geom.pkt.map(q => { const [X, Y] = naPlanie(pl.a, q); return [tx + t * X, ty + t * Y]; }), k = hexRgb(kolor(z));
              if (z.rodzaj === 'F') p.drawCircle({ x: Q[0][0], y: Q[0][1], size: 3.3, color: k, borderColor: hexRgb('#ffffff'), borderWidth: 0.8 });
              else if (Q.length > 1 && !z._punktowy) p.drawSvgPath('M' + Q.map(q => `${q[0]} ${-q[1]}`).join(' L') + (z.geom.zamkn ? ' Z' : ''), { x: 0, y: 0, borderColor: k, borderWidth: 1.1 });
              else { const [X, Y] = Q[0]; p.drawSvgPath(`M${X} ${-Y - 3.6} L${X + 3.6} ${-Y} L${X} ${-Y + 3.6} L${X - 3.6} ${-Y} Z`, { x: 0, y: 0, color: k, borderColor: hexRgb('#ffffff'), borderWidth: 0.6 }); }
            }
            const sn = cel ? `str. ${nrStrony(cel)}` : '';
            tekst(p, sn, tx + tw - szer(sn, fM, 7.5), ty - 13, 7.5, fM, KOL.jasny);
            tekst(p, skroc(pl.a.nazwa, fB, 8.5, tw - szer(sn, fM, 7.5) - 10), tx, ty - 13, 8.5, fB, KOL.tekst);
            if (cel) link(p, [tx, ty - 16, tx + tw, ty + th], cel);
            tx += tw + g;
          }
          top -= wysR(r) + lab + g;
        }
        if (plany.length > kafle.length) tekst(p, `+ ${ile(plany.length - kafle.length, 'kolejny arkusz', 'kolejne arkusze', 'kolejnych arkuszy')} w dokumencie`, RX, reg[1] - 4, 8.5, fR, KOL.szary);
      }
      // zawartość — komórki jak w tabliczce
      const zaw = tryb === 'robocza' ? [[Zm.length, 'zmiana lub uwaga', 'zmiany lub uwagi', 'zmian lub uwag'], [arkusze.length, 'plan roboczy', 'plany robocze', 'planów roboczych']]
        : [[zdjecia.length, 'zdjęcie', 'zdjęcia', 'zdjęć'], [F.length, 'punkt fotograficzny', 'punkty fotograficzne', 'punktów fotograficznych'],
          tryb === 'docelowa' ? [ZmF.length, 'zmiana ze zdjęciem', 'zmiany ze zdjęciami', 'zmian ze zdjęciami'] : [Zm.length, 'zmiana lub uwaga', 'zmiany lub uwagi', 'zmian lub uwag'],
          [arkusze.length, ...(tryb === 'docelowa' ? ['arkusz planu', 'arkusze planu', 'arkuszy planu'] : ['plan', 'plany', 'planów'])]];
      const cwz = RW / zaw.length;
      p.drawLine({ start: { x: RX, y: 150 }, end: { x: RX + RW, y: 150 }, thickness: 0.9, color: hexRgb(KOL.navy) });
      zaw.forEach(([n, j, d, wl], i) => {
        const x = RX + i * cwz; if (i) p.drawLine({ start: { x, y: 106 }, end: { x, y: 144 }, thickness: 0.5, color: hexRgb(KOL.linia) });
        const px = x + (i ? 10 : 0); tekst(p, String(n), px, 122, 20, fL, KOL.navy); tekst(p, odmW(n, j, d, wl), px, 108, 8.5, fR, KOL.szary);
      });
      let bx = RX; if (strSpis[0]) bx += przycisk(p, 'Spis zdjęć', bx, 60, strSpis[0], { tlo: KOL.navy, ramka: KOL.navy, kolor: '#ffffff' }) + 8;
      if (strZm[0]) bx += przycisk(p, 'Zestawienie zmian i uwag', bx, 60, strZm[0]) + 8;
      tekst(p, tryb === 'robocza' ? 'Wiersze zestawienia i oznaczenia na planach są klikalne. Dane do CAD: pliki zmiany_<plan>.dxf i zmiany.json w paczce ZIP.'
        : 'Numery na planach i miniatury są klikalne. Pełna rozdzielczość zdjęć: folder „zdjecia” w paczce ZIP.', RX, 38, 8, fR, KOL.szary);
    }
    /* 4. Zestawienie zmian Z */
    strZm.forEach((p, s) => {
      const [w, h] = A4;
      naglowekStrony(p, 'Zestawienie zmian i uwag', `${ile(Zm.length, 'pozycja', 'pozycje', 'pozycji')} — różnice między rysunkiem a stanem na obiekcie. Stuknij wiersz, aby przejść do zdjęcia lub planu.`);
      let y = h - 100;
      p.drawRectangle({ x: 28, y: y - 6, width: w - 56, height: 20, color: hexRgb(KOL.tlo) });
      KOLZ.forEach(([x, t]) => tekst(p, t, x + (x === 28 ? 6 : 0), y, 7.5, fB, KOL.szary)); y -= 22;
      for (const r of strZmW[s]) {
        const z = r.z, kz = kolor(z), yt = y - 2;
        const kod = z.nr, bw = szer(kod, fM, 8) + 10; prost(p, 30, yt - 3.5, bw, 13, 3.5, { color: hexRgb(kz) }); tekst(p, kod, 35, yt, 8, fM, '#ffffff');
        r.rd.forEach((t, i) => tekst(p, t, KOLZ[1][0], yt - i * 11, 8.5, fR, KOL.tekst));
        r.el.forEach((t, i) => tekst(p, t, KOLZ[2][0], yt - i * 11, 8.5, fR, KOL.tekst));
        r.op.forEach((t, i) => tekst(p, t, KOLZ[3][0], yt - i * 11, 8.5, fR, KOL.tekst));
        r.wy.forEach((t, i) => tekst(p, t, KOLZ[4][0], yt - i * 11, 8.5, fR, z.typZ === 'wymiar' ? KOL.wymiar : KOL.jasny));
        tekst(p, z.zrodlo || '—', KOLZ[5][0], yt, 8.5, fB, KOL.tekst); tekst(p, String((z.zdjecia || []).length || '—'), KOLZ[6][0], yt, 8.5, fM, KOL.tekst);
        const dol = y - r.h + 6; p.drawLine({ start: { x: 28, y: dol }, end: { x: w - 28, y: dol }, thickness: 0.45, color: hexRgb(KOL.linia) });
        const cel = pierwszeZdj.has(z.id) ? strZdj[pierwszeZdj.get(z.id)] : strPlan.get(z.arkuszId);
        if (cel) link(p, [28, dol, w - 28, y + 10], cel);
        y -= r.h;
      }
      tabliczka(p, nrStrony(p), razem);
    });
    /* 5. Plany z naniesionymi znacznikami */
    let ia = 0;
    for (const pl of plany) {
      const a = pl.a, p = strPlan.get(a.id), P = PODK.get(a.id); if (!p) continue;
      postep(0.08 + 0.12 * (ia++ / Math.max(1, arkusze.length)), `Rysuję plan „${a.nazwa}”…`);
      wstawPodklad(p, P, P.pl.p, P.pl.ox, P.pl.oy, null);
      const w = P.w, h = P.h, sk = skA(P), NAGL = pl.naglowek ? naglA(P) : 0;
      if (pl.naglowek) { // arkusz docelowy PDF zostaje w oryginalnej postaci (bez nagłówka) — ma własną tabliczkę z ZWCAD
        p.drawRectangle({ x: 0, y: h, width: w, height: NAGL, color: hexRgb('#ffffff') });
        p.drawRectangle({ x: 0, y: h + NAGL - 4 * sk, width: w, height: 4 * sk, color: hexRgb(KOL.navy) });
        p.drawRectangle({ x: 18 * sk, y: h + NAGL - 4 * sk - 2.6 * sk, width: 24 * sk, height: 2.6 * sk, color: hexRgb(KOL.orange) });
        p.drawLine({ start: { x: 0, y: h }, end: { x: w, y: h }, thickness: 0.9 * sk, color: hexRgb(KOL.navy) });
        tekst(p, a.nazwa, 18 * sk, h + 27 * sk, 15 * sk, fB, KOL.navy);
        tekst(p, tryb === 'robocza' ? 'Plan roboczy — stuknij oznaczenie zmiany, aby przejść do zestawienia' : tryb === 'docelowa' ? 'Stuknij znacznik, aby otworzyć zdjęcie' : 'Plan roboczy — stuknij znacznik, aby otworzyć zdjęcie lub pozycję zestawienia', 18 * sk, h + 12 * sk, 8.5 * sk, fR, KOL.szary);
        // prawa strona: numer opracowania i strona (zamiast stopki — rysunek zostaje nienaruszony)
        let rx = w - 18 * sk; const sNr = `${nrStrony(p)} / ${razem}`;
        const kom = [['Strona', sNr], ['Nr opracowania', m.nr || '—']];
        for (const [et, wart] of kom) { const cw = Math.max(szer(wart, fM, 9.5 * sk), szer(et, fB, 6.5 * sk)); rx -= cw; tekst(p, et, rx, h + 30 * sk, 6.5 * sk, fB, KOL.jasny); tekst(p, wart, rx, h + 14 * sk, 9.5 * sk, fM, KOL.tekst); rx -= 14 * sk; p.drawLine({ start: { x: rx + 2 * sk, y: h + 10 * sk }, end: { x: rx + 2 * sk, y: h + 40 * sk }, thickness: 0.5 * sk, color: hexRgb(KOL.linia) }); rx -= 12 * sk; }
        const typy = Object.keys(NAZWY_LEG).filter(t => pl.znaczniki.some(z => typZnacznika(z) === t));
        for (const t of typy.reverse()) { const tw = szer(NAZWY_LEG[t], fR, 8.5 * sk); rx -= tw; tekst(p, NAZWY_LEG[t], rx, h + 19 * sk, 8.5 * sk, fR, KOL.tekst); rx -= 17 * sk; glif(p, t, rx, h + 22 * sk, sk); rx -= 14 * sk; }
      }
      const r0 = promienPlanu(P);
      for (const z of pl.znaczniki) {
        const pts = z.geom.pkt.map(q => naPlanie(a, q)); const kol = hexRgb(kolor(z));
        let rect;
        if (z.rodzaj === 'F') {
          const [x, y] = pts[0];
          if (z.kier !== null && z.kier !== undefined) p.drawSvgPath(klin(x, h + NAGL - y, r0 * 4.2, z.kier), { x: 0, y: h + NAGL, color: hexRgb('#22C3E6'), opacity: 0.25, borderColor: kol, borderWidth: 0.6 * sk / 1.4 });
          p.drawCircle({ x, y, size: r0, color: kol, borderColor: hexRgb('#ffffff'), borderWidth: r0 * 0.16 });
          const t = String(parseInt(z.nr.slice(2), 10)), fs = r0 * (t.length > 2 ? 0.8 : 1.0);
          tekst(p, t, x - szer(t, fM, fs) / 2, y - fs * 0.36, fs, fM, '#ffffff');
          rect = [x - r0 * 1.3, y - r0 * 1.3, x + r0 * 1.3, y + r0 * 1.3];
        } else {
          const lw = r0 * 0.22;
          if (z.geom.kreski && !z._punktowy) { for (const k of z.geom.kreski) { const Q = k.pkt.map(q => naPlanie(a, q)); if (Q.length < 2) continue; p.drawSvgPath('M' + Q.map(q => `${q[0]} ${h + NAGL - q[1]}`).join(' L') + (k.zamkn ? ' Z' : ''), { x: 0, y: h + NAGL, borderColor: kol, borderWidth: lw * 0.8 }); } } // szkic / notatka z wielu kresek
          else if (pts.length > 1) { const d = 'M' + pts.map(q => `${q[0]} ${h + NAGL - q[1]}`).join(' L') + (z.geom.zamkn ? ' Z' : ''); p.drawSvgPath(d, { x: 0, y: h + NAGL, borderColor: kol, borderWidth: lw, borderDashArray: z.typZ === 'brak' ? [lw * 3, lw * 2] : undefined }); }
          if (z.typZ === 'brak' && pts.length > 2) { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); p.drawLine({ start: { x: Math.min(...xs), y: Math.min(...ys) }, end: { x: Math.max(...xs), y: Math.max(...ys) }, thickness: lw * 0.6, color: kol }); p.drawLine({ start: { x: Math.min(...xs), y: Math.max(...ys) }, end: { x: Math.max(...xs), y: Math.min(...ys) }, thickness: lw * 0.6, color: kol }); }
          if (z.typZ === 'uwaga' || z._punktowy) { const [x, y] = pts[0]; p.drawSvgPath(`M${x} ${h + NAGL - y - r0} L${x + r0} ${h + NAGL - y} L${x} ${h + NAGL - y + r0} L${x - r0} ${h + NAGL - y} Z`, { x: 0, y: h + NAGL, color: kol, borderColor: hexRgb('#ffffff'), borderWidth: r0 * 0.12 }); }
          const [lx0, ly0] = z.typZ === 'wymiar' && pts.length === 2 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2 + r0 * 1.3] : (z.typZ === 'uwaga' || z._punktowy) ? [pts[0][0] + r0 * 2.2, pts[0][1] + r0] : [pts[0][0], pts[0][1] + r0 * 1.3];
          let t = 'Z' + parseInt(z.nr.slice(2), 10); if (z.typZ === 'wymiar' && !z._punktowy && Number.isFinite(z.wymPom)) t += '  ' + opisWymiaru(z, S, R, true);
          const fs = r0 * 0.95, tw = szer(t, fB, fs) + fs * 1.1, th = fs * 1.55;
          prost(p, lx0 - tw / 2, ly0 - fs * 0.55, tw, th, th * 0.3, { color: kol, borderColor: hexRgb('#ffffff'), borderWidth: fs * 0.1 });
          tekst(p, t, lx0 - tw / 2 + fs * 0.55, ly0 - fs * 0.16, fs, fB, '#ffffff');
          rect = [lx0 - tw / 2, ly0 - fs * 0.55, lx0 + tw / 2, ly0 + fs];
        }
        const cel = pierwszeZdj.has(z.id) ? strZdj[pierwszeZdj.get(z.id)] : (z.rodzaj === 'Z' && stronaZm.has(z.id) ? strZm[stronaZm.get(z.id)] : null);
        if (cel && rect) link(p, rect, cel);
      }
    }
    /* 6. Strony zdjęć: zdjęcie na pierwszym planie, po prawej mini-plan, opis i dane */
    const jakosc = opcje.jakoscPdf || 1600;
    const OBRAZY = new Map(), CZAS = new Map(); // każde zdjęcie osadzone raz — strona zdjęcia i miniatura w spisie używają tego samego obrazu
    for (const [n, x] of zdjecia.entries()) {
      postep(0.2 + 0.75 * n / Math.max(1, zdjecia.length), `Zdjęcie ${n + 1} z ${zdjecia.length}…`);
      const p = strZdj[n], [w, h] = A4, z = x.z, mp = gdzie.get(z.id), a = mp && mp.a, P = a && PODK.get(a.id), zg = mp ? mp.z : z;
      const kz = kolor(z);
      if (!OBRAZY.has(x.id)) {
        const rek = await Baza.zdjecie(x.id); let jpg = null;
        if (rek) { const img = await obrazZPliku(new Blob([rek.dane], { type: 'image/jpeg' })); const { blob } = await jpegZObrazu(img, jakosc, 0.8); jpg = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer())); CZAS.set(x.id, rek.czas); }
        OBRAZY.set(x.id, jpg);
      }
      const jpg = OBRAZY.get(x.id);
      // nagłówek: numer zdjęcia, rodzaj, element
      p.drawRectangle({ x: 28, y: h - 31, width: 24, height: 2.6, color: hexRgb(KOL.orange) });
      tekst(p, z.nr, 28, h - 56, 22, fB, kz); let hx = 28 + szer(z.nr, fB, 22);
      const nr1 = '/' + (x.i + 1); tekst(p, nr1, hx + 1, h - 56, 22, fL, KOL.jasny); hx += szer(nr1, fL, 22) + 14;
      hx += chip(p, z.rodzaj === 'F' ? 'Punkt fotograficzny' : (TYPY[z.typZ] || 'Zmiana'), hx, h - 52.5, kz, 8);
      const el = [z.element, z.kategoria].filter(Boolean).join(', ');
      if (el) tekst(p, skroc(el, fR, 11, 480), 28, h - 74, 11, fR, KOL.tekst);
      const zz = z.zdjecia.length > 1 ? `zdjęcie ${x.i + 1} z ${z.zdjecia.length}` : '', nazwaA = a ? a.nazwa : ((S.arkusze.find(q => q.id === z.arkuszId) || {}).nazwa || '');
      if (zz) tekst(p, zz, w - 28 - szer(zz, fR, 8.5), h - 45, 8.5, fR, KOL.szary);
      if (nazwaA) { const t = skroc(nazwaA, fR, 8.5, 240); tekst(p, t, w - 28 - szer(t, fR, 8.5), h - 58, 8.5, fR, KOL.jasny); }
      // zdjęcie
      const box = [28, 96, 526, h - 88 - 96];
      if (jpg) {
        const k = Math.min(box[2] / jpg.width, box[3] / jpg.height), iw = jpg.width * k, ih = jpg.height * k;
        if (iw < box[2] - 1) { p.drawRectangle({ x: box[0], y: box[1], width: box[2], height: box[3], color: hexRgb(KOL.tlo) }); p.drawImage(jpg, { x: box[0] + (box[2] - iw) / 2, y: box[1], width: iw, height: ih }); } // pionowe — na tle
        else { p.drawImage(jpg, { x: box[0], y: box[1] + box[3] - ih, width: iw, height: ih }); p.drawRectangle({ x: box[0], y: box[1] + box[3] - ih, width: iw, height: ih, borderColor: hexRgb(KOL.linia), borderWidth: 0.5 }); }
      } else { p.drawRectangle({ x: box[0], y: box[1], width: box[2], height: box[3], color: hexRgb(KOL.tlo) }); tekst(p, 'Brak pliku zdjęcia w pamięci urządzenia.', box[0] + 20, box[1] + box[3] / 2, 11, fB, KOL.brak); }
      // mini-plan
      const mx = 572, mw = w - 28 - mx, mh = 166, my = h - 88 - mh;
      if (P) {
        p.drawRectangle({ x: mx, y: my, width: mw, height: mh, color: hexRgb('#ffffff') });
        const c = zg.geom.pkt[0], okno = clamp(Math.max(P.w, P.h) / 5.5, 70, 1000) / P.pl.p, pk = Math.min(mw, mh) / okno; // okno w jednostkach arkusza
        const ox = mx + mw / 2 - c[0] * pk, oy = my + mh / 2 + c[1] * pk;
        wstawPodklad(p, P, pk, ox, oy, [mx, my, mw, mh]);
        const S2 = (q) => [ox + q[0] * pk, oy - q[1] * pk];
        const pts = zg.geom.pkt.map(S2), kk = hexRgb(kz);
        if (z.rodzaj === 'F') {
          const [X, Y] = pts[0];
          if (zg.kier !== null && zg.kier !== undefined) p.drawSvgPath(klin(X, h - Y, 46, zg.kier), { x: 0, y: h, color: hexRgb('#22C3E6'), opacity: 0.3, borderColor: kk, borderWidth: 0.8 });
          p.drawCircle({ x: X, y: Y, size: 6, color: kk, borderColor: hexRgb('#ffffff'), borderWidth: 1.4 });
        } else if (pts.length > 1) {
          const linie = zg.geom.kreski ? zg.geom.kreski.map(k => ({ Q: k.pkt.map(S2), zamkn: k.zamkn })) : [{ Q: pts, zamkn: zg.geom.zamkn }];
          p.pushOperators(pushGraphicsState(), rectangle(mx, my, mw, mh), clip(), endPath());
          for (const { Q, zamkn } of linie) { if (Q.length < 2) continue; const d = 'M' + Q.map(q => `${clamp(q[0], mx - 50, mx + mw + 50)} ${h - clamp(q[1], my - 50, my + mh + 50)}`).join(' L') + (zamkn ? ' Z' : ''); p.drawSvgPath(d, { x: 0, y: h, borderColor: kk, borderWidth: 2 }); }
          p.pushOperators(popGraphicsState());
        } else { const [X, Y] = pts[0]; p.drawSvgPath(`M${X} ${h - Y - 7} L${X + 7} ${h - Y} L${X} ${h - Y + 7} L${X - 7} ${h - Y} Z`, { x: 0, y: h, color: kk, borderColor: hexRgb('#ffffff'), borderWidth: 1 }); }
        p.drawRectangle({ x: mx, y: my, width: mw, height: mh, borderColor: hexRgb(KOL.linia2), borderWidth: 0.7 });
        const fitR = (() => { const pp = naPlanie(a, c), r = clamp(Math.max(P.w, P.h) / 12, 40, 1200); return [pp[0] - r, pp[1] - r * 0.65, pp[0] + r, pp[1] + r * 0.65]; })();
        link(p, [mx, my, mx + mw, my + mh], strPlan.get(a.id), fitR);
        tekst(p, 'Miejsce na planie — stuknij, aby powiększyć', mx, my - 12, 7.5, fR, KOL.szary);
      } else {
        p.drawRectangle({ x: mx, y: my, width: mw, height: mh, color: hexRgb(KOL.tlo) });
        zawin(tryb === 'docelowa' ? 'Miejsce tego zdjęcia leży poza zakresem planu.' : 'Brak podkładu dla tego znacznika.', fR, 9, mw - 30, 3).forEach((t, i) => tekst(p, t, mx + 15, my + mh / 2 + 4 - i * 12, 9, fR, KOL.szary));
      }
      // dane (od dołu kolumny) i opis (nad nimi)
      const aW = a || S.arkusze.find(q => q.id === z.arkuszId), zW = a ? zg : z; // współrzędne w układzie planu z tego dokumentu
      const dane = [];
      const wsp = polozenie(zW, aW, R, S); if (wsp) dane.push(['Położenie', wsp, true]);
      if (z.rodzaj === 'F' && zW.kier !== null && zW.kier !== undefined) dane.push(['Kierunek', kierunekOpis(zW, aW, R)]);
      if (z.typZ === 'wymiar') dane.push(['Wymiar', opisWymiaru(z, S, R)]);
      dane.push(['Wykonano', dataCzas(CZAS.get(x.id) || z.utw), true]);
      dane.push(['Plik', 'zdjecia/' + plikZdj(z, x.i), true]);
      let dy = 96;
      const wiersze = dane.map(([k, v, mono]) => ({ k, l: zawin(v, mono ? fM : fR, 8.3, mw - 66, 2), mono })).reverse();
      for (const r of wiersze) {
        const hh = 9 + r.l.length * 10.5;
        r.l.forEach((t, i) => tekst(p, t, mx + 64, dy + hh - 12 - i * 10.5, 8.3, r.mono ? fM : fR, KOL.tekst));
        tekst(p, r.k, mx, dy + hh - 12, 7.5, fB, KOL.jasny);
        dy += hh; p.drawLine({ start: { x: mx, y: dy }, end: { x: mx + mw, y: dy }, thickness: 0.45, color: hexRgb(KOL.linia) });
      }
      const opTop = my - 34, opDol = dy + 14;
      tekst(p, 'Opis', mx, opTop + 4, 7.5, fB, KOL.jasny);
      // długi opis (np. dyktowany): najpierw mniejsza czcionka, dopiero potem skrót z odesłaniem do pełnego tekstu
      let rozm = 9.5, lh = 13, lin; for (const [r0, l0] of [[9.5, 13], [8.6, 11.6], [7.8, 10.4]]) { rozm = r0; lh = l0; lin = zawin(z.opis || 'Bez opisu.', fR, rozm, mw); if (lin.length <= Math.floor((opTop - 10 - opDol) / lh) + 1) break; }
      const maxL = Math.max(1, Math.floor((opTop - 10 - opDol) / lh) + 1);
      let dopisek = -1; if (lin.length > maxL) { lin = zawin(z.opis, fR, rozm, mw, maxL - 1); dopisek = lin.length; lin.push('Pełny opis: zestawienie_zdjec.csv w paczce ZIP.'); }
      lin.forEach((t, i) => tekst(p, t, mx, opTop - 10 - i * lh, rozm, fR, z.opis && i !== dopisek ? KOL.tekst : KOL.jasny));
      // nawigacja
      let nx = 28; const nav = [['‹ Poprzednie', n > 0 ? strZdj[n - 1] : null], ['Spis zdjęć', strSpis[Math.floor(n / NA_STR_SPISU)]], ['Plan', a ? strPlan.get(a.id) : null], ['Następne ›', n < zdjecia.length - 1 ? strZdj[n + 1] : null]];
      for (const [t, cel] of nav) nx += przycisk(p, t, nx, 62, cel) + 7;
      tabliczka(p, nrStrony(p), razem);
      if (n % 8 === 7) await czekaj(0); // oddech dla przeglądarki
    }
    /* 7. Spis zdjęć — stykówka z miniaturami (te same obrazy co na stronach zdjęć) */
    strSpis.forEach((p, s) => {
      const [w, h] = A4, kol = 5, gx = 14, cw = (w - 56 - gx * (kol - 1)) / kol, th = cw * 0.75, ch = th + 30, gy = 13, top = h - 86;
      naglowekStrony(p, 'Spis zdjęć', `${ile(zdjecia.length, 'zdjęcie', 'zdjęcia', 'zdjęć')} — stuknij miniaturę, aby otworzyć stronę zdjęcia.`);
      zdjecia.slice(s * NA_STR_SPISU, (s + 1) * NA_STR_SPISU).forEach((x, k) => {
        const n = s * NA_STR_SPISU + k, c = k % kol, r = Math.floor(k / kol), cx = 28 + c * (cw + gx), cy = top - r * (ch + gy) - th; // cy — dół miniatury
        const jpg = OBRAZY.get(x.id);
        p.drawRectangle({ x: cx, y: cy, width: cw, height: th, color: hexRgb(KOL.tlo) });
        if (jpg) {
          const k2 = Math.max(cw / jpg.width, th / jpg.height), iw = jpg.width * k2, ih = jpg.height * k2;
          p.pushOperators(pushGraphicsState(), rectangle(cx, cy, cw, th), clip(), endPath());
          p.drawImage(jpg, { x: cx + (cw - iw) / 2, y: cy + (th - ih) / 2, width: iw, height: ih });
          p.pushOperators(popGraphicsState());
        } else tekst(p, 'brak pliku zdjęcia', cx + 10, cy + th / 2, 8, fR, KOL.szary);
        p.drawRectangle({ x: cx, y: cy, width: cw, height: th, borderColor: hexRgb(KOL.linia), borderWidth: 0.5 });
        const kod = nrZdj(x.z, x.i), bw = szer(kod, fM, 7.5) + 9;
        prost(p, cx + 5, cy + th - 17, bw, 12, 3, { color: hexRgb(kolor(x.z)) }); tekst(p, kod, cx + 9.5, cy + th - 13.6, 7.5, fM, '#ffffff');
        const tyt = x.z.element || (x.z.rodzaj === 'F' ? 'Punkt fotograficzny' : (TYPY[x.z.typZ] || 'Zmiana')), sn = 'str. ' + nrStrony(strZdj[n]);
        tekst(p, sn, cx + cw - szer(sn, fM, 8), cy - 13, 8, fM, KOL.jasny);
        tekst(p, skroc(tyt, fB, 8.5, cw - szer(sn, fM, 8) - 8), cx, cy - 13, 8.5, fB, KOL.tekst);
        if (x.z.opis) tekst(p, skroc(x.z.opis, fR, 7.8, cw), cx, cy - 24, 7.8, fR, KOL.szary);
        link(p, [cx, cy - 28, cx + cw, cy + th], strZdj[n]);
      });
      tabliczka(p, nrStrony(p), razem);
    });
    postep(0.97, 'Zapisuję PDF…');
    return doc.save({ useObjectStreams: true });
  }
  function klin(x, ySvg, r, kat) { // wycinek koła (stożek widzenia) w układzie SVG (y w dół)
    const a0 = kat - 0.5, a1 = kat + 0.5;
    return `M${x} ${ySvg} L${x + r * Math.cos(a0)} ${ySvg + r * Math.sin(a0)} A${r} ${r} 0 0 1 ${x + r * Math.cos(a1)} ${ySvg + r * Math.sin(a1)} Z`;
  }

  /* Podkład DXF → osobna strona PDF z wektorami (potem wstawiana jak strona PDF). */
  async function podkladDxf(PDFDocument, r, f, docGlowny) {
    const d = r.dxf, z = d.zasieg, wid = r.warstwyWid || {};
    const Wd = Math.max(1, z.maxx - z.minx), Hd = Math.max(1, z.maxy - z.miny);
    const mar = 30, p0 = Math.min((2384 - 2 * mar) / Wd, (1684 - 2 * mar) / Hd); // rysunek mieści się na arkuszu A1
    const Wt = Wd * p0 + 2 * mar, Ht = Hd * p0 + 2 * mar;
    const tmp = await PDFDocument.create(); tmp.registerFontkit(fontkit); const font = await tmp.embedFont(f.R, { subset: true });
    const pg = tmp.addPage([Wt, Ht]);
    const X = (sx) => (sx - z.minx) * p0 + mar, Y = (sy) => (sy - z.miny) * p0 + mar; // układ SVG strony (y w dół)
    const r3 = (v) => Math.round(v * 100) / 100;
    for (const gr of d.grupy) {
      if (wid[gr.warstwa] === false) continue;
      let s = '', n = 0;
      const wyslij = () => { if (s) pg.drawSvgPath(s, { x: 0, y: Ht, borderColor: PDFLib.rgb(0.16, 0.16, 0.15), borderWidth: 0.35 }); s = ''; n = 0; };
      for (const a of gr.linie) { s += `M${r3(X(a[0]))} ${r3(Y(a[1]))}`; for (let i = 2; i < a.length; i += 2) s += `L${r3(X(a[i]))} ${r3(Y(a[i + 1]))}`; n += a.length; if (n > 40000) wyslij(); }
      wyslij();
    }
    for (const t of d.teksty) {
      if (wid[t.war] === false) continue;
      const fs = t.h * p0; if (fs < 1.2) continue;
      const linie = t.t.split('\n'); const kat = -t.rot; // w PDF obrót przeciwnie do wskazówek zegara
      linie.forEach((l, i) => {
        if (!l.trim()) return;
        const tw = font.widthOfTextAtSize(l, fs);
        let dx = t.poz === 'C' ? -tw / 2 : t.poz === 'R' ? -tw : 0;
        let dy = t.pion === 'T' ? -fs : t.pion === 'M' ? -fs * 0.5 : 0; dy -= i * fs * 1.25; if (t.mt && t.pion === 'B') dy += (linie.length - 1) * fs * 1.25;
        const x0 = X(t.x), y0 = Ht - Y(t.y), c = Math.cos(kat), s = Math.sin(kat);
        try { pg.drawText(l, { x: x0 + dx * c - dy * s, y: y0 + dx * s + dy * c, size: fs, font, color: PDFLib.rgb(0.16, 0.16, 0.15), rotate: PDFLib.degrees(kat * 180 / Math.PI) }); } catch (e) { /* znak spoza czcionki — pomijamy */ }
      });
    }
    const bajty = await tmp.save(); const zr = await PDFDocument.load(bajty);
    const emb = await docGlowny.embedPage(zr.getPage(0));
    // V: układ użytkownika strony tymczasowej → arkusz (vx, vy)
    return { emb, V: [1 / p0, 0, 0, -1 / p0, z.minx - mar / p0, (Ht - mar) / p0 + z.miny], L: 0, B: 0, w: Wt, h: Ht, p0, pl: { p: p0, ox: mar - p0 * z.minx, oy: Ht - mar + p0 * z.miny } };
  }

  /* ---------- opisy wartości ---------- */
  function jednostkaUz(S) { return S.ustaw.jedn === 'mm' ? 'mm' : 'm'; }
  function fmtUz(S, mm) { return S.ustaw.jedn === 'mm' ? liczba(mm, 0) + ' mm' : liczba(mm / 1000, 3) + ' m'; }
  function wymRysMm(z, R) { const r = R.get(z.arkuszId); if (!r || !r.T || z.geom.pkt.length < 2) return NaN; const a = Geom.zastosuj(r.T, ...z.geom.pkt[0]), b = Geom.zastosuj(r.T, ...z.geom.pkt[1]); return Geom.odl(a, b) * r.k; }
  function opisWymiaru(z, S, R, krotko) {
    const rys = wymRysMm(z, R), pom = z.wymPom;
    if (krotko) return Number.isFinite(pom) ? `${fmtUz(S, pom)}${Number.isFinite(rys) ? ` (Δ ${znak(pom - rys)} mm)` : ''}` : '';
    const cz = []; if (Number.isFinite(rys)) cz.push('rysunek ' + fmtUz(S, rys)); if (Number.isFinite(pom)) cz.push('pomiar ' + fmtUz(S, pom)); if (Number.isFinite(rys) && Number.isFinite(pom)) cz.push('różnica ' + znak(pom - rys) + ' mm');
    return cz.join(' · ') || '—';
  }
  const znak = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + liczba(Math.abs(v), 0);
  function polozenie(z, a, R, S) { const r = a && R.get(a.id); if (!r || !r.T) return a && a.typ === 'pdf' ? 'plan nieskalibrowany' : ''; const w = Geom.zastosuj(r.T, ...z.geom.pkt[0]); return `X ${fmtUz(S, w[0] * r.k)} · Y ${fmtUz(S, w[1] * r.k)}`; }
  function kierunekOpis(z, a, R) {
    const r = a && R.get(a.id); if (!r || !r.T) return 'zaznaczony na planie';
    const p = z.geom.pkt[0], q = [p[0] + Math.cos(z.kier), p[1] + Math.sin(z.kier)], P = Geom.zastosuj(r.T, ...p), Q = Geom.zastosuj(r.T, ...q);
    let st = Math.atan2(Q[1] - P[1], Q[0] - P[0]) * 180 / Math.PI; if (st < 0) st += 360;
    const kier = ['→ (+X)', '↗', '↑ (+Y)', '↖', '← (−X)', '↙', '↓ (−Y)', '↘'][Math.round(st / 45) % 8];
    return `${liczba(st, 0)}° od osi X rysunku ${kier}`;
  }

  /* ---------- DXF zmian (format R12 — czyta go każdy CAD, także ZWCAD 2022) ---------- */
  const WARSTWY = [['INW-FOTO', 4], ['INW-WYMIAR', 30], ['INW-NOWE', 3], ['INW-BRAK', 1], ['INW-UWAGI', 6], ['INW-SZKIC', 8], ['INW-NUMERY', 7]];
  function dxfTekst(s) { return String(s || '').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, c => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')); }
  function dxfZmian(S, a, r, ids) { // ids — arkusze z tego samego rysunku (kopie planu) łączone w jeden plik DXF
    const T = r.T || { a: 25.4 / 72, b: 0, c: 0, d: -25.4 / 72, e: 0, f: 0 }; // brak kalibracji PDF: mm na papierze
    const L = []; const n = (v) => (Math.round(v * 10000) / 10000).toString();
    const kod = (c, v) => { L.push(String(c), String(v)); };
    const W = (p) => Geom.zastosuj(T, p[0], p[1]);
    const zak = r.typ === 'dxf' ? r.dxf.zasieg : { minx: 0, miny: 0, maxx: r.wym.w, maxy: r.wym.h };
    const span = Math.max(zak.maxx - zak.minx, zak.maxy - zak.miny) * Geom.skala(T);
    const hT = Math.max(1e-6, Math.pow(10, Math.round(Math.log10(span / 350) * 2) / 2));
    const linia = (war, p, q) => { kod(0, 'LINE'); kod(8, war); kod(10, n(p[0])); kod(20, n(p[1])); kod(30, 0); kod(11, n(q[0])); kod(21, n(q[1])); kod(31, 0); };
    const pl = (war, pts, zamkn) => { kod(0, 'POLYLINE'); kod(8, war); kod(66, 1); kod(10, 0); kod(20, 0); kod(30, 0); kod(70, zamkn ? 1 : 0); for (const p of pts) { kod(0, 'VERTEX'); kod(8, war); kod(10, n(p[0])); kod(20, n(p[1])); kod(30, 0); } kod(0, 'SEQEND'); kod(8, war); };
    const okr = (war, p, rr) => { kod(0, 'CIRCLE'); kod(8, war); kod(10, n(p[0])); kod(20, n(p[1])); kod(30, 0); kod(40, n(rr)); };
    const txt = (war, p, t, h, rot = 0) => { kod(0, 'TEXT'); kod(8, war); kod(10, n(p[0])); kod(20, n(p[1])); kod(30, 0); kod(40, n(h)); kod(1, dxfTekst(t)); kod(50, n(rot)); };
    // nagłówek i tablice
    kod(0, 'SECTION'); kod(2, 'HEADER'); kod(9, '$ACADVER'); kod(1, 'AC1009'); kod(9, '$DWGCODEPAGE'); kod(3, 'ANSI_1250'); kod(0, 'ENDSEC');
    kod(0, 'SECTION'); kod(2, 'TABLES');
    kod(0, 'TABLE'); kod(2, 'LTYPE'); kod(70, 1); kod(0, 'LTYPE'); kod(2, 'CONTINUOUS'); kod(70, 0); kod(3, 'Solid line'); kod(72, 65); kod(73, 0); kod(40, 0); kod(0, 'ENDTAB');
    kod(0, 'TABLE'); kod(2, 'LAYER'); kod(70, WARSTWY.length); for (const [w, c] of WARSTWY) { kod(0, 'LAYER'); kod(2, w); kod(70, 0); kod(62, c); kod(6, 'CONTINUOUS'); } kod(0, 'ENDTAB');
    kod(0, 'TABLE'); kod(2, 'STYLE'); kod(70, 1); kod(0, 'STYLE'); kod(2, 'STANDARD'); kod(70, 0); kod(40, 0); kod(41, 1); kod(50, 0); kod(71, 0); kod(42, n(hT)); kod(3, 'txt'); kod(4, ''); kod(0, 'ENDTAB');
    kod(0, 'ENDSEC');
    kod(0, 'SECTION'); kod(2, 'ENTITIES');
    if (!r.T) txt('INW-UWAGI', [0, hT * 4], 'UWAGA: podklad PDF nieskalibrowany - wspolrzedne w mm na papierze, nie w ukladzie rysunku', hT * 1.5);
    for (const z of S.znaczniki.filter(q => (ids || [a.id]).includes(q.arkuszId))) {
      const P = z.geom.pkt.map(W); if (!P.length) continue;
      const nr = z.nr;
      if (z.rodzaj === 'F') {
        okr('INW-FOTO', P[0], hT * 0.9); txt('INW-NUMERY', [P[0][0] + hT * 1.2, P[0][1] + hT * 0.4], nr, hT);
        if (z.kier !== null && z.kier !== undefined) {
          const p = z.geom.pkt[0], q = W([p[0] + Math.cos(z.kier) / Geom.skala(T), p[1] + Math.sin(z.kier) / Geom.skala(T)]);
          const ang = Math.atan2(q[1] - P[0][1], q[0] - P[0][0]), R0 = hT * 4.5;
          for (const da of [-0.5, 0, 0.5]) linia('INW-FOTO', P[0], [P[0][0] + R0 * Math.cos(ang + da), P[0][1] + R0 * Math.sin(ang + da)]);
        }
        continue;
      }
      const war = { wymiar: 'INW-WYMIAR', nowy: 'INW-NOWE', brak: 'INW-BRAK', uwaga: 'INW-UWAGI', szkic: 'INW-SZKIC' }[z.typZ] || 'INW-UWAGI';
      if (z.typZ === 'wymiar' && P.length === 2) {
        linia(war, P[0], P[1]);
        const ang = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]), nx = -Math.sin(ang) * hT * 0.7, ny = Math.cos(ang) * hT * 0.7;
        for (const p of P) linia(war, [p[0] - nx, p[1] - ny], [p[0] + nx, p[1] + ny]);
        let rot = ang * 180 / Math.PI; if (rot > 90.0001 || rot < -89.9999) rot += 180;
        const mid = [(P[0][0] + P[1][0]) / 2 + nx * 1.4, (P[0][1] + P[1][1]) / 2 + ny * 1.4];
        txt(war, mid, `${nr} ${opisWymiaruMm(z, r)}`, hT * 0.9, ((rot % 360) + 360) % 360);
      } else if (z.geom.kreski) { // szkic / notatka: każda kreska osobną polilinią
        for (const k of z.geom.kreski) if (k.pkt.length > 1) pl(war, k.pkt.map(W), !!k.zamkn);
        txt('INW-NUMERY', [P[0][0] + hT * 0.4, P[0][1] + hT * 0.6], nr + (z.element ? ' ' + z.element : ''), hT);
      } else if (P.length > 1) {
        pl(war, P, !!z.geom.zamkn);
        if (z.typZ === 'brak') { const xs = P.map(p => p[0]), ys = P.map(p => p[1]); linia(war, [Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]); linia(war, [Math.min(...xs), Math.max(...ys)], [Math.max(...xs), Math.min(...ys)]); }
        txt('INW-NUMERY', [P[0][0] + hT * 0.4, P[0][1] + hT * 0.6], nr + (z.element ? ' ' + z.element : ''), hT);
      } else {
        const p = P[0], s = hT * 0.8; pl(war, [[p[0], p[1] + s], [p[0] + s, p[1]], [p[0], p[1] - s], [p[0] - s, p[1]]], true);
        txt('INW-NUMERY', [p[0] + hT * 1.3, p[1] + hT * 0.2], nr, hT);
        if (z.opis) txt(war, [p[0] + hT * 1.3, p[1] - hT * 1.3], z.opis.slice(0, 90), hT * 0.75);
      }
    }
    kod(0, 'ENDSEC'); kod(0, 'EOF');
    return L.join('\r\n') + '\r\n';
  }
  function opisWymiaruMm(z, r) { const rys = wymRysMm(z, new Map([[z.arkuszId, r]])), pom = z.wymPom; const c = []; if (Number.isFinite(rys)) c.push('rys. ' + Math.round(rys)); if (Number.isFinite(pom)) c.push('pom. ' + Math.round(pom)); if (Number.isFinite(rys) && Number.isFinite(pom)) c.push('roznica ' + (pom - rys >= 0 ? '+' : '') + Math.round(pom - rys)); return c.join(' / ') + ' mm'; }

  /* ---------- zestawienia CSV, dane dla AI ---------- */
  function csv(wiersze) { const q = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return '﻿' + wiersze.map(w => w.map(q).join(';')).join('\r\n') + '\r\n'; }
  function zestawienia(S, R, planDocelowy) { // planDocelowy: Map(id znacznika → nazwa arkusza docelowego) — opcjonalnie
    const { zdjecia, Zm } = uporzadkuj(S); const ark = (id) => (S.arkusze.find(a => a.id === id) || {}).nazwa || '';
    const wsp = (z) => { const r = R.get(z.arkuszId); if (!r || !r.T) return ['', '']; const w = Geom.zastosuj(r.T, ...z.geom.pkt[0]); return [liczba(w[0] * r.k / 1000, 3), liczba(w[1] * r.k / 1000, 3)]; };
    const pd = planDocelowy instanceof Map;
    const zd = [['Nr zdjęcia', 'Plik', 'Znacznik', 'Rodzaj', 'Plan (teren)', ...(pd ? ['Plan docelowy'] : []), 'Element', 'Kategoria', 'X [m]', 'Y [m]', 'Opis']];
    for (const x of zdjecia) { const [X, Y] = wsp(x.z); zd.push([nrZdj(x.z, x.i), 'zdjecia/' + plikZdj(x.z, x.i), x.z.nr, x.z.rodzaj === 'F' ? 'foto' : TYPY[x.z.typZ], ark(x.z.arkuszId), ...(pd ? [planDocelowy.get(x.z.id) || 'poza planem'] : []), x.z.element, x.z.kategoria, X, Y, x.z.opis]); }
    const zm = [['Nr', 'Rodzaj', 'Plan', 'Element', 'Kategoria', 'Źródło', 'Wymiar z rysunku [mm]', 'Pomiar [mm]', 'Różnica [mm]', 'X [m]', 'Y [m]', 'Opis', 'Zdjęcia']];
    for (const z of Zm) { const rys = z.typZ === 'wymiar' ? wymRysMm(z, R) : NaN, [X, Y] = wsp(z); zm.push([z.nr, TYPY[z.typZ], ark(z.arkuszId), z.element, z.kategoria, z.zrodlo, Number.isFinite(rys) ? Math.round(rys) : '', Number.isFinite(z.wymPom) ? Math.round(z.wymPom) : '', Number.isFinite(rys) && Number.isFinite(z.wymPom) ? Math.round(z.wymPom - rys) : '', X, Y, z.opis, (z.zdjecia || []).map((_, i) => plikZdj(z, i)).join(', ')]); }
    return { zdjecia: csv(zd), zmiany: csv(zm) };
  }
  function daneDlaAI(S, R) {
    const { Zm } = uporzadkuj(S);
    return {
      format: 'tek-inw-zmiany', wersja: 1, program: `${APP.nazwa} ${APP.wersja}`, wygenerowano: new Date().toISOString(),
      projekt: { nazwa: S.meta.nazwa, adres: S.meta.adres, nr: S.meta.nr, autor: S.meta.autor, data: S.meta.data },
      zasady: 'Współrzędne w układzie rysunku źródłowego (DXF: jednostki pliku; PDF: mm po kalibracji). Wartości „pomiar” pochodzą z dalmierza i mają pierwszeństwo przed rysunkiem. Nie zgaduj wymiarów, których tu nie ma.',
      arkusze: S.arkusze.map(a => { const r = R.get(a.id); return { id: a.id, nazwa: a.nazwa, podklad: a.zrodlo.nazwa, typ: a.typ, kalibracja: !!(r && r.T), jednostkaWspolrzednych: r ? (r.typ === 'dxf' ? `jednostka DXF (${r.dxf.jednostki}; 1 = ${r.k} mm)` : r.T ? 'mm' : 'mm na papierze (brak kalibracji)') : '' }; }),
      zmiany: Zm.map(z => { const r = R.get(z.arkuszId), T = r && r.T; return {
        nr: z.nr, rodzaj: z.typZ, opisRodzaju: TYPY[z.typZ], arkusz: z.arkuszId, element: z.element || null, kategoria: z.kategoria || null, zrodlo: z.zrodlo || null, opis: z.opis || null,
        geometria: { typ: z.geom.typ, zamknieta: !!z.geom.zamkn, punkty: T ? z.geom.pkt.map(p => Geom.zastosuj(T, ...p).map(v => Math.round(v * 1000) / 1000)) : null, punktyArkusza: z.geom.pkt,
          kreski: z.geom.kreski ? z.geom.kreski.map(k => ({ ksztalt: k.ksztalt || 'odreczna', zamknieta: !!k.zamkn, punkty: T ? k.pkt.map(p => Geom.zastosuj(T, ...p).map(v => Math.round(v * 1000) / 1000)) : null })) : undefined },
        wymiar: z.typZ === 'wymiar' ? { rysunek_mm: Number.isFinite(wymRysMm(z, R)) ? Math.round(wymRysMm(z, R)) : null, pomiar_mm: Number.isFinite(z.wymPom) ? Math.round(z.wymPom) : null } : undefined,
        zdjecia: (z.zdjecia || []).map((_, i) => 'zdjecia/' + plikZdj(z, i)) }; })
    };
  }
  const PROMPT = (S) => `Zadanie dla Claude (TEK-RYSOWNIK / ZWCAD) — naniesienie wyników inwentaryzacji

Projekt: ${S.meta.nazwa || ''}
W załączeniu: zmiany.json (lista zmian z TEK-INW), pliki zmiany_*.dxf (podgląd w układzie rysunku), zdjęcia.

1. Otwórz rysunek źródłowy i wstaw zmiany_<plan>.dxf jako odnośnik (XREF) w punkcie 0,0, skala 1 — sprawdź, czy znaczniki trafiają w elementy.
2. Dla każdej pozycji z zmiany.json:
   • „wymiar” — popraw położenie/wymiar elementu tak, by odległość między punktami była równa „pomiar_mm”. Nie zmieniaj innych wymiarów.
   • „nowy” — narysuj element wg geometrii (punkty w układzie rysunku), na właściwej warstwie projektu.
   • „brak” — usuń element zakreślony obrysem (najpierw pokaż mi listę, co usuwasz).
   • „uwaga” i „szkic” — tylko pokaż mi je; nic nie rysuj bez mojej decyzji.
3. Rysuj moim standardem (warstwy, bloki, opisy). Wymiary bierz wyłącznie z pliku — niczego nie odczytuj „na oko” z rysunku.
4. Na koniec wypisz zmiany, których nie udało się jednoznacznie nanieść.
`;

  /* ---------- paczka ZIP ---------- */
  async function paczka(S, R, opcje, postep) {
    const pliki = []; const enc = (s) => fflate.strToU8(s);
    const baza = nazwaPl(S.meta.nr || S.meta.nazwa, 40);
    const { zdjecia } = uporzadkuj(S);
    const czPdf = opcje.pdfRoboczy ? 0.6 : 0.7;
    if (opcje.pdf) { const pdf = await fotodokumentacja(S, R, (f, t) => postep(f * czPdf, t), opcje); pliki.push([`${baza}_fotodokumentacja.pdf`, pdf, false]); }
    if (opcje.pdfRoboczy) { const pdf = await fotodokumentacja(S, R, (f, t) => postep(czPdf + f * 0.1, 'Zestawienie zmian: ' + t), { tryb: 'robocza', plany: opcje.planyRobocze }); pliki.push([`${baza}_zmiany_robocze.pdf`, pdf, false]); }
    postep(0.72, 'Dodaję zdjęcia…');
    if (opcje.zdjecia || opcje.kopia) {
      for (const [k, x] of zdjecia.entries()) { const rek = await Baza.zdjecie(x.id); if (rek) pliki.push(['zdjecia/' + plikZdj(x.z, x.i), new Uint8Array(rek.dane), false]); if (k % 20 === 19) { postep(0.72 + 0.1 * k / zdjecia.length, `Zdjęcia ${k + 1}/${zdjecia.length}…`); await czekaj(0); } }
    }
    if (opcje.zestawienia) { const z = zestawienia(S, R, opcje.planDocelowy); pliki.push(['zestawienie_zdjec.csv', enc(z.zdjecia), true], ['zestawienie_zmian.csv', enc(z.zmiany), true]); }
    if (opcje.dxf) {
      // kopie planu z tego samego rysunku (ten sam plik i strona) → jeden DXF zmian, jak jeden rysunek w ZWCAD
      const grupy = new Map(); for (const a of S.arkusze) { const k = a.zrodlo.plikId + '#' + (a.zrodlo.strona || 1); if (!grupy.has(k)) grupy.set(k, []); grupy.get(k).push(a); }
      for (const gr of grupy.values()) { const a = gr[0], r = R.get(a.id), ids = gr.map(x => x.id); if (!r || !S.znaczniki.some(z => ids.includes(z.arkuszId))) continue; pliki.push([`zmiany_${nazwaPl(a.nazwa, 30)}.dxf`, enc(dxfZmian(S, a, r, ids)), true]); }
      pliki.push(['zmiany.json', enc(JSON.stringify(daneDlaAI(S, R), null, 1)), true], ['PROMPT_naniesienie_zmian.txt', enc(PROMPT(S)), true]);
    }
    if (opcje.kopia) {
      postep(0.85, 'Dodaję kopię projektu…');
      const zd = []; for (const x of zdjecia) { const rek = await Baza.zdjecie(x.id); if (!rek) continue; zd.push({ id: x.id, plik: 'zdjecia/' + plikZdj(x.z, x.i), w: rek.w, h: rek.h, czas: rek.czas, nazwa: rek.nazwa }); if (rek.mini) pliki.push([`_kopia_projektu/miniatury/${x.id}.jpg`, new Uint8Array(rek.mini), false]); }
      const pk = []; for (const a of S.arkusze) { if (pk.some(q => q.id === a.zrodlo.plikId)) continue; const pl = await Baza.plik(a.zrodlo.plikId); if (pl) { const sc = `_kopia_projektu/podklady/${a.zrodlo.plikId}_${nazwaPl(pl.nazwa.replace(/\.[^.]+$/, ''), 40)}.${a.typ}`; pk.push({ id: a.zrodlo.plikId, plik: sc, nazwa: pl.nazwa, typ: pl.typ }); pliki.push([sc, new Uint8Array(pl.dane), a.typ === 'dxf']); } }
      pliki.push(['_kopia_projektu/projekt.json', enc(JSON.stringify({ typ: 'tek-inw-kopia', wersjaProgramu: APP.wersja, data: new Date().toISOString(), projekt: S, podklady: pk, zdjecia: zd })), true]);
    }
    pliki.push(['PRZECZYTAJ.txt', enc(przeczytaj(S, opcje)), true]);
    postep(0.93, 'Pakuję ZIP…');
    const blob = await new Promise((ok, zle) => {
      const kawalki = []; const zip = new fflate.Zip((err, dane, koniec) => { if (err) return zle(err); kawalki.push(dane); if (koniec) ok(new Blob(kawalki, { type: 'application/zip' })); });
      for (const [nazwa, dane, kompres] of pliki) { const f = kompres ? new fflate.ZipDeflate(nazwa, { level: 6 }) : new fflate.ZipPassThrough(nazwa); zip.add(f); f.push(dane, true); }
      zip.end();
    });
    postep(1, 'Gotowe.');
    return new File([blob], `TEK-INW_${baza}_${new Date().toISOString().slice(0, 10)}.zip`, { type: 'application/zip' });
  }
  function przeczytaj(S, o) {
    return `TEK-INW — paczka z inwentaryzacji
Projekt: ${S.meta.nazwa || ''}   Nr: ${S.meta.nr || ''}   Autor: ${S.meta.autor || ''}
Wygenerowano: ${dataCzas(Date.now())} w ${APP.nazwa} ${APP.wersja}

ZAWARTOŚĆ
${o.pdf ? (o.tryb === 'docelowa' ? '• *_fotodokumentacja.pdf — plan docelowy (po poprawkach) z punktami zdjęć + strona dla każdego zdjęcia; odnośniki wewnątrz pliku (klikalne numery, mini-plany, nawigacja).\n' : '• *_fotodokumentacja.pdf — plany ze znacznikami + strona dla każdego zdjęcia; odnośniki wewnątrz pliku (klikalne numery, mini-plany, nawigacja).\n') : ''}${o.pdfRoboczy ? '• *_zmiany_robocze.pdf — zestawienie zmian Z i plany robocze z obrysami (materiał dla projektanta, bez stron zdjęć).\n' : ''}${o.zdjecia || o.kopia ? '• zdjecia\\ — zdjęcia w rozdzielczości zapisanej w aplikacji; nazwa pliku = numer znacznika i kolejny numer zdjęcia (F-012_1.jpg).\n' : ''}${o.zestawienia ? '• zestawienie_zdjec.csv, zestawienie_zmian.csv — tabele do Excela (separator: średnik, kodowanie UTF-8).\n' : ''}${o.dxf ? '• zmiany_<plan>.dxf — znaczniki i zmiany w układzie współrzędnych rysunku (warstwy INW-*). W ZWCAD: wstaw jako odnośnik (XREF) lub blok w punkcie 0,0, skala 1.\n• zmiany.json + PROMPT_naniesienie_zmian.txt — dane dla Claude (TEK-RYSOWNIK) do naniesienia zmian na DWG.\n' : ''}${o.kopia ? '• _kopia_projektu\\ — pełna kopia projektu; całą paczkę ZIP można wczytać w TEK-INW na innym urządzeniu (Projekty → Importuj).\n' : ''}
WARSTWY DXF
INW-FOTO (punkty i kierunki zdjęć), INW-WYMIAR (inne wymiary: rysunek / pomiar / różnica), INW-NOWE (nowe elementy),
INW-BRAK (elementy nieistniejące — obrys i przekreślenie), INW-UWAGI, INW-SZKIC (szkice odręczne — do interpretacji), INW-NUMERY.

UWAGI
• Wymiary z dalmierza wpisane przy zmianach „wymiar” mają pierwszeństwo przed rysunkiem.
• Szkice odręczne nie są pomiarem — wymagają interpretacji przez projektanta.
• Plan PDF bez kalibracji: współrzędne w DXF są w mm na papierze, nie w układzie rysunku.
`;
  }

  /* ---------- import kopii (ZIP lub JSON) ---------- */
  async function importuj(plik) {
    const u8 = new Uint8Array(await plik.arrayBuffer());
    let pliki = null, opis = null;
    if (u8[0] === 0x50 && u8[1] === 0x4B) { pliki = fflate.unzipSync(u8, { filter: (f) => f.name.startsWith('_kopia_projektu/') || f.name.startsWith('zdjecia/') }); const j = pliki['_kopia_projektu/projekt.json']; if (!j) throw new Error('W tym ZIP nie ma kopii projektu TEK-INW (folder _kopia_projektu).'); opis = JSON.parse(fflate.strFromU8(j)); }
    else opis = JSON.parse(new TextDecoder().decode(u8));
    if (!opis || opis.typ !== 'tek-inw-kopia' || !opis.projekt) throw new Error('To nie jest kopia projektu TEK-INW.');
    const p = opis.projekt, stary = await Baza.projekt(p.id);
    if (stary && !(await potwierdz(`Projekt „${esc(p.meta.nazwa)}” już jest na tym urządzeniu (zmieniony ${dataCzas(stary.zmieniono)}). Zastąpić go wersją z pliku (${dataCzas(p.zmieniono)})?`, 'Zastąp', 'Anuluj', true))) return null;
    if (stary) await Baza.usunProjekt(p.id);
    const mapaPl = new Map();
    for (const pk of opis.podklady || []) { const d = pliki && pliki[pk.plik]; if (!d) continue; const id = await Baza.zapiszPlik(p.id, new Blob([d], { type: pk.typ || '' }), pk.nazwa); mapaPl.set(pk.id, id); }
    for (const a of p.arkusze) if (mapaPl.has(a.zrodlo.plikId)) a.zrodlo.plikId = mapaPl.get(a.zrodlo.plikId);
    for (const zd of opis.zdjecia || []) { const d = pliki && pliki[zd.plik]; if (!d) continue; const mini = pliki[`_kopia_projektu/miniatury/${zd.id}.jpg`]; await Baza.zapiszZdjecie({ id: zd.id, projektId: p.id, blob: new Blob([d], { type: 'image/jpeg' }), mini: mini ? new Blob([mini], { type: 'image/jpeg' }) : null, w: zd.w, h: zd.h, czas: zd.czas, nazwa: zd.nazwa }); }
    await Baza.zapiszProjekt(p); await Baza.oproznij();
    return p;
  }

  return { paczka, fotodokumentacja, dxfZmian, zestawienia, daneDlaAI, importuj, opisWymiaru, wymRysMm, fmtUz, jednostkaUz, TYPY, biblioteki };
})();
