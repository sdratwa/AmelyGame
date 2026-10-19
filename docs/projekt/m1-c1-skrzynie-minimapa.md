# M1 + C1: minimapa, skrzynie, interakcje i zbieranie surowców

Pierwsza część questa "Most do nieznanego" jest grywalna w normalnej grze: przyjęcie zadania, wejście do lasu, minimapa (`M`), trzy skrzynie, klawisz `E`, ekwipunek (`I`), piła i kilof, drewno i kamień, postęp w dzienniku (`J`), zapis. Nie ma jeszcze trolla, zagadek ani budowy mostu (kolejny etap).

> Uwaga: model skrzyni z tego dokumentu (`chest.fairy`) został zastąpiony modelem `chest.treasure`; aktualny opis w [modele-skrzynia-troll.md](modele-skrzynia-troll.md). Logika, pozycje i interakcje poniżej pozostają aktualne.

## Model skrzyni (GLB od autora, wersja historyczna)

Źródło: `assets/source/miasto_skrzynia_basniowa.glb` (kopia pliku od autora, SHA-256 w manifeście). Wynik potoku: `public/props/chest.fairy.glb` + `public/props/props.json` (`npm run assets:props`, skrypt `scripts/assets/build-props.mjs`).

Analiza pliku źródłowego:

- 22 siatki, 7708 trójkątów; korpus i dekoracje (okucia, zamek, zawiasy) są dziećmi korzenia sceny, pokrywa jest dzieckiem węzła `Lid_Hinge`.
- **Pivot istnieje**: węzeł `Lid_Hinge` na (0, 0,505, -0,365), przy tylnej krawędzi korpusu, na wysokości jego górnej krawędzi. Pokrywa ma geometrię we współrzędnych zawiasu i rozciąga się ku +Z, więc obrót wokół osi X węzła to obrót wokół zawiasu; nie trzeba było tworzyć sztucznego pivotu ani niczego udawać.
- Orientacja: przód (zamek) po stronie +Z, góra +Y, podstawa na Y = 0. Otwarcie to obrót o -105° wokół X (przód pokrywy idzie w górę).
- Wymiary w pliku: 1,192 × 0,888 × 0,902 m. Skala świata 0,85 daje ok. 1,01 m szerokości, 0,75 m wysokości.
- Wygląd: **brak materiałów, tekstur i normalnych**; kolory pochodzą z kolorów wierzchołków (`COLOR_0`, alfa = 1). Potok zachowuje je 1:1 (drewno i metal zostają w kolorach autora), liczy normalne z progiem załamania 35° (gładkie fazy, ostre krawędzie) i zapisuje jeden wspólny materiał z kolorami wierzchołków.
- Potok sprawdza założenia (węzeł `Lid_Hinge`, tożsamość transformacji dzieci, brak materiałów, alfa) i przerywa pracę z komunikatem, jeśli plik je łamie, zamiast zgadywać.

Ładowanie: `src/lib/assets/props.ts` (`loadChestAsset`) waliduje strukturę względem manifestu (węzły, pivot zawiasu). Błąd wczytania modelu jest pokazywany na ekranie błędu lasu.

## Renderowanie i animacja

`src/lib/forest-view/props.ts`:

- `ChestLayer`: dwie siatki `InstancedMesh` (korpusy i pokrywy), czyli **2 wywołania rysowania dla wszystkich skrzyń**. Każda pokrywa ma własną macierz instancji (obrót wokół zawiasu liczony osobno), więc trzy skrzynie otwierają się niezależnie. Skrzynie dalej niż 110 m nie są rysowane (instancje rozrzucone po lesie nie nadają się do odcinania frustum).
- Otwarcie trwa 0,85 s (`CHEST_OPEN_SECONDS`, w zakresie 0,7-1,0 s) z łagodnym wejściem i niewielkim odbiciem (ok. 5%), po czym pokrywa zostaje otwarta. Stan otwarcia pochodzi ze stanu gry (`state.chests`); po wczytaniu zapisu pokrywy są od razu otwarte, bez animacji.
- `FxBurst`: jeden obiekt `Points` (bufor kołowy, 160 cząstek) na iskry skrzyni oraz drzazgi i odłamki kamienia; rysowany tylko wtedy, gdy jakaś cząstka żyje.

Integracja w `ForestRenderer`: `setChestStates(opened, animate)`, `setHarvested(ids)`, `burst(kind, x, y, z)`; opcje `stream.opened` i `stream.harvested` ustawiają stan początkowy bez animacji. Streaming sektorów dostał `StreamedForest.setRemoved(ids)`: zebrane drzewa i skały znikają z instancji (przebudowywane są tylko partie dotkniętych sektorów) i z kolizji (`syncHarvestedColliders`).

## Pozycje skrzyń

`src/lib/game/world/chests.ts`: pozycje to dokładnie kotwice W1b (`poi.chest_pickaxe`, `poi.chest_saw`, `poi.chest_blueprint`); nie dodano losowych współrzędnych i nie zmieniono generatora ani jego wersji. Obrót: przodem w stronę punktu wejścia do lasu z deterministycznym rozrzutem (hash seeda i id). Wysokość: najniższy punkt terenu pod podstawą (skrzynia nie wisi nad ziemią; na zboczu górna krawędź lekko wchodzi w teren). Każda skrzynia ma prostokątny collider (0,5 × 0,4 m połowy), dodany do globalnego świata chodzenia.

Testy (10 seedów): kotwica nieprzesunięta, teren osiągalny, brak kolizji z drzewami i skałami, skrzynie nie blokują ścieżek, deterministyczne pozycje.

Skrzynia ze schematem leży przy trollu i jest zablokowana: prompt pokazuje "Skrzynia jest zamknięta. Pilnuje jej troll.", a silnik odrzuca `chest.open` dopóki troll nie jest rozwiązany. Nie ma obejścia mechaniki trolla.

## Interakcje (klawisz E)

- `systems/interaction.ts` (czysta funkcja): wybór obiektu z stożka patrzenia i zasięgu (skrzynia 2,6 m, drzewo/skała 3,0 m; silnik akceptuje do 3,5 m, więc widoczny prompt zawsze przechodzi walidację). Wygrywa obiekt najbliżej środka celownika.
- `systems/interactor.ts` (`ForestInteractor`, bez Reacta): `poll()` (podpowiedź, okno), `press()` (E), `takeFromWindow()`, `closeWindow()`. Wysyła komendy silnika (`chest.open`, `chest.take`, `harvest`) i nie przechowuje wyniku: źródło prawdy to stan gry. Zamknięta skrzynia: E otwiera, po 0,9 s pojawia się okno zawartości; E (lub przycisk) zabiera przedmiot; "Zostaw" zamyka okno (przedmiot zostaje w otwartej skrzyni, E pokazuje okno ponownie).
- Przypadki brzegowe (testy): szybkie wielokrotne E (jedno otwarcie, jedna nagroda), odejście od skrzyni, wyjście z lasu w trakcie animacji, pełny ekwipunek (przedmiot zostaje w skrzyni, okno zostaje), skrzynia trolla, śmierć, E poza lasem.
- E jest przechwytywane w fazie przechwytywania (`capture`) tylko wtedy, gdy jest cel interakcji; wtedy nie uruchamia się jedzenie z paska. Bez celu E działa jak dotąd.
- Brak narzędzia: podpowiedź bez klawisza ("Potrzebujesz piły, aby ściąć to drzewo."); E dodatkowo daje komunikat silnika.

## Zbieranie

Piła: drewno z drzew, kilof: kamień ze skał; ilość zależy od rozmiaru obiektu (reguły W1b/E2, bez logiki w rendererze). Zebrany obiekt znika (bez pniaka), traci kolizję, nie da się zebrać ponownie, jest zapisany w `state.harvested`. Efekt: rozbłysk cząstek (drzazgi lub odłamki) i toast z ilością. Na 24 seedach test potwierdza co najmniej 15 sztuk drewna i 30 kamienia dostępnych na zachodnim brzegu (potrzeba 5 i 10).

## Ekwipunek (I) i dziennik (J)

- `InventoryPanel` rozszerza istniejący ekwipunek (ten sam stan `slots`, ten sam pasek 1-8): lista z nazwami, opisami i liczbami, grupy: narzędzia, przedmioty zadań, surowce, pozostałe. Dla surowców zadania pokazuje `ma/potrzeba`. Przedmioty zadań, narzędzia i surowce są niezbywalne (reguły E2). Panel zatrzymuje zegar gry.
- `QuestView.parallel`: cele "holding" z późniejszych etapów (zbieranie surowców) są widoczne w trackerze ("Surowce na most") i dzienniku także wtedy, gdy bieżący etap dotyczy czegoś innego. Dzięki temu postęp drewna i kamienia jest widoczny już po zdobyciu narzędzi, choć etap trolla nie jest jeszcze dostępny. Podpowiedź etapu "Schemat" wskazuje, że można już zbierać materiały.

## Minimapa (M)

`systems/minimap.ts` + `components/game/Minimap.tsx`:

- Las 300 × 300 m w rzeczywistych współrzędnych (`projectToMap`: +X w prawo, -Z w górę), rzeka z `riverAt`, ścieżka główna w całości, odgałęzienia obcięte do połowy, punkt wejścia, strzałka gracza (obrót = -yaw, test zgodności ze zwrotem patrzenia), współrzędne gracza, litera N, ramka w stylu baśniowym.
- Warstwa statyczna rysowana raz na seed do osobnego płótna, klatka kopiuje ją i dokłada obszary i strzałkę (~20 klatek na s, `requestAnimationFrame`, tylko płótno 2D).
- **Sekret**: mapa nie zawiera współrzędnych skrzyń ani trolla. Pokazuje tylko orientacyjne obszary poszukiwań (koło o promieniu 42 m, środek przesunięty o 0,2-0,55 promienia w deterministycznym kierunku) dla skrzyń, których przedmiot jest celem bieżącego etapu questa; obszar znika po otwarciu skrzyni lub zdobyciu przedmiotu. Testy sprawdzają, że ścieżki i znaczniki są daleko od celów (ścieżka główna to realna droga i może przejść blisko polany, odgałęzienia są obcięte) oraz że model nie zawiera współrzędnych ani nazw celów.
- `M` przełącza widoczność (zapamiętane w przeglądarce, domyślnie włączona; ukryta na wąskich ekranach). Brak mgły odkrywania (to osobny etap).

## Zapis

Bez zmian w schemacie i migracjach: `chests`, `harvested`, ekwipunek, księga i zadania były już w SaveV2 i w kluczu istotnych zmian autozapisu. Test integracyjny: przejście skrzynie -> narzędzia -> 5 drewna i 10 kamienia -> `Autosaver` -> `loadGame` -> `game.load` daje identyczny stan i brak podwójnych nagród po wczytaniu; osobny test dla skrzyni otwartej, lecz niezabranej.

## Pomiary i koszt

- Dodatkowe wywołania rysowania: 2 (korpusy i pokrywy skrzyń) + 1 (cząstki, tylko gdy żyją); przy włączonych cieniach te same siatki dochodzą do przejścia cieni.
- Trójkąty: 7708 na skrzynię, więc co najwyżej ok. 23 tys. (trzy skrzynie w zasięgu 110 m), zwykle jedna widoczna (ok. 7,7 tys.). To rząd wielkości mniej niż las (kilkaset tysięcy do mln trójkątów w F1), ale model jest gęsty jak na rekwizyt 1 m. Nie mierzono FPS w przeglądarce.
- Minimapa: jedno płótno 2D 190 px, bez wpływu na scenę 3D (koszt CPU niezmierzony).

## Znane ograniczenia

- Skrzynia ze schematem jest nieotwieralna do czasu implementacji trolla (T1); do tego czasu quest nie przejdzie etapu "Schemat" (silnik i solver `autoComplete` przechodzą go komendami).
- Zebrane drzewa i skały znikają bez animacji ścięcia i bez pniaków.
- Okno skrzyni i ekwipunek zwalniają kursor myszy; po zamknięciu trzeba kliknąć scenę (jak przy dzienniku).
- Wygląd modelu skrzyni (kolory wierzchołków, jedno światło sceny) i animacja nie były oceniane w przeglądarce przez agenta.
- Obszary poszukiwań są orientacyjne i nie dopasowują się do ścieżek.
