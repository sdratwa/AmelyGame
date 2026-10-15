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

## Budżety (kryteria prototypu)

- Pojedynczy sektor (HIGH): <= 80 draw calls, <= 300 tys. trójkątów.
- Tryb `?stress=49` (okno 7 x 7): <= 150 draw calls i <= 600 tys. trójkątów (HIGH), <= 250 tys. trójkątów (LOW).
- Pamięć tekstur <= 64 MB; transfer modeli sektora <= 4 MB (gzip); czas do pierwszej klatki lokalnie <= 3 s.
- FPS (mierzy autor): HIGH średnio >= 60 (1% low >= 45) w 1920x1080 na sprzęcie docelowym; LOW >= 30 na najsłabszym wskazanym sprzęcie; stress na MEDIUM średnio >= 45. Sprzęt referencyjny do ustalenia.

## Pomiar

Overlay (`?debug=1`): FPS średni i 1% low, czas klatki, draw calls, trójkąty, tekstury, geometrie (`renderer.info`), przełącznik profilu, suwak skali rozdzielczości, przycisk "Kopiuj raport" (JSON). Logika (generator) ma budżet czasu sprawdzany w testach Vitest. Agent nie uruchamia przeglądarki; wyniki FPS dostarcza autor.

## Zasada

Każda zmiana graficzna zawiera notatkę o wpływie na wydajność (draw calls, trójkąty, pamięć tekstur).
