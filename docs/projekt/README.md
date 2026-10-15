# Miasto - dokumentacja projektowa (etap 1)

Dokumenty opisują zatwierdzony plan etapu 1 ("Most do nieznanego" jako pierwszy quest i samouczek). Opis stanu gry sprzed etapu 1 jest w [../opis-gry.md](../opis-gry.md).

## Spis

- [architektura.md](architektura.md) - moduły, komendy i zdarzenia, pauza czasu, dane vs kod.
- [model-danych.md](model-danych.md) - stan gry, ekwipunek i kontenery, skrzynie, depozyt trolla, docelowy zapis.
- [swiat-w0.md](swiat-w0.md) - rdzeń świata po W0: współrzędne i sektory, teren, indeks przestrzenny, walkable, punkty i strefy.
- [zapis-gry.md](zapis-gry.md) - system zapisu po E1: SaveV1, SaveStore, migracje, kopie, autosave, generator v1.
- [swiat-generator.md](swiat-generator.md) - las 300x300 m, sektory, `terrainHeight`, walidator, zgodność wersji generatora.
- [quest-bridge-01.md](quest-bridge-01.md) - quest "Most do nieznanego".
- [plan-testow.md](plan-testow.md) - testy mechanik, generatora, zapisu.
- [zasoby-3d.md](zasoby-3d.md) - modele 3D po V1: pakiet i licencja, wybrane modele, potok optymalizacji, manifest, ładowanie w R3F, ograniczenia.
- [wydajnosc.md](wydajnosc.md) - budżety, profile jakości, pomiary.
- [prototyp-lasu.md](prototyp-lasu.md) - wizualny prototyp sektora 30x30 m i jego kryteria.
- [decyzje.md](decyzje.md) - decyzje zatwierdzone i robocze, sprawy otwarte.

## Proces

Praca etapami; po każdym większym etapie: zmienione pliki, funkcjonalności, wyniki testów, problemy i ryzyka, proponowany kolejny etap. Zatrzymanie do zatwierdzenia przed kolejnym etapem. Szczegóły i zależności w planie (sekcja "Kolejność" poniżej).

## Status

- Faza A (dokumentacja i reguły): zrobione.
- E0 (refaktor silnika): zrobione; nowe: powody pauzy zegara, `nextDayStart`, strumienie rng, zdarzenia. ID przedmiotów (`item.*`) i stosy przechodzą w E2 razem z modelem kontenerów (zmiana ID wymaga zmiany literałów w istniejących testach).
- E1 (zapis gry): zrobione; patrz [zapis-gry.md](zapis-gry.md). Następny krok po akceptacji: W0 (rdzeń świata i teren), potem V1; E2 w kolejności planu.
- W0 (rdzeń świata): zrobione; patrz [swiat-w0.md](swiat-w0.md). Niepodłączone do gry ani zapisu; generator v1 i `CURRENT_GEN_VERSION` bez zmian. Następny krok po akceptacji: V1 (potok zasobów) i W1a.
- V1 (zasoby 3D): zrobione; 31 modeli Quaternius (CC0) zoptymalizowanych do GLB + wspólne tekstury WebP, manifest, biblioteka ładowania i instancingu dla R3F, profile LOW/MEDIUM/HIGH, galeria `/dev/models`. Niepodłączone do `ForestScene`, świata ani zapisu. Następny krok po akceptacji: W1a i V2 (prototyp sektora 30x30 m).

## Kolejność etapów

1. Faza A: dokumentacja i reguły Cursor.
2. E0: refaktor silnika bez zmiany działania.
3. Równolegle po E0: E1 zapis, E2 ekwipunek/odrodzenie, W0 rdzeń świata i teren, V1 potok zasobów.
4. E3 questy; W1a generator (teren, rzeka, ścieżki, rozsiew).
5. V2 prototyp sektora lasu, bramka G2 (akceptacja autora).
6. UI1 tablica/dziennik, W1b kotwice, W2 walidator, M1 minimapa bazowa, F1 las w runtime.
7. C1 skrzynie i pozyskiwanie, T1 troll i depozyt, R1 most, M2 mgła odkrywania, tutorial, test przejścia, grafika pozostała.

Reguły dla agentów: [../../.cursor/rules/](../../.cursor/rules/).
