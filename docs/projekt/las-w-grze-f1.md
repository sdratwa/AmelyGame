# F1: las 3D w normalnej grze

Las 300 x 300 m (generator v2) jest teraz lasem w normalnej grze. Nie ma drugiego renderera: gra używa `ForestRenderer` z prototypu `/dev/forest` w trybie streamingu. Stary las r3f (`ForestScene`, `ForestView`) został usunięty; `@react-three/fiber` zostaje tylko dla `/dev/models`.

## Wejście, wyjście, zapis

- Wejście: kliknięcie lasu na mapie (po tutorialu). Pozycja startowa to zapisana pozycja po walidacji (`safeForestPose`) albo punkt wejścia przy zachodnim skraju, twarzą do rzeki.
- Po zbudowaniu mostu poprawna jest też pozycja na moście i na wschodnim brzegu (sprawdza ją świat chodzenia z flagą `bridge.built`). Bez mostu pozycja z zapisu na wschodnim brzegu wraca do punktu wejścia.
- Wyjście: przycisk "Wróć" lub dwukrotne `Esc` (pierwsze zwalnia kursor). Pozycja jest raportowana do stanu co 2 s i przy wyjściu, ale dopiero gdy las jest gotowy (nie nadpisuje zapisu w trakcie ładowania).
- Powtórne wejście/wyjście zwalnia geometrię, tekstury i instancje (testy: wielokrotne tworzenie i `dispose`).

## Streaming sektorów

- Siatka 10 x 10 sektorów po 30 m. Wokół gracza ładowany jest pierścień o promieniu zależnym od jakości: LOW 2, MEDIUM 3, HIGH 4 sektory (`STREAM_RADIUS` w `stream.ts`).
- Planista `planStream` jest czysty: wybiera sektory do załadowania (najbliższe pierwsze) i do zwolnienia; zwalnianie ma histerezę (sektor poza promieniem + 1), więc kręcenie się na granicy sektorów niczego nie buduje (test).
- Przed wejściem ładowany jest pierścień początkowy (2 sektory od gracza), widoczny jako ekran ładowania z procentami. Zegar gry stoi na czas ładowania (`ui.forest_loading`).
- Grunt: osobna płytka (mesh + tekstura) na sektor, tekstury z paddingiem 1 m (brak szwów, test porównujący sąsiednie płytki), siatka z `buildGroundMesh`. Płytki budowane przyrostowo w limicie czasu (28 ms/klatkę podczas ładowania, 4 ms potem). Cache pikseli płytek (LRU, 64) przyspiesza powrót.
- Instancje: każdy sektor ma własne partie (`batchesFor`), łączone `mergeBatches` i podawane do `ForestInstancer.setBatches`. Odświeżane najwyżej co 250 ms, tylko gdy zestaw sektorów się zmienił. Wszystkie modele lasu są wczytywane z góry (`forestModelIds`), żeby streaming nie wczytywał niczego w trakcie gry.
- Lustro wody obejmuje prostokąt załadowanych sektorów i jest przebudowywane tylko przy zmianie jego zasięgu.

## Kolizje i rzeka

- Kolizje nie zależą od streamingu: `forestWalkOf(seed)` to jeden `WalkWorld` ze wszystkimi colliderami (drzewa, skały; ok. 2000), barierami (rzeka) i przejściem mostu (`bridge.built`). `FirstPersonController` dostaje flagi gry (`worldFlags`), a stan `bridge.built` ustawia `setBridgeBuilt`.
- Testy `world/forestWalk.test.ts`: rzeka nieprzekraczalna co 5 m na całej długości na 3 seedach, przejście w obie strony tylko z flagą, walidacja zapisanej pozycji.

## Wygląd, światło, jakość

- Domyślnie MIASTO_DEFAULT (bez zmian wobec prototypu).
- Godzina lasu = `clock.hour + clock.minute / 60` z zegara gry (20 s realnych = 1 godzina gry); renderer ustawia słońce, mgłę i niebo przez `setHour`.
- Jakość: MEDIUM domyślnie; Niska / Średnia / Wysoka w panelu, wybór zapamiętany w `localStorage` (`miasto.forest.quality`). Zmiana jakości restartuje strumień w tym samym miejscu.
- `F3` pokazuje diagnostykę: FPS, sektory (załadowane/oczekujące), trójkąty, instancje, cache płytek.
- Gdy otwarty jest panel, dialog lub gracz nie żyje, sterowanie lasu jest zamrożone (`suspended`).

## Znane ograniczenia

- Brak sterowania dotykowego w lesie 3D (klawiatura i mysz z pointer lock).
- Brak pór roku w 3D (las wygląda tak samo zimą i latem).
- W lesie 3D nie ma jeszcze skrzyń, trolla, pozyskiwania, narzędzi w rączce ani widocznego mostu (M1/C1/T1/R1): quest można przyjąć i śledzić, ale nie da się go jeszcze posunąć w 3D.
- Gęstość trawy HIGH jest taka sama jak MEDIUM; krawędź lasu jest widoczna z bliska.
- Modele są ładowane przy każdym wejściu (kilka sekund przy pierwszym wejściu; brak pomiaru na sprzęcie referencyjnym).
- Styl gruntu jest ustalany przy starcie widoku (zmiana wymaga ponownego wejścia).
- Tablica ogłoszeń jest zablokowana do końca tutorialu.
