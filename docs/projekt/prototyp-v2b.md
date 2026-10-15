# Prototyp V2b - jakość wizualna lasu

Rozszerzenie `/dev/forest` (V2a zatwierdzone technicznie: M3 Max, HIGH, `?stress=49`: średnio 60 FPS, 1% low 56,8 FPS, ok. 2,35 mln trójkątów, 106 draw calls). V2b zmienia wyłącznie wygląd: światło, cienie, kolory materiałów i grunt. Nie zmienia generatora W1a, `worldGenVersion`, zapisów, liczby ani pozycji obiektów, manifestu ID modeli, profili jakości, zasięgów ani LOD. Liczby trójkątów i draw calls się nie zmieniają (te same instancje i siatki).

**Czego nie sprawdzono:** wyglądu i FPS w przeglądarce. Wyniki poniżej to szacunek ze wzorów shaderów (Lambert + półsfera + ACES) i test kompilacji GLSL; ostateczna ocena wyglądu należy do autora. Wpływu V2b na FPS nie mierzono (dochodzi niewielka ilość pracy w shaderach liści i gruntu); pomiar `Uruchom test` po stronie autora.

## Dlaczego drzewa były prawie czarne

1. **Tekstury liści są płaskie i ciemne.** `leaf_pine_c` to jeden kolor (50, 87, 0), czyli luminancja liniowa 0,075; `leaves_normaltree_c` (88, 123, 1) to 0,16. Czerwone liście starych drzew i krzewu po zamianie kanałów R i G dają (23, 167, 24), czyli 0,28: czysta, bardzo nasycona zieleń, kilka razy jaśniejsza od sosny. Różnice między gatunkami wynikały z tekstur, a nie z intencji.
2. **Cienie były twarde i pełne.** W Three 0.186 `PCFSoftShadowMap` został usunięty; renderer cicho wracał do PCF o promieniu 1 teksela (twardy brzeg), z pełnym zasłanianiem słońca (`intensity` 1). Gęste, dwustronne karty liści zasłaniają się nawzajem, więc wnętrze korony dostawało tylko światło otoczenia.
3. **Światło otoczenia było małe, a cienie bez odbicia.** Cień dostawał ok. 0,2 albedo, a odbicie od ziemi było słabe. ACES dodatkowo dociskał ciemne wartości.
4. **Krzywa słońca V2a:** 19:00 leżało pod horyzontem (wschód 6:00, zachód 18:00); scena była oświetlana "lustrzanym" słońcem bez tarczy i pyłków. 7:00 miało słońce na ok. 15 stopniach i mało światła otoczenia.
5. **Co było w porządku (sprawdzone):** przestrzenie kolorów tekstur (albedo sRGB, normalne liniowe), `baseColorFactor` ustawiany jako liniowy, kolory wierzchołków pni (średnio 0,95, nie czerń), `metalness` 0 / `roughness` 1, materiały zgodne z oświetleniem Three.js (Standard i Lambert). Nie było błędu przestrzeni kolorów ani brakujących normalnych.

## Szacowana jasność (0-255, sRGB po tone mappingu; godziny 7:00 / 12:00 / 19:00)

Powierzchnia "cień" to strona odwrócona od słońca i zasłonięta przez inne obiekty (najgorszy przypadek).

| Powierzchnia | ORIGINAL | NATURAL | FAIRYTALE |
|---|---|---|---|
| sosna, góra | 8 / 58 / 7 | 77 / 116 / 62 | 85 / 122 / 68 |
| sosna, cień | 1 / 4 / 1 | 49 / 51 / 37 | 57 / 59 / 44 |
| pień, strona słoneczna | 44 / 64 / 39 | 110 / 103 / 94 | 113 / 107 / 97 |
| pień, cień | 2 / 8 / 2 | 47 / 44 / 36 | 54 / 51 / 42 |
| liście dębu, cień | 4 / 13 / 3 | 65 / 67 / 50 | 82 / 85 / 64 |
| krzew, góra | 34 / 126 / 30 | 80 / 119 / 64 | 97 / 135 / 79 |

Stosunek słońce/cień pnia w południe spadł z ok. 8 do ok. 2,3. Nic nie przekracza 235 w żadnym kanale (test). Estymator pomija AO z wierzchołków, odbicia i mgłę, więc służy do porównań między presetami.

## Co się zmieniło

**Światło i cienie** (`renderer.ts`, `atmosphere.ts`, `visual.ts`)
- Cienie: usunięty martwy `PCFSoftShadowMap`; w presetach NATURAL i FAIRYTALE `shadow.radius` 2,6 teksela (miękki brzeg PCF), `shadow.intensity` 0,55 / 0,45 (część słońca przechodzi przez cień), `normalBias` 0,07 (mniej akne na dwustronnych kartach), `bias` -0,0003. Rozdzielczość i zasięg mapy cieni bez zmian (koszt cieni ten sam).
- Światło otoczenia: mnożnik `ambient` 1,75 / 1,95; ciepłe odbicie od ziemi (`groundBounce` 1,7 / 1,8); ekspozycja 1,10 / 1,15; słońce 0,9 / 0,85. Ambient nie dominuje nad słońcem w południe (test: stosunek < 0,85).
- Nowa krzywa pory dnia ("lato"): wschód 5:00, zachód 21:00, więc 7:00 i 19:00 to złota godzina ze słońcem ok. 21 stopni, ciepłym kolorem i światłem z nieba. ORIGINAL zachowuje krzywą V2a.

**Materiały** (`grading.ts`, `instancer.ts`): korekta koloru w shaderze, sterowana uniformami (nie ma rekompilacji ani kopiowania materiałów przy zmianie presetu).
- Kolor docelowy płaskich liści z zachowaniem luminancji tekstury: sosna chłodna ciemna zieleń, drzewa liściaste świeża żółtawa zieleń, krzewy i stare drzewa oliwkowa zieleń; różnice jasności i odcienia między gatunkami są sprawdzane testem.
- Mnożniki jasności kory i skał, spokojniejsza trawa i liście roślin, kwiaty nasycone umiarkowanie (suwak nasycenia zieleni działa tylko na zielone piksele: kwiaty i kora zostają).
- Normalne kart liści pochylone ku górze (jaśniejszy spód koron, mniej cienia na kartach), delikatna zmienność jasności na kartach i między instancjami (sosny nie są płaską plamą).
- Zamiana kanałów R/G (czerwone -> zielone) zostaje tylko w ORIGINAL; w pozostałych presetach czerwone liście dostają paletę (kolory pomarańczowe, niebieskie i różowe w atlasach zostają na strefy magiczne).
- Wiatr i przyciemnienie nasady roślin bez zmian.

**Grunt** (`ground.ts`, `renderer.ts`): bez zmian w generatorze W1a i w siatce.
- Styl `natural` tekstury: płaty trawy w ściółce zamiast jednolitego dywanu (udział "zielonych" pikseli ok. 30% zamiast 95% w V2a, test), ściółka liści i igły pod sosnami (osobny pędzel), płaty ziemi i mchu z zakrzywionymi (warpowanymi) granicami, drobne liście i kamyki, stonowana zieleń.
- Ścieżki: jaśniejsza ubita ziemia (kontrast z otoczeniem w teście), szerokie, nierówne przejście do wydeptanej trawy.
- Szum szczegółu w shaderze (współrzędne świata, wygaszany z odległością) dodaje subtelne zmiany koloru i tekstury z bliska bez zwiększania tekstury.
- Tekstury obu stylów są trzymane w pamięci; drugi styl buduje się porcjami przy pierwszej zmianie presetu (kilkaset ms rozłożone na klatki, bez blokowania; bez ekranu ładowania), powrót jest natychmiastowy.

## VISUAL TUNING (panel po prawej)

Suwaki: ekspozycja, światło otoczenia, słońce, intensywność cieni, nasycenie zieleni, gęstość mgły, kolor mgły (próbnik + udział koloru). Presety: ORIGINAL (V2a), NATURAL, FAIRYTALE; zmiana jednego suwaka oznacza preset jako zmieniony. Przyciski: Reset do presetu, Kopiuj JSON, Wczytaj (wklejenie JSON). Szybkie godziny 7:00 / 12:00 / 19:00.

Skróty: 4 / 5 / 6 presety ORIGINAL / NATURAL / FAIRYTALE, 7 / 8 / 9 godziny 7:00 / 12:00 / 19:00 (1/2/3 jakość, `[` i `]` godzina, F mgła, H cienie, L LOD). URL: `?preset=original|natural|fairytale&hour=7`.

Domyślny preset to NATURAL. Przełączanie presetów zmienia tylko uniformy shaderów, światła, mgłę i teksturę gruntu: bez przeładowania modeli i bez generowania świata. Jedyna jednorazowa praca to zbudowanie drugiego stylu tekstury gruntu.

### Format JSON (`forest-visual/1`)

```json
{
  "format": "forest-visual/1",
  "preset": "NATURAL",
  "modified": false,
  "hour": 12,
  "quality": "HIGH",
  "tuning": { "exposure": 1.1, "ambient": 1.75, "sun": 0.9, "shadow": 0.55, "greenSaturation": 0.85, "fogTint": "#cfe0d2", "fogTintAmount": 0.3, "fogDensity": 0.9 },
  "look": { "dayModel": "summer", "shadowBias": -0.0003, "shadowNormalBias": 0.07, "shadowRadius": 2.6, "groundBounce": 1.7, "groundStyle": "natural", "groundDetail": 0.12, "particleBoost": 1, "palette": { "...": "korekta każdego materiału" } }
}
```

`look` zawiera parametry, których nie ma w panelu (paleta materiałów, krzywa dnia, parametry cieni). Wczytanie przycina wartości do zakresów i odrzuca niepoprawny JSON.

## Testy

`src/lib/forest-view/forestVisual.test.ts` (29 testów, w tym migotanie trawy): ORIGINAL neutralny względem V2a, presety jako niezależne kopie, walidacja suwaków i JSON, mgła, jasność pni i sosen o 7:00 / 12:00 / 19:00 (cień, kontrast, brak przepalenia, spód koron), łagodniejsze cienie, ograniczenia ekspozycji i światła, krzywa letnia (słońce nad horyzontem, ciągłość), uspokojenie zieleni, różnice gatunków, suwak nasycenia tylko dla zieleni, shadery (wstawki tylko tam, gdzie trzeba, uniformy aktualizowane w miejscu), grunt (determinizm, brak zielonego dywanu, kontrast ścieżki). Poza testami jednostkowymi składane shadery (Standard i Lambert, sosna / krzew / trawa / kora / skały / grunt) przeszły kompilator `glslangValidator` w harnessie ES 3.0 (jednorazowo, nie jest częścią CI).

## Migotanie trawy (poprawka po testach wizualnych)

**Objaw.** W NATURAL i FAIRYTALE (nie w ORIGINAL) źdźbła konkretnych kęp przy minimalnej zmianie kąta patrzenia przełączały się z jasnozielonych na prawie czarne.

**Modele i materiał.** Cztery modele: `grass.common_short`, `grass.common_tall`, `grass.wispy_short`, `grass.wispy_tall`, wszystkie z jednym materiałem `grass` (`DoubleSide`, bez normal mapy, bez alfa, bez kolorów wierzchołków w użyciu). Tylko te modele używają materiału `grass`. Trawa nie rzuca cieni (`SHADOW_CASTERS` = drzewa, skały, krzewy), więc cienie własne trawy nie wchodzą w grę.

**Dane geometrii** (`grassGeometry.test.ts`, odczyt GLB): normalne wszystkich wierzchołków trawy wskazują w górę (+Y, min. Ny 0,94 w `wispy_short`, 1,00 w pozostałych), a kierunek trójkątów (CCW) rozmija się z tymi normalnymi w 81 z 155 trójkątów `common_short`, 238 z 326 `common_tall`, 38 z 494 `wispy_short` i 29 z 622 `wispy_tall`. Modele z materiałami `leaves` i `flowers` mają zgodny kierunek trójkątów (0 rozbieżności we wszystkich 15 modelach).

**Przyczyna (dwa mechanizmy, drugi tylko w NATURAL i FAIRYTALE).**

1. Three.js dla `DoubleSide` mnoży normalną przez `faceDirection` (`gl_FrontFacing`). Cienkie źdźbło ma więc normalną +Y z jednej strony trójkąta i -Y z drugiej: strona od słońca nie dostaje światła kierunkowego, a półkula daje jej najciemniejszy kolor gruntu. Którą stroną patrzy kamera, decyduje kierunek trójkąta, a ten jest dla trawy niespójny z normalnymi. Przy ruchu kamery piksele przełączają się między stronami.
2. V2b dodał dla trawy pochylenie normalnej ku górze `mix(normal, up, uUp)` z `up = 0,5`. Dla normalnej -Y z tylnej ścianki daje to dokładnie wektor zerowy, a `normalize(0)` jest niezdefiniowane w GLSL (NaN, czarne piksele, niestabilne przy minimalnym ruchu). ORIGINAL ma `up = 0`, więc tylna strona jest tylko ciemna (-Y), bez zerowania, dlatego tam błąd był łagodniejszy.

Wiatr (przesuwa tylko pozycję wierzchołków, normalne zostają) i cienie własne (trawa nie rzuca cieni) nie mogą tego wywołać; odbiór cienia drzew przez trawę zostaje. Z-fighting nie był badany geometrycznie (nakładanie współpłaszczyznowych trójkątów), ale wybierałby między dwiema powierzchniami tego samego koloru, więc nie tłumaczy przełączania jasnozielony - prawie czarny; do potwierdzenia w trybie diagnostycznym ("Strona trójkąta").

**Naprawa** (`grading.ts`, `disposition.ts`, `instancer.ts`):

- materiał `grass` (zbiór `STABLE_NORMAL`) dostaje jedną, stabilną normalną z wierzchołków niezależną od strony trójkąta (`normal = normalize(vNormal)` zamiast odwracania), więc źdźbło jest oświetlone tak samo z obu stron; strona przednia wygląda dokładnie jak przedtem;
- `NORMAL_UP_FRAGMENT` (wszystkie liście) ma zabezpieczenie: gdy mieszanie daje wektor o długości < 0,02, normalną jest kierunek "w górę" zamiast `normalize(0)`;
- `receiveShadow` zostaje włączone dla trawy (cienie drzew padają na trawę), cienie, wiatr i ekspozycja nie są zmieniane; liście i kwiaty (`leaves`, `flowers`) nie dostają stabilnej normalnej, tylko zabezpieczenie przed zerem (matematycznie nieosiągalne dla ich `up` = 0,3-0,45, więc wyglądają jak przedtem).

Nie zmieniono generatora, rozmieszczenia, seedów, zapisów, manifestu, presetów ani paczki parametrów (`up` trawy nadal 0,5).

**Tryb diagnostyczny (tymczasowy).** Przycisk "Laboratorium trawy (diagnostyka)" w panelu `/dev/forest` albo `?lab=grass[&labModel=grass.common_tall]`. Kępa (albo grupa kęp, albo wszystkie cztery modele w rzędzie) z bliska na płaskim podłożu, kamera orbitalna (przeciągnięcie myszą, kółko, suwaki z krokiem 0,5° i przyciski ±1°, tryb "Drżenie ±2,5°" oraz "Obrót"). Przełączniki: cieniowanie (materiał lasu / czysty `MeshStandardMaterial` bez modyfikacji shaderów / normalne po odwróceniu strony / strona trójkąta: zielony front, czerwony tył), poprawka normalnych (`uFix`: wył. odtwarza błąd), cienie globalnie, `receiveShadow` tylko dla trawy, wiatr, słupek rzucający cień na kępę. Do usunięcia po ocenie (pliki: `grassLab.ts`, `GrassLabPanel.tsx`, kilka linii w `renderer.ts` i `ForestPrototype.tsx`; uniform `uFix` można wtedy zostawić na stałe jako 1).

**Jak to sprawdzić w przeglądarce** (kolejność z przełącznikami): (1) preset NATURAL, "Materiał lasu", poprawka wył., "Drżenie": migotanie widać; (2) "Strona trójkąta" wskazuje granice stron, przy których zmienia się światło; (3) cienia wył./wł. i wiatr wył./wł.: migotanie zostaje (cienie i wiatr nie są przyczyną); (4) "Bez modyfikacji shaderów": brak NaN, ale tylna strona nadal ciemna zależnie od strony (czysty Three.js ma ten sam mechanizm odwracania); (5) poprawka wł.: źdźbła mają stałą jasność z obu stron.

**Wpływ na wydajność.** Liczba instancji, trójkątów, draw calls, tekstur i pamięci bez zmian. Dodatkowa praca GPU tylko w fragment shaderze liści: jedno porównanie z uniformem i jedno `dot` (zabezpieczenie), w trawie dodatkowo jedno `normalize(vNormal)`; bez gałęzi zależnych od danych (uniform, więc spójne w całej klatce). FPS nie był mierzony; tryb diagnostyczny po wyłączeniu nie wykonuje żadnej pracy w pętli renderowania poza jednym sprawdzeniem wskaźnika.

**Testy.** `forestVisual.test.ts` (matematyka normalnej przed i po poprawce: NaN na tylnej stronie przy `up` = 0,5, identyczna normalna obu stron po poprawce dla wszystkich presetów, brak zmian dla `leaves`/`flowers`/drzew; zakres wstawek shaderów; współdzielony `uFix`) i `grassGeometry.test.ts` (dane modeli). Złożone shadery `grass` i `leaves` (Standard) przeszły ponownie `glslangValidator` (jednorazowo, poza CI).

## Ryzyka i do sprawdzenia przez autora

1. Wygląd nie był oglądany: progi jasności są liczone modelem uproszczonym; możliwe, że NATURAL jest odrobinę za jasny w cieniu lub FAIRYTALE za mglisty (suwaki i JSON służą do korekty).
2. Pochylenie normalnych liści i zmienność jasności zmieniają charakter cieniowania koron (mniej "kartek"); jeśli sylwetki wydadzą się płaskie, zmniejsz `up` w palecie.
3. Dodatkowa praca w shaderach liści i gruntu (kilkanaście operacji, na gruncie 3 szumy z wygaszaniem po 14-46 m): bez pomiaru nie deklarujemy wpływu na FPS.
4. Drugi styl tekstury gruntu zajmuje dodatkową pamięć (np. 2048 px: ok. 16 MB + mipmapy) po pierwszej zmianie presetu.
5. Kolory pomarańczowe i czerwone w atlasie trawy i liści (niektóre pasma UV) nie są zmieniane poza nasyceniem i mnożnikiem: jeśli któryś model je pokaże, to kandydat do przekolorowania w kolejnej iteracji.
6. Woda i niebo nie były strojone; niebo o 19:00 w modelu letnim ma teraz pełną poświatę słońca i cząstki (w V2a ich nie miało).
