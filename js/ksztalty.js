/* TEK-INW — wygładzanie szkiców i rozpoznawanie kształtów (od wersji 0.4).
   Kreska odręczna (lista punktów w układzie arkusza) → linia prosta, prostokąt, trójkąt, wielokąt, okrąg lub elipsa.
   Zasada działania (bez sztucznej inteligencji — sama geometria):
   1. punkty rozkładamy równo wzdłuż kreski (żeby szybkie i wolne fragmenty ważyły tyle samo),
   2. sprawdzamy, czy kreska jest zamknięta (koniec blisko początku),
   3. otwarta: czy wszystkie punkty leżą blisko odcinka początek–koniec → linia; inaczej upraszczamy do łamanej,
   4. zamknięta: dopasowanie elipsy (osie główne z rozrzutu punktów) — mały rozrzut promienia → okrąg/elipsa;
      inaczej upraszczanie Douglasa–Peuckera → liczba narożników: 4 z kątami ≈ 90° → prostokąt, 3 → trójkąt, 5–8 → wielokąt.
   Prostokąty i linie bliskie osi rysunku (±10°) są do nich wyrównywane — tak jak „Orto” w ZWCAD.
   „wymus” = rysownik przytrzymał rysik na końcu kreski (jak w Notatkach iPada): rozpoznajemy śmielej. */
'use strict';

const Ksztalty = (() => {
  const odl = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dlugosc = (P) => { let L = 0; for (let i = 1; i < P.length; i++) L += odl(P[i - 1], P[i]); return L; };
  function odlOdc(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function przeprobkuj(P, n) { // n punktów w równych odstępach wzdłuż kreski
    const L = dlugosc(P); if (L <= 0) return P.slice(); const krok = L / (n - 1), out = [P[0]]; let d = 0;
    for (let i = 1; i < P.length; i++) {
      let a = P[i - 1]; const b = P[i]; let s = odl(a, b);
      while (d + s >= krok && out.length < n) { const t = (krok - d) / s, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; out.push(q); a = q; s = odl(a, b); d = 0; }
      d += s;
    }
    while (out.length < n) out.push(P[P.length - 1]);
    return out;
  }
  function rdp(P, eps) { // Douglas–Peucker: zostawia tylko punkty, bez których kształt zmieniłby się o więcej niż eps
    if (P.length < 3) return P.slice();
    let dmax = 0, ix = 0; for (let i = 1; i < P.length - 1; i++) { const d = odlOdc(P[i], P[0], P[P.length - 1]); if (d > dmax) { dmax = d; ix = i; } }
    if (dmax <= eps) return [P[0], P[P.length - 1]];
    const a = rdp(P.slice(0, ix + 1), eps), b = rdp(P.slice(ix), eps); return a.slice(0, -1).concat(b);
  }
  function chaikin(P, n = 2, zamkn = false) { // wygładzenie łamanej (każdy odcinek dzielony w 1/4 i 3/4)
    let Q = P;
    for (let k = 0; k < n; k++) {
      const R = zamkn ? [] : [Q[0]], m = Q.length;
      for (let i = 0; i < (zamkn ? m : m - 1); i++) { const a = Q[i], b = Q[(i + 1) % m]; R.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
      if (!zamkn) R.push(Q[m - 1]); Q = R;
    }
    return Q;
  }
  const katNorm = (a) => { a %= Math.PI; if (a < 0) a += Math.PI; return a; }; // kierunek bez zwrotu, 0…π
  const roznica90 = (a, b) => { let d = Math.abs(katNorm(a) - katNorm(b)) % (Math.PI / 2); return Math.min(d, Math.PI / 2 - d); };

  /* Prosta: wyrównanie do osi rysunku, gdy odchyłka < 10° */
  function linia(a, b, kat) {
    const L = odl(a, b), th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (let k = 0; k < 4; k++) { const osi = kat + k * Math.PI / 2; let d = th - osi; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 10 * Math.PI / 180) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ux = Math.cos(osi), uy = Math.sin(osi); return [[m[0] - ux * L / 2, m[1] - uy * L / 2], [m[0] + ux * L / 2, m[1] + uy * L / 2]]; } }
    return [a, b];
  }
  function elipsa(P) { // osie główne z macierzy kowariancji; zwraca środek, półosie, obrót i rozrzut promienia znormalizowanego
    const n = P.length; let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
    let sxx = 0, syy = 0, sxy = 0; for (const p of P) { const x = p[0] - cx, y = p[1] - cy; sxx += x * x; syy += y * y; sxy += x * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(th), s = Math.sin(th);
    let ra = 0, rb = 0; const loc = P.map(p => { const x = p[0] - cx, y = p[1] - cy; return [x * c + y * s, -x * s + y * c]; });
    for (const q of loc) { ra = Math.max(ra, Math.abs(q[0])); rb = Math.max(rb, Math.abs(q[1])); }
    // półosie: średnia z ekstremów i z rozrzutu (dla elipsy std = a/√2) — odporne na „przestrzelenie” przy zamykaniu
    let va = 0, vb = 0; for (const q of loc) { va += q[0] * q[0]; vb += q[1] * q[1]; } va = Math.sqrt(2 * va / n); vb = Math.sqrt(2 * vb / n);
    const a = (ra + va) / 2, b = (rb + vb) / 2; if (a <= 0 || b <= 0) return null;
    const r = loc.map(q => Math.hypot(q[0] / a, q[1] / b)), m = r.reduce((x, y) => x + y, 0) / n, sd = Math.sqrt(r.reduce((x, y) => x + (y - m) * (y - m), 0) / n);
    return { cx, cy, a: a * m, b: b * m, th, cv: sd / m };
  }
  function punktyElipsy(e, n = 48) { const c = Math.cos(e.th), s = Math.sin(e.th), out = []; for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n, x = e.a * Math.cos(t), y = e.b * Math.sin(t); out.push([e.cx + x * c - y * s, e.cy + x * s + y * c]); } return out; }
  function prostokat(rogi, P, kat) {
    // kierunek: średni kierunek krawędzi (mod 90°), ważony długością; wyrównanie do osi rysunku przy odchyłce < 10°
    let sx = 0, sy = 0; for (let i = 0; i < 4; i++) { const a = rogi[i], b = rogi[(i + 1) % 4], L = odl(a, b), t = 4 * Math.atan2(b[1] - a[1], b[0] - a[0]); sx += L * Math.cos(t); sy += L * Math.sin(t); }
    let th = Math.atan2(sy, sx) / 4; if (roznica90(th, kat) < 10 * Math.PI / 180) th = kat + Math.round((th - kat) / (Math.PI / 2)) * (Math.PI / 2);
    const c = Math.cos(th), s = Math.sin(th), loc = (p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c], glob = (q) => [q[0] * c - q[1] * s, q[0] * s + q[1] * c];
    // położenie boków = mediana punktów kreski przy danym boku (odporne na „ogonki” w narożnikach)
    const L = P.map(loc), xs = L.map(q => q[0]), ys = L.map(q => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), tol = 0.2 * Math.min(x1 - x0, y1 - y0);
    const med = (arr) => { const a = arr.slice().sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
    const lewy = med(L.filter(q => q[0] < x0 + tol).map(q => q[0])), prawy = med(L.filter(q => q[0] > x1 - tol).map(q => q[0]));
    const gora = med(L.filter(q => q[1] < y0 + tol).map(q => q[1])), dol = med(L.filter(q => q[1] > y1 - tol).map(q => q[1]));
    return [[lewy, gora], [prawy, gora], [prawy, dol], [lewy, dol]].map(glob);
  }
  function katyProste(R) { for (let i = 0; i < R.length; i++) { const a = R[(i + R.length - 1) % R.length], b = R[i], c = R[(i + 1) % R.length]; const u = Math.atan2(a[1] - b[1], a[0] - b[0]), w = Math.atan2(c[1] - b[1], c[0] - b[0]); let d = Math.abs(u - w); if (d > Math.PI) d = 2 * Math.PI - d; if (Math.abs(d - Math.PI / 2) > 25 * Math.PI / 180) return false; } return true; }

  /* Główna funkcja. P — punkty kreski (układ arkusza), kat — kierunek osi X rysunku na arkuszu [rad].
     Zwraca { pkt, zamkn, ksztalt } albo null (kreska zostaje odręczna). */
  function rozpoznaj(P0, { kat = 0, wymus = false } = {}) {
    if (!P0 || P0.length < 3) return null;
    const L0 = dlugosc(P0); if (L0 <= 0) return null;
    const P = przeprobkuj(P0, 96), L = dlugosc(P), d0 = odl(P[0], P[P.length - 1]);
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; for (const p of P) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
    const przek = Math.hypot(bx1 - bx0, by1 - by0);
    const zamk = d0 < Math.max(0.14 * L, 0.2 * przek) && L > 1.6 * przek;
    if (!zamk) {
      let maxd = 0; for (const p of P) maxd = Math.max(maxd, odlOdc(p, P[0], P[P.length - 1]));
      if (maxd < (wymus ? 0.1 : 0.045) * L) return { pkt: linia(P[0], P[P.length - 1], kat), zamkn: false, ksztalt: 'linia' };
      const R = rdp(P, 0.035 * L);
      if (wymus && R.length <= 6) return { pkt: R.length === 2 ? linia(R[0], R[1], kat) : R, zamkn: false, ksztalt: 'lamana' }; // łamana tylko po przytrzymaniu — nie psujemy pisma
      return null;
    }
    const e = elipsa(P);
    if (e && e.cv < (wymus ? 0.11 : 0.075)) {
      if (Math.max(e.a, e.b) / Math.min(e.a, e.b) < 1.18) { const r = (e.a + e.b) / 2; return { pkt: punktyElipsy({ ...e, a: r, b: r }), zamkn: true, ksztalt: 'okrag', srodek: [e.cx, e.cy], r }; }
      return { pkt: punktyElipsy(e), zamkn: true, ksztalt: 'elipsa' };
    }
    const Pz = P.slice(0, -1).concat([P[0]]); // domknięcie
    let R = rdp(Pz, 0.045 * L); R = R.slice(0, -1);
    // narożnik w punkcie startu: RDP traktuje start jako wierzchołek — usuwamy go, jeśli leży na prostej sąsiadów
    if (R.length > 3) { const a = R[R.length - 1], b = R[0], c = R[1]; if (odlOdc(b, a, c) < 0.03 * L) R = R.slice(1); }
    if (R.length === 4 && katyProste(R)) return { pkt: prostokat(R, P, kat), zamkn: true, ksztalt: 'prostokat' };
    if (R.length === 3) return { pkt: R, zamkn: true, ksztalt: 'trojkat' };
    if (wymus && R.length >= 4 && R.length <= 8) return { pkt: R, zamkn: true, ksztalt: 'wielokat' };
    return null;
  }
  /* Kreska, której nie rozpoznano: lekkie wygładzenie drżenia ręki i uproszczenie (mniej punktów w PDF i DXF). */
  function wygladz(P, tol) { if (!P || P.length < 3) return P; return rdp(chaikin(P, 2), tol); }
  return { rozpoznaj, wygladz, _test: { rdp, przeprobkuj, elipsa } };
})();
