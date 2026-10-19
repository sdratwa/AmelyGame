# Finalne modele 3D: skrzynia ze skarbem i troll

Stan: etap integracji animowanego trolla (19 października 2026); skrzynia bez zmian od etapu integracji modeli (18 października). Oba pliki od autora zastąpiły wcześniejsze placeholdery w normalnej grze 3D (renderer F1). Nie zmieniono logiki C1, identyfikatorów questowych, SaveV2 ani `MIASTO_DEFAULT`. Troll (T1) nadal nie ma prawdziwej logiki dialogowej w grze: jest warstwa prezentacji, adaptery i testowe zachowanie NPC z prostym dialogiem (patrz [troll-spotkanie.md](troll-spotkanie.md)).

Kopie oryginałów (nietknięte): `assets/source/treasure_chest_3d_model.glb`, `assets/source/forest_troll_animated.glb` (aktualny troll, Blender + Mixamo; starszy `assets/source/friendly_forest_troll_3d_model.glb` zostaje jako archiwum). Warianty dla gry: `public/props/chest.treasure.glb` (+ `props.json`), `public/characters/troll.forest.glb` (+ `characters.json`). Potoki: `npm run assets:props`, `npm run assets:troll`; oba można uruchomić ponownie z oryginałów.

## Skrzynia

- Źródło: 3 części (`tripo_part_0` korpus, `_1` pokrywa, `_2` zamek), 9257 trójkątów, ok. 1,0 x 0,68 x 0,75 m, brak zawiasu i animacji, tekstura korpusu 4096 x 4096.
- Potok tworzy węzły `Chest_Body`, `Chest_Lid`, `Chest_Lock` oraz pivot `Lid_Hinge` przy tylnej, dolnej krawędzi pokrywy (zmierzone z geometrii: x 0,001, y 0,396, z -0,354). Przód skrzyni to +Z, otwarcie to obrót -105° wokół osi X pivotu (przód pokrywy idzie w górę i do tyłu). Pokrywa jest dzieckiem pivotu, więc nie może się oderwać od korpusu; test sprawdza, że w każdej klatce animacji tylna krawędź pokrywy zostaje w punkcie zawiasu.
- Zamek jest statyczny względem korpusu (nie rusza się z pokrywą), zgodnie z geometrią modelu.
- Animacja: 0,85 s (`CHEST_OPEN_SECONDS`), każda skrzynia ma własną macierz pokrywy, więc stany są niezależne (`state.chests`). Po wczytaniu zapisu pokrywy są od razu otwarte.
- Optymalizacja: tekstury WebP, korpus 4096 -> 2048 (kolor, tekstura pokrywy 2048 i zamka 512 bez zmiany); geometria bez zmian. Plik 746 KB (oryginał 3,5 MB).
- Koszt: 3 wywołania rysowania (korpusy, pokrywy, zamki; instancje dla wszystkich trzech skrzyń), 9257 trójkątów na skrzynię (co najwyżej ok. 28 tys. przy trzech w zasięgu 110 m), 3 tekstury.

## Troll

- Źródło (`forest_troll_animated.glb`, 7,3 MB): 13299 trójkątów, 22 siatki / 22 materiały / 66 tekstur, jeden szkielet Mixamo (65 kości w skórze), 7 klipów: `Walk` (1,433 s), `Idle` (4,033 s), `Nervous` (7,033 s), `Surprised` (4,033 s), `Happy` (3,633 s), `Dance` (14,767 s), `Angry` (3,3 s). Węzły leżą pod `Troll_Rig` (obrót +90° wokół X, skala 0,01; lokalnie Z to góra), przód postaci to +Z. Szkielet, nazwy kości i klipy nie są zmieniane.
- Skala: cała postać jest skalowana jednolicie jedną skalą grupy (żadnych skal pojedynczych kości; test sprawdza, że kości mają skalę 1). Wysokość w pozie wiązania 0,0094904 jedn. sceny -> 2,7 m (współczynnik ok. 284,5, bo `Troll_Rig` ma już skalę 0,01). Stopy stoją na `terrainHeight`: pionowe przesunięcie liczone jest per stan animacji (najniższy wierzchołek stóp w całym cyklu w układzie świata), a teren pod stopami próbkowany jest siatką 5 x 5 punktów w obrysie +-0,7 m i bierzemy najwyższy. Ruch bioder w pionie zostaje zachowany. Test: 5 seedów i pełna sekwencja spotkania, penetracja < 10 cm (w przejściach między pozami), unoszenie < 0,5 m.
- Optymalizacja renderowania: 22 siatki z 22 materiałami i 66 teksturami -> **1 siatka ze skórą, 1 materiał, 3 tekstury** (atlas 3 x 2048 x 2048: kolor, normalne, metaliczność/chropowatość; WebP). UV przeliczone na atlas z 8 px marginesu; jedna skóra, więc 1 wywołanie rysowania (+1 w przejściu cieni, gdy profil jakości je włącza). 13299 trójkątów, 65 kości. Plik w grze 3,2 MB. Pamięć GPU ok. 64 MiB (3 x 16 MiB + mipmapy); to największy pojedynczy koszt trolla i główny kandydat do dalszej redukcji (np. 1024 dla niskiego profilu).
- Oświetlenie: jeden materiał standardowy (PBR) w scenie `MIASTO_DEFAULT`; test analityczny (bez mapy otoczenia) potwierdza, że materiał jest niemetaliczny, a albedo ma umiarkowaną jasność, czyli model nie będzie czarny ani prześwietlony. Wygląd w przeglądarce ocenia autor.

## Animacja trolla

- Wszystkie 7 klipów chodzi **w miejscu**: pomiar ruchu bioder w świecie na cykl daje < 5 cm dla każdego klipu, pierwsza i ostatnia klatka mają to samo położenie (pętla nie teleportuje), więc usuwanie root motion nie jest potrzebne (`buildTrollAnimations` zgłasza `stripped: []`; narzędzie zostaje i wykryje ruch w przyszłych plikach). Walk nie przesuwa postaci: ruch w świecie wyznacza wyłącznie patrol.
- Prędkość patrolu wynika z kroku stóp: nachylenie ruchu palców w fazie podparcia w Walk = 1,12 m/s; patrol idzie z tą prędkością, a tempo klipu śledzi rzeczywistą prędkość (przy ruszaniu i hamowaniu). Test: stopa w kontakcie z ziemią ślizga się < 40% prędkości, a przy ruchu 2x szybszym albo stojącym > 70% (kontrola testu).
- Stany animacji i klipy (`TROLL_STATES`): `idle` Idle (pętla), `walk` Walk (pętla), `nervous` Nervous (jednorazowy, można przerwać płynnie), `surprised` Surprised, `happy` Happy, `dance` Dance, `angry` Angry (jednorazowe, nieprzerywalne). Koniec klipu to zdarzenie `finished` miksera (bez `setTimeout`); po nim animator wchodzi w następny klip łańcucha (`Happy -> Dance`) albo wraca do stanu podstawowego.
- Przejścia: 0,3 s (Nervous 0,35 s). Wagi liczy animator sam: bieżący stan rośnie liniowo, pozostałe (także te, które jeszcze znikają) maleją proporcjonalnie, więc **suma wag zawsze równa 1** (żadnych dwóch pełnych animacji naraz ani skoku do pozy wiązania przy przerwanym przejściu); zatrzymane klipy są wyłączane w mikserze.
- **Brak Talk**: w pliku nie ma klipu rozmowy; podczas dialogu troll stoi w Idle i patrzy na gracza.

## Architektura

- `src/lib/assets/characters.ts`: loader trolla (GLTFLoader z biblioteki zasobów), walidacja względem manifestu (65 kości, kość bioder, 7 klipów i ich czasy).
- `src/lib/npc/`: `animator.ts` (AnimationMixer, stany, przejścia z sumą wag 1, reakcje jednorazowe, łańcuchy, zdarzenie końca), `patrol.ts` (trasa w pobliżu kotwicy, przyspieszanie, łagodne hamowanie `stop`, płynny obrót z ograniczeniem prędkości i przyspieszenia kątowego `face`, omijanie przeszkód), `encounter.ts` (czysta maszyna spotkania, bez Three.js i stanu gry), `rootMotion.ts`, `ground.ts`, `troll.ts` (`TrollNpc`: patrol + animator + maszyna spotkania).
- `src/lib/forest-view/npc.ts` (`NpcLayer`): troll w scenie F1, kotwica W1b, odcięcie dystansem 140 m, okrąg kolizji dla gracza, statystyki do F3, przekazanie dialogu i wyniku. `renderer.ts`: `onNpcDialog`, `resolveNpcDialog`, `restartNpcEncounter`, `talkToNpc`; troll jest aktualizowany także przy wstrzymanym sterowaniu, gdy trwa jego dialog.
- `src/components/game/TrollTestDialog.tsx` + `ForestWorldView.tsx`: testowe okno, pauza `ui.troll_test`, zwolnienie wskaźnika myszy, blokada E/M w dialogu, panel F3.
- `src/lib/game/systems/npcReactions.ts`: czysty adapter `GameEvent -> reakcja NPC`. Niczego nie zmienia w stanie; silnik pozostaje autorytatywny (nadaje się do przeniesienia na serwer).
- Patrol: deterministyczna trasa 4-5 punktów w promieniu 2,6 m od kotwicy W1b, sprawdzana względem świata kolizji (z obrysem 0,9 m), bez wchodzenia w pilnowaną skrzynię. Nie wpływa na stan gry ani zapis.

## Testy

- `assets/characters.test.ts`: struktura GLB trolla (65 kości, 7 klipów i czasy, jedna siatka, atlas) i zgodność z manifestem.
- `assets/props.test.ts`, `forest-view/props.test.ts`: węzły skrzyni, pivot, oś i kierunek, niezależne otwieranie pokryw, brak odrywania.
- `npc/rootMotion.test.ts`: pomiar dryfu w świecie dla wszystkich klipów, usuwanie root motion na syntetycznym dryfie (oś pionowa Z modelu), pętla bez skoku.
- `npc/animator.test.ts` (24): stany i mapowanie, jednorazowe klipy i `finished`, łańcuchy, przerwanie Nervous, suma wag = 1 także przy przerwanych przejściach, sprzątanie.
- `npc/patrol.test.ts`: trasa, ruch, hamowanie `stop`, płynny obrót ku graczowi (limity prędkości i przyspieszenia), ustępowanie graczowi.
- `npc/encounter.test.ts` (28): progi 20 m i 5 m, zwłoki i histereza 22 m, Nervous tylko w spoczynku i cyklicznie, jedno Surprised na spotkanie, dialog dopiero na zdarzenie końca klipu, rozbrajanie i ponowne uzbrajanie, restart/E, wyniki dialogu (correct, wrong, dismissed), brak pętli dialogu, `dispose`.
- `npc/troll.test.ts`, `npc/troll.encounter.test.ts` (prawdziwy model i teren): wysokość 2,7 m, jednolita skala, stopy na ziemi w całej sekwencji, brak ślizgania i teleportu, spotkanie od 40 m do dialogu (alert przy < 20 m, notice przy < 5 m, płynny obrót, jedno Surprised ok. 4 s, dialog po zdarzeniu końca), Happy -> Dance bez przerwania przy zmianach odległości, Angry bez przerwania, Esc, kolejne spotkanie, wyjście z lasu w trakcie animacji.
- `npc/isolation.test.ts`: moduły trolla i okno nie importują silnika gry/zapisu/questów; pełne spotkania z trzema wynikami nie zmieniają SaveV2.
- `forest-view/npc.test.ts`: warstwa NPC (odcięcie, kolizja, reakcje).
- `game/systems/npcReactions.test.ts`: zdarzenia silnika -> gniew, brak wpływu na stan i zapis SaveV2, niezależność stanów skrzyń.

## Czego nie zweryfikowano

Agent nie uruchamia przeglądarki: wygląd trolla i skrzyni, płynność animacji, czytelność dialogu i FPS ocenia autor (F3 pokazuje statystyki NPC). Wyniki liczbowe w testach (kontakt stóp, penetracja, długości klipów) nie zastępują oceny wizualnej. Okno testowe (React) nie ma testów DOM, bo repozytorium nie ma jeszcze środowiska komponentowego; jego logika (jedno wejście `resolveDialog`, pauza, E, Esc) jest cienka i sprawdzana ręcznie wg [troll-spotkanie.md](troll-spotkanie.md).
