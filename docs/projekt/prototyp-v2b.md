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

`src/lib/forest-view/forestVisual.test.ts` (21 testów): ORIGINAL neutralny względem V2a, presety jako niezależne kopie, walidacja suwaków i JSON, mgła, jasność pni i sosen o 7:00 / 12:00 / 19:00 (cień, kontrast, brak przepalenia, spód koron), łagodniejsze cienie, ograniczenia ekspozycji i światła, krzywa letnia (słońce nad horyzontem, ciągłość), uspokojenie zieleni, różnice gatunków, suwak nasycenia tylko dla zieleni, shadery (wstawki tylko tam, gdzie trzeba, uniformy aktualizowane w miejscu), grunt (determinizm, brak zielonego dywanu, kontrast ścieżki). Poza testami jednostkowymi składane shadery (Standard i Lambert, sosna / krzew / trawa / kora / skały / grunt) przeszły kompilator `glslangValidator` w harnessie ES 3.0 (jednorazowo, nie jest częścią CI).

## Ryzyka i do sprawdzenia przez autora

1. Wygląd nie był oglądany: progi jasności są liczone modelem uproszczonym; możliwe, że NATURAL jest odrobinę za jasny w cieniu lub FAIRYTALE za mglisty (suwaki i JSON służą do korekty).
2. Pochylenie normalnych liści i zmienność jasności zmieniają charakter cieniowania koron (mniej "kartek"); jeśli sylwetki wydadzą się płaskie, zmniejsz `up` w palecie.
3. Dodatkowa praca w shaderach liści i gruntu (kilkanaście operacji, na gruncie 3 szumy z wygaszaniem po 14-46 m): bez pomiaru nie deklarujemy wpływu na FPS.
4. Drugi styl tekstury gruntu zajmuje dodatkową pamięć (np. 2048 px: ok. 16 MB + mipmapy) po pierwszej zmianie presetu.
5. Kolory pomarańczowe i czerwone w atlasie trawy i liści (niektóre pasma UV) nie są zmieniane poza nasyceniem i mnożnikiem: jeśli któryś model je pokaże, to kandydat do przekolorowania w kolejnej iteracji.
6. Woda i niebo nie były strojone; niebo o 19:00 w modelu letnim ma teraz pełną poświatę słońca i cząstki (w V2a ich nie miało).
