# Animowany jeleń w lesie (pierwszy zwierzak)

Jeden jeleń w normalnej grze (las 3D po wejściu z miasta). To test, nie system fauny: warstwa prezentacji nie dotyka silnika, `SaveV2`, generatora świata ani `MIASTO_DEFAULT`.

## Jak znaleźć jelenia

1. Wejdź do lasu z miasta (start w punkcie wejścia, patrzysz na wschód).
2. Idź prosto przed siebie, na wschód, ok. 21-29 m. Jeleń stoi na polanie (przykład dla seeda 1: x = -101, z = 2; wejście to x = -126, z = 0). Położenie zależy od seeda świata, ale jest stałe dla danego seeda.
3. Panel diagnostyczny (O albo F3) pokazuje w sekcji "Jeleń" jego x/z, odległość od gracza i stan.
4. Po zbliżeniu się na mniej niż 10 m jeleń staje, patrzy na gracza, po chwili spokojnie odchodzi w bezpieczną stronę. Po oddaleniu wraca do spacerowania wokół polany.

## Zasób

- Źródło: `assets/source/deer_cartoon_3d_model.glb` (zachowane bez zmian).
- Potok: `npm run assets:deer` (`scripts/assets/build-deer.mjs`) -> `public/characters/deer.forest.glb` (ok. 0,93 MB) + wpis `deer.forest` w `characters.json` (wpis trolla nietknięty).
  - Zmiany: nazwy węzła i materiału (`Deer_Body`, `Deer`), tekstury JPEG -> WebP (1024 px), weryfikacja, że trójkąty, kości i klipy są bez zmian.
- Model: 1 siatka skinned, 19 798 trójkątów, 41 kości, jeden klip `preset:quadruped:walk`. Brak Idle i galopu.
- Orientacja: przód -X, góra +Y, lewa strona +Z (manifest: `forward: "-x"`). Grupa jest obracana o `yaw + pi/2`.
- Skala: wysokość 1,8 m (sylwetka z porożem; grzbiet ok. 1 m, długość ok. 1,4 m).

## Animacja

- Spoczynek: syntetyczny stały klip `deer.rest` zbudowany z pozy bazowej (stabilna pozycja stojąca, nogi nieruchome). Przejścia wagami `NpcAnimator` (0,4-0,45 s).
- Chód: oryginalny klip Walk, prędkość skalowana do prędkości ruchu (nominalnie ok. 0,92 m/s), bez ruchu korzenia (`stripRootMotion`).
- Głowa: kość `tripoHead_0` w pozie bazowej patrzyła w bok. Korekta neutralna: yaw -83 stopni, pitch -12 stopni (lokalne mnożenie `restWorld^-1 * R * restWorld`).
- Rozglądanie (`src/lib/npc/headRig.ts`): sprężyna krytycznie tłumiona, losowe spojrzenia lewo/prawo (w spoczynku do 0,45-0,8 rad, w marszu 0,25-0,45), pitch do 0,14 rad, powrót do neutralnej pozy; rozdział na głowę (65%) i szyję (35%). W alercie głowa śledzi gracza (limity yaw 1,15, pitch 0,2).
- Stopy: klip stawia tylne kopyta ok. 0,1 m niżej niż przednie, więc w marszu ciało jest pochylone o ok. 9,4 stopnia (`balancedTilt`) plus przesunięcie z `lowestPointOver`. Pochylenie względem terenu liczone z próbek przód/tył (limit 0,45 rad). W symulacji kopyta są w granicach -1,6 cm od terenu.

## Zachowanie (`src/lib/npc/deerBrain.ts`)

| Tryb | Opis |
| --- | --- |
| odpoczywa | stoi, rusza głową |
| spaceruje | cele w promieniu 4,5 m od domu, prędkość 0,85x nominalnej, cele poza strefą alertu gracza |
| czujny | gracz < 10 m (powrót do spokoju > 13 m); stoi, patrzy na gracza 1,6-2,6 s |
| odchodzi | idzie (1,25x nominalnej, bez galopu) do bezpiecznego punktu: wachlarz kątów, odległości 9/6/4 m, min. +2,5 m od gracza, do 24 m od domu |

Gdy brak bezpiecznej drogi, jeleń stoi i patrzy ("osaczony"). Każdy krok jest sprawdzany: środek + 8 punktów pierścienia 0,7 m przez `WalkWorld.isWalkable` (drzewa, skały, rzeka, nachylenie, granice mapy), dodatkowo `segmentFree` dla odcinków. Jeleń blokuje gracza kołem 0,65 m.

## Położenie (deterministyczne)

`src/lib/forest-view/deer.ts`, `computePlacement`: wyłącznie z danych lasu (`forestOf`, `forestWalkOf`, `anchorsFromFeatures`) i strumienia `rngStream(seed, ...)`. Pierścienie 21-29 m od wejścia (poziomy łagodzenia aż do 15-36 m), co 5 stopni. Warunki: osiągalność BFS, wolna przestrzeń, nachylenie, >= 12 m od skrzyń, trolla i mostu. Wynik: odległość od środka polany, kierunek zbliżony do wschodu, widoczność z wejścia. Przetestowane 120 seedów (brak braku miejsca w testach pomiarowych: 48 seedów, 46 na poziomie 0). Brak zmian w generatorze, zapisie i wersji generatora.

## Panel diagnostyczny (O / F3)

Sekcja "Jeleń" (`data-testid="deer-diagnostics"`): dystans, stan, klip/stan animacji i czas, mieszanie, prędkość, skala, wysokość, trójkąty, kości, x/z, odległość od wejścia i środka mapy, głowa (patrzy/yaw/pitch), liczba odejść. Błąd ładowania jest pokazany w linii błędu, a gra działa dalej.

## Wydajność (MEDIUM i HIGH)

Z testu `deer.test.ts`: 1 skinned mesh, 41 kości, 19 798 trójkątów (x2 z przejściem cienia), ok. 16,8 MB pamięci tekstur (3 x 1024^2 po zdekodowaniu z mipmapami), koszt CPU aktualizacji pomijalny (< 3 ms średnio). Przebieg animacji identyczny dla MEDIUM i HIGH (profil zmienia tylko cienie). LOW: bez cieni. Poza 140 m jeleń jest ukryty i zamrożony. FPS ocenia autor w przeglądarce.

## Testy

`src/lib/assets/deer.test.ts`, `headRig.test.ts`, `deerBrain.test.ts`, `src/lib/forest-view/deer.test.ts`: zasób i manifest, głowa, mózg, położenie na 120 seedach, determinizm, brak zmian świata, kopyta/teren, MEDIUM/HIGH, izolacja od silnika i zapisu.

## Ryzyka

- Brak galopu i Idle: ucieczka to szybszy marsz; spoczynek to poza bazowa.
- Pochylenie ciała w marszu (ok. 9 stopni) wynika z klipu; do oceny wizualnej.
- Pamięć tekstur ok. 16,8 MB.
- Wygląd i FPS nie były oceniane w przeglądarce.
