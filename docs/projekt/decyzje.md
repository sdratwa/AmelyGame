# Decyzje projektowe

## Zatwierdzone przez autora (plan v3 i uzupełnienia)

- Las 300 x 300 m, sektory logiczne 30 x 30 m (niewidoczne), deterministyczny generator z `worldSeed`, losowe skrzynie ze stałymi pozycjami w zapisie, depozyt trolla zamiast kary pieniężnej, blokady na zegarze gry.
- Wizualny prototyp jednego sektora wcześnie (V2) z docelowymi modelami; wspólne `terrainHeight(x, z)`; minimapa bazowa przed mechaniką skrzyń.
- Zgodność zapisów: `worldGenVersion` musi umożliwiać odtworzenie istniejącego świata po aktualizacji gry; zachowanie starszych generatorów lub bezpieczne migracje (nie wystarcza snapshot pozycji krytycznych). Realizacja: [swiat-generator.md](swiat-generator.md).
- Pauza czasu: centralny mechanizm powodów pauzy; zamknięcie jednego dialogu nie wznawia zegara, jeśli inny powód nadal go zatrzymuje. Realizacja: [architektura.md](architektura.md).
- Ekwipunek: `maxStack: 20` to wartość początkowa; system obsługuje większe ilości i pozwala dodać magazyn bez przebudowy silnika. Realizacja: [model-danych.md](model-danych.md).
- Modele: Quaternius Stylized Nature MegaKit zatwierdzony jako pierwszy kandydat do prototypu; przed pobraniem sprawdzić licencję i zawartość (zrobione, patrz [zasoby-3d.md](zasoby-3d.md)); alternatywy przy brakach; niczego nie kupować bez zgody autora.
- Reguły delegowania między modelami AI i subagentów: nie wdrażać teraz (osobna decyzja).

## Robocze (do ostatecznej akceptacji autora)

- `E`: interakcja, gdy obiekt w zasięgu; inaczej użycie zaznaczonego jedzenia.
- Czas gry zatrzymuje się podczas dialogów i zagadek (przez mechanizm powodów pauzy).
- Odrodzenie: narzędzia i surowce zostają, jedzenie może przepaść.
- Troll nie zabiera dodatkowo pieniędzy; po pierwszej przegranej konfrontacji dalsze interakcje tylko przez zagadki; po porażce gracz wraca na mapę miasta; depozyt odbieramy u trolla.
- Rzeka w przybliżeniu z północy na południe we wschodniej części lasu; start po zachodniej stronie.
- Surowce pierwszego questa skończone, zapas >= 3x.
- Stosy surowców, 8 slotów zostaje; domyślny `maxStack` 20 (konfigurowalny w danych).
- Odpowiedź na zagadkę wpisywana jako liczba.
- Most budowany tylko w wyznaczonym miejscu.
- Nagroda: 5000 zł i odznaka odkrywcy.
- Tablica: pierwszy quest i dwie zapowiedzi przyszłych zadań.
- Biblioteki pomocnicze (np. `@react-three/drei`) po uzasadnieniu; modele CC0 preferowane, CC-BY po sprawdzeniu atrybucji.
- Zapisujemy pozycję gracza w lesie.

## Otwarte

- Sprzęt referencyjny dla progów FPS (HIGH, LOW).
- Treść dwóch zapowiedzi na tablicy.
- Wygląd trolla (pod kątem dzieci od 8 lat).
- Skały S/M/L i paprocie: wariant A (skalowanie z Standard), B (inny darmowy pakiet CC0) czy C (płatna wersja Pro, wymaga zgody autora) - patrz [zasoby-3d.md](zasoby-3d.md).
- Piła: brak zweryfikowanego kandydata CC0.
- Przegląd drenażu życia pod kątem dzieci (zima: -1% co 5 s w nocy) - osobna propozycja; wartości na razie bez zmian.
