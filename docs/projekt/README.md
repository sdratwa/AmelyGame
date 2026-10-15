# Miasto - dokumentacja projektowa (etap 1)

Dokumenty opisują zatwierdzony plan etapu 1 ("Most do nieznanego" jako pierwszy quest i samouczek). Opis stanu gry sprzed etapu 1 jest w [../opis-gry.md](../opis-gry.md).

## Spis

- [architektura.md](architektura.md) - moduły, komendy i zdarzenia, pauza czasu, dane vs kod.
- [model-danych.md](model-danych.md) - stan gry, ekwipunek i kontenery, skrzynie, depozyt trolla, zapis.
- [swiat-generator.md](swiat-generator.md) - las 300x300 m, sektory, `terrainHeight`, walidator, zgodność wersji generatora.
- [quest-bridge-01.md](quest-bridge-01.md) - quest "Most do nieznanego".
- [plan-testow.md](plan-testow.md) - testy mechanik, generatora, zapisu.
- [zasoby-3d.md](zasoby-3d.md) - strategia modeli 3D, sprawdzone pakiety, licencje, braki.
- [wydajnosc.md](wydajnosc.md) - budżety, profile jakości, pomiary.
- [prototyp-lasu.md](prototyp-lasu.md) - wizualny prototyp sektora 30x30 m i jego kryteria.
- [decyzje.md](decyzje.md) - decyzje zatwierdzone i robocze, sprawy otwarte.

## Proces

Praca etapami; po każdym większym etapie: zmienione pliki, funkcjonalności, wyniki testów, problemy i ryzyka, proponowany kolejny etap. Zatrzymanie do zatwierdzenia przed kolejnym etapem. Szczegóły i zależności w planie (sekcja "Kolejność" poniżej).

## Kolejność etapów

1. Faza A: dokumentacja i reguły Cursor.
2. E0: refaktor silnika bez zmiany działania.
3. Równolegle po E0: E1 zapis, E2 ekwipunek/odrodzenie, W0 rdzeń świata i teren, V1 potok zasobów.
4. E3 questy; W1a generator (teren, rzeka, ścieżki, rozsiew).
5. V2 prototyp sektora lasu, bramka G2 (akceptacja autora).
6. UI1 tablica/dziennik, W1b kotwice, W2 walidator, M1 minimapa bazowa, F1 las w runtime.
7. C1 skrzynie i pozyskiwanie, T1 troll i depozyt, R1 most, M2 mgła odkrywania, tutorial, test przejścia, grafika pozostała.

Reguły dla agentów: [../../.cursor/rules/](../../.cursor/rules/).
