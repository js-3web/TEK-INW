/* TEK-INW — logika aplikacji: lista projektów, zakładki, plan ze znacznikami, zdjęcia, eksport.
   Struktura jak w TEK-AUDYTOR: ekran główny z listą projektów → projekt z zakładkami modułów. */
'use strict';

const KATEGORIE = ['Fundamenty', 'Konstrukcja nośna (słupy, dźwigary, rygle)', 'Stężenia i płatwie', 'Ściany zewnętrzne / obudowa', 'Dach, świetliki, klapy dymowe', 'Posadzka', 'Bramy, doki, rampy, stolarka', 'Ściany wewnętrzne i oddzielenia ppoż.', 'Część biurowo-socjalna', 'Instalacje', 'Wyposażenie i zagospodarowanie (regały, strefy)', 'Otoczenie (place, drogi, rampy zewn.)', 'Inne'];
const NARZ = [
  ['przegladaj', 'Przeglądaj', 'Przesuwanie planu i wybór znacznika', '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-1.5v-2a1.5 1.5 0 1 1 3 0V12m0-1.5a1.5 1.5 0 1 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.8-2.4L3.3 15.4a1.6 1.6 0 0 1 2.5-2L8 15.5"/>'],
  ['foto', 'Foto', 'Punkt zdjęcia: stuknij; przeciągnij, aby od razu wskazać kierunek', '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>'],
  ['wymiar', 'Wymiar', 'Inny wymiar / położenie: dwa punkty + wynik z dalmierza', '<path d="M3 12h18M3 8v8M21 8v8M7 10l-2 2 2 2M17 10l2 2-2 2"/>'],
  ['nowy', 'Nowy', 'Nowy element (linia, prostokąt, polilinia)', '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 8v8M8 12h8"/>'],
  ['brak', 'Brak', 'Element z rysunku nie istnieje — obrysuj go', '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/><path d="M8 8l8 8M16 8l-8 8"/>'],
  ['uwaga', 'Uwaga', 'Uwaga tekstowa w punkcie', '<path d="M5 5h14v10H10l-4 4v-4H5z"/><path d="M9 9h6M9 12h4"/>'],
  ['szkic', 'Szkic', 'Szkic odręczny (do interpretacji)', '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>'],
  ['pomiar', 'Pomiar', 'Odległość na rysunku (nie zapisuje się)', '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>']
];
const TABS = [['projekt', '1. Projekt'], ['podklady', '2. Podkłady'], ['plan', '3. Plan'], ['lista', '4. Zestawienie'], ['eksport', '5. Eksport'], ['info', 'O programie']];

let S = null, tab = 'plan', arkId = null, wybrany = null, historia = [], R = new Map(), miniUrl = new Map(), planZamontowany = false, ostatniaPaczka = null;
const ikona = (sciezki) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${sciezki}</svg>`;

/* ---------- jednostki ---------- */
const jedn = () => (S && S.ustaw.jedn === 'mm') ? 'mm' : 'm';
const naUz = (mm) => jedn() === 'mm' ? liczba(mm, 0) : liczba(mm / 1000, 3);           // mm → tekst w jednostce użytkownika
const zUzNaMm = (v) => jedn() === 'mm' ? v : v * 1000;
function rArk(id) { return R.get(id || arkId); }
function swiatMm(r, p) { const w = Geom.zastosuj(r.T, p[0], p[1]); return [w[0] * r.k, w[1] * r.k]; }

/* ---------- projekt ---------- */
function nowyProjekt() {
  return { id: uid('p'), typ: 'tek-inw-projekt', wersja: 1,
    meta: { nazwa: '', adres: '', inwestor: '', nr: '', autor: '', data: dzis(), cel: '' },
    ustaw: { jedn: 'm', zdjPx: 2400, pdfPx: 1600, aparatOdRazu: true },
    arkusze: [], znaczniki: [], seqF: 1, seqZ: 1, utw: Date.now(), zmieniono: Date.now() };
}
let zapisTimer = 0;
function zapisz(odrazu) { if (!S) return; S.zmieniono = Date.now(); clearTimeout(zapisTimer); if (odrazu) Baza.zapiszProjekt(S); else zapisTimer = setTimeout(() => Baza.zapiszProjekt(S), 350); }
function migawka() { if (!S) return; historia.push(JSON.stringify({ z: S.znaczniki, f: S.seqF, q: S.seqZ })); if (historia.length > 60) historia.shift(); }
function cofnij() {
  const h = historia.pop(); if (!h) return toast('Nie ma czego cofnąć.');
  const o = JSON.parse(h), przed = new Set(S.znaczniki.flatMap(z => z.zdjecia || [])), biezZdj = new Map(S.znaczniki.map(z => [z.id, z.zdjecia || []]));
  for (const z of o.z) if (biezZdj.has(z.id)) z.zdjecia = biezZdj.get(z.id); // zdjęcia nie podlegają cofaniu — zostają przy swoich znacznikach
  S.znaczniki = o.z; S.seqF = o.f; S.seqZ = o.q; zapisz(true);
  const po = new Set(S.znaczniki.flatMap(z => z.zdjecia || [])); for (const id of przed) if (!po.has(id)) Baza.usunZdjecie(id); // zdjęcia cofniętego znacznika
  if (wybrany && !S.znaczniki.some(z => z.id === wybrany)) wybrany = null; odswiezPlan(); toast('Cofnięto ostatnią zmianę.');
}
async function otworzProjekt(p, naTab) {
  S = p; R = new Map(); historia = []; wybrany = null; zwolnijMiniatury();
  arkId = (S.arkusze.find(a => a.id === S.ostatniArkusz) || S.arkusze[0] || {}).id || null;
  tab = naTab || (S.arkusze.length ? 'plan' : 'podklady'); render(); window.scrollTo(0, 0);
}
async function zamknijProjekt() { if (S) { zapisz(true); await Baza.oproznij(); } S = null; R = new Map(); zwolnijMiniatury(); Plan.zniszcz(); planZamontowany = false; render(); window.scrollTo(0, 0); }
function zwolnijMiniatury() { for (const u of miniUrl.values()) URL.revokeObjectURL(u); miniUrl.clear(); }

/* ---------- arkusze: przygotowanie danych roboczych (wczytanie pliku, odczyt PDF/DXF) ---------- */
async function przygotujArkusz(a, bezObrazu) {
  let r = R.get(a.id); if (r && (bezObrazu || r.typ === 'dxf' || r.baza)) return r;
  const pl = await Baza.plik(a.zrodlo.plikId); if (!pl) throw new Error(`Brak pliku podkładu „${a.zrodlo.nazwa}” w pamięci urządzenia.`);
  if (a.typ === 'pdf') {
    const doc = await PdfPodklad.otworz(a.zrodlo.plikId, pl.dane), page = await PdfPodklad.strona(doc, a.zrodlo.strona || 1), wym = PdfPodklad.wymiary(page);
    r = r || { id: a.id, typ: 'pdf', page, wym, w: wym.w, h: wym.h, bajty: new Uint8Array(pl.dane), k: 1 };
    if (!bezObrazu && !r.baza) r.baza = await PdfPodklad.obrazBazowy(page, iPad() ? 8e6 : 14e6);
  } else {
    const dxf = Dxf.wczytaj(pl.dane);
    r = { id: a.id, typ: 'dxf', dxf, w: dxf.zasieg.maxx, h: dxf.zasieg.maxy, k: dxf.k };
    if (!a.warstwyWid) { a.warstwyWid = {}; for (const w of dxf.warstwy) if (!w.wid) a.warstwyWid[w.nazwa] = false; }
  }
  r.warstwyWid = a.warstwyWid || {};
  ustawKalibracje(r, a);
  R.set(a.id, r); return r;
}
function ustawKalibracje(r, a) {
  if (r.typ === 'dxf') r.T = r.dxf.T; else r.T = a.kal ? a.kal.T : null;
  r.Ti = r.T ? Geom.odwroc(r.T) : null;
}

/* ---------- RENDER ---------- */
function render() {
  document.body.dataset.view = S ? tab : 'start';
  if (!S) { $('#tabs').innerHTML = ''; $('#view').innerHTML = vStart(); document.title = 'TEK-INW'; planZamontowany = false; odswiezListe(); return; }
  $('#tabs').innerHTML = `<button class="tab home" data-act="do-startu" title="Zamknij projekt i wróć do listy projektów">‹ PROJEKTY</button>`
    + TABS.map(([id, n]) => `<button class="tab${id === tab ? ' on' : ''}" data-tab="${id}">${n}${id === 'lista' && S.znaczniki.length ? ` <span class="badge">${S.znaczniki.length}</span>` : ''}</button>`).join('')
    + `<span class="pnazwa" title="Bieżący projekt">${esc(S.meta.nazwa || 'projekt bez nazwy')}</span>`;
  document.title = (S.meta.nazwa ? S.meta.nazwa + ' — ' : '') + 'TEK-INW';
  if (tab !== 'plan') { Plan.zniszcz(); planZamontowany = false; }
  const v = { projekt: vProjekt, podklady: vPodklady, plan: vPlan, lista: vLista, eksport: vEksport, info: vInfo }[tab];
  $('#view').innerHTML = v();
  if (tab === 'plan') montujPlan();
  if (tab === 'eksport') odswiezMiejsce();
  wysokoscPaska();
}
function wysokoscPaska() { document.documentElement.style.setProperty('--appbar', ($('.appbar').offsetHeight || 48) + 'px'); }

/* ---------- EKRAN GŁÓWNY ---------- */
let listaProjektow = [];
async function odswiezListe() { try { listaProjektow = await Baza.projekty(); } catch (e) { listaProjektow = []; toast('Nie można odczytać bazy: ' + e.message, true); } if (!S) $('#view').innerHTML = vStart(); }
function vStart() {
  const ix = listaProjektow.slice().sort((a, b) => (b.zmieniono || 0) - (a.zmieniono || 0));
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<div class="home"><section class="hero"><div class="hl">${LOGO.produktCiemne}</div>
    <div class="tag">inwentaryzacja budowlana · rzut + zdjęcia + zmiany</div>
    <div class="meta"><span class="hv">v${APP.wersja}</span><span class="dot">·</span><span>${APP.data}</span><span class="dot">·</span><span>dane tylko na tym urządzeniu · działa bez internetu</span></div>
    <div class="hm"><span>produkt marki</span>${LOGO.tektoriaCiemne}</div></section>
  ${urzadzenieDotykowe() && !standalone && location.protocol.startsWith('http') ? `<div class="card warn"><h2>Zainstaluj na iPadzie przed pracą w terenie</h2><p class="sm">Safari → <b>Udostępnij</b> → <b>Do ekranu początkowego</b>. Uruchamiaj TEK-INW z ikony — wtedy działa bez internetu, a iPad nie kasuje danych przy porządkowaniu pamięci. Projekty utworzone w Safari mogą nie być widoczne w aplikacji z ikony (to osobne pamięci), więc zacznij pracę dopiero po instalacji.</p></div>` : ''}
  <div class="sec-h"><span>Projekty${ix.length ? ` (${ix.length})` : ''}</span><div class="btns"><button class="btn" data-act="import">Importuj kopię…</button><button class="btn" data-act="demo">Projekt przykładowy</button><button class="btn primary lg" data-act="nowy-projekt">+ Nowy projekt</button></div></div>
  ${ix.length ? `<div class="plist">${ix.map(p => { const nf = p.znaczniki.filter(z => z.rodzaj === 'F').length, nz = p.znaczniki.length - nf, nzd = p.znaczniki.reduce((s, z) => s + (z.zdjecia || []).length, 0); return `<div class="proj" data-act="proj-otworz" data-id="${esc(p.id)}">
      <div><div class="pt">${esc(p.meta.nazwa || 'Projekt bez nazwy')}</div><div class="pd">${esc([p.meta.adres, p.meta.inwestor, p.meta.nr].filter(Boolean).join(' · ') || '—')}</div></div>
      <div class="pc"><div class="chips"><span class="chip" style="background:#e3f3f8;color:#0A6F88" title="punkty foto"><b>${nf}</b> F</span><span class="chip" style="background:#fbeee4;color:#9a3412" title="zmiany i uwagi"><b>${nz}</b> Z</span><span class="chip" title="zdjęcia"><b>${nzd}</b> zdj.</span><span class="chip" title="podkłady"><b>${p.arkusze.length}</b> pl.</span></div></div>
      <div class="pm">ostatnio zmieniany<br>${dataCzas(p.zmieniono)}</div>
      <div class="pa"><button class="btn primary sm" data-act="proj-otworz" data-id="${esc(p.id)}">Otwórz</button><button class="x" data-act="proj-usun" data-id="${esc(p.id)}" title="Usuń projekt z tego urządzenia">×</button></div></div>`; }).join('')}</div>`
    : `<div class="pusto"><b>Nie masz jeszcze żadnego projektu</b>Utwórz projekt inwentaryzacji, wczytaj kopię z innego urządzenia albo otwórz projekt przykładowy (fikcyjna hala z podkładem DXF i PDF).<div class="btns" style="justify-content:center;margin-top:1rem"><button class="btn" data-act="demo">Projekt przykładowy</button><button class="btn primary lg" data-act="nowy-projekt">+ Nowy projekt</button></div></div>`}
  <div class="sec-h"><span>Przebieg pracy</span></div>
  <div class="tiles">${[['1', 'Podkład', 'DXF z ZWCAD (zalecany — współrzędne i przyciąganie) albo PDF (kalibracja dwoma punktami).'], ['2', 'Zdjęcia F', 'Stuknij miejsce na planie → aparat → zdjęcie trafia do punktu. Przeciągnij, aby wskazać kierunek.'], ['3', 'Zmiany Z', 'Inny wymiar (z dalmierza), nowy element, element nie istnieje, uwaga, szkic.'], ['4', 'Eksport', 'ZIP: PDF z klikalnymi punktami, zdjęcia, zestawienia, DXF zmian (warstwy INW-*), kopia projektu.']].map(([n, t, d]) => `<div class="tile"><i>KROK ${n}</i><b>${t}</b><span>${d}</span></div>`).join('')}</div>
  <div class="legal">Projekty, podkłady i zdjęcia są zapisywane w pamięci przeglądarki na tym urządzeniu i nie są nigdzie wysyłane. Wyczyszczenie danych witryny lub usunięcie aplikacji z ekranu początkowego usuwa projekty — po każdym dniu pracy zrób eksport (kopia projektu w ZIP). Narzędzie wspiera inwentaryzację i nie zastępuje pomiaru i oceny osoby z uprawnieniami. Zdjęcia mogą zawierać dane osobowe (osoby, tablice rejestracyjne) — fotografuj za zgodą właściciela lub zarządcy obiektu.</div></div>`;
}
function oknoNowegoProjektu() {
  okno(`<form id="npForm"><h2>Nowy projekt inwentaryzacji</h2>
    <label class="f"><span>Nazwa obiektu</span><input name="nazwa" required placeholder="np. Hala magazynowa B — inwentaryzacja"></label>
    <label class="f"><span>Adres / lokalizacja</span><input name="adres"></label>
    <div class="row"><label class="f"><span>Zamawiający</span><input name="inwestor"></label><label class="f"><span>Nr opracowania</span><input name="nr" placeholder="np. INW-2026-01"></label></div>
    <label class="f"><span>Autor</span><input name="autor" value="${esc(localStorageGet('tek-inw-autor') || '')}"></label>
    <div class="btns right"><button type="button" class="btn" data-w="anuluj">Anuluj</button><button type="submit" class="btn primary">Utwórz projekt</button></div></form>`, 'waski', (d, koniec) => {
    d.querySelector('[name=nazwa]').focus();
    d.querySelector('#npForm').onsubmit = async (e) => {
      e.preventDefault(); const o = Object.fromEntries(new FormData(e.target).entries()); if (!o.nazwa.trim()) return;
      const p = nowyProjekt(); Object.assign(p.meta, { nazwa: o.nazwa.trim(), adres: o.adres.trim(), inwestor: o.inwestor.trim(), nr: o.nr.trim(), autor: o.autor.trim() });
      localStorageSet('tek-inw-autor', p.meta.autor);
      await Baza.zapiszProjekt(p); await Baza.oproznij(); koniec('ok'); otworzProjekt(p, 'podklady'); toast('Utworzono projekt. Dodaj podkład (DXF lub PDF).');
    };
  });
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
async function projektPrzykladowy() {
  toast('Tworzę projekt przykładowy…');
  const p = nowyProjekt(); Object.assign(p.meta, { nazwa: 'Hala przykładowa (dane fikcyjne)', adres: 'ul. Testowa 1, Lublin (fikcja)', inwestor: 'Inwestor testowy', nr: 'INW-DEMO', autor: localStorageGet('tek-inw-autor') || '' });
  await Baza.zapiszProjekt(p); await Baza.oproznij();
  for (const [u, n, typ] of [['przyklad/hala_demo.dxf', 'hala_demo.dxf', 'dxf'], ['przyklad/hala_demo_A1.pdf', 'hala_demo_A1.pdf', 'pdf']]) {
    const b = await (await fetch(u)).blob(); const id = await Baza.zapiszPlik(p.id, b, n);
    p.arkusze.push({ id: uid('a'), nazwa: typ === 'dxf' ? 'Rzut przyziemia (DXF)' : 'Rzut przyziemia (PDF A1)', typ, zrodlo: { plikId: id, nazwa: n, strona: 1 }, kal: null, warstwyWid: null, widok: null });
  }
  await Baza.zapiszProjekt(p); await Baza.oproznij(); otworzProjekt(p, 'plan');
  toast('Projekt przykładowy: arkusz DXF jest gotowy; arkusz PDF skalibruj na osiach A/1 = 0;0 i D/13 = 144;72 m.');
}

/* ---------- 1. PROJEKT ---------- */
const pole = (k, et, ph = '', typ = 'input') => `<label class="f"><span>${et}</span>${typ === 'textarea' ? `<textarea data-bind="meta.${k}" rows="3" placeholder="${esc(ph)}">${esc(S.meta[k])}</textarea>` : `<input data-bind="meta.${k}" value="${esc(S.meta[k])}" placeholder="${esc(ph)}">`}</label>`;
function vProjekt() {
  const u = S.ustaw;
  return `<div class="grid2"><section class="card"><h2>Dane opracowania <small>trafiają na stronę tytułową fotodokumentacji</small></h2>
    ${pole('nazwa', 'Nazwa obiektu')}${pole('adres', 'Adres / lokalizacja')}
    <div class="row">${pole('inwestor', 'Zamawiający')}${pole('nr', 'Nr opracowania')}</div>
    <div class="row">${pole('autor', 'Autor')}${pole('data', 'Data wizji')}</div>
    ${pole('cel', 'Cel inwentaryzacji (do opisu)', 'np. dokumentacja stanu istniejącego do projektu adaptacji', 'textarea')}</section>
  <section class="card"><h2>Ustawienia projektu</h2>
    <label class="f"><span>Jednostka wpisywanych i pokazywanych wymiarów</span><select data-ust="jedn"><option value="m"${u.jedn === 'm' ? ' selected' : ''}>metry (jak na dalmierzu, np. 5,985)</option><option value="mm"${u.jedn === 'mm' ? ' selected' : ''}>milimetry (np. 5985)</option></select></label>
    <label class="f"><span>Rozdzielczość zapisywanych zdjęć (dłuższy bok)</span><select data-ust="zdjPx">${[[1600, '1600 px — mały plik (~0,4 MB)'], [2400, '2400 px — zalecane (~0,9 MB)'], [3200, '3200 px — wysoka (~1,6 MB)'], [4032, 'pełna z aparatu iPada (~2,5 MB)']].map(([v, t]) => `<option value="${v}"${+u.zdjPx === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="f"><span>Rozdzielczość zdjęć w PDF fotodokumentacji</span><select data-ust="pdfPx">${[[1200, '1200 px — lekki PDF'], [1600, '1600 px — zalecane'], [2400, '2400 px — duży PDF']].map(([v, t]) => `<option value="${v}"${+u.pdfPx === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="chk"><input type="checkbox" data-ust="aparatOdRazu"${u.aparatOdRazu ? ' checked' : ''}> Po postawieniu punktu F od razu otwieraj aparat</label>
    <p class="hint">Rozmiary plików są orientacyjne — zależą od treści zdjęcia. 300 zdjęć po 0,9 MB to ok. 270 MB w pamięci iPada.</p>
    <h3>Statystyka</h3><p class="sm">${S.arkusze.length} podkład(y) · ${S.znaczniki.filter(z => z.rodzaj === 'F').length} punktów F · ${S.znaczniki.filter(z => z.rodzaj === 'Z').length} zmian Z · ${S.znaczniki.reduce((s, z) => s + (z.zdjecia || []).length, 0)} zdjęć</p>
    <div class="btns"><button class="btn danger" data-act="proj-usun" data-id="${esc(S.id)}">Usuń projekt z urządzenia…</button></div></section></div>`;
}

/* ---------- 2. PODKŁADY ---------- */
function vPodklady() {
  return `<section class="card"><h2>Podkłady <small>rzuty, na których stawiasz punkty — DXF z ZWCAD albo PDF</small></h2>
    <div class="drop" data-act="dodaj-podklad"><b>Dodaj podkład — stuknij lub przeciągnij plik</b><br><span class="hint">DXF (zalecany): współrzędne jak w ZWCAD, przyciąganie do narożników i skrzyżowań osi, eksport zmian 1:1. PDF: każdą stronę trzeba skalibrować dwoma punktami.</span></div>
    ${S.arkusze.length ? `<div class="plist">${S.arkusze.map(a => { const n = S.znaczniki.filter(z => z.arkuszId === a.id).length; const kal = a.typ === 'dxf' ? '<span class="stat ok">układ z pliku DXF</span>' : a.kal ? `<span class="stat ok">skalibrowany (${a.kal.tryb === 'odl' ? 'odległość' : '2 punkty'})</span>` : '<span class="stat cz">bez kalibracji</span>';
      return `<div class="proj ark"><div><input class="arknazwa" data-ark="${a.id}" value="${esc(a.nazwa)}" aria-label="Nazwa podkładu"><div class="pd">${esc(a.zrodlo.nazwa)}${a.typ === 'pdf' ? ' · strona ' + a.zrodlo.strona : ''} · ${a.typ.toUpperCase()}</div></div>
        <div class="pc">${kal} <span class="muted sm">${n} znaczników</span></div><div class="pm"></div>
        <div class="pa"><button class="btn primary sm" data-act="ark-otworz" data-id="${a.id}">Plan</button>${a.typ === 'pdf' ? `<button class="btn sm" data-act="ark-kalibruj" data-id="${a.id}">Kalibruj</button>` : `<button class="btn sm" data-act="ark-warstwy" data-id="${a.id}">Warstwy</button>`}<button class="x" data-act="ark-usun" data-id="${a.id}" title="Usuń podkład">×</button></div></div>`; }).join('')}</div>`
      : '<div class="pusto"><b>Brak podkładów</b>Przygotuj w ZWCAD czysty rzut (osie, słupy, ściany, bramy — bez kreskowań i odnośników) i zapisz jako DXF.</div>'}
    <details><summary>Jak przygotować DXF w ZWCAD 2022</summary><ol class="steps"><li>Zrób kopię rysunku. Usuń kreskowania (HATCH), obrazy i odnośniki zewnętrzne; zamroź zbędne warstwy (meble, opisy pomieszczeń, jeśli niepotrzebne).</li><li>Polecenie <code>ZAPISZJAKO</code> → typ <b>DXF</b> (np. AutoCAD 2018 DXF). Format binarny nie jest obsługiwany.</li><li>Prześlij plik na iPada (OneDrive / iCloud Drive / AirDrop z Maca) i dodaj go tutaj.</li></ol></details></section>`;
}
async function dodajPodklad(pliki) {
  for (const f of pliki) {
    const nazwa = f.name || 'podklad', rozsz = nazwa.toLowerCase().split('.').pop();
    try {
      if (rozsz === 'dxf') {
        toast(`Wczytuję ${nazwa}…`); await czekaj(30);
        const buf = await f.arrayBuffer(); const test = Dxf.wczytaj(buf); // sprawdzenie, zanim zapiszemy
        const id = await Baza.zapiszPlik(S.id, f, nazwa);
        const a = { id: uid('a'), nazwa: nazwa.replace(/\.dxf$/i, ''), typ: 'dxf', zrodlo: { plikId: id, nazwa, strona: 1 }, kal: null, warstwyWid: null, widok: null };
        S.arkusze.push(a); R.delete(a.id);
        toast(`Dodano DXF: ${test.grupy.reduce((s, g) => s + g.linie.length, 0)} linii, ${test.teksty.length} tekstów, jednostka: ${test.jednostki}, kodowanie: ${test.kodowanie}.`);
      } else if (rozsz === 'pdf') {
        toast(`Wczytuję ${nazwa}…`);
        const buf = await f.arrayBuffer(); const tmpId = uid('t'); const doc = await PdfPodklad.otworz(tmpId, buf);
        let strony = [1];
        if (doc.numPages > 1) strony = await wyborStron(doc, nazwa); PdfPodklad.zamknij(tmpId);
        if (!strony || !strony.length) continue;
        const id = await Baza.zapiszPlik(S.id, f, nazwa);
        for (const s of strony) S.arkusze.push({ id: uid('a'), nazwa: nazwa.replace(/\.pdf$/i, '') + (doc.numPages > 1 ? ` — str. ${s}` : ''), typ: 'pdf', zrodlo: { plikId: id, nazwa, strona: s }, kal: null, widok: null });
        toast(`Dodano PDF (${strony.length} ${strony.length === 1 ? 'strona' : 'strony'}). Skalibruj podkład, aby mierzyć i eksportować w układzie rysunku.`);
      } else toast(`Plik „${nazwa}” — obsługiwane są tylko DXF i PDF.`, true);
    } catch (e) { console.error(e); toast(`Nie udało się dodać „${nazwa}”: ${e.message || e}`, true); }
  }
  zapisz(true); if (!arkId && S.arkusze.length) arkId = S.arkusze[0].id; render();
}
async function wyborStron(doc, nazwa) {
  const n = doc.numPages; const info = [];
  for (let i = 1; i <= Math.min(n, 60); i++) { const p = await doc.getPage(i); const w = PdfPodklad.wymiary(p); info.push(`${Math.round(w.w * 25.4 / 72)}×${Math.round(w.h * 25.4 / 72)} mm`); }
  let wynik = null;
  await okno(`<h2>${esc(nazwa)} — ${n} stron</h2><p class="hint">Zaznacz strony, które mają być podkładami (np. rzuty). Każda strona będzie osobnym planem.</p>
    <div class="strony">${info.map((t, i) => `<label class="chk"><input type="checkbox" value="${i + 1}"${i === 0 ? ' checked' : ''}> Strona ${i + 1} <span class="muted sm">${t}</span></label>`).join('')}</div>
    <div class="btns right"><button class="btn" data-w="anuluj">Anuluj</button><button class="btn primary" data-w="ok">Dodaj zaznaczone</button></div>`, 'waski', (d) => {
    d.addEventListener('click', (e) => { if (e.target.closest('[data-w=ok]')) wynik = $$('.strony input:checked', d).map(x => +x.value); }, true);
  });
  return wynik;
}
async function usunArkusz(id) {
  const a = S.arkusze.find(x => x.id === id); if (!a) return;
  const zn = S.znaczniki.filter(z => z.arkuszId === id);
  if (!(await potwierdz(`Usunąć podkład „${esc(a.nazwa)}”${zn.length ? ` razem z ${zn.length} znacznikami i ich zdjęciami` : ''}? Tego nie da się cofnąć.`, 'Usuń', 'Anuluj', true))) return;
  for (const z of zn) for (const zid of z.zdjecia || []) await Baza.usunZdjecie(zid);
  S.znaczniki = S.znaczniki.filter(z => z.arkuszId !== id); S.arkusze = S.arkusze.filter(x => x.id !== id); historia = [];
  if (!S.arkusze.some(x => x.zrodlo.plikId === a.zrodlo.plikId)) await Baza.usunPlik(a.zrodlo.plikId);
  R.delete(id); if (arkId === id) arkId = (S.arkusze[0] || {}).id || null; zapisz(true); render();
}
async function oknoWarstw(id) {
  const a = S.arkusze.find(x => x.id === id); const r = await przygotujArkusz(a, true); const wid = a.warstwyWid || (a.warstwyWid = {});
  await okno(`<h2>Warstwy — ${esc(a.nazwa)}</h2><p class="hint">Wyłączone warstwy nie są wyświetlane na planie ani w PDF. Plik DXF się nie zmienia.</p>
    <div class="btns"><button class="btn sm" data-wsz="1">Wszystkie</button><button class="btn sm" data-wsz="0">Żadna</button></div>
    <div class="warstwy">${r.dxf.warstwy.map(w => `<label class="chk"><input type="checkbox" data-war="${esc(w.nazwa)}"${wid[w.nazwa] !== false ? ' checked' : ''}><span class="kw" style="background:${w.kolor}"></span>${esc(w.nazwa)}</label>`).join('')}</div>
    <div class="btns right"><button class="btn primary" data-w="ok">Gotowe</button></div>`, 'waski', (d) => {
    d.addEventListener('change', (e) => { const c = e.target.closest('[data-war]'); if (c) wid[c.dataset.war] = c.checked ? true : false; });
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-wsz]'); if (b) $$('[data-war]', d).forEach(c => { c.checked = b.dataset.wsz === '1'; wid[c.dataset.war] = c.checked; }); });
  });
  r.warstwyWid = wid; zapisz(true); if (tab === 'plan') { Plan.odswiezTlo(); }
}

/* ---------- 3. PLAN ---------- */
function vPlan() {
  if (!S.arkusze.length) return `<section class="card empty"><h2>Brak podkładu</h2><p>Najpierw dodaj rzut w zakładce „2. Podkłady” (DXF lub PDF).</p><div class="btns"><button class="btn primary" data-tab="podklady">Przejdź do podkładów</button></div></section>`;
  const a = S.arkusze.find(x => x.id === arkId) || S.arkusze[0]; arkId = a.id;
  return `<div class="planwrap">
    <nav class="narz" id="narz">${NARZ.map(([id, n, opis, sv]) => `<button class="nb${id === 'przegladaj' ? ' on' : ''}" data-narz="${id}" title="${esc(opis)}">${ikona(sv)}<span>${n}</span></button>`).join('')}</nav>
    <div class="planmid">
      <div class="planbar">
        <select id="arkSel" aria-label="Podkład">${S.arkusze.map(x => `<option value="${x.id}"${x.id === a.id ? ' selected' : ''}>${esc(x.nazwa)}</option>`).join('')}</select>
        <button class="btn sm" data-act="plan-dopasuj" title="Pokaż cały rysunek">Cały rysunek</button>
        <span class="sep"></span>
        <label class="tg" id="tgSnap" title="Przyciąganie do narożników, końców i skrzyżowań linii (tylko DXF)"><input type="checkbox" id="opSnap" checked><span>Przyciąganie</span></label>
        <label class="tg" title="Linie poziome i pionowe w układzie rysunku"><input type="checkbox" id="opOrto"><span>Orto</span></label>
        <label class="tg" title="Palec tylko przesuwa i powiększa plan; punkty stawia rysik"><input type="checkbox" id="opPalec"><span>Rysik rysuje</span></label>
        <label class="tg" id="tgKolory" title="Kolory warstw DXF"><input type="checkbox" id="opKolory"><span>Kolory</span></label>
        <span class="sep"></span>
        <button class="btn sm" data-act="cofnij" title="Cofnij ostatnią zmianę (Ctrl+Z)">Cofnij</button>
        <button class="btn sm" data-act="ark-kalibruj-plan" id="btnKal">Kalibruj</button>
        <button class="btn sm" data-act="ark-warstwy-plan" id="btnWar">Warstwy</button>
        <span class="status" id="status"></span>
      </div>
      <div class="planhost" id="planHost"></div>
      <div class="wpis" id="wpis"></div>
    </div>
    <aside class="panel" id="panel"></aside>
  </div>`;
}
let narzBiez = 'przegladaj', podtrybBiez = 'linia', kalibracjaArk = null;
async function montujPlan() {
  const host = $('#planHost'); if (!host) return;
  Plan.montuj(host, {
    naFoto: utworzFoto, naKoniec: utworzZmiane, naWybor: (id) => { wybrany = id; odswiezPanel(); },
    naKalibracje: dokonczKalibracje, naPomiar: (p) => { const r = rArk(); if (!r || !r.T) return toast('Pomiar w jednostkach wymaga kalibracji podkładu.', true); status(`Pomiar: ${naUz(Geom.odl(swiatMm(r, p[0]), swiatMm(r, p[1])))} ${jedn()}`); },
    naPunkty: () => odswiezWpis(), naWidok: (v) => { const a = S && S.arkusze.find(x => x.id === arkId); if (a) { a.widok = v; zapisz(); } },
    naCelownik: (c) => { const r = rArk(); if (r && r.T) { const w = swiatMm(r, [c.x, c.y]); status(`X ${naUz(w[0])} · Y ${naUz(w[1])} ${jedn()}${c.snap ? ' · przyciągnięto' : ''}`); } },
    opisOdcinka: (p, q) => { const r = rArk(); if (!r || !r.T) return ''; return `${naUz(Geom.odl(swiatMm(r, p), swiatMm(r, q)))} ${jedn()}`; },
    formatWym: (z) => Eksport.opisWymiaru(z, S, R, true),
    zUzytkownika: (v) => { const r = rArk(); return zUzNaMm(v) / (r ? r.k : 1); },
    naRysik: () => { $('#opPalec').checked = true; toast('Wykryto rysik: od teraz rysik stawia punkty, a palec przesuwa plan. Zmienisz to przełącznikiem „Rysik rysuje”.'); }
  });
  planZamontowany = true;
  $('#arkSel').onchange = (e) => { arkId = e.target.value; S.ostatniArkusz = arkId; zapisz(); pokazArkusz(); };
  $('#opSnap').onchange = (e) => Plan.opcja('snap', e.target.checked);
  $('#opOrto').onchange = (e) => Plan.opcja('orto', e.target.checked);
  $('#opPalec').onchange = (e) => { Plan.opcja('palec', e.target.checked); Plan.opcja('tylkoRysik', e.target.checked); };
  $('#opKolory').onchange = (e) => Plan.opcja('kolory', e.target.checked);
  $$('#narz .nb').forEach(b => b.onclick = () => wybierzNarzedzie(b.dataset.narz));
  await pokazArkusz();
}
async function pokazArkusz() {
  const a = S.arkusze.find(x => x.id === arkId); if (!a) return;
  status('Wczytuję podkład…');
  try {
    const r = await przygotujArkusz(a);
    if (tab !== 'plan' || arkId !== a.id) return;
    Plan.ustawArkusz(r, S.znaczniki.filter(z => z.arkuszId === a.id), a.widok);
    $('#btnKal').style.display = a.typ === 'pdf' ? '' : 'none'; $('#btnWar').style.display = a.typ === 'dxf' ? '' : 'none'; $('#tgKolory').style.display = a.typ === 'dxf' ? '' : 'none'; $('#tgSnap').style.display = a.typ === 'dxf' ? '' : 'none';
    status(a.typ === 'pdf' && !a.kal ? 'PDF bez kalibracji — punkty i zdjęcia działają; wymiary i eksport DXF po kalibracji.' : '');
    if (a.typ === 'pdf' && !a.kal) toast('Ten PDF nie jest skalibrowany. Kalibracja: przycisk „Kalibruj” i dwa punkty o znanych współrzędnych.', false, { tekst: 'Kalibruj teraz', fn: () => rozpocznijKalibracje(a.id) });
  } catch (e) { console.error(e); status(''); toast('Nie udało się wyświetlić podkładu: ' + (e.message || e), true); }
  wybierzNarzedzie(narzBiez); odswiezPanel();
}
function odswiezPlan() { if (tab !== 'plan' || !planZamontowany) return; Plan.znaczniki(S.znaczniki.filter(z => z.arkuszId === arkId)); Plan.zaznacz(wybrany); odswiezPanel(); const b = $('.tab[data-tab=lista]'); if (b) b.innerHTML = '4. Zestawienie' + (S.znaczniki.length ? ` <span class="badge">${S.znaczniki.length}</span>` : ''); }
function status(t) { const s = $('#status'); if (s) s.textContent = t || ''; }
function wybierzNarzedzie(n) {
  narzBiez = n; kalibracjaArk = null; $$('#narz .nb').forEach(b => b.classList.toggle('on', b.dataset.narz === n));
  Plan.narzedzie(n, podtrybBiez); odswiezWpis();
  const opisy = { przegladaj: 'Przesuwaj jednym palcem, powiększaj dwoma. Stuknij znacznik, aby go wybrać.', foto: 'Stuknij miejsce zdjęcia. Przeciągnij od miejsca w stronę, w którą patrzy aparat — zapisze się kierunek.', wymiar: 'Wskaż dwa punkty elementu (palcem: celownik nad palcem, punkt po oderwaniu). Potem wpisz wynik z dalmierza.', nowy: 'Wskaż punkty nowego elementu albo wpisz współrzędne w polu na dole.', brak: 'Obrysuj element, którego nie ma na obiekcie.', uwaga: 'Wskaż miejsce uwagi, opis dodasz w panelu.', szkic: 'Rysuj palcem lub rysikiem. Szkic nie jest pomiarem.', pomiar: 'Wskaż dwa punkty — długość pokaże się na pasku (nic się nie zapisuje).' };
  status(opisy[n] || '');
}
function odswiezWpis() {
  const w = $('#wpis'); if (!w) return; const st = Plan.stan(), r = rArk(), a = S.arkusze.find(x => x.id === arkId);
  const punktowe = ['wymiar', 'nowy', 'brak', 'uwaga', 'pomiar'].includes(st.narz) || kalibracjaArk;
  let h = '';
  if (st.narz === 'nowy' || st.narz === 'brak') h += `<div class="seg">${[['linia', 'Linia'], ['prost', 'Prostokąt'], ['polilinia', 'Polilinia']].map(([k, t]) => `<label class="${st.podtryb === k ? 'on' : ''}"><input type="radio" name="pt" value="${k}" data-podtryb="${k}">${t}</label>`).join('')}</div>`;
  if (punktowe && !kalibracjaArk) h += r && r.T ? `<input id="wpisPole" class="wpisPole" placeholder="punkt z klawiatury: x;y  ·  @dx;dy  ·  @długość<kąt  [${jedn()}]" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn sm" data-act="wpis-ok">Dodaj punkt</button>` : (a && a.typ === 'pdf' ? '<span class="hint">Wpisywanie współrzędnych — po kalibracji podkładu.</span>' : '');
  if (st.punkty) h += `<button class="btn sm" data-act="punkt-cofnij">Cofnij punkt</button>`;
  if ((st.narz === 'nowy' || st.narz === 'brak') && st.podtryb === 'polilinia' && st.punkty >= 2) h += `<button class="btn sm primary" data-act="pl-zakoncz">Zakończ</button>${st.punkty >= 3 ? '<button class="btn sm" data-act="pl-zamknij">Zamknij obrys</button>' : ''}`;
  if (kalibracjaArk) h += `<span class="hint"><b>Kalibracja:</b> wskaż punkt ${st.punkty + 1} z 2 (np. skrzyżowanie osi). Dokładność kalibracji = dokładność wszystkich wymiarów.</span><button class="btn sm" data-act="kal-anuluj">Anuluj</button>`;
  w.innerHTML = h; w.style.display = h ? '' : 'none';
  const pole = $('#wpisPole'); if (pole) pole.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); wpiszPunkt(); } };
  $$('[data-podtryb]', w).forEach(x => x.onchange = () => { podtrybBiez = x.value; Plan.podtryb(podtrybBiez); odswiezWpis(); });
}
function wpiszPunkt() { const p = $('#wpisPole'); if (!p) return; try { Plan.wpisz(p.value); p.value = ''; } catch (e) { toast(e.message, true); } }

/* --- tworzenie znaczników --- */
const pad = (n, d) => String(n).padStart(d, '0');
function utworzFoto(pos, kier) {
  migawka();
  const z = { id: uid('m'), nr: 'F-' + pad(S.seqF++, 3), rodzaj: 'F', arkuszId: arkId, geom: { typ: 'punkt', pkt: [pos] }, kier: kier ?? null, element: '', kategoria: '', opis: '', zdjecia: [], utw: Date.now(), zm: Date.now() };
  S.znaczniki.push(z); wybrany = z.id; zapisz(true); odswiezPlan();
  if (S.ustaw.aparatOdRazu) zrobZdjecie(z.id, true);
}
function utworzZmiane({ typZ, geom }) {
  migawka();
  const z = { id: uid('m'), nr: 'Z-' + pad(S.seqZ++, 2), rodzaj: 'Z', typZ, arkuszId: arkId, geom, kier: null, element: '', kategoria: '', opis: '', zrodlo: typZ === 'wymiar' ? 'P' : 'O', wymPom: null, zdjecia: [], utw: Date.now(), zm: Date.now() };
  S.znaczniki.push(z); wybrany = z.id; zapisz(true); odswiezPlan();
  if (typZ === 'wymiar') { const p = $('#zPom'); if (p) p.focus(); }
}

/* --- kalibracja PDF --- */
function rozpocznijKalibracje(id) {
  if (tab !== 'plan') { arkId = id; tab = 'plan'; render(); setTimeout(() => rozpocznijKalibracje(id), 400); return; }
  if (arkId !== id) { arkId = id; $('#arkSel').value = id; pokazArkusz().then(() => rozpocznijKalibracje(id)); return; }
  kalibracjaArk = id; $$('#narz .nb').forEach(b => b.classList.remove('on')); Plan.narzedzie('kalibracja'); odswiezWpis();
  status('Kalibracja: wskaż pierwszy punkt o znanych współrzędnych (najlepiej skrzyżowanie osi, daleko od drugiego punktu).');
}
async function dokonczKalibracje(pk) {
  const a = S.arkusze.find(x => x.id === kalibracjaArk); if (!a) return;
  const k0 = a.kal || {}, j = jedn();
  const w = await okno(`<form id="kalForm"><h2>Kalibracja — ${esc(a.nazwa)}</h2>
    <div class="seg" id="kalTryb"><label class="on"><input type="radio" name="tryb" value="wsp" checked>Współrzędne obu punktów</label><label><input type="radio" name="tryb" value="odl">Znana odległość</label></div>
    <div id="kalWsp"><p class="hint">Wpisz współrzędne wskazanych punktów w układzie rysunku z ZWCAD (np. przecięcia osi A/1 i D/13). Jednostka: ${j}.</p>
      <div class="row"><label class="f"><span>Punkt 1 — X [${j}]</span><input name="x1" inputmode="decimal" value="${k0.wsp ? naUz(k0.wsp[0][0]) : '0'}"></label><label class="f"><span>Punkt 1 — Y [${j}]</span><input name="y1" inputmode="decimal" value="${k0.wsp ? naUz(k0.wsp[0][1]) : '0'}"></label></div>
      <div class="row"><label class="f"><span>Punkt 2 — X [${j}]</span><input name="x2" inputmode="decimal" value="${k0.wsp ? naUz(k0.wsp[1][0]) : ''}"></label><label class="f"><span>Punkt 2 — Y [${j}]</span><input name="y2" inputmode="decimal" value="${k0.wsp ? naUz(k0.wsp[1][1]) : ''}"></label></div></div>
    <div id="kalOdl" style="display:none"><p class="hint">Punkt 1 stanie się początkiem układu (0;0), oś X — poziomo na arkuszu.</p><label class="f"><span>Odległość między punktami [${j}]</span><input name="odl" inputmode="decimal"></label></div>
    <p class="err sm" id="kalBlad"></p>
    <div class="btns right"><button type="button" class="btn" data-w="anuluj">Anuluj</button><button type="submit" class="btn primary">Zapisz kalibrację</button></div></form>`, 'waski', (d, koniec) => {
    const f = $('#kalForm', d);
    $$('#kalTryb input', d).forEach(x => x.onchange = () => { $$('#kalTryb label', d).forEach(l => l.classList.toggle('on', l.contains(x) && x.checked)); $('#kalWsp', d).style.display = x.value === 'wsp' ? '' : 'none'; $('#kalOdl', d).style.display = x.value === 'odl' ? '' : 'none'; });
    f.onsubmit = (e) => {
      e.preventDefault(); const o = Object.fromEntries(new FormData(f).entries());
      try {
        let T, kal;
        if (o.tryb === 'odl') { const D = parsujLiczbe(o.odl); if (!(D > 0)) throw new Error('Podaj odległość większą od zera.'); T = Geom.zOdleglosci(pk[0], pk[1], zUzNaMm(D)); kal = { tryb: 'odl', odl: zUzNaMm(D) }; }
        else { const v = ['x1', 'y1', 'x2', 'y2'].map(k => parsujLiczbe(o[k])); if (!v.every(Number.isFinite)) throw new Error('Uzupełnij wszystkie współrzędne liczbami.'); const W = v.map(zUzNaMm); T = Geom.zDwochPunktow(pk[0], pk[1], [W[0], W[1]], [W[2], W[3]]); kal = { tryb: 'wsp', wsp: [[W[0], W[1]], [W[2], W[3]]] }; }
        a.kal = { ...kal, T, punkty: pk, data: Date.now() };
        koniec('ok');
      } catch (er) { $('#kalBlad', d).textContent = er.message; }
    };
  });
  kalibracjaArk = null;
  if (w === 'ok') {
    const r = R.get(a.id); if (r) ustawKalibracje(r, a); zapisz(true);
    const skalaPapier = Geom.skala(a.kal.T) / (25.4 / 72); // mm świata na mm papieru
    toast(`Zapisano kalibrację. Skala podkładu ≈ 1:${Math.round(skalaPapier)}. Sprawdź narzędziem „Pomiar” znany wymiar (np. rozstaw osi).`);
  }
  wybierzNarzedzie('przegladaj');
}

/* --- panel właściwości znacznika --- */
function odswiezPanel() {
  const p = $('#panel'); if (!p) return;
  const z = S.znaczniki.find(x => x.id === wybrany);
  if (!z) {
    const naArk = S.znaczniki.filter(x => x.arkuszId === arkId);
    p.innerHTML = `<h2>Znaczniki na tym planie</h2><p class="sm">${naArk.filter(x => x.rodzaj === 'F').length} punktów foto · ${naArk.filter(x => x.rodzaj === 'Z').length} zmian/uwag</p>
      <p class="hint">Stuknij znacznik na planie (narzędzie „Przeglądaj”), aby zobaczyć i edytować jego dane i zdjęcia.</p>
      <div class="ostatnie">${naArk.slice(-8).reverse().map(x => `<button class="rf" data-act="znacznik-pokaz" data-id="${x.id}"><div><b style="color:${kolorZ(x)}">${x.nr}</b> <span>${esc(x.element || opisRodzaju(x))}</span></div><span>${(x.zdjecia || []).length} zdj.</span></button>`).join('')}</div>
      <h3>Skróty (klawiatura)</h3><p class="hint">Esc — przerwij · Enter — zakończ polilinię · Ctrl+Z — cofnij · F3 — przyciąganie · F8 — orto</p>`;
    p.classList.remove('on'); return;
  }
  p.classList.add('on');
  const r = rArk(z.arkuszId), kal = r && r.T;
  const wsp = kal ? z.geom.pkt.map(q => swiatMm(r, q)) : null;
  const rys = z.typZ === 'wymiar' ? Eksport.wymRysMm(z, R) : NaN;
  p.innerHTML = `<div class="ph"><b style="color:${kolorZ(z)}">${z.nr}</b><span>${esc(opisRodzaju(z))}</span><button class="x" data-act="panel-zamknij" title="Zamknij panel">×</button></div>
    ${z.rodzaj === 'Z' ? `<label class="f"><span>Rodzaj zmiany</span><select data-zm="typZ">${Object.entries(Eksport.TYPY).map(([k, t]) => `<option value="${k}"${z.typZ === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
    <label class="f"><span>Element (oznaczenie)</span><input data-zm="element" value="${esc(z.element)}" placeholder="np. SŁ-C/4, brama B-07, dok D-03"></label>
    <label class="f"><span>Kategoria</span><select data-zm="kategoria"><option value="">—</option>${KATEGORIE.map(k => `<option${z.kategoria === k ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
    ${z.typZ === 'wymiar' ? `<div class="wym"><div><span>Z rysunku</span><b>${Number.isFinite(rys) ? naUz(rys) + ' ' + jedn() : (kal ? '—' : 'brak kalibracji')}</b></div>
      <label><span>Pomiar (dalmierz) [${jedn()}]</span><input id="zPom" data-zm="wymPom" inputmode="decimal" value="${Number.isFinite(z.wymPom) ? naUz(z.wymPom) : ''}" placeholder="${jedn() === 'm' ? 'np. 5,985' : 'np. 5985'}"></label>
      <div><span>Różnica</span><b class="${Number.isFinite(rys) && Number.isFinite(z.wymPom) && Math.abs(z.wymPom - rys) > 20 ? 'err' : ''}">${Number.isFinite(rys) && Number.isFinite(z.wymPom) ? (z.wymPom - rys >= 0 ? '+' : '−') + liczba(Math.abs(z.wymPom - rys), 0) + ' mm' : '—'}</b></div></div>` : ''}
    ${z.rodzaj === 'Z' ? `<label class="f"><span>Źródło informacji</span><select data-zm="zrodlo"><option value="P"${z.zrodlo === 'P' ? ' selected' : ''}>P — pomiar</option><option value="O"${z.zrodlo === 'O' ? ' selected' : ''}>O — oględziny</option><option value="D"${z.zrodlo === 'D' ? ' selected' : ''}>D — dokumentacja archiwalna</option><option value="N"${z.zrodlo === 'N' ? ' selected' : ''}>N — nieustalone</option></select></label>` : ''}
    <label class="f"><span>Opis <span class="muted">(mikrofon na klawiaturze iPada = dyktowanie)</span></span><textarea data-zm="opis" rows="3">${esc(z.opis)}</textarea></label>
    <h3>Zdjęcia (${(z.zdjecia || []).length})</h3>
    <div class="miniatury" id="miniatury">${(z.zdjecia || []).map((id, i) => `<button class="mini" data-act="zdj-pokaz" data-id="${id}" data-z="${z.id}" title="${z.nr}/${i + 1}"><img alt="${z.nr}/${i + 1}" data-mini="${id}"><span>${i + 1}</span></button>`).join('')}</div>
    <div class="btns"><button class="btn primary" data-act="zdj-aparat" data-id="${z.id}">Zrób zdjęcie</button><button class="btn" data-act="zdj-galeria" data-id="${z.id}">Z galerii…</button></div>
    ${z.rodzaj === 'F' ? `<h3>Kierunek zdjęcia</h3><div class="btns"><button class="btn sm" data-act="kier-ustaw" data-id="${z.id}">Wskaż na planie</button>${z.kier !== null ? `<button class="btn sm" data-act="kier-usun" data-id="${z.id}">Usuń kierunek</button>` : ''}</div>` : ''}
    ${kal ? `<details${z.typZ === 'nowy' ? ' open' : ''}><summary>Współrzędne punktów [${jedn()}]</summary><div class="wspl">${wsp.map((w, i) => `<div class="fr"><span class="muted sm">${i + 1}</span><input data-wsp="${i}" data-os="0" inputmode="decimal" value="${naUz(w[0])}" aria-label="X ${i + 1}"><input data-wsp="${i}" data-os="1" inputmode="decimal" value="${naUz(w[1])}" aria-label="Y ${i + 1}"></div>`).join('')}</div><p class="hint">Zmiana liczby przesuwa punkt dokładnie w to miejsce.</p></details>` : ''}
    <p class="hint">Utworzono ${dataCzas(z.utw)}</p>
    <div class="btns"><button class="btn sm" data-act="znacznik-pokaz" data-id="${z.id}">Pokaż na planie</button><button class="btn sm danger" data-act="znacznik-usun" data-id="${z.id}">Usuń ${z.nr}</button></div>`;
  wczytajMiniatury();
}
const kolorZ = (z) => z.rodzaj === 'F' ? '#0A8FB0' : ({ wymiar: '#c2410c', nowy: '#15803d', brak: '#b91c1c', uwaga: '#7c3aed', szkic: '#57534e' }[z.typZ] || '#444');
const opisRodzaju = (z) => z.rodzaj === 'F' ? 'punkt fotograficzny' : (Eksport.TYPY[z.typZ] || 'zmiana').toLowerCase();
async function wczytajMiniatury() {
  for (const img of $$('img[data-mini]')) {
    const id = img.dataset.mini; let u = miniUrl.get(id);
    if (!u) { const r = await Baza.zdjecie(id); if (!r) { img.alt = 'brak'; continue; } u = URL.createObjectURL(new Blob([r.mini || r.dane], { type: 'image/jpeg' })); miniUrl.set(id, u); }
    img.src = u;
  }
}
function zmienPole(z, k, val) {
  if (k === 'wymPom') { const v = parsujLiczbe(val); z.wymPom = Number.isFinite(v) ? zUzNaMm(v) : null; }
  else z[k] = val;
  z.zm = Date.now(); zapisz();
  if (k === 'wymPom' || k === 'typZ') { Plan.planuj(); if (k === 'typZ') odswiezPanel(); else { const r = Eksport.wymRysMm(z, R); const b = $('.wym div:last-child b'); if (b) b.textContent = Number.isFinite(r) && Number.isFinite(z.wymPom) ? (z.wymPom - r >= 0 ? '+' : '−') + liczba(Math.abs(z.wymPom - r), 0) + ' mm' : '—'; } }
  Plan.znaczniki(S.znaczniki.filter(x => x.arkuszId === arkId));
}
function zmienWspolrzedna(z, i, os, val) {
  const r = rArk(z.arkuszId); const v = parsujLiczbe(val); if (!r || !r.T || !Number.isFinite(v)) return toast('Wpisz liczbę.', true);
  migawka();
  const w = Geom.zastosuj(r.T, ...z.geom.pkt[i]); w[os] = zUzNaMm(v) / r.k; z.geom.pkt[i] = Geom.zastosuj(r.Ti, w[0], w[1]); z.zm = Date.now(); zapisz(true); odswiezPlan();
}

/* --- zdjęcia --- */
async function zrobZdjecie(zid, aparat) {
  const pliki = await wybierzPliki({ accept: 'image/*', multiple: !aparat, capture: aparat ? 'environment' : null });
  if (!pliki.length) return;
  const z = S.znaczniki.find(x => x.id === zid); if (!z) return;
  let n = 0;
  for (const f of pliki) {
    try {
      toast(`Zapisuję zdjęcie ${++n}/${pliki.length}…`);
      const img = await obrazZPliku(f);
      const duze = await jpegZObrazu(img, +S.ustaw.zdjPx || 2400, 0.86), mini = await jpegZObrazu(img, 320, 0.72);
      const id = await Baza.zapiszZdjecie({ projektId: S.id, blob: duze.blob, mini: mini.blob, w: duze.w, h: duze.h, czas: f.lastModified && Math.abs(Date.now() - f.lastModified) < 864e5 * 365 ? f.lastModified : Date.now(), nazwa: f.name || '' });
      z.zdjecia = [...(z.zdjecia || []), id]; z.zm = Date.now();
    } catch (e) { console.error(e); toast('Nie udało się zapisać zdjęcia: ' + (e.message || e), true); }
  }
  zapisz(true); odswiezPlan();
  toast(`${z.nr}: zapisano ${n} ${n === 1 ? 'zdjęcie' : 'zdjęcia'}.`);
}
async function pokazZdjecie(id, zid) {
  const r = await Baza.zdjecie(id); if (!r) return toast('Nie ma tego zdjęcia w pamięci urządzenia.', true);
  const z = S.znaczniki.find(x => x.id === zid), i = z ? z.zdjecia.indexOf(id) : -1;
  const u = URL.createObjectURL(new Blob([r.dane], { type: 'image/jpeg' }));
  const w = await okno(`<div class="podglad-zdj"><img src="${u}" alt="zdjęcie"></div><div class="bar"><span class="sm"><b>${z ? z.nr + '/' + (i + 1) : ''}</b> · ${r.w}×${r.h} px · ${dataCzas(r.czas)}</span>
    <span class="btns">${i > 0 ? '<button class="btn sm" data-w="lewo">← Przesuń wcześniej</button>' : ''}<button class="btn sm danger" data-w="usun">Usuń zdjęcie</button><button class="btn sm primary" data-w="ok">Zamknij</button></span></div>`, 'szeroki');
  URL.revokeObjectURL(u);
  if (!z) return;
  if (w === 'usun' && await potwierdz(`Usunąć zdjęcie ${z.nr}/${i + 1}? Tego nie da się cofnąć.`, 'Usuń', 'Anuluj', true)) { z.zdjecia = z.zdjecia.filter(x => x !== id); await Baza.usunZdjecie(id); historia = []; zapisz(true); odswiezPlan(); }
  if (w === 'lewo' && i > 0) { [z.zdjecia[i - 1], z.zdjecia[i]] = [z.zdjecia[i], z.zdjecia[i - 1]]; zapisz(true); odswiezPanel(); }
}
async function usunZnacznik(id) {
  const z = S.znaczniki.find(x => x.id === id); if (!z) return;
  const n = (z.zdjecia || []).length;
  if (!(await potwierdz(`Usunąć ${z.nr}${n ? ` razem z ${n} ${n === 1 ? 'zdjęciem' : 'zdjęciami'}` : ''}?${n ? ' Zdjęć nie da się przywrócić.' : ''}`, 'Usuń', 'Anuluj', true))) return;
  if (n) { for (const zid of z.zdjecia) await Baza.usunZdjecie(zid); historia = []; } else migawka();
  S.znaczniki = S.znaczniki.filter(x => x.id !== id); wybrany = null; zapisz(true); odswiezPlan();
}

/* ---------- 4. ZESTAWIENIE ---------- */
let filtrListy = { q: '', rodzaj: '' };
function vLista() {
  const q = filtrListy.q.toLowerCase();
  const lista = S.znaczniki.filter(z => (!filtrListy.rodzaj || (filtrListy.rodzaj === 'F' ? z.rodzaj === 'F' : z.typZ === filtrListy.rodzaj)) && (!q || [z.nr, z.element, z.opis, z.kategoria].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => a.nr.localeCompare(b.nr, 'pl', { numeric: true }));
  const ark = (id) => (S.arkusze.find(a => a.id === id) || {}).nazwa || '';
  return `<section class="card"><h2>Zestawienie znaczników <small>${S.znaczniki.length} pozycji</small></h2>
    <div class="filters"><input id="fQ" placeholder="Szukaj: numer, element, opis…" value="${esc(filtrListy.q)}"><select id="fR"><option value="">wszystkie rodzaje</option><option value="F"${filtrListy.rodzaj === 'F' ? ' selected' : ''}>punkty foto (F)</option>${Object.entries(Eksport.TYPY).map(([k, t]) => `<option value="${k}"${filtrListy.rodzaj === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="tw"><table class="main"><thead><tr><th>Nr</th><th>Rodzaj</th><th>Plan</th><th>Element</th><th>Kategoria</th><th>Opis</th><th>Wymiar</th><th>Zdj.</th></tr></thead><tbody>
    ${lista.map(z => `<tr data-act="lista-pokaz" data-id="${z.id}"><td style="color:${kolorZ(z)};font-weight:600">${z.nr}</td><td>${esc(opisRodzaju(z))}</td><td>${esc(ark(z.arkuszId))}</td><td>${esc(z.element)}</td><td class="kat">${esc(z.kategoria)}</td><td class="pre">${esc(z.opis)}</td><td class="nowrap">${z.typZ === 'wymiar' ? esc(Eksport.opisWymiaru(z, S, R)) : ''}</td><td>${(z.zdjecia || []).length}</td></tr>`).join('') || '<tr><td colspan="8" class="muted c">Brak pozycji.</td></tr>'}
    </tbody></table></div><p class="hint">Kliknij wiersz, aby pokazać znacznik na planie. Wymiary z rysunku liczą się po otwarciu planu z danym podkładem.</p></section>`;
}

/* ---------- 5. EKSPORT ---------- */
let opcjeEksp = { pdf: true, zdjecia: true, zestawienia: true, dxf: true, kopia: true };
function vEksport() {
  const nzd = S.znaczniki.reduce((s, z) => s + (z.zdjecia || []).length, 0);
  const bezKal = S.arkusze.filter(a => a.typ === 'pdf' && !a.kal && S.znaczniki.some(z => z.arkuszId === a.id));
  return `<div class="grid2"><section class="card"><h2>Paczka ZIP <small>${S.znaczniki.length} znaczników · ${nzd} zdjęć</small></h2>
    ${[['pdf', 'Fotodokumentacja PDF', 'plany z klikalnymi punktami, strona na każde zdjęcie z mini-planem i kierunkiem, spis zdjęć, zestawienie zmian'], ['zdjecia', 'Zdjęcia (JPG)', 'folder „zdjecia”, nazwy plików = numery znaczników'], ['zestawienia', 'Zestawienia CSV', 'zdjęcia i zmiany — do Excela'], ['dxf', 'DXF zmian + dane dla AI', 'warstwy INW-* w układzie rysunku, zmiany.json i prompt do naniesienia zmian przez Claude (TEK-RYSOWNIK)'], ['kopia', 'Kopia projektu', 'pozwala wczytać projekt na innym urządzeniu (np. laptop) — zalecane po każdym dniu pracy']]
      .map(([k, t, o]) => `<label class="mod${opcjeEksp[k] ? ' on' : ''}"><input type="checkbox" data-eksp="${k}"${opcjeEksp[k] ? ' checked' : ''}><b>${t}</b><span>${o}</span></label>`).join('')}
    ${bezKal.length ? `<div class="card warn sm" style="margin-top:.7rem"><b>Uwaga:</b> podkłady PDF bez kalibracji: ${bezKal.map(a => esc(a.nazwa)).join(', ')}. Ich DXF będzie w mm na papierze, a wymiary „z rysunku” będą puste.</div>` : ''}
    <div class="btns"><button class="btn primary lg" data-act="eksport-start"${S.znaczniki.length ? '' : ' disabled'}>Przygotuj paczkę</button></div>
    <div id="ekspPostep"></div><div id="ekspWynik"></div></section>
  <section class="card"><h2>Gdzie trafi plik</h2>
    <p class="sm"><b>iPad:</b> po przygotowaniu paczki stuknij „Zapisz / Udostępnij” → <b>Zachowaj w Plikach</b> (iCloud Drive, OneDrive) albo AirDrop. Na komputerze z Windows najprościej odebrać plik z OneDrive lub iCloud Drive w przeglądarce.</p>
    <p class="sm"><b>Komputer:</b> plik trafia do folderu „Pobrane”.</p>
    <p class="hint">Zanim użyjesz chmury do danych z obiektu klienta, sprawdź zasady firmy i umowę z klientem (dane osobowe na zdjęciach, poufność obiektu).</p>
    <h3>Pamięć urządzenia</h3><p class="sm" id="miejsce">sprawdzam…</p></section></div>`;
}
async function odswiezMiejsce() {
  const el = $('#miejsce'); if (!el) return; const e = await Baza.miejsce(), t = await Baza.utrwal();
  el.innerHTML = (e ? `Zajęte przez aplikację: ok. ${liczba(e.usage / 1048576, 0)} MB${e.quota ? ` z dostępnych ${liczba(e.quota / 1048576, 0)} MB` : ''}. ` : '') + (t ? '<span class="stat ok">pamięć trwała</span>' : '<span class="stat cz">pamięć zwykła — przeglądarka może usunąć dane przy braku miejsca; rób kopie</span>');
}
async function eksportuj() {
  if (!Object.values(opcjeEksp).some(Boolean)) return toast('Zaznacz przynajmniej jeden element paczki.', true);
  const pe = $('#ekspPostep'), wy = $('#ekspWynik'); wy.innerHTML = '';
  const post = (f, t) => { if (pe) pe.innerHTML = `<div class="postep"><div style="width:${Math.round(f * 100)}%"></div></div><p class="hint">${esc(t || '')}</p>`; };
  const btn = $('[data-act=eksport-start]'); btn.disabled = true;
  try {
    post(0.01, 'Wczytuję podkłady…');
    for (const a of S.arkusze) if (S.znaczniki.some(z => z.arkuszId === a.id)) await przygotujArkusz(a, true);
    const plik = await Eksport.paczka(S, R, { ...opcjeEksp, jakoscPdf: +S.ustaw.pdfPx || 1600 }, post);
    ostatniaPaczka = plik;
    const MB = liczba(plik.size / 1048576, 1);
    wy.innerHTML = `<div class="imp-pod"><h3>Gotowe: ${esc(plik.name)}</h3><p class="sm">${MB} MB</p><div class="btns">${mozeUdostepnic(plik) ? '<button class="btn primary" data-act="eksport-udostepnij">Zapisz / Udostępnij…</button>' : ''}<button class="btn${mozeUdostepnic(plik) ? '' : ' primary'}" data-act="eksport-pobierz">Pobierz</button></div></div>`;
    S.ostatniEksport = Date.now(); zapisz(true);
  } catch (e) { console.error(e); toast('Eksport nieudany: ' + (e.message || e), true); post(0, 'Błąd: ' + (e.message || e)); }
  finally { btn.disabled = false; }
}

/* ---------- O PROGRAMIE ---------- */
function vInfo() {
  return `<section class="card"><h2>${APP.nazwa} <small>wersja ${APP.wersja} · ${APP.data}</small></h2>
    <div class="about">${LOGO.produktJasne}<span class="muted">produkt marki</span>${LOGO.tektoriaJasne}</div>
    <p>Aplikacja do inwentaryzacji budowlanej obiektów istniejących: znaczniki zdjęć i zmian na rzucie DXF/PDF, fotodokumentacja PDF z odnośnikami, DXF zmian do ZWCAD.</p>
    <h3>Ograniczenia wersji 0.1</h3><ul class="tight"><li>Przyciąganie działa na podkładach DXF; na PDF punkty wskazuje się „na oko” lub wpisuje współrzędne po kalibracji.</li><li>Kreskowania i atrybuty bloków z DXF nie są wyświetlane.</li><li>Jeden projekt pracuje na jednym urządzeniu; przeniesienie przez kopię ZIP (eksport → import).</li><li>Brak opisu technicznego i kontroli pomiarów (odchyłka zamknięcia) — planowane.</li></ul>
    <h3>Komponenty i licencje</h3><ul class="tight"><li>pdf.js 6.4.299 — Mozilla, Apache 2.0 (odczyt PDF)</li><li>dxf-parser 1.1.2 — MIT (odczyt DXF)</li><li>pdf-lib 1.17.1 + @pdf-lib/fontkit 1.1.1 — MIT (tworzenie PDF)</li><li>fflate 0.8.3 — MIT (ZIP)</li><li>IBM Plex Sans / Mono — SIL OFL 1.1 (czcionki); Space Grotesk — SIL OFL 1.1 (logo)</li></ul><p class="hint">Pełne teksty licencji: folder „licencje” aplikacji.</p></section>`;
}

/* ---------- ZDARZENIA ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab]'); if (t && S) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  try {
    if (act === 'do-startu') { if (S) await zamknijProjekt(); else render(); }
    else if (act === 'nowy-projekt') oknoNowegoProjektu();
    else if (act === 'demo') await projektPrzykladowy();
    else if (act === 'import') { const [f] = await wybierzPliki({ accept: '.zip,.json,application/zip' }); if (!f) return; toast('Wczytuję kopię…'); const p = await Eksport.importuj(f); if (p) { toast('Zaimportowano projekt.'); otworzProjekt(p); } }
    else if (act === 'proj-otworz') { e.stopPropagation(); const p = await Baza.projekt(id); if (p) otworzProjekt(p); }
    else if (act === 'proj-usun') { e.stopPropagation(); const p = (await Baza.projekt(id)); if (!p) return; const nzd = p.znaczniki.reduce((s, z) => s + (z.zdjecia || []).length, 0);
      if (await potwierdz(`Usunąć projekt „${esc(p.meta.nazwa || 'bez nazwy')}” z tego urządzenia? Zostaną usunięte podkłady i ${nzd} zdjęć. Tego nie da się cofnąć — jeśli nie masz kopii ZIP, najpierw zrób eksport.`, 'Usuń projekt', 'Anuluj', true)) { await Baza.usunProjekt(id); if (S && S.id === id) { S = null; } toast('Usunięto projekt.'); render(); } }
    else if (act === 'dodaj-podklad') { const f = await wybierzPliki({ accept: '.dxf,.pdf,application/pdf,application/dxf,image/vnd.dxf', multiple: true }); if (f.length) await dodajPodklad(f); }
    else if (act === 'ark-otworz') { arkId = id; S.ostatniArkusz = id; tab = 'plan'; render(); }
    else if (act === 'ark-usun') await usunArkusz(id);
    else if (act === 'ark-kalibruj') rozpocznijKalibracje(id);
    else if (act === 'ark-kalibruj-plan') rozpocznijKalibracje(arkId);
    else if (act === 'ark-warstwy') await oknoWarstw(id);
    else if (act === 'ark-warstwy-plan') await oknoWarstw(arkId);
    else if (act === 'kal-anuluj') { kalibracjaArk = null; wybierzNarzedzie('przegladaj'); }
    else if (act === 'plan-dopasuj') Plan.dopasuj();
    else if (act === 'cofnij') cofnij();
    else if (act === 'punkt-cofnij') Plan.cofnijPunkt();
    else if (act === 'pl-zakoncz') Plan.zakonczPolilinie(false);
    else if (act === 'pl-zamknij') Plan.zakonczPolilinie(true);
    else if (act === 'wpis-ok') wpiszPunkt();
    else if (act === 'panel-zamknij') { wybrany = null; Plan.zaznacz(null); odswiezPanel(); }
    else if (act === 'znacznik-pokaz' || act === 'lista-pokaz') {
      const z = S.znaczniki.find(x => x.id === id); if (!z) return; wybrany = z.id;
      if (tab !== 'plan' || arkId !== z.arkuszId) { arkId = z.arkuszId; tab = 'plan'; render(); await czekaj(500); }
      Plan.pokaz(z.geom.pkt[0][0], z.geom.pkt[0][1]); Plan.zaznacz(z.id); odswiezPanel();
    }
    else if (act === 'znacznik-usun') await usunZnacznik(id);
    else if (act === 'zdj-aparat') await zrobZdjecie(id, true);
    else if (act === 'zdj-galeria') await zrobZdjecie(id, false);
    else if (act === 'zdj-pokaz') await pokazZdjecie(id, b.dataset.z);
    else if (act === 'kier-ustaw') { kierunekDla = id; toast('Stuknij na planie punkt, w stronę którego patrzy aparat.'); wybierzNarzedzie('przegladaj'); Plan.narzedzie('przegladaj'); }
    else if (act === 'kier-usun') { const z = S.znaczniki.find(x => x.id === id); if (z) { migawka(); z.kier = null; zapisz(true); odswiezPlan(); } }
    else if (act === 'eksport-start') await eksportuj();
    else if (act === 'eksport-udostepnij') { if (ostatniaPaczka) { try { await udostepnij(ostatniaPaczka); } catch (er) { if (er.name !== 'AbortError') { toast('Udostępnianie nie powiodło się — użyj „Pobierz”.', true); } } } }
    else if (act === 'eksport-pobierz') { if (ostatniaPaczka) pobierz(ostatniaPaczka, ostatniaPaczka.name); }
  } catch (er) { console.error(er); toast('Błąd: ' + (er.message || er), true); }
});
/* Kierunek zdjęcia: tryb „wskaż na planie” — następne stuknięcie ustawia kierunek wybranego punktu F. */
let kierunekDla = null;
document.addEventListener('pointerup', (e) => {
  if (!kierunekDla || !e.target.closest || !e.target.closest('.plan-cv')) return;
  const z = S && S.znaczniki.find(x => x.id === kierunekDla); kierunekDla = null; if (!z) return;
  const r = e.target.getBoundingClientRect(), v = Plan.widok();
  const sx = (e.clientX - r.left - v.tx) / v.s, sy = (e.clientY - r.top - v.ty) / v.s, p = z.geom.pkt[0];
  migawka(); z.kier = Math.atan2(sy - p[1], sx - p[0]); zapisz(true); setTimeout(() => { wybrany = z.id; odswiezPlan(); }, 30);
}, true);
document.addEventListener('input', (e) => {
  const el = e.target; if (!S) return;
  if (el.dataset.bind) { const [o, k] = el.dataset.bind.split('.'); S[o][k] = el.value; zapisz(); if (k === 'nazwa') { const p = $('.pnazwa'); if (p) p.textContent = el.value || 'projekt bez nazwy'; } }
  if (el.dataset.zm && el.tagName !== 'SELECT') { const z = S.znaczniki.find(x => x.id === wybrany); if (z) zmienPole(z, el.dataset.zm, el.value); }
  if (el.id === 'fQ') { filtrListy.q = el.value; const poz = el.selectionStart; $('#view').innerHTML = vLista(); const n = $('#fQ'); n.focus(); n.setSelectionRange(poz, poz); }
});
document.addEventListener('change', (e) => {
  const el = e.target; if (!S) return;
  if (el.dataset.ust) { S.ustaw[el.dataset.ust] = el.type === 'checkbox' ? el.checked : el.value; zapisz(true); }
  if (el.dataset.zm && el.tagName === 'SELECT') { const z = S.znaczniki.find(x => x.id === wybrany); if (z) zmienPole(z, el.dataset.zm, el.value); }
  if (el.dataset.wsp !== undefined) { const z = S.znaczniki.find(x => x.id === wybrany); if (z) zmienWspolrzedna(z, +el.dataset.wsp, +el.dataset.os, el.value); }
  if (el.dataset.ark) { const a = S.arkusze.find(x => x.id === el.dataset.ark); if (a) { a.nazwa = el.value.trim() || a.nazwa; zapisz(true); } }
  if (el.dataset.eksp) { opcjeEksp[el.dataset.eksp] = el.checked; el.closest('.mod').classList.toggle('on', el.checked); }
  if (el.id === 'fR') { filtrListy.rodzaj = el.value; $('#view').innerHTML = vLista(); }
});
document.addEventListener('keydown', (e) => {
  if (!S || tab !== 'plan') return;
  if (e.target.matches('input, textarea, select') && e.key !== 'Escape') return;
  if (e.key === 'Escape') { kalibracjaArk = null; wybierzNarzedzie('przegladaj'); }
  else if (e.key === 'Enter') Plan.zakonczPolilinie(false);
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); cofnij(); }
  else if (e.key === 'F3') { e.preventDefault(); const c = $('#opSnap'); c.checked = !c.checked; Plan.opcja('snap', c.checked); toast('Przyciąganie: ' + (c.checked ? 'włączone' : 'wyłączone')); }
  else if (e.key === 'F8') { e.preventDefault(); const c = $('#opOrto'); c.checked = !c.checked; Plan.opcja('orto', c.checked); toast('Orto: ' + (c.checked ? 'włączone' : 'wyłączone')); }
});
['dragover', 'dragleave', 'drop'].forEach(ev => document.addEventListener(ev, (e) => {
  const d = e.target.closest && e.target.closest('.drop'); if (!d) { if (ev !== 'dragleave') e.preventDefault(); return; }
  e.preventDefault(); d.classList.toggle('over', ev === 'dragover');
  if (ev === 'drop' && S) { const files = Array.from(e.dataTransfer.files || []); if (files.length) dodajPodklad(files); }
}));
window.addEventListener('resize', wysokoscPaska);
window.addEventListener('pagehide', () => { if (S) Baza.zapiszProjekt(S); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S) Baza.zapiszProjekt(S); });

/* ---------- START ---------- */
$('#brand').innerHTML = LOGO.produktCiemne + `<span class="ver">v${APP.wersja}</span>`;
$('#brand').dataset.act = 'do-startu'; $('#brand').title = 'Ekran główny — lista projektów';
$('#marka').innerHTML = '<small>produkt marki</small>' + LOGO.tektoriaCiemne;
Baza.naBlad = (t) => toast(t, true);
window.addEventListener('unhandledrejection', (e) => { const r = e.reason || {}; if (r.name === 'RenderingCancelledException' || r.name === 'AbortError') return; console.error(r); toast('Wystąpił błąd: ' + (r.message || r), true); });
(async () => {
  $('#view').innerHTML = '<p class="muted" style="text-align:center;padding:3rem">Wczytuję projekty…</p>';
  try { await Baza.otworz(); Baza.utrwal(); } catch (e) { toast(e.message, true); }
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      let odswiezNaZadanie = false; // przeładowanie tylko po kliknięciu „Odśwież” — nie przy pierwszej instalacji
      const pokazAktualizacje = (w) => toast('Jest nowa wersja TEK-INW.', false, { tekst: 'Odśwież', fn: () => { odswiezNaZadanie = true; if (S) Baza.zapiszProjekt(S); w.postMessage({ typ: 'aktywuj' }); } });
      if (reg.waiting && navigator.serviceWorker.controller) pokazAktualizacje(reg.waiting);
      reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) pokazAktualizacje(w); }); });
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!odswiezNaZadanie) return; odswiezNaZadanie = false; setTimeout(() => location.reload(), 250); });
      setInterval(() => reg.update().catch(() => { }), 30 * 60 * 1000);
    } catch (e) { console.warn('Service worker:', e); }
  }
})();
