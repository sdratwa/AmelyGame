# Finalne modele 3D: skrzynia ze skarbem i troll

Stan: etap integracji modeli (18 października 2026). Oba pliki od autora zastąpiły wcześniejsze placeholdery w normalnej grze 3D (renderer F1). Nie zmieniono logiki C1, identyfikatorów questowych, SaveV2 ani `MIASTO_DEFAULT`. Troll (T1) nadal nie ma własnej logiki dialogowej w tym etapie: dodano wyłącznie warstwę prezentacji i adaptery.

Kopie oryginałów (nietknięte): `assets/source/treasure_chest_3d_model.glb`, `assets/source/friendly_forest_troll_3d_model.glb`. Warianty dla gry: `public/props/chest.treasure.glb` (+ `props.json`), `public/characters/troll.forest.glb` (+ `characters.json`). Potoki: `npm run assets:props`, `npm run assets:troll`; oba można uruchomić ponownie z oryginałów.

## Skrzynia

- Źródło: 3 części (`tripo_part_0` korpus, `_1` pokrywa, `_2` zamek), 9257 trójkątów, ok. 1,0 x 0,68 x 0,75 m, brak zawiasu i animacji, tekstura korpusu 4096 x 4096.
- Potok tworzy węzły `Chest_Body`, `Chest_Lid`, `Chest_Lock` oraz pivot `Lid_Hinge` przy tylnej, dolnej krawędzi pokrywy (zmierzone z geometrii: x 0,001, y 0,396, z -0,354). Przód skrzyni to +Z, otwarcie to obrót -105° wokół osi X pivotu (przód pokrywy idzie w górę i do tyłu). Pokrywa jest dzieckiem pivotu, więc nie może się oderwać od korpusu; test sprawdza, że w każdej klatce animacji tylna krawędź pokrywy zostaje w punkcie zawiasu.
- Zamek jest statyczny względem korpusu (nie rusza się z pokrywą), zgodnie z geometrią modelu.
- Animacja: 0,85 s (`CHEST_OPEN_SECONDS`), każda skrzynia ma własną macierz pokrywy, więc stany są niezależne (`state.chests`). Po wczytaniu zapisu pokrywy są od razu otwarte.
- Optymalizacja: tekstury WebP, korpus 4096 -> 2048 (kolor, tekstura pokrywy 2048 i zamka 512 bez zmiany); geometria bez zmian. Plik 746 KB (oryginał 3,5 MB).
- Koszt: 3 wywołania rysowania (korpusy, pokrywy, zamki; instancje dla wszystkich trzech skrzyń), 9257 trójkątów na skrzynię (co najwyżej ok. 28 tys. przy trzech w zasięgu 110 m), 3 tekstury.

## Troll

- Źródło: 13299 trójkątów, 66 kości (Mixamo), 22 siatki / 22 materiały / 66 tekstur, klipy `walk` (2,333 s) i `angry_01` (3,5 s). Szkielet, nazwy kości i klipy nie są zmieniane.
- Skala: wysokość modelu 0,949 -> 2,7 m (współczynnik ok. 2,845); stopy stoją na `terrainHeight` w miejscu trolla. Pionowe przesunięcie liczone jest per stan (najniższy wierzchołek w całym cyklu), więc ruch bioder w pionie zostaje zachowany, a stopy nie wchodzą w ziemię (test: 5 seedów, penetracja < 5 cm, unoszenie < 0,5 m).
- Optymalizacja renderowania: 22 siatki z 22 materiałami i 66 teksturami -> **1 siatka ze skórą, 1 materiał, 3 tekstury** (atlas 3 x 2048 x 2048: kolor, normalne, metaliczność/chropowatość; WebP). UV przeliczone na atlas z 8 px marginesu; jedna skóra, więc 1 wywołanie rysowania (+1 w przejściu cieni, gdy profil jakości je włącza). Pamięć GPU ok. 64 MiB nieskompresowanych (3 x 16 MiB + mipmapy); to największy pojedynczy koszt trolla i główny kandydat do dalszej redukcji (np. 1024 dla niskiego profilu), jeśli FPS na słabszym sprzęcie spadnie.
- Oświetlenie: jeden materiał standardowy (PBR) w scenie `MIASTO_DEFAULT`; test analityczny (bez mapy otoczenia) potwierdza, że materiał jest niemetaliczny, a albedo ma umiarkowaną jasność, czyli model nie będzie czarny ani prześwietlony. Wygląd w przeglądarce ocenia autor.

## Animacja trolla

- **Chód**: poziomy root motion `mixamorig:Hips` (0,83 jedn. modelu na cykl, oś Z) jest usuwany przez odjęcie liniowego trendu X/Z od ścieżki pozycji bioder. Zostają kroki, kołysanie, pionowy ruch bioder i wszystkie obroty. Pierwsza i ostatnia klatka mają to samo położenie poziome, więc pętla nie teleportuje. Ruch w świecie wyznacza wyłącznie patrol; prędkość nominalna 1,01 m/s (skok biodra x skala / czas cyklu), a `timeScale` chodu śledzi rzeczywistą prędkość patrolu.
- **Brak ślizgania**: test porównuje stopę w kontakcie z ziemią przy usuniętym root motion i patrolu z oryginałem odtwarzanym w miejscu (mediana i p75 prędkości stopy równe) oraz z podwójnym ruchem (oryginał + patrol), który ślizga się ok. 3x mocniej.
- **Idle**: model nie ma animacji Idle (poza wiązania to T-pose), więc stan `idle` to klip jednej pozy próbkowanej z klatki `walk` (0,067 s) plus delikatny proceduralny ruch (drobne kołysanie głowy o kilka stopni i tułowia); poza Idle warstwa proceduralna wygasa. Nie udajemy animacji autora; w razie jej dodania wystarczy klip i wpis stanu.
- **Gniew**: `angry_01` odtwarza się raz po nieudanej interakcji (próba otwarcia pilnowanej skrzyni, zła odpowiedź na zagadkę, konfiskata) i wraca do stanu bazowego (idle lub chód).
- **Brak Talk**: nie ma klipu rozmowy; podczas rozmowy troll stoi w idle. Dodanie klipu: nowy `AnimationClip` w `buildTrollAnimations` i wpis w `states` (`NpcAnimator` jest sterowany danymi, nie zna konkretnych stanów).

## Architektura

- `src/lib/assets/characters.ts`: loader trolla (GLTFLoader z biblioteki zasobów), walidacja względem manifestu.
- `src/lib/npc/`: `rootMotion.ts` (pomiar i usuwanie dryfu, klip pozy), `animator.ts` (AnimationMixer, stany, przejścia, jednorazowe reakcje, procedura idle), `patrol.ts` (trasa w pobliżu kotwicy, przyspieszanie, omijanie przeszkód), `ground.ts`, `troll.ts` (`TrollNpc`).
- `src/lib/forest-view/npc.ts` (`NpcLayer`): troll w scenie F1, kotwica W1b, odcięcie dystansem 140 m (ukryty i zamrożony poza zasięgiem), okrąg kolizji dla kontrolera gracza, statystyki do F3.
- `src/lib/game/systems/npcReactions.ts`: czysty adapter `GameEvent -> reakcja NPC`. Niczego nie zmienia w stanie; silnik pozostaje autorytatywny (nadaje się do przeniesienia na serwer).
- Patrol: troll nie miał wcześniej systemu patrolu (wcześniej stał jako placeholder), więc dodano minimalny, deterministyczny patrol wyłącznie jako prezentację: trasa 4-5 punktów w promieniu 2,6 m od kotwicy W1b, sprawdzana względem świata kolizji lasu, bez wchodzenia w pilnowaną skrzynię. Nie wpływa na stan gry, zapis ani logikę dialogu (T1 dostanie pozycję trolla z kotwicy, tak jak dotąd).

## Testy

- `assets/characters.test.ts`: struktura GLB trolla (66 kości, klipy, jedna siatka, atlas) i zgodność z manifestem.
- `assets/props.test.ts`, `forest-view/props.test.ts`: węzły skrzyni, pivot, oś i kierunek, niezależne otwieranie pokryw, brak odrywania.
- `npc/rootMotion.test.ts`, `npc/animator.test.ts`, `npc/patrol.test.ts`, `npc/troll.test.ts`: usuwanie root motion, przejścia idle/walk/angry, patrol na prawdziwym terenie (wiele seedów), stopy na ziemi, brak ślizgania i teleportu.
- `forest-view/npc.test.ts`: warstwa NPC (odcięcie, kolizja, reakcje).
- `game/systems/npcReactions.test.ts`: zdarzenia silnika -> gniew, brak wpływu na stan i zapis SaveV2, niezależność stanów skrzyń.

## Czego nie zweryfikowano

Agent nie uruchamia przeglądarki: wygląd trolla i skrzyni, płynność animacji i FPS ocenia autor (F3 pokazuje statystyki NPC). Wyniki liczbowe w testach (kontakt stóp, penetracja, deformacja kości) nie zastępują oceny wizualnej.
