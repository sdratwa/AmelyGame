# Zasoby 3D: strategia, pakiety, licencje, potok

Stan: etap V1 (15 października 2026). W repozytorium jest zoptymalizowany zestaw roślin i skał z paczki Quaternius (31 modeli) oraz potok, który odtwarza go z oryginałów. Skrzynia, most, kilof, piła, troll i postać gracza nie mają jeszcze modeli (patrz "Pozostali kandydaci").

## Zasady

- Preferujemy gotowe modele z licencją dopuszczającą użycie komercyjne i dystrybucję. Preferowane CC0. CC-BY dopiero po sprawdzeniu warunków atrybucji i zapisaniu ich tutaj.
- Nic nie pobieramy z niezweryfikowanych źródeł i nic bez zatwierdzenia pakietu przez autora. Niczego nie kupujemy bez zgody autora.
- Każdy używany model ma wpis w `public/models/manifest.json` (test pilnuje kompletności, plików, rozmiarów i licencji).
- Placeholdery proceduralne wyłącznie do testów mechaniki, oznaczone `placeholder: true`; docelowy las nie powstaje z prostych brył. Wyjątek techniczny: zastępnik przy błędzie ładowania (`fallback: true`), widoczny w statystykach biblioteki.
- Wygląd rozdzielony od gry: kolizje należą do obiektów świata (generator), a manifest podaje tylko sugerowane rozmiary kolizji modeli. Wymiana modeli nie psuje zapisów (patrz [swiat-generator.md](swiat-generator.md)).

## Zatwierdzony pakiet: Quaternius "Stylized Nature MegaKit" [Standard]

Zweryfikowane 15.10.2026 na oficjalnej stronie itch.io przed pobraniem.

- Autor: Quaternius. Strona: https://quaternius.itch.io/stylized-nature-megakit (producent: https://quaternius.com/packs/stylizednaturemegakit.html).
- Licencja: **CC0 1.0 Universal** (strona itch.io i `License_Standard.txt` w paczce). Atrybucja niewymagana; sugerowane podziękowanie w ekranie autorów.
- Wersja: Standard, darmowa (cena "name your own price", minimum 0 USD), 68 z 116 modeli. Wersji Pro (9,99 USD) i Source (14,99 USD) nie pobieraliśmy ani nie kupowaliśmy.
- Archiwum: `Stylized Nature MegaKit[Standard].zip`, 104 088 529 bajtów, SHA-256 `298f6732b872e4cf7b30e6e7abf9641c7f6dc6b326df37ac089533ed7e3d58c9`.
- Zawartość (po pobraniu): glTF (`.gltf` + `.bin` + PNG; **brak GLB**), FBX, OBJ, FBX Unity, tekstury, 68 modeli glTF.
- Styl: ręcznie malowane tekstury, miękkie bryły, nasycone kolory (liście także niebieskie, pomarańczowe, różowe), maskowane liście. Pasuje do baśniowego lasu; do oceny wizualnej w V2.
- Wiatr: shadery są tylko w wersji Source. Zachowaliśmy kolor wierzchołków jako maskę wiatru (trawa, paprocie, rośliny) pod własny shader, ale go nie wdrożyliśmy.

### Wybrane modele (31)

| Kategoria | Id w manifeście | Źródło |
|---|---|---|
| Drzewa liściaste (5) | `tree.common.1..5` | `CommonTree_1..5` |
| Sosny (3) | `tree.pine.1`, `.3`, `.5` | `Pine_1,3,5` |
| Stare drzewa (2), punkty orientacyjne | `tree.twisted.1`, `.3` | `TwistedTree_1,3` (skala 0,7) |
| Krzewy (2) | `bush.common`, `bush.common_flowers` | `Bush_Common*` |
| Paproć (1) | `fern.1` | `Fern_1` |
| Runo (6) | `plant.1`, `plant.1_big`, `plant.7`, `plant.7_big`, `clover.1`, `clover.2` | `Plant_*`, `Clover_*` |
| Trawy (4) | `grass.common_short/tall`, `grass.wispy_short/tall` | `Grass_*` |
| Kwiaty (4) | `flower.3_single/group`, `flower.4_single/group` | `Flower_3/4_*` |
| Grzyb (1) | `mushroom.common` | `Mushroom_Common` |
| Skały (3) | `rock.medium.1..3` | `Rock_Medium_1..3` |

Pominięte celowo: `DeadTree_*` (ponure, nie pasują do tonu gry), `Pine_2/4`, `TwistedTree_2/4/5` (zapas wariantów, do dodania w razie potrzeby), `Petal_*`, `Pebble_*`, `RockPath_*`, `Mushroom_Laetiporus` (3,2 tys. trójkątów), kilka tekstur nieużywanych przez wybrane modele.

### Skały S/M/L (wariant A, decyzja autora)

Paczka Standard ma tylko trzy skały średnie (około 3 m szerokości). Klasy powstają przez skalowanie: S 0,28-0,40 (1 jednostka surowca), M 0,55-0,75 (2), L 0,95-1,30 (5), z kontrolowaną zmiennością proporcji (osie x/z do +-12%, y do +-15%), losowym obrotem wokół osi pionowej i pochyleniem do 0,08 rad. Zakresy i pomocnik `pickRock` są w manifeście i `src/lib/assets/variety.ts`. To decyzja prototypowa, nie styl docelowy; ryzyko: powtarzalność trzech kształtów. Ocena w V2; w razie potrzeby wariant B lub C (wymaga zgody autora).

### Wyniki optymalizacji (V1)

- 12 tekstur użytych zamiast 20 w paczce; oryginały 24,5 MB (PNG do 2048 px) -> 0,72 MB (WebP, maks. 1024 px) lub 0,28 MB (wariant LOW, 512 px).
- 41 plików GLB (31 modeli + 10 LOD1 drzew): 1,86 MB razem (kwantyzacja geometrii + kompresja meshopt).
- Razem do pobrania: około 2,6 MB (HIGH/MEDIUM), 2,1 MB (LOW). Przy wszystkich 31 modelach: 10 materiałów, 1-2 wywołania rysowania na model i poziom LOD.
- Trójkąty modeli: bez zmian na LOD0 (64 023 w sumie); LOD1 drzew ma od 8% do 60% mniej trójkątów (średnio ok. 38%).
- Raport z manifestu: `npm run assets:report`.

## Potok optymalizacji (`scripts/assets/`)

Oryginały nie są w repozytorium ani w bundlu (99 MB). Potok jest odtwarzalny i deterministyczny (ten sam wynik bajt w bajt dla tych samych oryginałów i wersji narzędzi).

1. Pobierz archiwum z oficjalnej strony (wersja Standard, 0 USD), sprawdź SHA-256 (wyżej).
2. Rozpakuj do `.assets-src/quaternius-stylized-nature-megakit-standard/` (katalog w `.gitignore`; oczekiwane `glTF/` i `License_Standard.txt`) albo podaj ścieżkę: `npm run assets:build -- --src <katalog lub .zip>`. Dla `.zip` potok sprawdza sumę archiwum i rozpakowuje je sam (wymaga `unzip`).
3. `npm run assets:build` robi:
   - weryfikuje sumy SHA-256 każdego użytego pliku z `scripts/assets/source-hashes.json` (nowe oryginały trzeba przyjąć świadomie: `--update-hashes`);
   - sprawdza, że ten sam materiał ma tę samą definicję we wszystkich modelach;
   - zdejmuje tekstury z GLB; geometria + nazwy materiałów, bez danych zbędnych (`prune`, `dedup` akcesorów); kolor wierzchołków zostaje tylko tam, gdzie niesie informację (kora: AO; trawa/rośliny: maska wiatru), białe zostają usunięte; UV zachowane;
   - kwantyzacja (pozycja 14 bit, normalne 10, UV 12 gdy w [0,1], kolor 8) i kompresja `EXT_meshopt_compression`;
   - LOD1 drzew: uproszczenie `meshoptimizer` per prymityw (z normalnymi i UV; flaga `Prune` usuwa najcieńsze gałązki). Siatki drzew składają się z rozłącznych powłok, więc zwykłe uproszczenie niemal nie działa;
   - tekstury: rozlanie koloru krawędzi w przezroczyste obszary (brak białej obwódki liści), WebP (jakość 82, normalne 90), wariant maks. 1024 px i 512 px;
   - zapisuje `public/models/{glb,textures,licenses}` i `manifest.json` (trójkąty, wierzchołki, wywołania rysowania, rozmiary, granice, kolizje, LOD, materiały, tekstury, sumy, wersje narzędzi);
   - test po drodze: materiały po optymalizacji muszą być takie same jak w źródle (wcześniej `dedup` zlewał materiały po zdjęciu tekstur; wykryte i naprawione).
4. Zmiana wyboru modeli, skal lub kolizji: edycja `scripts/assets/config.mjs` i ponowne `npm run assets:build`.

Narzędzia są w `devDependencies` (`@gltf-transform/*`, `meshoptimizer`, `sharp`), nie w produkcji.

### Format manifestu (`public/models/manifest.json`, schemaVersion 1)

- `packs[]`: pakiet, autor, licencja (id, URL, plik z tekstem), źródło, archiwum (nazwa, bajty, SHA-256), atrybucja, informacja o zatwierdzeniu.
- `textures[]`, `materials[]`: współdzielone; materiał ma albedo/normalne, `alphaMode`/`alphaCutoff`, `doubleSided`, `vertexColors`.
- `models[]`: `id`, `file`, `sourceName`, `author`, `license`, `attribution`, `category`/`subcategory`, `triangles`, `vertices`, `drawCalls`, `bytes`, `baseScale`, `bounds` (w metrach, po `baseScale`), `collision` (koło x-z: `r`, `height`; dla pni drzew mierzone z kory na wysokości 0,2-0,5 m, dla skał ślad oszacowany; rośliny bez kolizji), `lod[]` (plik, trójkąty, `minDistance`), `placeholder`, `approvedAt`, `visualReview` (`pending-v2`).
- `scaleClasses.rock`: klasy rozmiaru skał.
- Rozmiar naturalny: `baseScale` sprowadza modele do metrów (gracz ok. 1,7 m); trawy i kwiaty zmniejszono (np. trawa 0,45-0,5), stare drzewa 0,7.

## Ładowanie w grze (`src/lib/assets/`, `src/components/assets/`)

- Bez `@react-three/drei`: kompatybilny (v10, `three >=0.159`, R3F 9, React 19), ale potrzebujemy własnego cache z jednym materiałem i jedną geometrią na model oraz testowalności w Node. Do `GLTFLoader` dodany `MeshoptDecoder` z `three/addons`.
- `AssetLibrary`: cache modeli, geometrii, materiałów i tekstur; `preload`; jedno wspólne wstępne ładowanie wszystkich modeli; błędy jako `AssetLoadError` (manifest/model/tekstura) z ponawianiem; `loadOrFallback` zwraca oznaczony zastępnik; `stats()`; `dispose()`.
- Geometria jest zamieniana na Float32 i ma wypieczoną skalę `baseScale`, więc instancje mają skalę 1 = rozmiar naturalny.
- `createInstancedModel`: `InstancedMesh` na (poziom LOD x część), współdzielone geometrie i materiały; `updateLods(camera)` przydziela instancje do poziomów wg odległości.
- Komponenty R3F: `AssetLibraryProvider` (profil jakości), `AssetBoundary` (Suspense + granica błędu), `ModelInstances`.
- Profile `LOW/MEDIUM/HIGH` (`profiles.ts`): wariant tekstur, mapy normalnych (tylko HIGH), materiał (Lambert w LOW), alpha-to-coverage (HIGH), minimalny LOD (LOW używa od razu LOD1), mnożnik odległości LOD, gęstość roślinności, cienie, limit pixel ratio. Wartości są punktem wyjścia; strojenie na sprzęcie referencyjnym w V2.
- Galeria deweloperska: `/dev/models` (tylko tryb deweloperski, w produkcji 404): wszystkie modele w rzędach, skały w S/M/L, przełącznik jakości, test wydajności N instancji jednego drzewa (FPS, wywołania rysowania, trójkąty), statystyki biblioteki.

## Znane ograniczenia i ryzyka (do oceny w V2)

- Wygląd nie był oceniany w przeglądarce w tym etapie (zgodnie z ustaleniem testy 3D wykonuje autor). Tekstury sprawdzone na obrazach, geometria testowana w Node (GLTFLoader + meshopt), ale nie na GPU.
- LOD1 drzew to uproszczenie bez weryfikacji wizualnej; dla odległości powyżej 50-60 m rozsądniejsze mogą się okazać billboardy (impostory), poza zakresem V1.
- Kolizje pni: zmierzone na wysokości 0,2-0,5 m; sosny mają nisko rozłożyste gałęzie, które nie blokują ruchu (kolizja tylko pień).
- Tekstury zajmują w GPU ok. 5 MB każda (WebP jest rozpakowywany); format KTX2 (GPU-compressed) jest opcją na później.
- Jedna paproć (`Fern_1`); gęstość runa budują `plant.*`, trawy i koniczyny.
- Skały S/M/L ze skalowania trzech modeli (wariant A).
- Tekstury liści zawierają nasycone kolory (niebieskie, różowe, pomarańczowe liście); do wyboru w V2, które materiały zostają w zasięgu "baśniowym", a które odrzucamy.

## Pozostali kandydaci (wymagają osobnej akceptacji)

- Kenney "Nature Kit" (CC0, ok. 330 modeli; m.in. `bridge_wood` 220 trójkątów, `bridge_wood_round` 336): most, kłody, pnie, ewentualnie skały. Styl prostszy niż MegaKit.
- Kenney "Survival Kit" (CC0, ok. 70-80 modeli; skrzynia `chest` 322 trójkąty): skrzynia, ewentualnie narzędzia.
- Quaternius "Pickaxe Wood" (CC0): kilof. Piła: brak zweryfikowanego kandydata.
- Troll: Quaternius "Orc" (CC0, ok. 4,3 tys. trójkątów, animowany) lub "Big T" (Polygonal Mind, CC0). Odrzucony: "Troll Doodle" (CC-BY, wymaga atrybucji). Wygląd musi być odpowiedni dla dzieci od 8 lat.
- Postać gracza: Quaternius "Universal Base Characters" (CC0, śr. ok. 13 tys. trójkątów - do zmniejszenia) lub KayKit "Adventurers" (CC0, low poly, rigged).
- Tekstury gruntu i niebo (CC0, np. Poly Haven, ambientCG): konkretne pliki i licencje do potwierdzenia przy wyborze.

## Źródła (sprawdzone 15.10.2026)

- https://quaternius.com/packs/stylizednaturemegakit.html
- https://quaternius.itch.io/stylized-nature-megakit (strona i `/purchase`: wersje Standard, Pro, Source i ceny)
- `License_Standard.txt` z pobranej paczki Standard (kopia w `public/models/licenses/`)
- https://creativecommons.org/publicdomain/zero/1.0/
- https://kenney.nl/assets/nature-kit, https://kenney-assets.itch.io/survival-kit
- https://poly.pizza/m/Ip2iXOq381, https://poly.pizza/m/5vO2YJsPEf, https://poly.pizza/m/Q3g8BKnXHA
- https://quaternius.com/packs/universalbasecharacters.html, https://kaylousberg.itch.io/kaykit-adventurers

## Skrzynia baśniowa (od autora, M1) - zastąpiona

Zastąpiona modelem `chest.treasure` (skrzynia ze skarbem) i dodano trolla: patrz [modele-skrzynia-troll.md](modele-skrzynia-troll.md). Opis poniżej jest historyczny.

Plik od autora (`assets/source/miasto_skrzynia_basniowa.glb`) jest docelowym modelem skrzyń w lesie. Potok `npm run assets:props` tworzy `public/props/chest.fairy.glb` i `props.json` (osobno od `public/models`, bo `assets:build` odtwarza ten katalog). Szczegóły analizy (pivot `Lid_Hinge`, kolory wierzchołków, skala 0,85) w [m1-c1-skrzynie-minimapa.md](m1-c1-skrzynie-minimapa.md). Kandydat Kenney `chest` z listy powyżej nie jest już potrzebny.
