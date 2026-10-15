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

Stosy i łączenie; limit stosu z definicji; ilości dużo większe niż 20; kontener "magazyn" bez limitu bez zmian w kodzie questów (test z kontenerem testowym); pełny ekwipunek; przedmioty `unique` i `pinned`; odrodzenie (narzędzia i surowce zostają, jedzenie przepada); niezmiennik sumy ilości na losowych sekwencjach komend; brak duplikacji przy wielokrotnym przenoszeniu.

## Questy (E3)

Start questa; zależności podzadań; znalezienie narzędzia przed rozpoczęciem; cel warunkowy odzyskania depozytu; przeczytane vs zaakceptowane; postęp wyliczany ze stanu, nie z przycisków; nagroda raz.

## Skrzynie i pozyskiwanie (C1)

Otwarcie raz; osobne odebranie; pełny ekwipunek zostawia przedmiot w skrzyni; brak duplikacji; pozyskiwanie właściwym narzędziem; brak wydobycia bez narzędzia; liczenie drewna/kamienia 1/2/5; zmiana stanu drzewa/skały i trwałość po zapisie.

## Troll i depozyt (T1)

Troll zabiera wszystko poza telefonem (także narzędzia); przedmioty w depozycie z pełnym stanem; po poprawnej odpowiedzi wraca cały depozyt; brak slotów nie gubi przedmiotów (reszta u trolla); wielokrotne odbieranie nie duplikuje; zapis i odczyt zachowują depozyt; blokady (następny dzień, 1 godzina) działają po zapisie i odczycie z poprawnym pozostałym czasem; odrodzenie nie usuwa depozytu; konfrontacja atomowa; po pierwszej konfrontacji tylko zagadki; porażka nie blokuje ukończenia questa; pauza podczas dialogu nie przesuwa blokad.

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

## Rdzeń świata (W0)

Zrealizowane w `src/lib/game/world/*.test.ts`: determinizm i zróżnicowanie terenu, zgodność wysokości/normalnych/nachylenia (także na płaszczyźnie analitycznej), modyfikacje terenu (porównanie z przejściem pełnym), granice sektorów i obiekty na granicach, indeks przestrzenny (porównanie z przeszukaniem pełnym, 20 000 obiektów), walkable (granice, zbocza, obiekty, rzeka, most, regiony odblokowywane flagą), BFS, potok budowy (determinizm, warianty, niezależność strumieni, walidacja), dane punktów i stref, brak importów React/Three i odwołań do GLB.
