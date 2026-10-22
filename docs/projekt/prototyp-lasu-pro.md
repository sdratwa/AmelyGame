# Prototyp lasu PRO 300 x 300 m (`/dev/forest-pro`)

Stan: kod i testy napisane 20 października 2026. **Testy jednostkowe, lint, typecheck, build i przeglądarka nie były uruchamiane** (zakaz autora i ustalenie z planu: testy dopiero po zgodzie). Wygląd, kolory i FPS ocenia wyłącznie autor.

Cel: dodać do potoku zasobów wszystkie modele paczki Quaternius Stylized Nature MegaKit **[Pro]** (zakup autora), pokazać je w jednym lesie 300 x 300 m z czterema strefami i zmierzyć wydajność. Niczego jeszcze nie wycinamy; czy modele nadają się dla dzieci od 8 lat i które zostają w grze, zdecyduje autor po obejrzeniu prototypu.

## Co jest nietknięte

- Generator lasu v2, `FOREST_GEN_VERSION`, zapisy, quest, minimapa i las w grze: bez zmian. Wszystko nowe jest za opcją `ForestOptions.pro` (domyślnie wyłączona). Bez niej ten sam seed daje dokładnie te same obiekty (dodatkowe losowania i reguły działają tylko wtedy, gdy podano katalog Pro).
- Wartości życia, śmierci, drenażu, zegara, waluta: bez zmian.
- Gra nadal używa 31 modeli Standard (`SPECIES`). Modele Pro są w osobnym katalogu `SPECIES_PRO` / `SPECIES_ALL`, widocznym tylko w prototypie.

## Paczka i potok (`scripts/assets/`)

- `config.mjs`: paczka zmieniona na Pro (licencja CC0, `License_Pro.txt`); `MODELS_STANDARD` (31, bez zmian) + `MODELS_PRO_ONLY` (85) + `MODELS_PRO_DESERT` (6 pustynnych wariantów skał z materiałem `Rocks_Desert`). Razem **122 modele w manifeście** (116 z paczki + 6 wariantów).
- Geometria i pliki glTF 31 modeli Standard są w Pro bajt w bajt takie same (SHA-256), więc modele gry się nie zmieniły (po przebudowie potoku porównane `cmp`).
- Nowe materiały (łącznie 20) i tekstury (25); `blend` liści zamieniany na maskę 0,5 (jak dotąd); pień bez kory do pomiaru (brzoza, olbrzymia sosna) liczony medianą pierścienia wierzchołków.
- Rozmiar publicznych zasobów: 12,7 MB (wariant pełny), 11,7 MB (niski). Skala bazowa dobrana per model (np. brzoza 0,6, wiśnia 0,5, martwe drzewa 0,6, kwiaty 0,45).
- Odtworzenie: `npm run assets:build` (skrypt czyta rozpakowaną paczkę z `.assets-src/quaternius-stylized-nature-megakit-pro`; gdy go brak: `npm run assets:build -- --src <katalog|zip>`).

## Porównanie trójkątów (LOD0, jedna sztuka modelu)

| Kategoria | Modele (Pro / w tym Standard) | Suma trójkątów wszystkich modeli |
|---|---|---|
| drzewa | 40 / 10 | 287 659 |
| krzewy | 6 / 2 | 10 256 |
| runo (paprocie, rośliny, koniczyny) | 14 / 7 | 4 832 |
| trawy | 7 / 4 | 3 663 |
| kwiaty | 12 / 4 | 7 879 |
| grzyby | 4 / 1 | 6 440 |
| skały | 12 / 3 | 10 376 |
| ozdoby (kamyki Pebble, płatki Petal) | 17 / 0 | 1 206 |
| bruk (RockPath) | 10 / 0 | 14 839 |
| **razem** | **122 / 31** | **347 150** (z tego Standard 64 023) |

Najcięższe sztuki: wiśnie `tree.cherry.1..5` (12,4-14,7 tys.), stare drzewa `tree.twisted.*` (do 10,1 tys.). Płyty bruku `rockpath.*` mają 0,5-3,5 tys. trójkątów każda i jest ich w prototypie kilkaset, więc to realny koszt przy drodze. Liczby w teście FPS (poniżej) pokażą rzeczywisty koszt w oknie.

## Strefy (4 ćwiartki z łagodnym przejściem)

Szew w punkcie (0, 0), pas przejścia 40 m (czysta strefa zaczyna się 20 m od szwu). Wagi czterech stref sumują się do 1 (gładkie współczynniki osi), więc profil płynnie przechodzi z jednej strefy w drugą. Polany i brzeg rzeki z planu zachowują pierwszeństwo; losowe zagajniki (`dense_forest`, `sunny_forest`) są w tym trybie pomijane, żeby nie zaburzały czytelności stref.

| Strefa | Położenie (północ = mniejsze z) | Wzór | Zawartość |
|---|---|---|---|
| A | północny zachód | Preview_1 | jesienna łąka: brzozy, duże krzewy, szeroka trawa, grzyby, duże skały |
| B | południowy zachód | Preview_2 | gęsty las iglasty: olbrzymie sosny, wysokie iglaki, paprocie, pszenica |
| C | południowy wschód | Preview_3 | pustynia: martwe drzewa, skały w wersji pustynnej, sucha trawa |
| D | północny wschód | mix | wszystko naraz: wiśnie z płatkami, wszystkie krzewy, kwiaty i grzyby |

Gęstości celowo nie są obniżone (prototyp ma pokazać koszt). Test pokrycia sprawdza, że w całym lesie (strefy razem) występuje każdy z 122 modeli.

## Bruk drogi głównej

`trail.main` (od startu do mostu) jest częściowo wybrukowana jak w Preview_3: płyty `rockpath.*` leżą wzdłuż stycznej drogi z niewielkim rozrzutem, na brzegach dochodzą kamyki `pebble.*`. Przy starcie i przy moście (45 m od każdego końca) bruk jest gęsty i prawie ciągły (dwie płyty na krok), w środku drogi to łaty długości 14 m z szansą 0,45. Płyty nie mają kolizji (po drodze się chodzi), wynik zależy tylko od seeda i geometrii drogi (identyczny w każdym sektorze). Grunt pod bruk jest dodatkowo malowany w teksturze gruntu (kamienny odcień).

## Widok i wygląd

- Okno prototypu to cały las (10 x 10 sektorów, `radius: 5`), tekstura gruntu co najmniej 3072 px.
- Rodzaje widoku: nowe `decor` (kamyki, płatki, przerzedzane z odległością) i `path` (płyty bruku, widoczne dalej niż ozdoby).
- Domyślny preset to ORIGINAL (charakter V2a, bez ocieplenia); klawisze 5 i 6 to NATURAL i FAIRYTALE, 0 to MIASTO_DEFAULT. **Kolory paczki są zachowane**: w tym trybie nie zamieniamy czerwonych liści starych drzew na zielone, a nowe materiały liści (`leaves_birch`, `leaves_cherryblossom`, `leaves_giantpine`, `leaves_tallthick`) mają wiatr i nie mają korekty palety. W prototypie nic nie jest ukryte (w grze `plant.7` jest ukryte jako "odmiana magiczna").

## Trawa w kępach, spękana ziemia i pustynia (tryb Pro)

Cel: zbliżyć wygląd do `Preview_1/2/3`. Wszystko działa tylko w trybie Pro (`/dev/forest-pro`); generator v2 bez opcji `pro`, gra i zapisy są bez zmian. Parametry są w `PRO_TUNING` i `PRO_GROUND` (`generators/v2/pro.ts`) i można je stroić bez zmian w logice.

**Trawa.** Wcześniej: pojedyncze kępki (1 źdźbło na kandydata, ok. 0,16 szt./m²), małe modele (`baseScale` 0,45-0,5). Teraz każdy kandydat to kępa 5-11 kępek w promieniu ok. 1 m, z jedną dominującą odmianą (70%), skalą x0,8 (kwiaty x1,25) i gęstością w kępach (po zgrupowaniu): A 48, B 40, C 26, D 40 kępek na 100 m² (przed klastrowaniem). Maks. gęstość wynika z siatki komórek 3 m (2 kandydaci na komórkę), czyli do ok. 0,22 kandydata/m².

| Cecha | Przed (Pro) | Po (Pro) | Preview_1/2 (oszacowanie ze zrzutów) |
| --- | --- | --- | --- |
| Układ | pojedyncze kępki | kępy 5-11 kępek, odmiana dominująca | zwarte kępy ze zmienną gęstością |
| Skala kępki | 1,0 (model 0,45-0,5) | x0,8 | zbliżona do wyższej |
| Koszt | bazowy | ok. +0,3 mln trójkątów w HIGH (szacunek), draw calls bez zmian (instancing) | - |

Wartości w kolumnie Preview są oszacowaniem z obrazów, nie pomiarem; skalę trzeba ocenić okiem i skorygować `scale`, `members`, `spread`.

**Spękana ziemia.** Maska (kanał alfa tekstury gruntu): duże płaty w pustyni (szum o skali ok. 16 m, próg 0,5) i ścieżki ziemne we wszystkich strefach; bruk i woda bez pęknięć. Wzór (komórki Voronoi ok. 0,25 m, linie ok. 2 cm) rysuje shader gruntu, bo tekstura ma ok. 0,1 m/piksel i cienkie linie by w niej zanikły. Pęknięcia są pełne przy kamerze i znikają do 18 m. Tekstura gruntu poza trybem Pro zachowuje alfę 255.

**Pustynia.**
- Formacje skalne: kotwica skały zamienia się (szansa `formations`: C 0,3, A 0,12, D 0,1, B 0,03) w grupę 3-5 dużych głazów (skala 1,2-1,8, część średnich skał) stykających się z kotwicą. Okna rzadzenia i blokowania roślin są poszerzone o promień kolizji dużych głazów.
- Wydmy: niskie, wydłużone grzbiety (amplituda do ok. 1,4 m, długość fali ok. 42 m) dodawane do terenu tylko w ćwiartce C przez `createForest` (potok `buildWorld` i jego walidacja liczą na terenie bazowym). Wygaszane przy rzece (8 m + 22 m narastania), przy ścieżkach (2 m + 9 m) i przy obszarach wolnych (start, lądowiska mostu). Poza C przesunięcie jest dokładnie 0.
- Piasek: jaśniejsza, cieplejsza paleta, fale (zmiana jasności i pochylenie normalnej w shaderze, wygaszanie 22-70 m) według atrybutu wierzchołków `aDesert`.
- Sucha trawa w C: z tego samego mechanizmu kęp (odmiany wheat, wide, wispy).

Suwaki na żywo: w panelu `/dev/forest-pro` sekcja "Pro: pęknięcia, trawa, kwiaty" zmienia rozmiar komórki, szerokość, siłę i zasięg pęknięć oraz skalę trawy i kwiatów bez przeładowania lasu (skala trawy i kwiatów tylko w widoku: kolizje i generator bez zmian). "Kopiuj wartości" daje liczby do wpisania w `PRO_GROUND` i `PRO_TUNING`.

Ryzyka: koszt kęp trawy (więcej instancji), pętla Voronoi (9 komórek na piksel) na słabszych GPU (tylko w pobliżu kamery), wydmy a chodzenie (nachylenie ograniczone testem), duże głazy jako przeszkody na trasie testowej.

Test ręczny: strefa C (`?zone=c`): czy kępy trawy wyglądają jak w Preview_1/2 i jaka jest ich skala; pęknięcia płatami na piasku i na ścieżkach; formacje skalne i wydmy (nie powinny zasłaniać drogi ani mostu); FPS w trasie (porównaj z poprzednim raportem).

## Trasa i test wydajności

Adres: `http://localhost:3000/dev/forest-pro` (tylko development; w produkcji 404). Parametry: `zone=a|b|c|d` (start w strefie), `q=low|medium|high`, `seed=`, `stress=` (mniejsze okno), `preset=`, `hour=`.

Panel po prawej: przyciski stref (przenoszą gracza) i **"Test FPS: trasa przez 4 strefy i drogę"**. Trasa to pięć odcinków: okrąg o promieniu 26 m w środku każdej strefy (po 20 s) i przejście drogą główną od startu do mostu (do 60 s). Pierwsze 1,5 s każdego odcinka nie wchodzi do statystyk. Raport (przycisk "Kopiuj raport", JSON) ma dla każdego odcinka: średnie FPS, 1% low, medianę, p95, p99 i max czasu klatki, średnie draw calls i trójkąty, widoczne instancje, aktywne modele.

## Instrukcja testu ręcznego dla autora

1. `npm run dev`, otwórz `/dev/forest-pro?q=high`. Ładowanie całego lasu (generowanie, tekstura gruntu) może potrwać kilkanaście sekund.
2. Przejdź drogą od startu na zachodzie ku mostowi (WASD, mysz, Shift): sprawdź bruk (gęsty na początku i przy moście), przejścia stref przy (0, 0) i wygląd liści (kolory, wiatr).
3. Przycisk stref: obejrzyj A, B, C, D z bliska. Oceń, które modele są zbyt ponure lub realistyczne dla dzieci od 8 lat (martwe drzewa, grzyby `laetiporus`, nasycone kolory) i zapisz listę do wycięcia.
4. Uruchom "Test FPS: trasa przez 4 strefy i drogę" na `q=low`, `medium`, `high` i wklej raporty JSON; najciekawsze są różnice między strefą D (wszystko) a pozostałymi i odcinek `road`.
5. Zgłoś: miejsca, gdzie płyty bruku wchodzą w teren lub drzewa, migotanie liści, zbyt jasne/ciemne strefy (porównaj presety 4, 5, 6), FPS poniżej oczekiwań.

## Ryzyka

- **Liczba materiałów** wzrosła do 20 (wersja Standard miała mniej), więc w strefie D przybywa draw calls (jeden na model i materiał). Miarą jest raport trasy.
- **Ciężkie modele**: wiśnie (do 14,7 tys. trójkątów) i płyty bruku w dużej liczbie; ewentualnie rzadsze rozmieszczenie albo tylko LOD1 w oddali.
- **Kolory**: paczka ma nasycone, ręcznie malowane liście (różowe wiśnie, pomarańczowe brzozy); w ORIGINAL scena może być ciemniejsza niż NATURAL.
- **Wiek odbiorcy**: martwe drzewa i niektóre grzyby mogą być zbyt ponure; decyzja po obejrzeniu.
- **Czas generowania** całego lasu 300 x 300 m z pełnym katalogiem jest dłuższy niż okna 3 x 3; to jednorazowy koszt wejścia na trasę.
- Generator v3, kotwice questa i migracje zapisów są potrzebne dopiero przy włączaniu modeli Pro do gry (osobna decyzja).

## Pliki

- Potok: `scripts/assets/config.mjs`, `build-models.mjs`, `source-hashes.json`; dane: `public/models/**`.
- Generator (tylko tryb `pro`): `src/lib/game/world/generators/v2/{species,profiles,showcaseProfiles,vegetation,paving,pro,dunes,geometry,forest,index}.ts`.
- Widok: `src/lib/forest-view/{profiles,selector,window,disposition,instancer,ground,grading,renderer,proTour,index}.ts`.
- Trasa i UI: `src/app/dev/forest-pro/page.tsx`, `src/components/forest-proto/ForestPrototype.tsx` (parametr `pro`).
- Testy: `generators/v2/pro.test.ts`, `forest-view/proPrototype.test.ts`, `lib/assets/assets.test.ts`, `lib/assets/forest.assets.test.ts`.

## Domyślne ustawienia prototypu Pro (wybrane przez autora)

- Wygląd: preset ORIGINAL z gęstością mgły 1,5 (`PRO_DEFAULT_CONFIG`), godzina 12, jakość HIGH (nadal nadpisywane parametrami `?preset=`, `?hour=`, `?q=`).
- Pęknięcia (`PRO_GROUND`): komórka 0,25 m, linia 0,021 m, siła 0,53, pełne od 0 do 18 m.
- Skale: trawa 0,8, kwiaty 1,25 (generator); mnożniki widoku (`PRO_KIND_SCALE_DEFAULTS`): paprocie 2,34, rośliny runa 0,9, ozdoby 1, grzyby 0,73, krzewy 1,31.
- Zagłębienie bruku (`PATH_SINK_DEFAULT`): maks. 0,055 m, losowość 0,22.

## Las Pro w grze (generator v3, 22 października 2026)

- Nowe gry (`CURRENT_GEN_VERSION = 3`) używają lasu Pro w widoku gry: `ForestRenderer` w trybie streamingu dla `genVersion >= 3` włącza oryginalne kolory paczki, shader gruntu Pro (pęknięcia, piasek), atrybut pustyni, domyślne mnożniki skali i zagłębienie bruku oraz `PRO_DEFAULT_CONFIG` (godzinę ustala zegar gry). Zapisy v2 renderują się jak dotąd.
- Ładowanie: najpierw warstwa autorytatywna (kolizje) i las do rysowania porcjami z postępem w komunikacie ładowania, potem modele. Klucz pamięci płytek gruntu zawiera wersję generatora.
- Warstwa autorytatywna i kosmetyczna: patrz [decyzje.md](decyzje.md) i [swiat-generator.md](swiat-generator.md).
- Test ręczny dla autora: nowa gra, wejście do lasu przez tablicę ogłoszeń, przejście pierwszego questa (trzy skrzynie, troll, zbieranie drewna i kamienia, budowa mostu). Sprawdzić: czas ładowania lasu, FPS, czy wydmy w południowo-wschodniej ćwiartce nie blokują przejścia, czy zasoby na most są łatwe do znalezienia, wygląd kolorów paczki Pro dla dzieci od 8 lat.
- Pliki: `generators/v3/world.ts`, `world/lookup.ts`, `world/types.ts` (`WorldRef`), `forest-view/{renderer,streaming}.ts`, `testkit.ts` (`testWorldKey`); testy: `generators/v3/world.test.ts`, `world/proQuest.test.ts`.
