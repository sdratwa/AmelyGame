# Generator lasu W1a (v2) - stan implementacji

Deterministyczny, proceduralny generator terenu, ścieżek, rzeki i roślinności dla lasu 300 x 300 m. Dane przygotowują prototyp wizualny V2. Kod: `src/lib/game/world/generators/v2/`, adapter instancingu: `src/lib/assets/forest.ts`.

**Status: wersja robocza (draft).** Generator v2 NIE jest zarejestrowany w `registry.ts`, `CURRENT_GEN_VERSION` pozostaje 1, a istniejące zapisy i zamrożony generator v1 nie zostały zmienione. Stała `FOREST_GEN_VERSION = 2` istnieje w module v2, ale nie jest podłączona do zapisu. Renderowania lasu nie ma w tym etapie (`ForestScene` bez zmian).

## Rozszerzenia rdzenia W0 (kompatybilne wstecz)

- `shape.ts`: kształt `ribbon` (wstęga po polilinii z promieniem w każdym punkcie) i `ribbonGap`; bariera rzeki to wstęga.
- `polyline.ts`: `SegmentIndex` - siatkowy indeks odcinków, `nearest(x, z)` bez trygonometrii (używa go geometria rzeki i ścieżek).
- `terrain.ts` / `pipeline.ts`: żądania terenu `river` i `trail` obok `bump` i `pad`; stała kolejność nakładania: bump, river, trail, pad. `pad` może mieć `reference: "shaped"` (wysokość po pagórkach i rzece).
- `prepareWorld(recipe, seed, version, {variant})`: etapy 1-3 bez obiektów (teren, plan, teren końcowy). `buildWorld` z niego korzysta; las leniwy bierze teren i plan bez generowania obiektów.
- `recipe.validate` (reguły dodatkowe po standardowej walidacji) i `recipe.walkCell`; `ViolationCode` przyjmuje dowolny napis.
- `WorldObject` ma opcjonalne `variant`, `scaleXYZ`, `tilt`.
- `buildWorld` przekazuje do `WalkWorld` tylko obiekty z kolizją (trawa i kwiaty nie zaśmiecają indeksu).

## Teren i rzeka

- Wspólny `createTerrain` / `terrainHeight`: łagodne wzgórza (9) i zagłębienia (5), polany (a, b na końcach odgałęzień oraz c, d wolne), ścieżki wtopione w teren (profil wzdłużny to wygładzony teren; odgałęzienie jest zakotwiczone w głównej ścieżce).
- Rzeka: 43 punkty od z = -170 do 170 (poza mapą, więc brak obejścia przy krawędziach), x ok. 100-106 z łagodnym meandrem, szerokość 10-14 m. Profil: dno `wy - 1,1 (1 - u^2)`, brzeg z płynną skarpą (4 m, +0,8 m), wtopienie w teren na 22 m.
- Rzeka jest barierą (`barrier.river`); przejście `passage.bridge` otwiera flaga `bridge.built`. Miejsce mostu to wyłącznie dane: punkt `poi.bridge_site` (z w przedziale -30..30, zależnie od seedu) oraz lądowiska zachodnie (wymagane do osiągnięcia) i wschodnie z płaskimi podestami 4,5 m od krawędzi wody. Mostu nie ma w obiektach, nie ma mechaniki questu.
- Cztery ścieżki: główna (półszerokość 1,3 m), dwa odgałęzienia (1,0 m) kończące się polanami oraz krótki odcinek za rzeką dostępny dopiero z flagą. Główna ścieżka próbuje do 12 strumieni, a jeśli żaden nie przejdzie walidacji, ma prosty zapas.

## Profile środowiskowe (dane, bez logiki w rendererze)

`profiles.ts`: `mixed_forest` (tło), `sunny_forest`, `dense_forest`, `clearing`, `riverside`. Każdy profil to gęstości na 100 m^2 dla warstw (tree, ancient, rock, bush, fern, plant, grass, flower), szansa na grzyby i miks gatunków. Strefy w planie (kształt + priorytet) są składane jak alfa z wygładzonym brzegiem; reszta to `mixed_forest`. Profile można podmienić w `ForestOptions.profiles`; wyzerowanie warstwy usuwa ją, plan i teren zostają. Zależność od typu terenu: wilgotność (bliskość rzeki + szum) zwiększa paprocie i grzyby, wysokość pinie, nachylenie skały i zmniejsza drzewa.

## Roślinność

- Kandydaci to czysta funkcja (ziarno warstwy, komórka, k); gęstość lokalna = profile x szum skupisk x środowisko; stała liczba losowań na kandydata.
- Rzadzenie Matérn II po znacznikach: drzewa promieniem korony, skały i pozostałe obiekty promieniem kolizji / podstawy. Pnie i skały nigdy się nie nakładają, korony mogą.
- Wykluczenia statyczne: koryto rzeki, korytarz ścieżki (kolizje: promień + 0,6 m), polany i strefy `keep_clear`, margines regionu.
- Warstwy: drzewa liściaste i sosny, stare drzewa (rzadkie), skały S/M/L (grupy 1-4), krzewy, paprocie, rośliny runa (w tym koniczyny), trawa, kwiaty (płaty 3-7), grzyby przy drzewach.
- Każda warstwa ma własny strumień `forest.veg.<warstwa>`; zmiana liczby kwiatów nie przesuwa drzew ani skał (test).

## Determinizm

- Ten sam seed + wersja + wariant = identyczny świat (odcisk `fp1:...` zamrożony w teście dla seedów 1, 2030 i 4000000000).
- Zakaz `Math.random`, zegara i funkcji, których wynik różni się między silnikami JS (sin, cos, tan, atan, exp, pow, log, hypot) w kodzie v2 (test skanuje źródła); plan używa wielomianowego szumu `noise1`. Pozycje zaokrąglone do 1 mm, wysokości do 0,1 mm.
- Znane ograniczenie: spłaszczenia i pagórki z W0 (`bump`, `pad`) używają `Math.cos`; odcisk może się różnić między silnikami JS o ostatnie bity. Przed wydaniem generatora v2 do zapisów trzeba je zastąpić wielomianami (osobna zmiana wersji).
- Obiekty mają stabilne ID `rodzaj.region.ix_iz.n` (numer w obrębie rodzaju po posortowaniu po (x, z)); właścicielem jest sektor pozycji.

## Sektory i wydajność

- 100 sektorów 30 x 30 m (10 x 10). Każdy sektor jest funkcją czystą (seed, wersja, wariant, sektor) liczoną leniwie z marginesami (drzewa 8 m, skały 3 m, krzewy 2,5 m), więc wynik nie zależy od kolejności zapytań ani cache.
- `ActiveSectorWindow` (7 x 7): `update(x, z)` zwraca różnicę `{enter, leave, current}` tylko po przejściu na inny sektor; pierwszy ruch liczy 49 sektorów, krok o jeden sektor dokłada najwyżej 7.
- `collidersNear(x, z, r)` czyta tylko sektory w pobliżu; `surfaceAt` daje wysokość terenu.
- Adapter `sectorPlacements(sector)` zwraca pozycje pogrupowane po `rodzaj.wariant` (kompatybilne z `Placement` instancingu V1; skały zagłębione o `ROCK_SINK * scaleY`), cache per sektor.
- `pickShowcaseSectors(forest, n)` wybiera sektory do V2 (>= 8 drzew z dwóch grup i rozrzutem skali, >= 2 skały, >= 10 paproci, >= 60 niskich roślin, >= 12 m ścieżki, różnica wysokości >= 0,6 m, nie przy wodzie). Sektory nie są wyrównywane; gęstość pozostaje zróżnicowana.

## Walidacja (`validate.ts`)

Zbocza (<= 33 stopnie poza korytem), rzeka nieprzekraczalna (także przy krawędziach i na wschodnim brzegu), osiągalność zachodniej części, most (bez flagi nie, z flagą tak), ścieżki przechodnie i osiągalne, brak obiektów w wodzie, brak nakładania kolizji, wysokość obiektu = teren, unikalność i zgodność ID z sektorem. Każdy kod ogranicza się do 6 zgłoszeń + podsumowanie.

## Raport i testy

- `npm run world:report` - liczby obiektów, gęstości, czasy, sektory, trójkąty (test z `FOREST_REPORT=1`).
- Testy: `w1a-core.test.ts` (rdzeń), `generators/v2/forest.test.ts` (determinizm, sektory, teren, rzeka, ścieżki, kolizje, profile, wydajność), `forest.seeds.test.ts` (300 seedów planu, 300 x 3 sektory, 60 pełnych światów, 14 pełnych walidacji, sektor wzorcowy dla 80 seedów), `src/lib/assets/forest.assets.test.ts` (zgodność z manifestem V1, adapter, budżet trójkątów).

## Ryzyka przed V2

1. Liczba trójkątów: ok. 16-17 mln w całym lesie i ok. 8,5 mln w najgęstszym oknie 7 x 7 przy LOD 0. V2 musi opierać się na LOD 1+, ograniczeniu odległości widzenia, odcinaniu trawy/kwiatów z dystansu i profilach jakości; same dane nie mieszczą się w budżecie z [wydajnosc.md](wydajnosc.md) bez tego.
2. Najcięższe są stare drzewa (ok. 10 tys. trójkątów) i krzewy z kwiatami; do rozważenia limity lub billboardy.
3. Gęstość i wygląd zostały dobrane liczbowo bez oceny wizualnej; wartości profili są punktem wyjścia do strojenia w V2 (strojenie zmienia odcisk, więc wymaga nowej wersji generatora, o ile świat jest już zapisywany).
4. Jakość obejścia rzeki jest sprawdzana BFS na siatce 1-2 m i ruchem przy krawędziach; nie ma jeszcze testu F1 z prawdziwym kontrolerem gracza.
5. `Math.cos` w spłaszczeniach i pagórkach (patrz Determinizm).
6. Sektory z wodą mają mniej obiektów; sektory wzorcowe wybierane są automatycznie, ale nie wszystkie seedy mają trzy kwalifikujące się.
