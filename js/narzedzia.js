/* TEK-INW — drobne narzędzia wspólne dla całej aplikacji (skróty DOM, liczby po polsku, okna, zdjęcia). */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dzis = () => new Date().toLocaleDateString('pl-PL');
const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const czekaj = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dataCzas = (t) => t ? new Date(t).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/* Liczby: wyświetlamy z przecinkiem (po polsku), przyjmujemy z przecinkiem lub kropką. */
function liczba(v, miejsc = 3) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return Number(v).toLocaleString('pl-PL', { minimumFractionDigits: miejsc, maximumFractionDigits: miejsc, useGrouping: false });
}
function parsujLiczbe(t) {
  if (typeof t === 'number') return t;
  const s = String(t ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!s || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return NaN;
  return parseFloat(s);
}

/* Komunikat w rogu ekranu (jak w TEK-AUDYTOR). akcja = { tekst, fn } dodaje przycisk. */
function toast(msg, zly, akcja) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (zly ? ' zly' : '') + (akcja ? ' zakcja' : '');
  if (akcja) {
    const b = document.createElement('button'); b.textContent = akcja.tekst; b.onclick = () => { t.className = 'toast'; akcja.fn(); }; t.appendChild(b);
    const x = document.createElement('button'); x.textContent = '×'; x.className = 'tx'; x.onclick = () => { t.className = 'toast'; }; t.appendChild(x);
  }
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', akcja ? 30000 : zly ? 9000 : 3500);
}

/* Okno dialogowe: zwraca obietnicę z wartością przycisku (data-w) lub null przy zamknięciu. */
function okno(html, klasa = 'waski', przyOtwarciu) {
  return new Promise((ok) => {
    const d = $('#dlg'); d.className = klasa; d.innerHTML = html;
    const koniec = (w) => { d.onclick = null; d.oncancel = null; if (d.open) d.close(); ok(w); };
    d.onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) { e.preventDefault(); koniec(b.dataset.w); } };
    d.oncancel = () => koniec(null);
    d.showModal();
    if (przyOtwarciu) przyOtwarciu(d, koniec);
  });
}
async function potwierdz(tekst, tak = 'Tak', nie = 'Anuluj', groznie = false) {
  const w = await okno(`<h2>Potwierdź</h2><p>${tekst}</p><div class="btns right"><button class="btn" data-w="nie">${esc(nie)}</button><button class="btn ${groznie ? 'danger' : 'primary'}" data-w="tak">${esc(tak)}</button></div>`);
  return w === 'tak';
}

/* Wybór pliku z dysku / aparatu. capture = 'environment' otwiera od razu aparat na iPadzie. */
function wybierzPliki({ accept = '', multiple = false, capture = null } = {}) {
  return new Promise((ok) => {
    const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept; i.multiple = multiple; // bez „accept” — wszystkie pliki do wyboru
    if (capture) i.setAttribute('capture', capture);
    i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { const f = Array.from(i.files || []); i.remove(); ok(f); };
    i.addEventListener('cancel', () => { i.remove(); ok([]); });
    i.click();
  });
}

/* Zdjęcie → JPEG o zadanej największej krawędzi. Obraz dekodujemy przez <img>, bo Safari wtedy uwzględnia
   obrót z aparatu (EXIF). Płótno zwalniamy od razu — iPad ma mały limit pamięci na płótna. */
async function obrazZPliku(blob) {
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.decoding = 'async'; img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}
async function jpegZObrazu(img, maxPx, jakosc = 0.85) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const k = Math.min(1, maxPx / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((ok, zle) => c.toBlob(b => b ? ok(b) : zle(new Error('Nie udało się zakodować zdjęcia.')), 'image/jpeg', jakosc));
  c.width = c.height = 0;
  return { blob, w, h };
}

/* Zapis pliku: na iPadzie najpewniej działa okno „Udostępnij” (Zapisz w Plikach, AirDrop, OneDrive),
   w przeglądarce na komputerze — zwykłe pobranie do folderu „Pobrane”. */
function mozeUdostepnic(plik) { try { return !!(navigator.canShare && navigator.canShare({ files: [plik] })); } catch (e) { return false; } }
async function udostepnij(plik) { await navigator.share({ files: [plik], title: plik.name }); }
function pobierz(blob, nazwa) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nazwa; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const bezpiecznaNazwa = (s, dl = 40) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, dl) || 'projekt';
const urzadzenieDotykowe = () => (navigator.maxTouchPoints || 0) > 0;
const iPad = () => /iPad|Macintosh/.test(navigator.userAgent) && urzadzenieDotykowe();

/* Kolory notatek i znaczników do wyboru (od 0.4.2). W projekcie zapisujemy identyfikator (z.kolor, kreska.kolor);
   brak koloru = kolor rodzaju (F, wymiar, nowy, brak, uwaga, szkic). hex — na rysunku i w PDF (białe tło),
   ekr — jaśniejszy odcień do ciemnego interfejsu, aci — numer koloru AutoCAD/ZWCAD w pliku DXF zmian. */
const PALETA = [
  { id: 'czerwony', nazwa: 'czerwony', hex: '#dc2626', ekr: '#f28b8b', aci: 1 },
  { id: 'pomaranczowy', nazwa: 'pomarańczowy', hex: '#ea580c', ekr: '#f6a56b', aci: 30 },
  { id: 'zolty', nazwa: 'żółty', hex: '#ca8a04', ekr: '#f2cf5b', aci: 2 },
  { id: 'zielony', nazwa: 'zielony', hex: '#16a34a', ekr: '#6fcf8e', aci: 3 },
  { id: 'turkus', nazwa: 'turkusowy', hex: '#0891b2', ekr: '#5fd3ee', aci: 4 },
  { id: 'niebieski', nazwa: 'niebieski', hex: '#2563eb', ekr: '#8fb0f7', aci: 5 },
  { id: 'fiolet', nazwa: 'fioletowy', hex: '#9333ea', ekr: '#c9a2f5', aci: 6 },
  { id: 'czarny', nazwa: 'czarny', hex: '#1d1d1b', ekr: '#e6e9ef', aci: 7 },
  { id: 'szary', nazwa: 'szary', hex: '#6b7280', ekr: '#b9c3d6', aci: 8 }
];
const kolorPalety = (id) => (id && PALETA.find(k => k.id === id)) || null;
