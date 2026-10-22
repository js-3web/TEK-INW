/* TEK-INW — eksport: paczka ZIP z fotodokumentacją PDF, zdjęciami, zestawieniami, DXF zmian i kopią projektu.

   PDF budujemy biblioteką pdf-lib (MIT), czcionka IBM Plex Sans (licencja OFL) jest osadzana w pliku — polskie znaki
   wyświetlą się na każdym komputerze. Odnośniki w PDF są WEWNĘTRZNE (skok do innej strony tego samego pliku) —
   to działa w Acrobat Readerze, Edge, Chrome i na iPadzie bez ostrzeżeń, w odróżnieniu od linków do plików obok.
   Podkład planu wstawiamy jako wektor (jedna kopia w pliku, użyta na planie i na wszystkich mini-planach). */
'use strict';

const Eksport = (() => {
  const A4 = [841.89, 595.28];
  const KOL = { F: '#0A8FB0', wymiar: '#c2410c', nowy: '#15803d', brak: '#b91c1c', uwaga: '#7c3aed', szkic: '#57534e', navy: '#0d1830', akcent: '#c1692e', szary: '#6f6e64', linia: '#d8d6cc', tlo: '#faf9f4' };
  const TYPY = { wymiar: 'Inny wymiar / położenie', nowy: 'Nowy element', brak: 'Element nie istnieje', uwaga: 'Uwaga', szkic: 'Szkic odręczny' };
  const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
  const nazwaPl = (s, dl = 40) => ascii(bezpiecznaNazwa(s, dl));
  let bib = null;
  function wczytajSkrypt(src) { return new Promise((ok, zle) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => zle(new Error('Nie udało się wczytać ' + src)); document.head.appendChild(s); }); }
  async function biblioteki() {
    if (bib) return bib;
    if (typeof PDFLib === 'undefined') await wczytajSkrypt('vendor/pdf-lib.min.js');
    if (typeof fontkit === 'undefined') await wczytajSkrypt('vendor/fontkit.umd.min.js');
    const pobierzB = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
    bib = { R: await pobierzB('fonts/IBMPlexSans_400Regular.ttf'), B: await pobierzB('fonts/IBMPlexSans_600SemiBold.ttf'), M: await pobierzB('fonts/IBMPlexMono_500Medium.ttf') };
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
    const fR = await doc.embedFont(f.R, { subset: true }), fB = await doc.embedFont(f.B, { subset: true }), fM = await doc.embedFont(f.M, { subset: true });
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
    const tekst = (page, t, x, y, size, font = fR, color = '#1d1d1b', o = {}) => page.drawText(String(t ?? ''), { x, y, size, font, color: hexRgb(color), ...o });
    const szer = (t, font, size) => font.widthOfTextAtSize(String(t ?? ''), size);
    function zawin(t, font, size, maxW, maxLinii = 99) {
      const out = []; for (const akap of String(t || '').split(/\r?\n/)) {
        let l = ''; for (const s of akap.split(/\s+/)) { const k = l ? l + ' ' + s : s; if (szer(k, font, size) > maxW && l) { out.push(l); l = s; } else l = k; }
        out.push(l);
      }
      if (out.length > maxLinii) { const o = out.slice(0, maxLinii); o[maxLinii - 1] = o[maxLinii - 1].replace(/\s*\S*$/, '') + ' …'; return o; }
      return out;
    }
    const skroc = (t, font, size, maxW) => { t = String(t || '').replace(/\s+/g, ' '); if (szer(t, font, size) <= maxW) return t; while (t.length > 1 && szer(t + '…', font, size) > maxW) t = t.slice(0, -1); return t + '…'; };
    function rysujLogo(page, x, y, h) { // logo TEK-INW (wektorowo, ścieżki z js/logo.js) — wysokość h, lewy dolny róg (x, y)
      const svg = LOGO.produktJasne, vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), k = h / parseFloat(vb[2]), top = y + h;
      const atr = (t, n) => { const m = t.match(new RegExp(' ' + n + '="([^"]*)"')); return m ? m[1] : null; };
      for (const el of svg.match(/<(path|circle|rect)\b[^>]*>/g) || []) {
        const fill = atr(el, 'fill'), st = atr(el, 'stroke'), sw = parseFloat(atr(el, 'stroke-width') || '0');
        const o = { color: fill && fill !== 'none' ? hexRgb(fill) : undefined, borderColor: st && st !== 'none' ? hexRgb(st) : undefined, borderWidth: st && st !== 'none' ? sw * k : 0 };
        if (el.startsWith('<path')) page.drawSvgPath(atr(el, 'd'), { x, y: top, scale: k, ...o });
        else if (el.startsWith('<circle')) page.drawCircle({ x: x + parseFloat(atr(el, 'cx')) * k, y: top - parseFloat(atr(el, 'cy')) * k, size: parseFloat(atr(el, 'r')) * k, ...o });
      }
      return parseFloat(vb[1]) * k;
    }
    function stopka(page, nr, razem, dodatek) {
      const [w] = [page.getWidth()];
      page.drawLine({ start: { x: 28, y: 26 }, end: { x: w - 28, y: 26 }, thickness: 0.5, color: hexRgb(KOL.linia) });
      tekst(page, `${APP.nazwa} ${APP.wersja} · ${m.nazwa || ''}${dodatek ? ' · ' + dodatek : ''}`, 28, 14, 7.5, fR, KOL.szary);
      const t = `str. ${nr} / ${razem}`; tekst(page, t, w - 28 - szer(t, fR, 7.5), 14, 7.5, fR, KOL.szary);
    }

    /* 2. Układ stron (najpierw policzenie, potem rysowanie — odnośniki potrzebują gotowych stron). */
    const WIERSZE_SPISU = 26, WIERSZE_ZM = 15;
    const strTytul = doc.addPage(A4);
    const strSpis = []; if (tryb !== 'robocza') for (let i = 0; i < Math.max(1, Math.ceil(zdjecia.length / WIERSZE_SPISU)); i++) strSpis.push(doc.addPage(A4));
    const strZm = []; if (tryb !== 'docelowa') for (let i = 0; i < Math.ceil(Zm.length / WIERSZE_ZM); i++) strZm.push(doc.addPage(A4));
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

    /* 3. Strona tytułowa */
    {
      const p = strTytul, [w, h] = A4;
      p.drawRectangle({ x: 0, y: h - 8, width: w, height: 8, color: hexRgb(KOL.navy) }); p.drawRectangle({ x: 0, y: h - 10.5, width: w, height: 2.5, color: hexRgb('#e07b3c') }); // pasek granat + pomarańcz (rodzina TEKTORIA)
      rysujLogo(p, 40, h - 70, 34);
      tekst(p, 'PRODUKT MARKI TEKTORIA', w - 40 - szer('PRODUKT MARKI TEKTORIA', fM, 7.5), h - 52, 7.5, fM, KOL.szary);
      tekst(p, tryb === 'robocza' ? 'ZESTAWIENIE ZMIAN I UWAG' : 'DOKUMENTACJA FOTOGRAFICZNA', 40, h - 135, 26, fB, KOL.navy);
      tekst(p, tryb === 'robocza' ? 'Inwentaryzacja budowlana — różnice względem rysunku (materiał roboczy)' : 'Inwentaryzacja budowlana — stan istniejący', 40, h - 160, 13, fR, KOL.akcent);
      const zaw = tryb === 'robocza' ? `${Zm.length} zmian i uwag (Z) · ${arkusze.length} plan(y) roboczy(e)`
        : tryb === 'docelowa' ? `${zdjecia.length} zdjęć · ${F.length} punktów foto (F) · ${ZmF.length} zmian ze zdjęciami (Z) · ${arkusze.length} arkusz(e) planu`
        : `${zdjecia.length} zdjęć · ${F.length} punktów foto (F) · ${Zm.length} zmian i uwag (Z) · ${arkusze.length} plan(y)`;
      const wiersze = [['Obiekt', m.nazwa], ['Adres / lokalizacja', m.adres], ['Zamawiający', m.inwestor], ['Nr opracowania', m.nr], ['Autor', m.autor], ['Data wizji', m.data], ['Data wygenerowania', dataCzas(Date.now())],
        ['Zawartość', zaw], [tryb === 'docelowa' ? 'Plan' : 'Plany', arkusze.map(a => a.nazwa).join('; ')]];
      let y = h - 200;
      for (const [k, val] of wiersze) {
        tekst(p, k, 40, y, 9.5, fB, KOL.szary);
        const l = zawin(val || '—', fR, 10.5, 520, 2); l.forEach((t, i) => tekst(p, t, 200, y - i * 13, 10.5)); y -= 13 * Math.max(1, l.length) + 9;
      }
      y -= 8; p.drawRectangle({ x: 40, y: y - 88, width: w - 80, height: 92, color: hexRgb(KOL.tlo), borderColor: hexRgb(KOL.linia), borderWidth: 0.6 });
      tekst(p, 'JAK KORZYSTAĆ Z TEGO PLIKU', 54, y - 16, 8.5, fB, KOL.akcent);
      (tryb === 'robocza' ? [
        '• Każda pozycja Z to różnica między rysunkiem a stanem na obiekcie; kliknij wiersz zestawienia, aby zobaczyć ją na planie.',
        '• Plany robocze: obrysy i wymiary naniesione w terenie na podkładzie sprzed poprawek.',
        '• Wymiar z dalmierza („pomiar”) ma pierwszeństwo przed rysunkiem. Szkice odręczne wymagają interpretacji.',
        '• Dane do CAD: pliki zmiany_<plan>.dxf (warstwy INW-*) i zmiany.json w paczce ZIP.'] : [
        '• Plan: kliknij numer punktu (kółko F lub romb Z), aby otworzyć zdjęcie tego miejsca.',
        '• Strona zdjęcia: mini-plan pokazuje miejsce i kierunek zdjęcia; kliknij go, aby zobaczyć to miejsce na planie.',
        '• Na dole każdej strony zdjęcia: poprzednie / spis zdjęć / plan / następne. Spis zdjęć też jest klikalny.',
        '• Pełna rozdzielczość zdjęć: folder „zdjecia” w paczce ZIP — nazwy plików odpowiadają numerom w tym dokumencie.'])
        .forEach((t, i) => tekst(p, t, 54, y - 34 - i * 14, 9.5));
      const skroty = []; if (strSpis[0]) skroty.push(['Spis zdjęć', strSpis[0]]); if (strZm.length) skroty.push(['Zestawienie zmian i uwag', strZm[0]]);
      for (const a of arkusze) skroty.push([(tryb === 'docelowa' ? '' : 'Plan: ') + a.nazwa, strPlan.get(a.id)]);
      let x = 40; for (const [t0, cel] of skroty) { const tw = Math.min(200, szer(t0, fB, 10)); if (x + tw > w - 40) break; tekst(p, skroc(t0, fB, 10, 200), x, 60, 10, fB, KOL.F); link(p, [x - 2, 56, x + tw + 2, 72], cel); x += tw + 22; }
      stopka(p, 1, razem);
    }
    /* 4. Spis zdjęć */
    strSpis.forEach((p, s) => {
      const [w, h] = A4; tekst(p, 'SPIS ZDJĘĆ', 40, h - 48, 15, fB, KOL.navy); tekst(p, `${zdjecia.length} zdjęć — kliknij wiersz, aby przejść do zdjęcia`, 40, h - 64, 9, fR, KOL.szary);
      const kol = [[40, 'Nr zdjęcia'], [112, 'Znacznik'], [170, 'Plan'], [290, 'Element'], [390, 'Opis'], [w - 76, 'Strona']];
      let y = h - 92; p.drawRectangle({ x: 36, y: y - 5, width: w - 72, height: 17, color: hexRgb('#e8e8e3') }); kol.forEach(([x, t]) => tekst(p, t.toUpperCase(), x, y, 7.5, fB, KOL.szary)); y -= 19;
      for (const [k, x] of zdjecia.slice(s * WIERSZE_SPISU, (s + 1) * WIERSZE_SPISU).entries()) {
        const n = s * WIERSZE_SPISU + k, z = x.z, mp = gdzie.get(z.id), a = mp ? mp.a : (tryb === 'docelowa' ? { nazwa: '— poza planem' } : S.arkusze.find(q => q.id === z.arkuszId));
        if (k % 2) p.drawRectangle({ x: 36, y: y - 5, width: w - 72, height: 16, color: hexRgb('#f6f5f0') });
        tekst(p, nrZdj(z, x.i), 40, y, 9, fM, kolor(z)); tekst(p, z.rodzaj === 'F' ? 'foto' : (TYPY[z.typZ] || '').split(' ')[0].toLowerCase(), 112, y, 8.5, fR, KOL.szary);
        tekst(p, skroc(a ? a.nazwa : '', fR, 8.5, 112), 170, y, 8.5); tekst(p, skroc(z.element, fR, 8.5, 94), 290, y, 8.5); tekst(p, skroc(z.opis, fR, 8.5, w - 76 - 396), 390, y, 8.5);
        tekst(p, String(nrStrony(strZdj[n])), w - 76, y, 9, fM);
        link(p, [36, y - 5, w - 36, y + 11], strZdj[n]); y -= 16;
      }
      stopka(p, nrStrony(p), razem, 'spis zdjęć');
    });
    /* 5. Zestawienie zmian Z */
    strZm.forEach((p, s) => {
      const [w, h] = A4; tekst(p, 'ZESTAWIENIE ZMIAN I UWAG (Z)', 40, h - 48, 15, fB, KOL.navy); tekst(p, 'Różnice między rysunkiem a stanem na obiekcie. Kliknij wiersz, aby przejść do zdjęcia (lub do planu, gdy zmiana nie ma zdjęcia).', 40, h - 64, 9, fR, KOL.szary);
      const kol = [[40, 'Nr'], [84, 'Rodzaj'], [190, 'Element'], [280, 'Opis'], [560, 'Rysunek / pomiar / różnica'], [740, 'Źr.'], [770, 'Foto']];
      let y = h - 92; p.drawRectangle({ x: 36, y: y - 5, width: w - 72, height: 17, color: hexRgb('#e8e8e3') }); kol.forEach(([x, t]) => tekst(p, t.toUpperCase(), x, y, 7.5, fB, KOL.szary)); y -= 20;
      for (const z of Zm.slice(s * WIERSZE_ZM, (s + 1) * WIERSZE_ZM)) {
        const wys = 30; p.drawLine({ start: { x: 36, y: y - wys + 12 }, end: { x: w - 36, y: y - wys + 12 }, thickness: 0.4, color: hexRgb(KOL.linia) });
        p.drawRectangle({ x: 40, y: y - 2, width: 4, height: 10, color: hexRgb(kolor(z)) });
        tekst(p, z.nr, 48, y, 9, fM, kolor(z)); tekst(p, skroc(TYPY[z.typZ] || '', fR, 8.5, 100), 84, y, 8.5);
        tekst(p, skroc(z.element, fR, 8.5, 86), 190, y, 8.5);
        zawin(z.opis || '—', fR, 8.5, 270, 2).forEach((t, i) => tekst(p, t, 280, y - i * 10.5, 8.5));
        if (z.typZ === 'wymiar') { const t = opisWymiaru(z, S, R); zawin(t, fR, 8.5, 175, 2).forEach((q, i) => tekst(p, q, 560, y - i * 10.5, 8.5, fR, KOL.wymiar)); }
        tekst(p, z.zrodlo || '', 740, y, 8.5, fM); tekst(p, String((z.zdjecia || []).length || '—'), 772, y, 8.5, fM);
        const cel = pierwszeZdj.has(z.id) ? strZdj[pierwszeZdj.get(z.id)] : strPlan.get(z.arkuszId);
        if (cel) link(p, [36, y - wys + 12, w - 36, y + 12], cel);
        y -= wys;
      }
      stopka(p, nrStrony(p), razem, 'zestawienie zmian');
    });
    /* 6. Plany z naniesionymi znacznikami */
    let ia = 0;
    for (const pl of plany) {
      const a = pl.a, p = strPlan.get(a.id), P = PODK.get(a.id); if (!p) continue;
      postep(0.08 + 0.12 * (ia++ / Math.max(1, arkusze.length)), `Rysuję plan „${a.nazwa}”…`);
      wstawPodklad(p, P, P.pl.p, P.pl.ox, P.pl.oy, null);
      const w = P.w, h = P.h, sk = skA(P), NAGL = pl.naglowek ? naglA(P) : 0;
      if (pl.naglowek) {
      p.drawRectangle({ x: 0, y: h, width: w, height: NAGL, color: hexRgb('#ffffff') });
      p.drawRectangle({ x: 0, y: h + NAGL - 5 * sk, width: w, height: 5 * sk, color: hexRgb(KOL.navy) });
      p.drawLine({ start: { x: 0, y: h }, end: { x: w, y: h }, thickness: 0.8, color: hexRgb(KOL.linia) });
      tekst(p, 'PLAN — ' + a.nazwa, 18 * sk, h + 30 * sk, 16 * sk, fB, KOL.navy);
      tekst(p, `${m.nazwa || ''} · ${tryb === 'robocza' ? 'kliknij oznaczenie zmiany, aby przejść do zestawienia' : 'kliknij znacznik, aby otworzyć zdjęcie'} · TEK-INW`, 18 * sk, h + 13 * sk, 8.5 * sk, fR, KOL.szary);
      let lx = w - 18 * sk; [['szkic', 'szkic'], ['uwaga', 'uwaga'], ['brak', 'nie istnieje'], ['nowy', 'nowy element'], ['wymiar', 'inny wymiar'], ['F', 'punkt foto']].filter(([k]) => tryb !== 'robocza' || k !== 'F').forEach(([k, t]) => {
        const tw = szer(t, fR, 8.5 * sk); lx -= tw; tekst(p, t, lx, h + 22 * sk, 8.5 * sk); lx -= 14 * sk; p.drawRectangle({ x: lx, y: h + 21 * sk, width: 10 * sk, height: 8 * sk, color: hexRgb(KOL[k]) }); lx -= 14 * sk;
      });
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
          if (pts.length > 1) { const d = 'M' + pts.map(q => `${q[0]} ${h + NAGL - q[1]}`).join(' L') + (z.geom.zamkn ? ' Z' : ''); p.drawSvgPath(d, { x: 0, y: h + NAGL, borderColor: kol, borderWidth: lw, borderDashArray: z.typZ === 'brak' ? [lw * 3, lw * 2] : undefined }); }
          if (z.typZ === 'brak' && pts.length > 2) { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); p.drawLine({ start: { x: Math.min(...xs), y: Math.min(...ys) }, end: { x: Math.max(...xs), y: Math.max(...ys) }, thickness: lw * 0.6, color: kol }); p.drawLine({ start: { x: Math.min(...xs), y: Math.max(...ys) }, end: { x: Math.max(...xs), y: Math.min(...ys) }, thickness: lw * 0.6, color: kol }); }
          if (z.typZ === 'uwaga' || z._punktowy) { const [x, y] = pts[0]; p.drawSvgPath(`M${x} ${h + NAGL - y - r0} L${x + r0} ${h + NAGL - y} L${x} ${h + NAGL - y + r0} L${x - r0} ${h + NAGL - y} Z`, { x: 0, y: h + NAGL, color: kol }); }
          const [lx0, ly0] = z.typZ === 'wymiar' && pts.length === 2 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2 + r0 * 1.3] : (z.typZ === 'uwaga' || z._punktowy) ? [pts[0][0] + r0 * 2.2, pts[0][1] + r0] : [pts[0][0], pts[0][1] + r0 * 1.3];
          let t = 'Z' + parseInt(z.nr.slice(2), 10); if (z.typZ === 'wymiar' && !z._punktowy && Number.isFinite(z.wymPom)) t += ' · ' + opisWymiaru(z, S, R, true);
          const fs = r0 * 0.95, tw = szer(t, fB, fs) + fs;
          p.drawRectangle({ x: lx0 - tw / 2, y: ly0 - fs * 0.55, width: tw, height: fs * 1.5, color: kol, borderColor: hexRgb('#ffffff'), borderWidth: fs * 0.1 });
          tekst(p, t, lx0 - tw / 2 + fs / 2, ly0 - fs * 0.18, fs, fB, '#ffffff');
          rect = [lx0 - tw / 2, ly0 - fs * 0.55, lx0 + tw / 2, ly0 + fs * 0.95];
        }
        const cel = pierwszeZdj.has(z.id) ? strZdj[pierwszeZdj.get(z.id)] : (z.rodzaj === 'Z' && strZm.length ? strZm[Math.floor(Zm.indexOf(z) / WIERSZE_ZM)] : null);
        if (cel && rect) link(p, rect, cel);
      }
      if (pl.naglowek) stopka(p, nrStrony(p), razem, 'plan'); // arkusz docelowy PDF zostaje w oryginalnej postaci (bez nagłówka i stopki)
    }
    /* 7. Strony zdjęć */
    const jakosc = opcje.jakoscPdf || 1600;
    for (const [n, x] of zdjecia.entries()) {
      postep(0.2 + 0.75 * n / Math.max(1, zdjecia.length), `Zdjęcie ${n + 1} z ${zdjecia.length}…`);
      const p = strZdj[n], [w, h] = A4, z = x.z, mp = gdzie.get(z.id), a = mp && mp.a, P = a && PODK.get(a.id), zg = mp ? mp.z : z;
      const kz = kolor(z);
      p.drawRectangle({ x: 0, y: h - 5, width: w, height: 5, color: hexRgb(KOL.navy) });
      tekst(p, nrZdj(z, x.i), 28, h - 34, 17, fB, kz);
      const podt = [z.rodzaj === 'F' ? 'Punkt fotograficzny' : (TYPY[z.typZ] || 'Zmiana'), z.element, a ? a.nazwa : (S.arkusze.find(q => q.id === z.arkuszId) || {}).nazwa].filter(Boolean).join(' · ');
      tekst(p, skroc(podt, fR, 10, 520), 28 + szer(nrZdj(z, x.i), fB, 17) + 12, h - 33, 10, fR, KOL.szary);
      tekst(p, `zdjęcie ${x.i + 1} z ${z.zdjecia.length}`, w - 28 - szer(`zdjęcie ${x.i + 1} z ${z.zdjecia.length}`, fR, 9), h - 33, 9, fR, KOL.szary);
      // zdjęcie
      const rek = await Baza.zdjecie(x.id);
      const box = [28, 44, 545, h - 96];
      if (rek) {
        const img = await obrazZPliku(new Blob([rek.dane], { type: 'image/jpeg' }));
        const { blob } = await jpegZObrazu(img, jakosc, 0.78);
        const jpg = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const k = Math.min(box[2] / jpg.width, box[3] / jpg.height), iw = jpg.width * k, ih = jpg.height * k;
        p.drawImage(jpg, { x: box[0] + (box[2] - iw) / 2, y: box[1] + box[3] - ih, width: iw, height: ih });
      } else tekst(p, 'Brak pliku zdjęcia w bazie.', box[0] + 20, box[1] + box[3] / 2, 12, fB, '#9a2222');
      // mini-plan
      const mx = 590, mw = w - 28 - mx, mh = 186, my = h - 96 - mh + 34;
      p.drawRectangle({ x: mx, y: my, width: mw, height: mh, color: hexRgb('#ffffff'), borderColor: hexRgb(KOL.linia), borderWidth: 0.8 });
      if (P) {
        const c = zg.geom.pkt[0], okno = clamp(Math.max(P.w, P.h) / 7, 60, 900) / P.pl.p, pk = Math.min(mw, mh) / okno; // okno w jednostkach arkusza
        const ox = mx + mw / 2 - c[0] * pk, oy = my + mh / 2 + c[1] * pk;
        wstawPodklad(p, P, pk, ox, oy, [mx, my, mw, mh]);
        const S2 = (q) => [ox + q[0] * pk, oy - q[1] * pk];
        const pts = zg.geom.pkt.map(S2), kk = hexRgb(kz);
        if (z.rodzaj === 'F') {
          const [X, Y] = pts[0];
          if (zg.kier !== null && zg.kier !== undefined) p.drawSvgPath(klin(X, h - Y, 46, zg.kier), { x: 0, y: h, color: hexRgb('#22C3E6'), opacity: 0.3, borderColor: kk, borderWidth: 0.8 });
          p.drawCircle({ x: X, y: Y, size: 6, color: kk, borderColor: hexRgb('#ffffff'), borderWidth: 1.2 });
        } else if (pts.length > 1) {
          const d = 'M' + pts.map(q => `${clamp(q[0], mx - 50, mx + mw + 50)} ${h - clamp(q[1], my - 50, my + mh + 50)}`).join(' L') + (zg.geom.zamkn ? ' Z' : '');
          p.pushOperators(pushGraphicsState(), rectangle(mx, my, mw, mh), clip(), endPath()); p.drawSvgPath(d, { x: 0, y: h, borderColor: kk, borderWidth: 2 }); p.pushOperators(popGraphicsState());
        } else { const [X, Y] = pts[0]; p.drawSvgPath(`M${X} ${h - Y - 7} L${X + 7} ${h - Y} L${X} ${h - Y + 7} L${X - 7} ${h - Y} Z`, { x: 0, y: h, color: kk, borderColor: hexRgb('#ffffff'), borderWidth: 1 }); }
        const fitR = (() => { const pp = naPlanie(a, c), r = clamp(Math.max(P.w, P.h) / 12, 40, 1200); return [pp[0] - r, pp[1] - r * 0.65, pp[0] + r, pp[1] + r * 0.65]; })();
        link(p, [mx, my, mx + mw, my + mh], strPlan.get(a.id), fitR);
        tekst(p, 'Miejsce na planie — kliknij, aby powiększyć', mx, my - 11, 7.5, fR, KOL.szary);
      } else {
        p.drawRectangle({ x: mx, y: my, width: mw, height: mh, color: hexRgb(KOL.tlo) });
        zawin(tryb === 'docelowa' ? 'Miejsce tego zdjęcia leży poza zakresem planu.' : 'Brak podkładu dla tego znacznika.', fR, 9, mw - 30, 3).forEach((t, i) => tekst(p, t, mx + 15, my + mh / 2 + 4 - i * 12, 9, fR, KOL.szary));
      }
      // metryczka
      let y = my - 32; const kv = (k, val, max = 3) => { tekst(p, k.toUpperCase(), mx, y, 7, fB, KOL.szary); y -= 11; const l = zawin(val || '—', fR, 9, mw, max); l.forEach(t => { tekst(p, t, mx, y, 9); y -= 11; }); y -= 5; };
      kv('Element / kategoria', [z.element, z.kategoria].filter(Boolean).join(' · ') || '—', 2);
      const aW = a || S.arkusze.find(q => q.id === z.arkuszId), zW = a ? zg : z; // współrzędne w układzie planu z tego dokumentu
      const wsp = polozenie(zW, aW, R, S); if (wsp) kv('Położenie (układ rysunku)', wsp, 1);
      if (z.rodzaj === 'F' && zW.kier !== null && zW.kier !== undefined) kv('Kierunek zdjęcia', kierunekOpis(zW, aW, R), 1);
      if (z.typZ === 'wymiar') kv('Wymiar', opisWymiaru(z, S, R), 2);
      kv('Wykonano', dataCzas(rek ? rek.czas : z.utw), 1);
      kv('Opis', z.opis || '—', Math.max(2, Math.floor((y - 60) / 11)));
      // nawigacja
      const nav = [['← poprzednie', n > 0 ? strZdj[n - 1] : null], ['spis zdjęć', strSpis[Math.floor(n / WIERSZE_SPISU)]], ['plan', a ? strPlan.get(a.id) : null], ['następne →', n < zdjecia.length - 1 ? strZdj[n + 1] : null]];
      let nx = 28; for (const [t, cel] of nav) { if (!cel) { nx += szer(t, fB, 9) + 22; continue; } tekst(p, t, nx, 32, 9, fB, KOL.F); link(p, [nx - 3, 28, nx + szer(t, fB, 9) + 3, 43], cel); nx += szer(t, fB, 9) + 22; }
      stopka(p, nrStrony(p), razem, nrZdj(z, x.i));
      if (n % 8 === 7) await czekaj(0); // oddech dla przeglądarki
    }
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
  function dxfZmian(S, a, r) {
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
    for (const z of S.znaczniki.filter(q => q.arkuszId === a.id)) {
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
        geometria: { typ: z.geom.typ, zamknieta: !!z.geom.zamkn, punkty: T ? z.geom.pkt.map(p => Geom.zastosuj(T, ...p).map(v => Math.round(v * 1000) / 1000)) : null, punktyArkusza: z.geom.pkt },
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
      for (const a of S.arkusze) { const r = R.get(a.id); if (!r || !S.znaczniki.some(z => z.arkuszId === a.id)) continue; pliki.push([`zmiany_${nazwaPl(a.nazwa, 30)}.dxf`, enc(dxfZmian(S, a, r)), true]); }
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
