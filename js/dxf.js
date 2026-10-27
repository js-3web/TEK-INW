/* TEK-INW — wczytanie podkładu DXF.
   Kroki: (1) rozpoznanie kodowania polskich znaków, (2) odczyt pliku biblioteką dxf-parser (MIT),
   (3) „spłaszczenie” rysunku: bloki (INSERT) rozwijamy do zwykłych linii w układzie rysunku, łuki zamieniamy na odcinki,
   (4) zebranie punktów przyciągania: końce i środki odcinków, wierzchołki, środki okręgów, skrzyżowania długich linii.
   Kreskowania (HATCH) i atrybuty bloków pomijamy — na podkładzie do inwentaryzacji tylko zaciemniałyby rysunek.
   Od 0.4.2 pomijamy też to, czego w ZWCAD nie widać: obiekty na warstwach zamrożonych i wyłączonych oraz obiekty ukryte
   (wcześniej były liczone do limitu — np. zamrożona legenda z dołączonego odnośnika potrafiła zająć połowę limitu). */
'use strict';

const Dxf = (() => {
  const JEDN = { 1: ['cal', 25.4], 2: ['stopa', 304.8], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000] };
  const KODOWANIA = { ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252', ANSI_1257: 'windows-1257', ANSI_874: 'windows-874', ANSI_932: 'shift_jis', ANSI_936: 'gbk' };

  const POLSKIE_1250 = new Set([0xB9, 0xB3, 0x9C, 0xBF, 0x8C, 0xCA, 0xA5, 0xA3, 0xAF, 0xE6, 0xEA, 0x9F, 0x8F]); // ą ł ś ż Ś Ę Ą Ł Ż ć ę ź Ź w CP1250
  function dekoduj(buf) {
    const u8 = new Uint8Array(buf);
    const glowa = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 80000)));
    if (glowa.startsWith('AutoCAD Binary DXF')) throw new Error('To jest binarny DXF. W ZWCAD zapisz rysunek jako DXF tekstowy (ASCII): Zapisz jako → typ „DXF”.');
    const wer = (glowa.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/) || [])[1] || '';
    const cp = ((glowa.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/) || [])[1] || '').toUpperCase();
    if (!wer && !/SECTION/.test(glowa)) throw new Error('Plik nie wygląda na rysunek DXF.');
    let tekst = null, kodowanie = 'utf-8';
    if (wer >= 'AC1021' || (u8[0] === 0xEF && u8[1] === 0xBB)) {
      try { tekst = new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { tekst = null; }
    }
    if (tekst === null) {
      kodowanie = KODOWANIA[cp] || 'windows-1250';
      // Plik z nagłówkiem ANSI_1252 (lub bez), a treść wygląda na polską stronę kodową 1250 (ą ł ś ż jako bajty B9 B3 9C BF) — wybieramy 1250.
      if (kodowanie === 'windows-1252') { let n = 0; for (let i = 0; i < u8.length; i++) { const c = u8[i]; if (POLSKIE_1250.has(c)) n++; } if (n >= 2) kodowanie = 'windows-1250'; }
      tekst = new TextDecoder(kodowanie).decode(u8);
    }
    return { tekst, wersja: wer, kodowanie };
  }
  const czyscTekst = (s) => String(s || '')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%').replace(/%%[uUoO]/g, '');
  function czyscMtext(s) {
    let t = czyscTekst(s);
    t = t.replace(/\\P/g, '\n').replace(/\\~/g, ' ')
      .replace(/\\S([^;]*?)[#^\/]([^;]*?);/g, '$1/$2')
      .replace(/\\[ACcFfHhQqTtWw][^;\\]*;/g, '').replace(/\\[LlOoKkNn]/g, '')
      .replace(/\\([{}\\])/g, '$1').replace(/[{}]/g, '');
    return t;
  }
  const hex = (n) => '#' + (n >>> 0 & 0xFFFFFF).toString(16).padStart(6, '0');

  /* macierz afiniczna 2D: [a, b, c, d, e, f]  →  x' = a·x + c·y + e,  y' = b·x + d·y + f */
  const mnoz = (M, N) => [M[0] * N[0] + M[2] * N[1], M[1] * N[0] + M[3] * N[1], M[0] * N[2] + M[2] * N[3], M[1] * N[2] + M[3] * N[3], M[0] * N[4] + M[2] * N[5] + M[4], M[1] * N[4] + M[3] * N[5] + M[5]];
  const pkt = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  const ID = [1, 0, 0, 1, 0, 0];
  const lustroOCS = (e) => (e.extrusionDirectionZ !== undefined ? e.extrusionDirectionZ : (e.extrusionDirection && e.extrusionDirection.z)) < 0;

  function luk(cx, cy, r, a0, a1, M, out) { // a0 → a1 przeciwnie do wskazówek zegara (radiany)
    let sweep = a1 - a0; while (sweep <= 0) sweep += Math.PI * 2;
    const n = Math.max(4, Math.min(160, Math.ceil(sweep / (Math.PI / 36))));
    for (let i = 0; i <= n; i++) { const t = a0 + sweep * i / n; out.push(pkt(M, cx + r * Math.cos(t), cy + r * Math.sin(t))); }
  }
  function lukWypuklosc(p, q, b, M, out) { // fragment polilinii z „wypukłością” (bulge)
    const th = 4 * Math.atan(b), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < 1e-12) return;
    const r = d / (2 * Math.sin(Math.abs(th) / 2));
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, h = Math.sqrt(Math.max(0, r * r - d * d / 4));
    const ux = (q.x - p.x) / d, uy = (q.y - p.y) / d, s = (b > 0) === (Math.abs(th) < Math.PI) ? 1 : -1;
    const cx = mx - uy * h * s, cy = my + ux * h * s;
    let a0 = Math.atan2(p.y - cy, p.x - cx), a1 = Math.atan2(q.y - cy, q.x - cx);
    const n = Math.max(3, Math.min(120, Math.ceil(Math.abs(th) / (Math.PI / 36))));
    if (b > 0) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
    for (let i = 1; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; out.push(pkt(M, cx + r * Math.cos(t), cy + r * Math.sin(t))); }
  }
  function splajn(e, M) {
    const cp = (e.controlPoints || []).map(v => [v.x, v.y]), fit = (e.fitPoints || []).map(v => [v.x, v.y]);
    const p = e.degreeOfSplineCurve || 3, U = e.knotValues || [];
    if (cp.length > p && U.length === cp.length + p + 1) { // krzywa B-sklejana (de Boor)
      const out = [], u0 = U[p], u1 = U[cp.length], n = Math.min(400, cp.length * 12);
      for (let i = 0; i <= n; i++) {
        const u = Math.min(u0 + (u1 - u0) * i / n, u1 - 1e-12);
        let k = p; while (k < cp.length - 1 && U[k + 1] <= u) k++;
        const d = []; for (let j = 0; j <= p; j++) d.push(cp[k - p + j].slice());
        for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
          const den = U[j + 1 + k - r] - U[j + k - p]; const a = den ? (u - U[j + k - p]) / den : 0;
          d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
        }
        out.push(pkt(M, d[p][0], d[p][1]));
      }
      return out;
    }
    return (fit.length > 1 ? fit : cp).map(v => pkt(M, v[0], v[1]));
  }

  /* Główna funkcja: bajty pliku → podkład gotowy do wyświetlenia. */
  function wczytaj(buf, opcje = {}) {
    const { tekst, wersja, kodowanie } = dekoduj(buf);
    const d = new DxfParser().parseSync(tekst);
    if (!d || !d.entities) throw new Error('Nie udało się odczytać rysunku DXF.');
    const jedn = JEDN[(d.header && d.header.$INSUNITS) || 4] || ['mm (przyjęto)', 1];
    const warstwyDef = (d.tables && d.tables.layer && d.tables.layer.layers) || {};
    const warstwy = new Map(); // nazwa → { nazwa, kolor, wid }
    const warstwa = (n) => { let w = warstwy.get(n); if (!w) { const def = warstwyDef[n] || {}; w = { nazwa: n, kolor: def.color !== undefined ? hex(def.color) : '#000000', wid: def.visible !== false && !def.frozen }; warstwy.set(n, w); } return w; };
    const grupy = new Map(); // „warstwa|kolor” → { warstwa, kolor, linie: [[x,y,...], ...] }
    const teksty = [], snap = [], proste = [];
    let licznik = 0, przekroczono = false; const LIMIT = 1500000;
    const nieZbieraj = () => { przekroczono = true; grupy.clear(); for (const t of [snap, proste, teksty]) { t.length = 0; t.push = () => 0; } }; // po przekroczeniu tylko liczymy — żeby wskazać, co zajmuje najwięcej

    function dodaj(war, kol, punkty, zamknij) {
      if (punkty.length < 2) return;
      licznik += punkty.length;
      if (licznik > LIMIT && !przekroczono) nieZbieraj();
      if (przekroczono) return;
      const k = war + '|' + kol; let g = grupy.get(k); if (!g) grupy.set(k, g = { warstwa: war, kolor: kol, linie: [] });
      const a = new Float64Array((punkty.length + (zamknij ? 1 : 0)) * 2);
      punkty.forEach((p, i) => { a[i * 2] = p[0]; a[i * 2 + 1] = p[1]; });
      if (zamknij) { a[punkty.length * 2] = punkty[0][0]; a[punkty.length * 2 + 1] = punkty[0][1]; }
      g.linie.push(a);
    }
    const odcinkiSnap = (pts, zamk) => { const n = pts.length; for (let i = 0; i < n - (zamk ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % n]; snap.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); proste.push([a, b]); } if (!zamk && n) snap.push(pts[n - 1]); };

    function encja(e, M, warRodzica, kolRodzica, glebia) {
      if (e.inPaperSpace || e.visible === false) return;
      let war = e.layer || '0'; if (war === '0' && warRodzica) war = warRodzica;
      const def = warstwyDef[war];
      if (def && def.frozen) return; // warstwa zamrożona: w ZWCAD niewidoczna — razem z całym blokiem wstawionym na tej warstwie
      if (def && def.visible === false && e.type !== 'INSERT' && e.type !== 'DIMENSION') return; // wyłączona: blok na niej pokazuje tylko elementy z innych, włączonych warstw
      const w = warstwa(war);
      let kol = e.color !== undefined && e.colorIndex !== 256 ? hex(e.color) : w.kolor;
      if (e.colorIndex === 0 && kolRodzica) kol = kolRodzica; // BYBLOCK
      let Mo = M; if (lustroOCS(e)) Mo = mnoz(M, [-1, 0, 0, 1, 0, 0]);
      switch (e.type) {
        case 'LINE': { const p = e.vertices.map(v => pkt(Mo, v.x, v.y)); dodaj(war, kol, p); odcinkiSnap(p, false); break; }
        case 'LWPOLYLINE': case 'POLYLINE': {
          const V = (e.vertices || []).filter(v => !v.faceA && !(v.type && v.type === 'faceVertex')); if (V.length < 2) break;
          const zamk = !!e.shape, out = [pkt(Mo, V[0].x, V[0].y)], wierz = [out[0]];
          for (let i = 0; i < V.length - (zamk ? 0 : 1); i++) {
            const p = V[i], q = V[(i + 1) % V.length];
            if (p.bulge) lukWypuklosc(p, q, p.bulge, Mo, out); else out.push(pkt(Mo, q.x, q.y));
            if (!p.bulge) proste.push([pkt(Mo, p.x, p.y), pkt(Mo, q.x, q.y)]);
            if (i + 1 < V.length) wierz.push(pkt(Mo, q.x, q.y));
          }
          dodaj(war, kol, out, false); snap.push(...wierz);
          for (let i = 0; i < V.length - (zamk ? 0 : 1); i++) { const p = V[i], q = V[(i + 1) % V.length]; if (!p.bulge) snap.push(pkt(Mo, (p.x + q.x) / 2, (p.y + q.y) / 2)); }
          break;
        }
        case 'CIRCLE': { const o = []; luk(e.center.x, e.center.y, e.radius, 0, Math.PI * 2, Mo, o); dodaj(war, kol, o); snap.push(pkt(Mo, e.center.x, e.center.y)); break; }
        case 'ARC': { const o = []; luk(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle, Mo, o); dodaj(war, kol, o); snap.push(o[0], o[o.length - 1], pkt(Mo, e.center.x, e.center.y)); break; }
        case 'ELLIPSE': {
          const c = e.center, mj = e.majorAxisEndPoint, r = e.axisRatio || 1; let t0 = e.startAngle || 0, t1 = e.endAngle || Math.PI * 2; while (t1 <= t0) t1 += Math.PI * 2;
          const n = Math.max(8, Math.ceil((t1 - t0) / (Math.PI / 48))), o = [];
          for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; o.push(pkt(Mo, c.x + mj.x * Math.cos(t) - mj.y * r * Math.sin(t), c.y + mj.y * Math.cos(t) + mj.x * r * Math.sin(t))); }
          dodaj(war, kol, o); snap.push(pkt(Mo, c.x, c.y)); break;
        }
        case 'SPLINE': { const o = splajn(e, Mo); dodaj(war, kol, o); if (o.length) snap.push(o[0], o[o.length - 1]); break; }
        case 'SOLID': case '3DFACE': { const p = (e.points || e.vertices || []).map(v => pkt(Mo, v.x, v.y)); if (e.type === 'SOLID' && p.length === 4) [p[2], p[3]] = [p[3], p[2]]; dodaj(war, kol, p, true); snap.push(...p); break; }
        case 'POINT': if (e.position) snap.push(pkt(Mo, e.position.x, e.position.y)); break;
        case 'TEXT': case 'MTEXT': case 'ATTDEF': {
          if (e.type === 'ATTDEF') break;
          const mt = e.type === 'MTEXT';
          const txt = mt ? czyscMtext(e.text) : czyscTekst(e.text); if (!txt.trim()) break;
          const wyr = !mt && (e.halign || e.valign) && e.endPoint && e.halign !== 3 && e.halign !== 5; const P = mt ? e.position : (wyr ? e.endPoint : e.startPoint); if (!P) break;
          const [x, y] = pkt(Mo, P.x, P.y);
          let rot = (e.rotation || 0) * Math.PI / 180; if (mt && e.directionVector) rot = Math.atan2(e.directionVector.y, e.directionVector.x);
          const vx = pkt(Mo, Math.cos(rot), Math.sin(rot)), v0 = pkt(Mo, 0, 0); const rw = Math.atan2(vx[1] - v0[1], vx[0] - v0[0]);
          const sk = Math.sqrt(Math.abs(Mo[0] * Mo[3] - Mo[1] * Mo[2])) || 1;
          const h = (mt ? e.height : e.textHeight) * sk; if (!(h > 0)) break;
          let poz = 'L', pion = 'B';
          if (mt) { const a = e.attachmentPoint || 1; poz = 'LCR'[(a - 1) % 3]; pion = 'TMB'[Math.floor((a - 1) / 3)]; }
          else { poz = ['L', 'C', 'R', 'L', 'C', 'L'][e.halign || 0]; pion = ['B', 'B', 'M', 'T'][e.valign || 0]; if (e.halign === 4) pion = 'M'; }
          teksty.push({ x, y, h, rot: rw, t: txt, war, kol, poz, pion, mt });
          snap.push([x, y]); break;
        }
        case 'INSERT': case 'DIMENSION': {
          if (glebia > 12) break;
          const blok = d.blocks && d.blocks[e.type === 'DIMENSION' ? e.block : e.name]; if (!blok || !blok.entities) break;
          if (e.type === 'DIMENSION') { for (const x of blok.entities) encja(x, M, war, kol, glebia + 1); break; }
          const bx = (blok.position && blok.position.x) || 0, by = (blok.position && blok.position.y) || 0;
          const sx = e.xScale ?? 1, sy = e.yScale ?? 1, r = (e.rotation || 0) * Math.PI / 180;
          const nc = Math.max(1, e.columnCount || 1), nr = Math.max(1, e.rowCount || 1);
          for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) {
            const px = e.position.x + Math.cos(r) * i * (e.columnSpacing || 0) - Math.sin(r) * j * (e.rowSpacing || 0);
            const py = e.position.y + Math.sin(r) * i * (e.columnSpacing || 0) + Math.cos(r) * j * (e.rowSpacing || 0);
            const Mi = mnoz(Mo, [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, px, py]);
            const Mb = mnoz(Mi, [1, 0, 0, 1, -bx, -by]);
            snap.push(pkt(Mo, px, py));
            for (const x of blok.entities) encja(x, Mb, war, kol, glebia + 1);
          }
          break;
        }
        default: break;
      }
    }
    const udzial = new Map(); // co zajmuje najwięcej punktów: „blok …” albo „warstwa …”
    for (const e of d.entities) {
      const l0 = licznik; encja(e, ID, null, null, 0); const n = licznik - l0;
      if (n) { const k = e.type === 'INSERT' ? `blok „${e.name}” (warstwa „${e.layer || '0'}”)` : `warstwa „${e.layer || '0'}”`; udzial.set(k, (udzial.get(k) || 0) + n); }
    }
    if (przekroczono) {
      const mln = (v) => (v / 1e6).toFixed(1).replace('.', ',');
      const top = [...udzial].sort((a, b) => b[1] - a[1]).filter(([, n], i) => i === 0 || n >= licznik * 0.02).slice(0, 3).map(([k, n]) => `${k} — ${Math.round(100 * n / licznik)}%`);
      const err = new Error(`Rysunek jest zbyt duży: ${mln(licznik)} mln punktów linii (limit ${mln(LIMIT)} mln). Najwięcej zajmują: ${top.join('; ')}. W kopii rysunku w ZWCAD usuń te elementy albo zamroź ich warstwy i zapisz DXF ponownie.`);
      err.udzial = [...udzial].sort((a, b) => b[1] - a[1]).slice(0, 10); throw err;
    }
    if (!grupy.size && !teksty.length) throw new Error('W pliku DXF nie znaleziono widocznych elementów rysunku w obszarze modelu (sprawdź, czy warstwy nie są zamrożone).');

    // Zasięg rysunku (współrzędne świata) — pełny i „rdzeń” (bez pojedynczych elementów daleko od reszty).
    // pełny zasięg — dokładnie, ze wszystkich wierzchołków (do 0.4.1 z co czwartego, co mogło pominąć skrajną linię); „rdzeń” — z próbki
    const xs = [], ys = []; let n = 0; const pelny = { minx: Infinity, maxx: -Infinity, miny: Infinity, maxy: -Infinity };
    const obejmij = (x, y) => { if (x < pelny.minx) pelny.minx = x; if (x > pelny.maxx) pelny.maxx = x; if (y < pelny.miny) pelny.miny = y; if (y > pelny.maxy) pelny.maxy = y; };
    for (const g of grupy.values()) for (const a of g.linie) for (let i = 0; i < a.length; i += 2) { obejmij(a[i], a[i + 1]); if ((n++ & 3) === 0) { xs.push(a[i]); ys.push(a[i + 1]); } }
    for (const t of teksty) { obejmij(t.x, t.y); xs.push(t.x); ys.push(t.y); }
    const sortN = (v) => Float64Array.from(v).sort();
    const X = sortN(xs), Y = sortN(ys), q = (A, f) => A[Math.min(A.length - 1, Math.max(0, Math.floor(f * (A.length - 1))))];
    const rdzen = { minx: q(X, 0.005), maxx: q(X, 0.995), miny: q(Y, 0.005), maxy: q(Y, 0.995) };
    // Początek układu arkusza. Dla podkładu już używanego w projekcie zostaje ten zapisany (opcje.poczatek) —
    // inaczej po zmianie sposobu wczytywania (np. pominięciu zamrożonych warstw) znaczniki przesunęłyby się względem rysunku.
    const ox = opcje.poczatek ? opcje.poczatek[0] : Math.floor(pelny.minx), oy = opcje.poczatek ? opcje.poczatek[1] : Math.ceil(pelny.maxy);

    // Przeliczenie do układu arkusza: sx = X − ox, sy = oy − Y (oś y w dół).
    for (const g of grupy.values()) for (const a of g.linie) for (let i = 0; i < a.length; i += 2) { a[i] -= ox; a[i + 1] = oy - a[i + 1]; }
    for (const t of teksty) { t.x -= ox; t.y = oy - t.y; t.rot = -t.rot; }
    const naArk = (p) => [p[0] - ox, oy - p[1]];
    const rozp = Math.max(rdzen.maxx - rdzen.minx, rdzen.maxy - rdzen.miny) || 1;
    const sp = snap.map(naArk);
    // Skrzyżowania długich prostych odcinków (osie, lica ścian) — dodatkowe punkty przyciągania.
    const dlugie = proste.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > rozp / 40)
      .sort((u, v) => Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1]) - Math.hypot(u[1][0] - u[0][0], u[1][1] - u[0][1])).slice(0, 1500).map(([a, b]) => [naArk(a), naArk(b)]);
    for (let i = 0; i < dlugie.length; i++) for (let j = i + 1; j < dlugie.length; j++) { const p = Geom.przeciecie(dlugie[i][0], dlugie[i][1], dlugie[j][0], dlugie[j][1]); if (p) sp.push(p); }

    return {
      wersja, kodowanie, jednostki: jedn[0], k: jedn[1], ox, oy,
      zasieg: { minx: 0, miny: 0, maxx: Math.max(pelny.maxx - ox, 1), maxy: Math.max(oy - pelny.miny, 1) },
      widok: { minx: rdzen.minx - ox, maxx: rdzen.maxx - ox, miny: oy - rdzen.maxy, maxy: oy - rdzen.miny },
      warstwy: [...warstwy.values()].sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl')),
      grupy: [...grupy.values()], teksty, snap: Geom.indeksPunktow(sp, rozp / 150), lSnap: sp.length,
      T: { a: 1, b: 0, c: 0, d: -1, e: ox, f: oy }
    };
  }
  return { wczytaj, dekoduj };
})();
