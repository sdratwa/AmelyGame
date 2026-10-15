# Prototyp wizualny V2a - grywalny fragment lasu

Następny etap: [prototyp-v2b.md](prototyp-v2b.md) (jakość wizualna, presety, VISUAL TUNING).

Strona deweloperska `/dev/forest` (tylko `next dev`; w buildzie produkcyjnym zwraca 404). Kod: `src/lib/forest-view/` (logika i renderer Three.js), `src/components/forest-proto/ForestPrototype.tsx` (panel), `src/app/dev/forest/page.tsx`.

**Status:** prototyp jakości wizualnej i wydajności. Nie rusza `ForestScene`, mechaniki gry, zapisów ani rejestru generatorów. Wygląd i FPS NIE zostały jeszcze ocenione w przeglądarce (decyzja autora: bez testów w przeglądarce po stronie agenta); zmierzone są tylko dane liczbowe niezależne od GPU.

## Skąd się bierze las

Wszystko pochodzi z generatora W1a (`createForest`): wybrany sektor wzorcowy (`pickShowcaseSectors`), rozmieszczenie obiektów, teren (`terrain.height`) i kolizje (`WalkWorld` z W0). Nie ma ręcznie ustawionych obiektów. Domyślnie seed 2030 i pierwszy sektor wzorcowy dla tego seeda (obecnie `5_5`).

- Renderowane jest okno 3 x 3 sektory wokół wybranego (90 x 90 m), żeby las nie kończył się ostrą krawędzią. Strefa chodzenia to wybrany sektor + 15 m z każdej strony (60 x 60 m); dalej stoi niewidzialna ściana W0.
- `?stress=49` renderuje okno 7 x 7 sektorów (210 x 210 m), a gracz chodzi po całym oknie; wszystkie zasięgi rysowania są podwojone. Dopuszczalne: 9, 25, 49 (również 81).
- Start gracza: punkt głównej ścieżki najbliższy środka sektora, patrzy wzdłuż ścieżki.
- Odmiany "magiczne" są pomijane tylko w widoku (`plant.7`, `plant.7_big`: fioletowe liście); w świecie zostają. Czerwone liście starych drzew i krzewu (`leaves_twistedtree`) są w shaderze zamieniane na zielone (zamiana kanałów R i G). Niebieskie, różowe i pomarańczowe odmiany zostają na przyszłe strefy magiczne.

## Sterowanie

Kliknięcie w scenę: pointer lock. WASD (lub strzałki): ruch; Shift: bieg; mysz: rozglądanie; Esc: zwolnienie myszy (wtedy działa panel). Prędkość 3,2 m/s (bieg 5,6 m/s) niezależnie od FPS; długie klatki są obcinane do 0,1 s, a `WalkWorld.move` dzieli ruch na kroki <= promień gracza, więc nie da się przeskoczyć przeszkody. Wysokość oczu = teren + 1,62 m z gładkim śledzeniem. Skróty: 1/2/3 jakość, F mgła, H cienie, L LOD (auto/LOD0/LOD1), [ i ] pora dnia.

## Profile jakości (`profiles.ts`)

Profil kontroluje wyłącznie widoczność i szczegółowość, nie układ świata.

| | LOW | MEDIUM | HIGH |
|---|---|---|---|
| zasięg drzew / skał / krzewów | 60 / 51 / 42 m | 95 / 81 / 67 m | 140 / 119 / 98 m |
| zasięg trawy / kwiatów / paproci | 22 / 26 / 30 m | 34 / 41 / 46 m | 48 / 58 / 65 m |
| gęstość drobnej roślinności | 50% | 75% | 100% |
| cienie | wyłączone | 1536 px, 42 m | 2048 px, 62 m |
| LOD | tylko LOD1 (LOD0 niezaładowany), próg x0,4 | próg x0,7 | próg x1 (LOD1 od 35 m) |
| tekstury | 512, Lambert, bez normalnych | 1024 | 1024 + normalne, alphaToCoverage |
| tekstura gruntu / siatka | 1024 px / 1,25 m | 1536 px / 0,9 m | 2048 px / 0,7 m |
| rozdzielczość | x0,8, DPR <= 1 | DPR <= 1,5 | DPR <= 2 |
| atmosfera | niebo + mgła | + wiatr, 120 pyłków | + wiatr, 280 pyłków |

Zmiana jakości przebudowuje tylko zasoby widoku (biblioteka GLB, instancje, rozmiar cieni, tekstura gruntu); świat i pozycja gracza zostają. Biblioteka zasobów V1 jest związana z profilem, więc stara jest zwalniana po załadowaniu nowej.

## LOD, odcinanie, wydajność

- Instancing V1 (`createInstancedModel`) rozszerzony zgodnie wstecz o `updateWith(select)`: własny przydział poziomu LOD albo ukrycie instancji. Domyślne zachowanie bez zmian.
- Reguła widoczności (`selector.ts`): odcięcie odległościowe wg kategorii; rzadzenie trawy, kwiatów, roślin, paproci i grzybów stałym rankiem z hasha ID (rośnie z odległością od 55% zasięgu, więc nie ma twardego pop-in); frustum culling instancji z 18% zapasem pola widzenia; LOD z histerezą (powrót do LOD0 dopiero po 92% progu) i rozrzutem progu +-12% na instancję, żeby pierścień drzew nie zmieniał sylwetek w jednej klatce.
- Obiekty rzucające cień w promieniu `keepRange` (22 m MEDIUM, 30 m HIGH) nie są odcinane frustum, żeby cień nie znikał przy obrocie głowy. Rzucają cień tylko drzewa, skały i krzewy.
- Aktualizacja widoczności tylko po przesunięciu kamery o ok. 0,8 m lub obrocie o ok. 3 stopnie (nie częściej niż co 33 ms; w trybie stress co 90 ms).
- Cienie: jedno światło kierunkowe, mapa cieni podąża za graczem z przyciąganiem do tekseli (bez migotania).
- Billboardów nie ma.

## Wygląd

- Światło: słońce (ciepłe, miękkie cienie PCF) + półsferyczne światło otoczenia, tonemapping ACES, bez bloomu. Pora dnia (`atmosphere.ts`): klucze 0-24 h, domyślnie 10:30. Noc używa tego samego światła jako księżyca (zimne, słabe).
- Mgła Exp2 liczona z zasięgu profilu (ok. 96% przy zasięgu `fogVisibility`), kolor mgły = horyzont nieba; subtelna, gęstsza rano i wieczorem. Niebo to shader z gradientem i poświatą słońca.
- Grunt: siatka z `terrain.height` + tekstura koloru generowana z danych generatora (ścieżka, rzeka, strefy, nachylenie, obiekty): trawa w kilku odcieniach (polana jaśniejsza i cieplejsza, gęsty las ciemniejszy i mszysty), ściółka i cień pod drzewami, ścieżka z ubitej ziemi z kamyczkami i nierównym brzegiem, błoto i żwir przy rzece, goła ziemia na zboczach, ciemny kontakt pod skałami i krzewami, drobne źdźbła. Woda: prosta, półprzezroczysta wstęga (tylko gdy okno obejmuje rzekę).
- Wtopienie roślin: przyciemniona nasada liści i trawy (shader), skały zagłębione w terenie (`ROCK_SINK`), kontakt namalowany w teksturze gruntu.
- Wiatr: delikatne kołysanie liści i trawy w shaderze (zależne od wysokości wierzchołka i pozycji instancji); cienie go nie uwzględniają. Pyłki unoszące się w powietrzu (MEDIUM i HIGH).

## Diagnostyka i narzędzia

Panel po lewej: FPS bieżący i średni, czas klatki, draw calls, trójkąty (`renderer.info`, razem z cieniami), trójkąty gruntu, widoczne/wszystkie instancje, LOD0/LOD1, aktywne modele, geometrie i tekstury, profil, seed, sektor, okno, pozycja. Panel po prawej: jakość, pora dnia, mgła, cienie, wiatr, wymuszenie LOD0/LOD1, seed, wybór sektora wzorcowego (lista 6 najlepszych), przełącznik trybu stress, test FPS i kopiowanie raportu JSON. Parametry początkowe z URL: `seed`, `sector` (np. `4_5`), `q` (low/medium/high), `stress`, `hour`, `fog=0`, `shadows=0`, `lod=0|1`, `wind=0`.

## Instrukcja testu FPS (po stronie autora)

1. `npm run dev`, otwórz `http://localhost:43217/dev/forest` w Chrome/Edge z włączoną akceleracją sprzętową, okno w docelowej rozdzielczości (np. 1920 x 1080), najlepiej bez innych ciężkich kart.
2. Wybierz profil (1/2/3) i poczekaj na koniec ładowania; dla porównania ustaw takie same wartości pory dnia, mgły i cieni.
3. Kliknij "Uruchom test" w panelu: 30 s automatycznego marszu po ścieżce z omiataniem głowy +-75 stopni (sprawdza frustum culling). Wynik: średnie FPS, 1% low, mediana / p95 / max czasu klatki, średnie draw calls i trójkąty, nazwa GPU, rozdzielczość i DPR.
4. "Kopiuj raport" daje JSON do wklejenia. Powtórz dla LOW/MEDIUM/HIGH oraz `?stress=49` (zwykle kolejno MEDIUM i HIGH).
5. FPS jest ograniczany odświeżaniem monitora (vsync); bez ustalenia sprzętu referencyjnego żadnego progu (np. 60 FPS) nie uznajemy za osiągnięty.

## Pomiary niezależne od GPU (`npm run forest:report`)

Seed 2030, sektor `5_5`, start na ścieżce, 4 kierunki patrzenia, FOV 72. Trójkąty modeli to szacunek z liczby instancji i trójkątów LOD (bez cieni; `renderer.info` w przeglądarce pokaże więcej, bo liczy też przebieg cieni).

| Okno | Profil | Widoczne instancje (z 1864 / 9873) | Trójkąty modeli | Grunt | Draw calls modeli |
|---|---|---|---|---|---|
| 3 x 3 | LOW | 113-143 | 184-242 tys. | 10 tys. | 37 |
| 3 x 3 | MEDIUM | 214-303 | 329-411 tys. | 20 tys. | 57 |
| 3 x 3 | HIGH | 392-560 | 487-602 tys. | 33 tys. | 57 |
| 7 x 7 (stress, zasięgi x2) | LOW | 436-603 | 733-982 tys. | 45 tys. | 43 |
| 7 x 7 | MEDIUM | 992-1240 | 1,14-1,46 mln | 45 tys. | 62 |
| 7 x 7 | HIGH | 1762-2073 | 1,64-1,87 mln | 45 tys. | 62 |

Budżety z `wydajnosc.md` (sektor <= 300 tys., stress <= 600 tys. trójkątów w HIGH) są przekroczone: drzewa (3-10 tys. trójkątów w LOD0, LOD1 tylko 25-60% mniej) stanowią ok. 65-70% trójkątów, krzewy z kwiatami ok. 10-15%. To główny wynik V2a do decyzji (patrz niżej).

## Znane problemy i ryzyka

1. Budżet trójkątów przekroczony ok. 1,6-2x w HIGH w zwykłym oknie i ok. 3x w stress. Opcje do oceny po teście FPS: agresywniejsze LOD1 dla drzew (próg 20-25 m), dodatkowy LOD2 lub billboardy dla dalekich drzew (poza zakresem V2a), limit drzew i starych drzew w zasięgu, krótszy zasięg krzewów, LOD dla krzewów.
2. Wygląd nie był oglądany: kolory gruntu, siła mgły, ekspozycja i intensywność słońca są strojone "na oko" z danych; mogą wymagać korekty (zwłaszcza ACES na nasyconych teksturach i jasność cieni).
3. Cień pass renderuje wszystkie instancje rzucające cień w oknie, łącznie z tymi poza zasięgiem mapy cieni (nie ma osobnego odcinania dla przebiegu cieni); koszt przebiegu cieni będzie widoczny w `renderer.info`.
4. Liście z `alphaTest` w cieniach nie mają wiatru (cień jest statyczny). Pyłki i niebo są prostymi shaderami.
5. Przełączenie jakości przeładowuje modele (ok. 2 MB) i może na chwilę pokazać ekran ładowania; tekstura gruntu 2048 px jest generowana na głównym wątku w porcjach (kilkaset ms łącznie, do zmierzenia).
6. Woda jest tylko płaską wstęgą (bez animacji, bez załamań).
7. Brak obsługi dotyku i padów; pointer lock wymaga kliknięcia po każdym Esc.
8. Zasięgi i rzadzenie zmieniają to, co widać, ale nie zmieniają pozycji ani kolizji; wyłączona mgła odsłania granice zasięgu (pop-in rośliny).
