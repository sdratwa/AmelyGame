# Gra Miasto

Przygodowa gra przeglądarkowa (widok z góry + las w widoku pierwszej osoby).
To pierwszy wycinek gry – bez backendu i bazy danych, cały stan żyje w przeglądarce.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · three.js + react-three-fiber · Vitest

## Uruchomienie

```bash
npm install
npm run dev        # http://localhost:43217
```

Inne komendy: `npm run build`, `npm start` (port 43217), `npm run lint`, `npm run typecheck`, `npm test`.

Zasoby 3D (modele lasu, CC0 Quaternius): `npm run assets:report` (raport z manifestu), `npm run assets:build` (odtworzenie `public/models/` z oryginałów, patrz [`docs/projekt/zasoby-3d.md`](docs/projekt/zasoby-3d.md)). Galeria modeli w trybie deweloperskim: `/dev/models`.

## Co jest w grze

1. **Imię** → ekran ładowania świata → mapa świata z góry.
2. **Tutorial** – podświetlony las z wykrzyknikiem, reszta wyszarzona. Trzeba kliknąć las.
3. **Las (FPV)** – las 3D 300 × 300 m (streaming sektorów, kolizje, rzeka bez przejścia do czasu mostu): `W/S/A/D` – ruch, `Shift` – bieg, mysz – rozglądanie, `O` (albo `F3`) – panel diagnostyczny, jakość Niska/Średnia/Wysoka, `E` – otwórz skrzynię / zetnij drzewo / rozbij skałę, `I` – ekwipunek, `M` – minimapa, `J` – dziennik, `Esc` – zamknięcie okna i zwolnienie myszy, drugi `Esc` – powrót na mapę. Pełna lista: [`docs/projekt/sterowanie.md`](docs/projekt/sterowanie.md). Szczegóły i ograniczenia: [`docs/projekt/las-w-grze-f1.md`](docs/projekt/las-w-grze-f1.md), skrzynie i zbieranie: [`docs/projekt/m1-c1-skrzynie-minimapa.md`](docs/projekt/m1-c1-skrzynie-minimapa.md). Tablica ogłoszeń w mieście: quest „Most do nieznanego”. Widok pierwszoosobowy pokazuje wyłącznie otoczenie (bez ręki i telefonu).
4. **Sklep „Żappka”** – wnętrze sklepu: kupno jedzenia (leczy życie), w środku życie nie spada (schronienie). Wyjście: `Esc`.
5. **Dwa domy na sprzedaż** – cena losowa 200–500 tys. zł, 6-cyfrowy telefon, a wygląd zależy od ceny: 4 poziomy (1 Chatka < 275 tys., 2 Domek < 350 tys., 3 Dom z poddaszem < 425 tys., 4 Rezydencja). Dom można kupić i ulepszać do poziomu 4 (koszt: 60 / 90 / 130 tys. zł).
6. **Pasek górny** – życie (lewo); portfel (start: 1 000 000 zł), dzień/noc, pora roku i rok (prawo). Start: zima 2030.
7. **Ekwipunek** – 8 slotów, na starcie puste (telefonu w grze już nie ma). Zaznacz jedzenie i `Zjedz` / `E`, by się uleczyć. Klawisze `1–8` wybierają slot.
8. **Śmierć i odrodzenie** – przy 0% życia pojawia się ekran śmierci; odrodzenie na mapie z pełnym życiem; jedzenie przepada, narzędzia, schemat i materiały zostają.

### Zasady czasu i życia

- 1 godzina w grze = 20 s realnych; doba = 12 h dnia + 12 h nocy (06:00–18:00 dzień); pora roku = 30 dni; start: zima 2030.
- Wiosna/lato/jesień: dzień – bez strat, noc – −1% / 10 s.
- Zima: dzień – −1% / 10 s, noc – −1% / 5 s (wskaźnik „Jest zimno”).
- W sklepie życie nie spada. Czas stoi, dopóki nie klikniesz lasu w tutorialu.

Logika (zegar, spadek życia, sklep, ekwipunek, śmierć) jest w `src/lib/game/` (publiczne API: `engine.ts`) i ma testy (`*.test.ts`).

Pełny opis stanu gry, zasad i tego, czego jeszcze nie ma — do wklejenia innemu modelowi — jest w [`docs/opis-gry.md`](docs/opis-gry.md).

### Zapis gry

Postęp zapisuje się automatycznie w `localStorage` przeglądarki (imię, czas, życie, portfel, ekwipunek ze stosami, domy, pozycja w lesie, seed świata, postęp questa „Most do nieznanego”: zadania, skrzynie, troll z depozytem, most). Po odświeżeniu pojawia się ekran „Kontynuuj / Nowa gra”. Zapis (SaveV3) jest wersjonowany, z kopią zapasową i migracją ze starych zapisów (v1 -> v2 -> v3; v3 to usunięcie telefonu) – szczegóły w [`docs/projekt/zapis-gry.md`](docs/projekt/zapis-gry.md).

### Debug

`?reset=1` w adresie czyści zapis (także przycisk „dev: reset zapisu” w trybie deweloperskim).

`?speed=20` w adresie przyspiesza czas gry (np. `http://localhost:43217/?speed=30`).

## Dokumentacja projektowa i reguły

Plan i projekt etapu 1 („Most do nieznanego”): [`docs/projekt/README.md`](docs/projekt/README.md). Trwałe reguły dla agentów: `.cursor/rules/`.

## Struktura

- `src/lib/game/` – czysta logika gry bez Reacta i Three: `core/` (stan, zegar, `applyCommand`, zdarzenia, pauza czasu, rng), `content/` (przedmioty, domy, zagadki, questy), `systems/` (sesja, życie, ekwipunek, kontenery, domy, śmierć, questy, skrzynie/troll/most), `world/` (wersjonowany generator świata z seeda, odcisk), `save/` (zapis, walidacja, migracje, magazyn, autosave); `engine.ts` to fasada publicznego API
- `src/components/game/scene/` – ilustrowana scena świata (SVG): teren, ścieżki, drzewa, sklep, domy w 4 poziomach
- `src/components/game/` – ekrany: `NameScreen`/`LoadingScreen`, `WorldMap`, `ShopInterior`, `ForestView` + `ForestScene` (r3f), `Hud`
- `src/components/ui/` – komponenty shadcn/ui

### Dostęp z innego hosta (dev)

`next dev` blokuje połączenie HMR (`/_next/hmr`) z hostów spoza `allowedDevOrigins`; wtedy w przeglądarce widać „websocket error” i strona przeładowuje się w pętli. Dozwolone hosty ustawiasz w `next.config.ts` lub zmienną `ALLOWED_DEV_ORIGINS` (lista hostów po przecinku, bez portu), np. `ALLOWED_DEV_ORIGINS=moj-host.example.com npm run dev`.
