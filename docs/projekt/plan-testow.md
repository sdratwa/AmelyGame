# Plan testów

Narzędzia: Vitest (`npm test`), `npm run lint`, `npm run typecheck`, `npm run build`. Weryfikacja wizualna scen 3D po stronie autora.

## Regresja

17 istniejących testów w `src/lib/game/engine.test.ts` muszą pozostać zielone bez zmian w oczekiwaniach (zegar, drenaż, śmierć, sklep, tutorial, domy).

## Silnik i czas (E0)

- `applyCommand` zwraca zdarzenia zgodne z komendą (`item.purchased`, `player.died`, `player.respawned`, `view.entered`, `house.bought`, ...), a `reducer` zwraca ten sam stan.
- Pauza: powody systemowe; `pause.add` idempotentne; zamknięcie jednego dialogu nie wznawia zegara, gdy drugi trwa; `pause.clearOwner`; `tick` nie zmienia `elapsed` podczas pauzy; pauza nie wpływa na drenaż.
- `nextDayStart` (granice dnia), `rng` deterministyczny i niezależne strumienie.
- Toast bez zmiennej modułu (`toastSeq` w stanie), deterministyczne ID.

## Ekwipunek i kontenery (E2)

Stosy i łączenie; limit stosu z definicji; ilości dużo większe niż 20; kontener "magazyn" bez limitu bez zmian w kodzie questów (test z kontenerem testowym); pełny ekwipunek; przedmioty `unique`; odrodzenie (narzędzia i surowce zostają, jedzenie przepada); niezmiennik sumy ilości na losowych sekwencjach komend; brak duplikacji przy wielokrotnym przenoszeniu.

## Questy (E3)

Start questa; zależności podzadań; znalezienie narzędzia przed rozpoczęciem; cel warunkowy odzyskania depozytu; przeczytane vs zaakceptowane; postęp wyliczany ze stanu, nie z przycisków; nagroda raz.

## Skrzynie i pozyskiwanie (C1)

Otwarcie raz; osobne odebranie; pełny ekwipunek zostawia przedmiot w skrzyni; brak duplikacji; pozyskiwanie właściwym narzędziem; brak wydobycia bez narzędzia; liczenie drewna/kamienia 1/2/5; zmiana stanu drzewa/skały i trwałość po zapisie.

## Troll i depozyt (T1)

Troll zabiera wszystko (także narzędzia); przedmioty w depozycie z pełnym stanem; po poprawnej odpowiedzi wraca cały depozyt; brak slotów nie gubi przedmiotów (reszta u trolla); wielokrotne odbieranie nie duplikuje; zapis i odczyt zachowują depozyt; blokady (następny dzień, 1 godzina) działają po zapisie i odczycie z poprawnym pozostałym czasem; odrodzenie nie usuwa depozytu; konfrontacja atomowa; po pierwszej konfrontacji tylko zagadki; porażka nie blokuje ukończenia questa; pauza podczas dialogu nie przesuwa blokad.

## Troll: spotkanie z graczem (animacje i testowy dialog)

Progi 20 m (alert) i 5 m (zauważenie) oraz histereza 22 m ze zwłokami; brak alertu przy chwiejnej odległości; Nervous tylko w spoczynku i cyklicznie; jedno `Surprised` na spotkanie od początku do końca, dialog dopiero na zdarzenie końca klipu; płynny obrót bez teleportu (limity prędkości i przyspieszenia kątowego); `Happy -> Dance` i `Angry` bez przerwania przy zmianach odległości; po sekwencji alert albo patrol, bez pętli dialogu; Esc bez reakcji; nowe spotkanie po oddaleniu, E albo restarcie; suma wag animacji = 1 w każdej klatce; stopy na terenie; troll nie opuszcza obszaru patrolu ani nie wchodzi w skrzynię; wyjście z lasu w trakcie animacji sprząta mikser i nasłuch; wyniki dialogu nie zmieniają SaveV2 ani stanu questa i moduły trolla nie importują silnika. Pliki: `npc/encounter.test.ts`, `npc/troll.encounter.test.ts`, `npc/isolation.test.ts`, `npc/animator.test.ts`, `npc/patrol.test.ts`; opis w [troll-spotkanie.md](troll-spotkanie.md). Okno React i pauza: test ręczny (brak środowiska DOM).

## Zagadki

Min. 10 zagadek; walidacja w silniku; liczba jako odpowiedź (normalizacja); stabilny wybór w ramach próby; poprawna/błędna odpowiedź.

## Świat i generator (W0, W1, W2)

- Determinizm: to samo ziarno i wersja -> identyczny `WorldBase` (odcisk); różne ziarna -> różne światy.
- Golden: odciski dla stałych ziaren dla każdej wydanej wersji generatora; `FROZEN.sha256` plików zamrożonej wersji.
- Setki ziaren: walidator przechodzi; wszystkie skrzynie osiągalne bez przedmiotów z siebie nawzajem, poza wodą, bez nakładania, odstępy; ścieżki przechodnie; zasoby >= 3x przed mostem; brak przecieku przez rzekę przed mostem i przejście po moście; nachylenie w limitach.
- `terrainHeight`: identyczne wartości w generatorze, kolizjach i siatce renderera (tolerancja 1 cm).
- Baza vs delta: zmiana delty nie zmienia bazy; `resolveWorld` poprawne.
- Zgodność wersji: stary zapis (wersja N) odtwarza ten sam świat po dodaniu wersji N+1; niezgodność odcisku jest wykrywana i nie nadpisuje zapisu; migracja atomowa (wszystko albo nic), z przypiętymi kotwicami i kopią zapasową.
- Czas generacji w budżecie.

## Zapis (E1)

Round-trip w trakcie questa; uszkodzony zapis i kopia `.bak`; migracje `vN -> vN+1`; jawne pauzy niezapisywane; pozycja w lesie walidowana; reset zapisu; domy z seeda identyczne po wczytaniu.

Zrealizowane w E1 (`src/lib/game/save/save.test.ts`, `world/world.test.ts`): własny seed nowej gry, round-trip, symulowane odświeżenie, ten sam seed = ten sam świat, uszkodzony zapis i kopia, niezgodny odcisk bez nadpisania, migracja (sukces, wyjątek, zły wynik, brak miejsca na kopię), brak stanu tymczasowego i obiektów Three w zapisie, walidator, `Autosaver`, zamrożenie generatora v1, brak `Math.random`/zegara w logice gry.

## Przejście headless (Q)

Bot samymi komendami kończy quest na wielu ziarnach: ścieżka prosta oraz ścieżka z porażką u trolla (konfrontacja, czekanie do następnego dnia, zagadka, zwrot depozytu, budowa). Fuzz niezmienników: krytyczne przedmioty nie znikają, brak softlocka po śmierci.

## Zasoby 3D (V1)

- `src/lib/assets/assets.test.ts`, w tym: manifest zgodny ze schematem i z konfiguracją potoku (każdy używany model ma wpis); pliki GLB/LOD/tekstury/licencja istnieją, rozmiary zgodne z manifestem, brak osieroconych plików i brak oryginałów (`.gltf`, `.png`, `.fbx`) w `public/models`; licencje CC0, autor, źródło, atrybucja, brak placeholderów; komplet kategorii (>= 3 drzewa, runo, paproć, krzewy, trawy, >= 3 skały); budżety (materiały, tekstury <= 1024 px, rozmiar, trójkąty, wywołania rysowania); kolizje.
- Walidator manifestu odrzuca błędy (brak licencji, duplikaty, złe referencje, LOD cięższy od LOD0).
- Ładowanie prawdziwych plików GLB przez `GLTFLoader` + meshopt w Node: trójkąty i rozmiary zgodne z manifestem, współdzielone materiały i geometrie, cache, profile (LOW: LOD1, tekstury 512, bez normalnych), błędy (brak modelu, uszkodzony GLB, brak tekstury, brak manifestu), ponawianie, zastępnik, `dispose`.
- Instancing: 1000 drzew = tyle `InstancedMesh` co części, współdzielone geometrie i materiały; przydział LOD wg odległości.
- Skały S/M/L: rosnące rozmiary, ograniczona zmienność proporcji, powtarzalność dla ziarna, podpowiedź 1/2/5.
- Poza zakresem automatów: ocena wyglądu i wydajność na GPU (galeria `/dev/models`, wykonuje autor).

## Prototyp lasu (V2)

Automatyczne kryteria z [prototyp-lasu.md](prototyp-lasu.md): zgodność manifestu, determinizm sektora, brak instancji w kolizji i na zboczach, jednolitość `terrainHeight`.

## Generator lasu W1a

Szczegóły w [swiat-w1a.md](swiat-w1a.md): determinizm i niezależność strumieni, odcisk zamrożony dla 3 seedów, podział na sektory i odtwarzalność sektora, okno 7 x 7, y obiektów = teren, brak obiektów w wodzie, brak nakładania kolizji, korytarz ścieżek, rzeka jako bariera bez obejścia, profile i zależność od terenu, stabilność dla setek seedów (300 planów, 300 x 3 sektory, 60 pełnych światów, 14 pełnych walidacji), zgodność z manifestem V1 i adapter instancingu, budżety czasu.

## Prototyp V2a

`src/lib/forest-view/forestView.test.ts`: deterministyczny wybór sektora i okna, pozycje instancji = wysokość terenu (skały zagłębione), start na ścieżce, ruch niezależny od FPS, kolizje z pniami i skałami z różnych kierunków, granica strefy chodzenia, LOD z histerezą, ładowanie prawdziwych GLB dla LOW/MEDIUM/HIGH bez zastępników, wymuszenie LOD0/LOD1 i przełączanie ustawień, rzadzenie i frustum culling, grunt i woda, tekstura gruntu, atmosfera, statystyki klatek, trasa testu FPS. Poza automatami: wygląd i FPS w przeglądarce (autor).

## Prototyp V2b

`src/lib/forest-view/forestVisual.test.ts`: ORIGINAL neutralny względem V2a (paleta, strojenie, krzywa dnia, zamiana kanałów); presety jako niezależne kopie, zakresy suwaków i walidacja JSON (round-trip, śmieci, wartości skrajne); mgła; estymator jasności (Lambert + półsfera + ACES) dla pni, sosen i skał o 7:00, 12:00, 19:00: cień czytelny, kontrast słońce/cień, brak przepalenia, spód koron; ograniczenia ekspozycji i światła; krzywa letnia (słońce nad horyzontem, ciągłość, zawinięcie); uspokojenie zieleni i różnice między gatunkami; suwak nasycenia tylko dla zielonych pikseli; shadery (korekta w odpowiednich materiałach, normalne liści, zamiana kanałów tylko dla starych drzew, uniformy aktualizowane w miejscu); grunt natural (determinizm, udział zieleni, kontrast ścieżki). Jednorazowo: kompilacja GLSL złożonych shaderów w `glslangValidator`. Poza automatami: ocena wyglądu i FPS w przeglądarce (autor).

### V2b: migotanie trawy

`forestVisual.test.ts`: matematyka normalnej dwustronnego źdźbła przed poprawką (NaN na tylnej stronie przy `up` = 0,5; -Y bez słońca przy `up` = 0) i po poprawce (ta sama, skończona normalna z obu stron dla wszystkich presetów, oświetlenie niezależne od strony), brak zmian dla `leaves`/`flowers`/drzew, zakres wstawek shaderów (stabilna normalna tylko w `grass`, zabezpieczenie we wszystkich liściach), współdzielony `uFix`. `grassGeometry.test.ts`: odczyt GLB (normalne trawy w górę, rozbieżność kierunku trójkątów, zgodność w modelach `leaves` i `flowers`). Tryb diagnostyczny `/dev/forest` (laboratorium trawy) do oceny w przeglądarce przez autora.

## Rdzeń świata (W0)

Zrealizowane w `src/lib/game/world/*.test.ts`: determinizm i zróżnicowanie terenu, zgodność wysokości/normalnych/nachylenia (także na płaszczyźnie analitycznej), modyfikacje terenu (porównanie z przejściem pełnym), granice sektorów i obiekty na granicach, indeks przestrzenny (porównanie z przeszukaniem pełnym, 20 000 obiektów), walkable (granice, zbocza, obiekty, rzeka, most, regiony odblokowywane flagą), BFS, potok budowy (determinizm, warianty, niezależność strumieni, walidacja), dane punktów i stref, brak importów React/Three i odwołań do GLB.

## Zrealizowane w E2 + Q1 + W1b

- `systems/containers.test.ts`: stosy, limity, konfiskata i odzysk (niezmiennik księgi), kolejność odzysku (niezbywalne najpierw).
- `systems/quest.test.ts`: tablica (przeczytane vs przyjęte), cele `obtained`/`holding`/`flag`, skrzynie, pozyskiwanie (narzędzie, limit noszenia, atomowość), troll (konfiskata bez pieniędzy, blokada do następnego dnia, +1 godzina po błędnej odpowiedzi, zagadki, depozyt), budowa mostu, nagroda raz, pauza z wieloma przyczynami (zamknięcie jednego okna nie wznawia zegara), zapis i odczyt po każdym kamieniu milowym (przyjęcie, każda skrzynia, konfiskata, odzysk depozytu, materiały, most, ukończenie) z kontrolą braku duplikacji i utraty zasobów, 5 scenariuszy kolejności zdarzeń oraz fuzz na 60 seedach z solverem `autoComplete` (każdy dozwolony stan da się doprowadzić do ukończenia questa).
- `save/migration.test.ts`: migracja v1 -> v2 (zachowane domy, portfel, czas, zdrowie, imię; mapowanie przedmiotów; pozycja poprawna zachowana, niepoprawna przeniesiona do punktu wejścia; zapis legacy czytelny przez `LocalStorageSaveStore`; kopie `premigration` i `.bak`; uszkodzony SaveV1 jest odrzucany bez zgadywania; migracja jest czysta i deterministyczna; po migracji quest da się ukończyć).
- `save/save.test.ts`: m.in. `Autosaver` traktuje postęp questa jako istotną zmianę.
- `world/generators/v2/anchors.test.ts`: patrz [swiat-w1a.md](swiat-w1a.md).

## Zrealizowane w UI1 + F1

- `systems/questView.test.ts`: widok tablicy i questa wyliczany ze stanu (bez logiki w React).
- `forest-view/stream.test.ts`: planista streamingu (kolejność, histereza, brzegi siatki, tekstury z paddingiem).
- `forest-view/streaming.test.ts`: pierścień początkowy i okno, zgodność instancji z załadowanymi sektorami po przejściu przez granice, zwalnianie geometrii i tekstur, brak budowania przy kręceniu się na granicy, wielokrotne tworzenie i `dispose`, wykrycie wszystkich modeli lasu, brak szwów między płytkami.
- `world/forestWalk.test.ts`: indeks colliderów całego lasu, rzeka nieprzekraczalna bez mostu (3 seedy, co 5 m), przejście z flagą mostu, `safeForestPose` dla wschodniego brzegu.
- Test ręczny w przeglądarce: kroki w raporcie F1 i [las-w-grze-f1.md](las-w-grze-f1.md).

## Zrealizowane w M1 + C1

- `assets/props.test.ts`: manifest i SHA źródła, struktura modelu skrzyni (korpus, pivot `Lid_Hinge`), skala, kolory i normalne.
- `world/chests.test.ts`: kotwice, osiągalność, brak kolizji z drzewami i skałami, deterministyczność na 10 seedach.
- `systems/interaction.test.ts`: wybór celu (stożek, dystans, stan skrzyni, blokada trolla, narzędzia), prompt mniejszy niż zasięg silnika.
- `systems/interactor.test.ts`: przebieg E (otwarcie, okno, zabranie), szybkie wielokrotne E, odejście, wyjście z lasu w trakcie animacji, pełny ekwipunek, skrzynia trolla, zbieranie z narzędziem i bez, śmierć.
- `systems/minimap.test.ts`: model z prawdziwej geometrii, rzut i strzałka, sekret (brak współrzędnych celów), obszary poszukiwań.
- `systems/m1c1.test.ts`: pełny przebieg grywalnego fragmentu przez interakcje, zapis i wczytanie, skrzynia otwarta bez zabrania, wystarczalność surowców (24 seedy), usuwanie i przywracanie kolizji zebranych obiektów.
- `systems/questView.test.ts`: cele równoległe (surowce) w trackerze i dzienniku.
- `forest-view/props.test.ts`: animacja pokrywy (czas, krzywa, pivot, niezależność skrzyń, wczytanie bez animacji, odcinanie dystansem, 2 siatki), cząstki.
- `forest-view/streaming.test.ts`: `setRemoved` (usuwanie i przywracanie instancji, także w dociąganych sektorach).
- Nie ma automatycznego testu WebGL: wygląd, FPS i klawisze w przeglądarce sprawdza autor wg instrukcji w raporcie.
- Modele skrzyni i trolla (struktura GLB, root motion, animator, patrol, adapter reakcji, zapis): patrz [modele-skrzynia-troll.md](modele-skrzynia-troll.md), sekcja Testy.
