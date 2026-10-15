# Wydajność

Projektujemy najpierw dla desktopowej przeglądarki; w przyszłości iOS i Android. Render zgodny z WebGL2; WebGPU nie jest zakładane.

## Techniki

- InstancedMesh dla powtarzalnej roślinności, jedno mesh na typ, wypełniane dla okna aktywnych sektorów (np. 7 x 7 sektorów 30 m) wokół gracza; przebudowa przy zmianie sektora lub stanu obiektu (ścięte drzewo = przebudowa okna).
- LOD dla dużych modeli; frustum culling; przycinanie po dystansie zgodne z mgłą; ograniczenie draw calls.
- Tekstury <= 1024 px (docelowo KTX2), geometrie skompresowane (Draco/meshopt).
- Kolizje przez indeks sektorowy (zamiast liniowego skanu wszystkich obiektów).
- Pozycja gracza w ref; do silnika trafia ok. 5 Hz (odkrywanie mapy, zapis).
- Ograniczenie postprocessingu: LOW i MEDIUM bez postprocessingu; efekty (np. tanie "promienie słońca" jako geometria) tylko na HIGH; możliwość wyłączenia.
- Dynamiczne skalowanie rozdzielczości renderowania (średni czas klatki) i automatyczny spadek profilu.
- Licznik FPS i statystyki rendererów tylko w trybie developerskim (`?debug=1`).

## Profile jakości

- LOW: dpr 1, brak cieni, krótka mgła, ograniczona gęstość roślin i cząstek, bez efektów.
- MEDIUM: dpr <= 1,5, cienie 1024 px, średnia gęstość.
- HIGH: dpr <= 2, cienie 2048 px, pełna gęstość, tanie promienie słońca.
Wartości w jednym obiekcie konfiguracji; zmiana profilu na żywo.

Stan po V1: profile zasobów (`src/lib/assets/profiles.ts`) obejmują wariant tekstur (1024/512 px), mapy normalnych, materiał (Lambert w LOW), alpha-to-coverage, minimalny LOD, mnożnik odległości LOD, gęstość roślinności, cienie i limit pixel ratio. Wartości nie są jeszcze mierzone na sprzęcie. Koszt zestawu: 10 materiałów, 12 tekstur (ok. 5 MB GPU każda przy 1024 px po rozpakowaniu), 1-2 wywołania rysowania na typ modelu i poziom LOD, ok. 2,6 MB transferu (HIGH/MEDIUM) lub 2,1 MB (LOW). Galeria `/dev/models` pokazuje FPS, wywołania rysowania i trójkąty dla N instancji drzewa.

## Budżety (kryteria prototypu)

- Pojedynczy sektor (HIGH): <= 80 draw calls, <= 300 tys. trójkątów.
- Tryb `?stress=49` (okno 7 x 7): <= 150 draw calls i <= 600 tys. trójkątów (HIGH), <= 250 tys. trójkątów (LOW).
- Pamięć tekstur <= 64 MB; transfer modeli sektora <= 4 MB (gzip); czas do pierwszej klatki lokalnie <= 3 s.
- FPS (mierzy autor): HIGH średnio >= 60 (1% low >= 45) w 1920x1080 na sprzęcie docelowym; LOW >= 30 na najsłabszym wskazanym sprzęcie; stress na MEDIUM średnio >= 45. Sprzęt referencyjny do ustalenia.

## Generator lasu W1a (pomiar logiki, Node, bez GPU)

Cały świat 300 x 300 m: ok. 22 tys. obiektów (ok. 2 tys. z kolizją), wszystkie 100 sektorów w ok. 120-220 ms, pojedynczy sektor ok. 1 ms (mediana), pełny `buildForest` z walidacją ok. 0,5-0,7 s. Szacunek trójkątów LOD 0: ok. 16-17 mln w całym lesie, ok. 8,5 mln w najgęstszym oknie 7 x 7 - budżet z tego dokumentu wymaga w V2 LOD, ograniczenia odległości i profili jakości. Raport: `npm run world:report`.

## Prototyp V2a (szacunek bez GPU)

Seed 2030, sektor 5_5, okno 3 x 3: trójkąty modeli ok. 184-242 tys. (LOW), 329-411 tys. (MEDIUM), 487-602 tys. (HIGH) plus grunt 10-33 tys.; okno 7 x 7 (`?stress=49`): ok. 0,7-1,0 mln (LOW), 1,1-1,5 mln (MEDIUM), 1,6-1,9 mln (HIGH). Budżety z tej strony są przekroczone w HIGH i MEDIUM; decyzja po teście FPS autora. Szczegóły i instrukcja: [prototyp-v2a.md](prototyp-v2a.md); raport: `npm run forest:report`.

## Pomiar

Overlay (`?debug=1`): FPS średni i 1% low, czas klatki, draw calls, trójkąty, tekstury, geometrie (`renderer.info`), przełącznik profilu, suwak skali rozdzielczości, przycisk "Kopiuj raport" (JSON). Logika (generator) ma budżet czasu sprawdzany w testach Vitest. Agent nie uruchamia przeglądarki; wyniki FPS dostarcza autor.

## Zasada

Każda zmiana graficzna zawiera notatkę o wpływie na wydajność (draw calls, trójkąty, pamięć tekstur).
