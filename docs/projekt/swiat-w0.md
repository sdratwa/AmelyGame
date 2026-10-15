# Rdzeń świata (W0) - stan implementacji

Moduły w `src/lib/game/world/`, niezależne od Reacta, Three.js i modeli GLB (test pilnuje importów i odwołań do `.glb`/`BufferGeometry`). Nic z W0 nie jest jeszcze podłączone do gry, zapisu ani `ForestScene`; `CURRENT_GEN_VERSION` nadal wynosi 1, generator v1 jest nietknięty.

## Współrzędne, regiony, sektory (`bounds.ts`, `shape.ts`)

- 1 jednostka = 1 m; x, z poziomo, y w górę. Początkowy las: `FOREST_START_REGION` (x, z od -150 do 150, sektor 30 m, siatka 10 x 10).
- `RegionDef { id, bounds, sectorSize, unlockedBy? }` jest daną; regiony mogą mieć inny rozmiar i niepodzielne granice (ostatni sektor jest mniejszy). `regionAt(regions, x, z, flags)` uwzględnia odblokowanie flagą (np. `bridge.built`).
- Sektory są tylko logiczną siatką (generowanie, odkrywanie mapy, okno renderowania): `sectorOf` (granica domknięta od dołu, krawędź maksymalna w ostatnim sektorze), `sectorBounds`, `sectorsOverlapping` (obiekt na granicy należy do wszystkich przeciętych sektorów; dotyk linii nie dodaje sąsiada). Ruch nie zależy od sektorów.
- Identyfikatory: `sector.<region>.<ix>_<iz>` (np. `sector.forest_start.3_4`) i `<rodzaj>.<region>.<ix>_<iz>.<numer>` (np. `tree.forest_start.3_4.17`); `objectId`/`parseObjectId`/`parseSectorId`. Sektor i numer nadaje generator w chwili tworzenia obiektu, ID nie zmienia się po przesunięciu. (Zmiana względem wcześniejszej notacji `sector.{ix}_{iz}`: dodany segment regionu, żeby regiony o różnych siatkach nie kolidowały.)
- `Shape`: koło, prostokąt, pas wokół łamanej (rzeka, ścieżka) - używane przez bariery, przejścia i strefy.

## Teren (`terrain.ts`, `noise.ts`)

- `createTerrain(worldSeed, worldGenVersion, { modifiers? })` zwraca `Terrain` z `height`, `normal`, `slope` (stopnie) oraz `gradient`. Normalne i nachylenie wynikają z różnic centralnych (`NORMAL_EPS` = 0,25 m), więc zawsze zgadzają się z `height`.
- Baza: szum wartościowy fBm z liczb całkowitych (bez `Math.random`, bez zegara). Wersje terenu są niezmienne po wydaniu: v1 = płaski prototyp, v2 = ROBOCZA (amplituda 2,4 m, długość fali 80 m, 3 oktawy; nie jest zarejestrowana w generatorach świata ani zapisywana, może się zmieniać do wydania w W1a).
- Modyfikacje: interfejs `TerrainModifier { id, kind, bounds, apply }` nakładany w ustalonej kolejności i indeksowany siatką (koszt zależy od modyfikacji w pobliżu). Zaimplementowane tylko `padModifier` (spłaszczenie pod budynek/obiekt questowy) i `bumpModifier` (wzgórze/zagłębienie). Ścieżki, brzegi rzeki i wąwozy dojdą jako kolejne modyfikatory bez zmian architektury.

## Kolejność generowania (`pipeline.ts`)

1. Teren bazowy z (seed, wersja): `createBaseTerrain`.
2. Plan miejsc wymagających modyfikacji: `recipe.plan` dostaje wyłącznie `HeightField` bazy (typ uniemożliwia odczyt obiektów i modyfikacji). Zwraca prośby o teren (`pad`, `bump`), punkty charakterystyczne, strefy, bariery i przejścia.
3. `materializeTerrain`: wysokość spłaszczenia jest liczona raz z terenu bazowego (+ `heightOffset`), kolejność stała (wzniesienia, potem spłaszczenia, w obrębie rodzaju wg planu).
4. `recipe.place` dostaje teren końcowy i `FeatureMap`; obiekty mają `y = terrain.height(x, z)`.
5. Walidacja: start przechodni, obiekty i prośby w regionach, osiągalność celów `mustReach` (POI) i obiektów z tagiem `must_reach` (BFS 1 m, uwzględnia nachylenie, bariery, kolizje i flagi; cel w kolizji liczy się w zasięgu interakcji `reachRadius`).

Wynik zależy tylko od (przepis, seed, wersja, `variant`). Strumienie RNG są nazwane (`ctx.rng("trees")`), więc dodanie strumienia nie przesuwa pozostałych; `variant` > 0 daje deterministyczny, inny układ (pod naprawę walidatora w W2). `BuiltWorld.fingerprint` hashuje próbki terenu, plan i obiekty (jeszcze nie jest zapisywany).

## Indeks przestrzenny (`spatialIndex.ts`)

`SpatialIndex<T>`: jednorodna siatka komórek (domyślnie 30 m). Obiekt trafia do wszystkich komórek, które przecina; zapytania nie dublują wyników. Operacje: `add`, `remove`, `move`, `get`, `has`, `queryRadius(x, z, r)` (koło przecina okrąg obiektu; kolejność: odległość, ID), `queryArea(bounds)` (kolejność: ID), filtr opcjonalny, `stats`, `cellsOf`. Test: 20 000 obiektów i 5000 zapytań w ułamku sekundy; zapytanie bada < 10% obiektów.

## Walkable i kolizje (`walk.ts`, `objects.ts`)

- Dane kolizji są częścią `WorldObject` (wynik generatora): `circle` albo `box` (z `yaw`), niezależne od wyglądu. `radius` obwiedni zawsze obejmuje collider (`makeObject`).
- `WalkWorld`: granice odblokowanych regionów (margines krawędzi), maksymalne nachylenie (domyślnie 35 stopni), `Barrier` (rzeka, urwisko) i `Passage` (np. most, aktywny po fladze `requiresFlag`, tylko w obrębie swojego kształtu, opcjonalnie dla wybranych barier), kolizje z obiektami z indeksu.
- `checkPoint`/`isWalkable` zwracają przyczynę blokady (`out_of_bounds`, `too_steep`, `barrier`, `object`). `move(from, to, flags)` dzieli ruch na kroki nie dłuższe niż promień gracza (brak przeskakiwania cienkich barier), wypycha z obiektów (ślizg), a przy granicy, zboczu lub barierze ślizga wzdłuż osi lub zatrzymuje.
- `computeReachability`/`reachesNear`: BFS po siatce do walidacji osiągalności.

## Punkty charakterystyczne i strefy (`features.ts`)

`PointOfInterest` i `EnvironmentZone` to czyste dane (`kind`, `tags`, `props`, kształt, priorytet), obsługiwane przez `FeatureMap` (`zonesAt`, `zonesWithTag`, `poisNear`, `poi`). Generator ich nie zna z nazwy: lokacje takie jak Stary Dąb czy Polana Świetlików będą wpisami w planie, bez przebudowy kodu. Pozycje nie są jeszcze ustalone.

## Rozszerzenia W1a

Wstęga (`ribbon`), `SegmentIndex`, żądania terenu `river` i `trail`, `prepareWorld`, hook `validate`, `walkCell` i indeks chodzenia tylko z obiektami z kolizją - opis w [swiat-w1a.md](swiat-w1a.md).

## Ograniczenia znane na tym etapie

- Ruch to model okręgu gracza; schodzenie ze zbocza „po osi” jest przybliżeniem (pełny ślizg po normalnej dojdzie razem z F1).
- Kolizje box-box i walidator nakładania obiektów dojdą w W2.
- `slope` używa `Math.atan`; wyniki pochodne nie są zapisywane, a progi w `WalkWorld` porównują gradient z `tan(limit)`.
