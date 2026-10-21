/* TEK-INW — baza danych w przeglądarce (IndexedDB).
   Trzy „szuflady” (magazyny):
   • projekty — opis projektu: arkusze, znaczniki, ustawienia (zwykły obiekt, kilkadziesiąt kB),
   • pliki    — podkłady PDF i DXF (bajty pliku),
   • zdjecia  — zdjęcia (JPEG) i ich miniatury.
   Pliki i zdjęcia trzymamy jako ArrayBuffer (ciąg bajtów) — Safari na iPadzie obsługuje to najpewniej.
   Nazwa bazy „tek-inw” jest własna: inne aplikacje z tego samego konta GitHub mają osobne bazy. */
'use strict';

const Baza = (() => {
  const NAZWA = 'tek-inw', WERSJA = 1;
  let db = null, trwala = null;

  function otworz() {
    if (db) return Promise.resolve(db);
    return new Promise((ok, zle) => {
      const r = indexedDB.open(NAZWA, WERSJA);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('projekty')) d.createObjectStore('projekty', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('pliki')) d.createObjectStore('pliki', { keyPath: 'id' }).createIndex('projekt', 'projektId');
        if (!d.objectStoreNames.contains('zdjecia')) d.createObjectStore('zdjecia', { keyPath: 'id' }).createIndex('projekt', 'projektId');
      };
      r.onsuccess = () => { db = r.result; db.onversionchange = () => { db.close(); db = null; }; ok(db); };
      r.onerror = () => zle(r.error || new Error('Nie można otworzyć bazy danych przeglądarki.'));
      r.onblocked = () => zle(new Error('Baza jest zablokowana przez inną otwartą kartę z TEK-INW — zamknij ją.'));
    });
  }
  function tx(magazyn, tryb, fn) {
    return otworz().then(d => new Promise((ok, zle) => {
      const t = d.transaction(magazyn, tryb); const m = t.objectStore(magazyn); let wynik;
      Promise.resolve(fn(m)).then(w => { wynik = w; });
      t.oncomplete = () => ok(wynik);
      t.onerror = () => zle(t.error || new Error('Błąd zapisu w bazie przeglądarki.'));
      t.onabort = () => zle(t.error || new Error('Zapis przerwany — możliwy brak miejsca na urządzeniu.'));
    }));
  }
  const req = (r) => new Promise((ok, zle) => { r.onsuccess = () => ok(r.result); r.onerror = () => zle(r.error); });

  /* --- projekty --- */
  const projekty = () => tx('projekty', 'readonly', m => req(m.getAll()));
  const projekt = (id) => tx('projekty', 'readonly', m => req(m.get(id)));
  // Zapis projektu: kolejka — zawsze trafia najnowsza wersja, zapisy nie nakładają się na siebie.
  let czeka = null, pracuje = null;
  function zapiszProjekt(p) {
    czeka = JSON.parse(JSON.stringify(p));
    if (!pracuje) pracuje = (async () => {
      while (czeka) { const x = czeka; czeka = null; try { await tx('projekty', 'readwrite', m => m.put(x)); } catch (e) { if (Baza.naBlad) Baza.naBlad('Nie udało się zapisać projektu: ' + (e.message || e)); } }
      pracuje = null;
    })();
    return pracuje;
  }
  async function oproznij() { while (pracuje) await pracuje; }
  async function usunProjekt(id) {
    await oproznij();
    await tx('projekty', 'readwrite', m => m.delete(id));
    for (const mag of ['pliki', 'zdjecia']) await tx(mag, 'readwrite', m => new Promise(ok => {
      const c = m.index('projekt').openKeyCursor(IDBKeyRange.only(id));
      c.onsuccess = () => { const k = c.result; if (k) { m.delete(k.primaryKey); k.continue(); } else ok(); };
    }));
  }

  /* --- pliki podkładów --- */
  async function zapiszPlik(projektId, blob, nazwa) {
    const id = uid('f'); const dane = await blob.arrayBuffer();
    await tx('pliki', 'readwrite', m => m.put({ id, projektId, nazwa, typ: blob.type || '', rozmiar: dane.byteLength, dane }));
    return id;
  }
  const plik = (id) => tx('pliki', 'readonly', m => req(m.get(id)));
  const usunPlik = (id) => tx('pliki', 'readwrite', m => m.delete(id));

  /* --- zdjęcia --- */
  async function zapiszZdjecie(o) { // o: { projektId, blob, mini, w, h, czas, nazwa }
    const id = o.id || uid('z');
    const rek = { id, projektId: o.projektId, w: o.w, h: o.h, czas: o.czas || Date.now(), nazwa: o.nazwa || '', typ: 'image/jpeg',
      dane: await o.blob.arrayBuffer(), mini: o.mini ? await o.mini.arrayBuffer() : null };
    await tx('zdjecia', 'readwrite', m => m.put(rek));
    return id;
  }
  const zdjecie = (id) => tx('zdjecia', 'readonly', m => req(m.get(id)));
  const usunZdjecie = (id) => tx('zdjecia', 'readwrite', m => m.delete(id));
  const zdjeciaProjektu = (pid) => tx('zdjecia', 'readonly', m => req(m.index('projekt').getAllKeys(IDBKeyRange.only(pid))));

  /* Prośba o trwałe przechowywanie — przeglądarka nie usunie wtedy danych przy braku miejsca.
     Na iPadzie zgoda jest zwykle udzielana aplikacji dodanej do ekranu początkowego. */
  async function utrwal() {
    try { if (navigator.storage && navigator.storage.persist) trwala = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (e) { trwala = null; }
    return trwala;
  }
  async function miejsce() { try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { return null; } }

  return { otworz, projekty, projekt, zapiszProjekt, oproznij, usunProjekt, zapiszPlik, plik, usunPlik, zapiszZdjecie, zdjecie, usunZdjecie, zdjeciaProjektu,
    utrwal, miejsce, trwala: () => trwala, naBlad: null };
})();
