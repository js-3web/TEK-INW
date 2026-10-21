/* TEK-INW — geometria: układy współrzędnych, kalibracja, przyciąganie do punktów rysunku.

   Dwa układy:
   • układ ARKUSZA (sx, sy) — w nim zapisujemy znaczniki. Dla PDF: punkty PDF (1 pt = 1/72 cala) tak, jak strona
     jest wyświetlana, oś y w dół. Dla DXF: jednostki rysunku, oś y w dół, początek przesunięty do narożnika rysunku.
   • układ RYSUNKU / ŚWIATA (X, Y) — współrzędne jak w ZWCAD (oś Y w górę). Dla DXF to dokładnie współrzędne z pliku.
     Dla PDF powstaje po kalibracji (dwa punkty o znanych współrzędnych albo znana odległość).

   Przejście arkusz → świat to przekształcenie afiniczne T = {a,b,c,d,e,f}:  X = a·sx + c·sy + e,  Y = b·sx + d·sy + f. */
'use strict';

const Geom = (() => {
  const zastosuj = (T, sx, sy) => [T.a * sx + T.c * sy + T.e, T.b * sx + T.d * sy + T.f];
  function odwroc(T) {
    const det = T.a * T.d - T.b * T.c; if (!det) return null;
    const a = T.d / det, b = -T.b / det, c = -T.c / det, d = T.a / det;
    return { a, b, c, d, e: -(a * T.e + c * T.f), f: -(b * T.e + d * T.f) };
  }
  const skala = (T) => Math.sqrt(Math.abs(T.a * T.d - T.b * T.c)); // ile jednostek świata na 1 jednostkę arkusza

  /* Kalibracja dwoma punktami: arkusz (s1, s2) → świat (w1, w2). Liczby zespolone: w = k·u + t, gdzie u = (sx, −sy)
     (odbicie osi y, bo na arkuszu y rośnie w dół). Wynik zachowuje kąty (bez zniekształceń). */
  function zDwochPunktow(s1, s2, w1, w2) {
    const u1 = [s1[0], -s1[1]], u2 = [s2[0], -s2[1]];
    const du = [u2[0] - u1[0], u2[1] - u1[1]], dw = [w2[0] - w1[0], w2[1] - w1[1]];
    const m = du[0] * du[0] + du[1] * du[1]; if (m < 1e-12) throw new Error('Punkty kalibracji leżą zbyt blisko siebie.');
    if (Math.hypot(...dw) < 1e-9) throw new Error('Współrzędne obu punktów są takie same.');
    const kr = (dw[0] * du[0] + dw[1] * du[1]) / m, ki = (dw[1] * du[0] - dw[0] * du[1]) / m; // k = dw / du
    const tx = w1[0] - (kr * u1[0] - ki * u1[1]), ty = w1[1] - (ki * u1[0] + kr * u1[1]);
    return { a: kr, b: ki, c: ki, d: -kr, e: tx, f: ty };
  }
  /* Kalibracja znaną odległością: punkt 1 = początek układu, oś X wzdłuż poziomu arkusza. */
  function zOdleglosci(s1, s2, D) {
    const L = Math.hypot(s2[0] - s1[0], s2[1] - s1[1]); if (L < 1e-9) throw new Error('Punkty kalibracji leżą zbyt blisko siebie.');
    const k = D / L;
    return { a: k, b: 0, c: 0, d: -k, e: -k * s1[0], f: k * s1[1] };
  }
  const odl = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const katOsiX = (T) => Math.atan2(T.b, T.a); // obrót osi X świata względem poziomu arkusza (radiany, w układzie świata)

  /* Indeks punktów przyciągania (siatka kubełków) — szybkie szukanie najbliższego punktu w promieniu. */
  function indeksPunktow(pkt, rozmiar) {
    const S = rozmiar || 1, m = new Map();
    const klucz = (i, j) => i * 100003 + j;
    for (let n = 0; n < pkt.length; n++) {
      const p = pkt[n], k = klucz(Math.floor(p[0] / S), Math.floor(p[1] / S));
      let b = m.get(k); if (!b) m.set(k, b = []); b.push(n);
    }
    function najblizszy(x, y, r) {
      const i0 = Math.floor((x - r) / S), i1 = Math.floor((x + r) / S), j0 = Math.floor((y - r) / S), j1 = Math.floor((y + r) / S);
      let best = null, bd = r * r;
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return null; // zbyt mały zoom — nie przyciągamy
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const b = m.get(klucz(i, j)); if (!b) continue;
        for (const n of b) { const p = pkt[n], d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d <= bd) { bd = d; best = p; } }
      }
      return best;
    }
    return { najblizszy, ile: pkt.length };
  }

  /* Przecięcie dwóch odcinków (do punktów przyciągania na skrzyżowaniach osi i ścian). */
  function przeciecie(a, b, c, d) {
    const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
    const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return [a[0] + t * r[0], a[1] + t * r[1]];
  }

  /* Wpis punktu jak w ZWCAD: „x;y” (bezwzględnie), „@dx;dy” (względem poprzedniego), „@dł<kąt” (biegunowo, kąt w stopniach
     od osi X przeciwnie do wskazówek zegara). Separator współrzędnych: średnik lub spacja; część dziesiętna: przecinek lub kropka.
     Zwraca punkt w układzie ŚWIATA (jednostki użytkownika przeliczone przez funkcję naSwiat). */
  function parsujWpis(tekst, poprzedniSwiat, naSwiat) {
    let s = String(tekst || '').trim(); if (!s) return null;
    const wzgl = s.startsWith('@'); if (wzgl) s = s.slice(1).trim();
    if (wzgl && !poprzedniSwiat) throw new Error('Wpis względny (@) wymaga wcześniejszego punktu.');
    if (s.includes('<')) {
      const [dl, kt] = s.split('<').map(parsujLiczbe);
      if (!isFinite(dl) || !isFinite(kt)) throw new Error('Wpis biegunowy: @długość<kąt, np. @5,985<90');
      const L = naSwiat(dl), a = kt * Math.PI / 180, base = wzgl ? poprzedniSwiat : [0, 0];
      return [base[0] + L * Math.cos(a), base[1] + L * Math.sin(a)];
    }
    const cz = s.split(/[;\s]+/).filter(Boolean).map(parsujLiczbe);
    if (cz.length !== 2 || !cz.every(isFinite)) throw new Error('Wpis: x;y albo @dx;dy albo @długość<kąt (separator: średnik).');
    const v = [naSwiat(cz[0]), naSwiat(cz[1])];
    return wzgl ? [poprzedniSwiat[0] + v[0], poprzedniSwiat[1] + v[1]] : v;
  }

  return { zastosuj, odwroc, skala, zDwochPunktow, zOdleglosci, odl, katOsiX, indeksPunktow, przeciecie, parsujWpis };
})();
