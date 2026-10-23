# Audyt skakania na kamienie — 23 października 2026

Obecny `WalkWorld.move` rozwiązuje kolizje w płaszczyźnie XZ. Każda skała jest kołem bez wysokości (`WorldObject.collider`), więc blokuje ruch niezależnie od wysokości stóp. `PlayerController` liczy skok w osi Y osobno, już po ruchu poziomym. To bezpośrednia przyczyna niemożności przeskakiwania kamieni.

## Zakres zmiany

- **Przeskoczenie kamienia:** średnia złożoność. W wersjonowanym profilu kolizji skał trzeba dodać wysokość (bazową i skalowaną wraz z obiektem). Kontroler powinien sprawdzać pionowy zakres kapsuły dla każdego kroku ruchu poziomego, również w powietrzu, i pominąć skałę tylko wtedy, gdy stopy znajdują się ponad jej szczytem z niewielkim zapasem. Trzeba rozwiązać próbkowanie wysokości w trakcie klatki, aby nie przenikać boku przy szybkim skoku i nie przechodzić przez kamień podczas opadania.
- **Lądowanie i chodzenie po kamieniu:** wyższa złożoność. `groundAt` musi wybierać najwyższą osiągalną powierzchnię pod stopami: teren, pokład mostu albo wierzch skały. Potrzebne są definicje płaskiej lub uproszczonej powierzchni stania, obsługa krawędzi (zejście, spadanie), skał nachylonych lub o nieregularnej bryle, kamery i interakcji na innej wysokości.
- **Multiplayer i zapis:** serwer przyjmuje obecnie ruch przekazany przez klienta, więc przy tej mechanice powinien weryfikować zgodność trajektorii pionowej i poziomej z autorytatywnym profilem skał. Profile należą do wersjonowanego generatora; zmiana wymaga nowej wersji i testów zgodności/migracji istniejących światów. Klient i serwer muszą używać identycznych wysokości.

Nie należy brać wysokości bezpośrednio z aktualnego GLB: model może zostać zmieniony bez zmiany wersji świata. Wysokość w manifeście zasobów nie jest dziś przenoszona do `WorldObject`; generowane skały zachowują tylko koło w XZ i skalę.

Proponowany podział: najpierw przeskakiwanie bez lądowania, następnie stabilna powierzchnia skał. Dla obu etapów testy ruchu przy różnej wysokości skoku, skali skały, prędkości, kucaniu, opadaniu, krawędziach i w dwóch klientach. Ocena dopasowania powierzchni do modeli oraz odczuć skoku należy do autora w ręcznym teście, zgodnie z zakazem testów GUI.
