# Zasoby 3D: strategia, pakiety, licencje

Stan weryfikacji: 15 października 2026 (źródła w sekcji "Źródła"). Do repozytorium nie dodano jeszcze żadnych modeli.

## Zasady

- Preferujemy gotowe modele GLB/glTF z licencją dopuszczającą użycie komercyjne i dystrybucję. Preferowane CC0. CC-BY dopiero po sprawdzeniu warunków atrybucji i zapisaniu ich tutaj.
- Nic nie pobieramy z niezweryfikowanych źródeł i nic bez zatwierdzenia pakietu przez autora. Niczego nie kupujemy bez zgody autora.
- Każdy model ma wpis w `public/models/manifest.json`: id, plik, pakiet, źródło (URL), autor, licencja, atrybucja, trójkąty, `placeholder`, `approvedAt`. Obok plików przechowujemy tekst licencji pakietu.
- Placeholdery proceduralne wyłącznie do testów mechaniki, oznaczone `placeholder: true`; nie prezentujemy ich jako ukończonej grafiki. Docelowy las nie powstaje z prostych brył.
- Wygląd rozdzielony od gry: kolizje pochodzą z profili colliderów wersji generatora, więc wymiana modeli nie psuje zapisów (patrz [swiat-generator.md](swiat-generator.md)).
- Optymalizacja: GLB przez `gltf-transform` (uruchamiany przez `npx`, bez dodawania do zależności produkcyjnych), tekstury <= 1024 px, Draco/meshopt.

## Zatwierdzony pierwszy kandydat: Quaternius "Stylized Nature MegaKit"

- Autor: Quaternius. Wydanie: lipiec 2024 (strona producenta), ostatnia aktualizacja na itch.io ok. miesiąc temu.
- Licencja: CC0 1.0 (Public Domain Dedication), potwierdzona na stronie producenta i w pliku `License_Standard.txt` wersji Standard. Atrybucja niewymagana (zalecane podziękowanie w ekranie autorów).
- Wersje: Standard (darmowa, 68 z 116 modeli, pay-what-you-want od 0), Pro 9,99 USD (wszystkie modele), Source 14,99 USD (+ projekty silników). Żadnej płatnej wersji nie kupujemy bez zgody autora.
- Format: glTF/FBX/OBJ; modele teksturowane (maskowane liście, kolory wierzchołków), styl "Ghibli".
- Uwaga: shadery wiatru są tylko w wersji Source; ruch liści zrobimy własnym shaderem (opcjonalnie, później).

### Zawartość wersji Standard (glTF, 68 modeli; lista z publicznego lustra plików, do potwierdzenia po pobraniu)

- Drzewa (20): `CommonTree_1..5`, `Pine_1..5`, `TwistedTree_1..5`, `DeadTree_1..5`.
- Krzewy i runo: `Bush_Common`, `Bush_Common_Flowers`, `Fern_1` (jedna paproć), `Plant_1`, `Plant_1_Big`, `Plant_7`, `Plant_7_Big`, `Clover_1..2`, `Grass_Common_Short/Tall`, `Grass_Wispy_Short/Tall`, kwiaty (`Flower_3/4`, `Petal_1..5`), grzyby (`Mushroom_Common`, `Mushroom_Laetiporus`).
- Skały: `Rock_Medium_1..3`, otoczaki `Pebble_Round_1..5`, `Pebble_Square_1..6`, elementy ścieżek `RockPath_Round_*` i `RockPath_Square_*` (po 5).

### Braki względem potrzeb prototypu

- Skały: w Standard są tylko 3 modele średnie plus drobne otoczaki; brak jawnych skał małych i dużych (w pełnym zestawie jest 27 skał). Potrzebujemy trzech klas S/M/L (1/2/5 kamienia).
- Paprocie: tylko `Fern_1`; do zagęszczenia runa dochodzą `Plant_*` i trawy (kryterium prototypu: >= 2 modele paproci/roślin runa jest spełnione).
- Piła, kilof, skrzynia, most, troll i postać nie należą do tego pakietu.

### Propozycje rozwiązania braku skał S/M/L (do decyzji autora, bez zakupów)

A. Wersja Standard + skalowanie: `Rock_Medium_1..3` skalowane (np. x0,5 mała, x1 średnia, x1,8 duża) i otoczaki jako dekoracja. Zero kosztu; ryzyko powtarzalności kształtu - ocena w prototypie (G2).
B. Standard + darmowe skały CC0 z innego pakietu (np. Kenney "Nature Kit", CC0, styl prostszy; ryzyko niespójności stylu) - sprawdzić w prototypie.
C. Wersja Pro MegaKit (9,99 USD, wszystkie 116 modeli, w tym pełny zestaw skał i paproci) - wymaga wyraźnej zgody autora; nie kupuję bez niej.
Rekomendacja: A w prototypie; decyzja o B/C po G2, jeśli skały będą słabym punktem.

## Pozostałe kandydaci (wymagają osobnej akceptacji)

- Kenney "Nature Kit" (CC0, ok. 330 modeli; m.in. `bridge_wood` 220 trójkątów, `bridge_wood_round` 336): most, kłody, pnie, ewentualnie skały. Styl prostszy niż MegaKit.
- Kenney "Survival Kit" (CC0, ok. 70-80 modeli; skrzynia `chest` 322 trójkąty): skrzynia, ewentualnie narzędzia.
- Quaternius "Pickaxe Wood" (CC0): kilof. Piła: brak zweryfikowanego kandydata.
- Troll: Quaternius "Orc" (CC0, ok. 4,3 tys. trójkątów, animowany) lub "Big T" (Polygonal Mind, CC0). Odrzucony: "Troll Doodle" (CC-BY, wymaga atrybucji). Wygląd musi być odpowiedni dla dzieci od 8 lat.
- Postać gracza: Quaternius "Universal Base Characters" (CC0, śr. ok. 13 tys. trójkątów - do zmniejszenia) lub KayKit "Adventurers" (CC0, low poly, rigged).
- Tekstury gruntu i niebo (CC0, np. Poly Haven, ambientCG): konkretne pliki i licencje do potwierdzenia przy wyborze.

## Proces pobrania (po akceptacji)

1. Autor zatwierdza pakiet (i warianty, np. A/B/C powyżej).
2. Pobranie wyłącznie z oficjalnego źródła do katalogu tymczasowego; zapis tekstu licencji.
3. Wyodrębnienie potrzebnych GLB, optymalizacja, wpisy w manifeście, skrypt sprawdzający kompletność manifestu.
4. Modele dopiero wtedy trafiają do `public/models/`.

## Źródła (sprawdzone 15.10.2026)

- https://quaternius.com/packs/stylizednaturemegakit.html
- https://quaternius.itch.io/stylized-nature-megakit (oraz strona `/purchase`: wersje Standard, Pro, Source i ceny)
- `License_Standard.txt` i lista plików glTF wersji Standard w publicznym lustrze repozytorium (informacyjnie; autorytatywna jest paczka z oficjalnego źródła)
- https://kenney.nl/assets/nature-kit, https://kenney-assets.itch.io/survival-kit
- https://poly.pizza/m/Ip2iXOq381, https://poly.pizza/m/5vO2YJsPEf, https://poly.pizza/m/Q3g8BKnXHA
- https://quaternius.com/packs/universalbasecharacters.html, https://kaylousberg.itch.io/kaykit-adventurers
