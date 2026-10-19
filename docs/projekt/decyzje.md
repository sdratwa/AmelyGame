# Decyzje projektowe

## Zatwierdzone przez autora (plan v3 i uzupełnienia)

- Las 300 x 300 m, sektory logiczne 30 x 30 m (niewidoczne), deterministyczny generator z `worldSeed`, losowe skrzynie ze stałymi pozycjami w zapisie, depozyt trolla zamiast kary pieniężnej, blokady na zegarze gry.
- Wizualny prototyp jednego sektora wcześnie (V2) z docelowymi modelami; wspólne `terrainHeight(x, z)`; minimapa bazowa przed mechaniką skrzyń.
- Zgodność zapisów: `worldGenVersion` musi umożliwiać odtworzenie istniejącego świata po aktualizacji gry; zachowanie starszych generatorów lub bezpieczne migracje (nie wystarcza snapshot pozycji krytycznych). Realizacja: [swiat-generator.md](swiat-generator.md).
- Pauza czasu: centralny mechanizm powodów pauzy; zamknięcie jednego dialogu nie wznawia zegara, jeśli inny powód nadal go zatrzymuje. Realizacja: [architektura.md](architektura.md).
- Ekwipunek: `maxStack: 20` to wartość początkowa; system obsługuje większe ilości i pozwala dodać magazyn bez przebudowy silnika. Realizacja: [model-danych.md](model-danych.md).
- Modele: Quaternius Stylized Nature MegaKit zatwierdzony jako pierwszy kandydat do prototypu; przed pobraniem sprawdzić licencję i zawartość (zrobione, patrz [zasoby-3d.md](zasoby-3d.md)); alternatywy przy brakach; niczego nie kupować bez zgody autora.
- Reguły delegowania między modelami AI i subagentów: nie wdrażać teraz (osobna decyzja).

## Robocze (do ostatecznej akceptacji autora)

- `E`: interakcja, gdy obiekt w zasięgu; inaczej użycie zaznaczonego jedzenia.
- Czas gry zatrzymuje się podczas dialogów i zagadek (przez mechanizm powodów pauzy).
- Odrodzenie: narzędzia i surowce zostają, jedzenie może przepaść.
- Troll nie zabiera dodatkowo pieniędzy; po pierwszej przegranej konfrontacji dalsze interakcje tylko przez zagadki; po porażce gracz wraca na mapę miasta; depozyt odbieramy u trolla.
- Rzeka w przybliżeniu z północy na południe we wschodniej części lasu; start po zachodniej stronie.
- Surowce pierwszego questa skończone, zapas >= 3x.
- Stosy surowców, 8 slotów zostaje; domyślny `maxStack` 20 (konfigurowalny w danych).
- Odpowiedź na zagadkę wpisywana jako liczba.
- Most budowany tylko w wyznaczonym miejscu.
- Nagroda: 5000 zł i odznaka odkrywcy.
- Tablica: pierwszy quest i dwie zapowiedzi przyszłych zadań.
- Biblioteki pomocnicze (np. `@react-three/drei`) po uzasadnieniu; modele CC0 preferowane, CC-BY po sprawdzeniu atrybucji.
- Zapisujemy pozycję gracza w lesie.

## E1 (zapis gry)

- `SaveV1` zawiera tylko to, co dziś istnieje; questy, skrzynie i reszta dochodzą w SaveV2+ z migracjami (zamiast pustych pól).
- Generator świata v1 = 2 domy z `rngStream(seed, "houses")`; zamrożony i pilnowany sumami SHA-256. Las z seeda wchodzi z generatorem v2 (W1a).
- Koperta z sumą kontrolną nad payloadem; wiele warstw kopii (`.bak`, `.corrupt`, `archive`, `premigration`) zamiast jednej.
- Nowa gra nigdy nie kasuje poprzedniego zapisu: trafia on do archiwum (5 slotów, obieg).
- Zapis z nowszej wersji gry i niezgodny odcisk świata nie są nadpisywane ani zastępowane starszą kopią.
- Seed i `saveId` pochodzą z `crypto.getRandomValues` w warstwie UI i wchodzą do silnika jako dane komendy; silnik nie używa `Math.random` ani zegara (pilnuje test).
- Pozycja w lesie: zapisywana co 2 s i przy wyjściu; po wczytaniu gracz startuje na mapie, a wejście do lasu przywraca pozycję.

## W0 (rdzeń świata)

- Teren v1 = płaski prototyp; teren v2 jest roboczy (nie rejestrowany w generatorach, nie zapisywany) do czasu wydania w W1a. `CURRENT_GEN_VERSION` pozostaje 1.
- Etap planowania widzi tylko teren bazowy, a spłaszczenia biorą wysokość z bazy: brak cyklu teren <-> obiekty (wymuszone typami).
- Identyfikator sektora zawiera region (`sector.forest_start.3_4`), identyfikator obiektu: `rodzaj.region.ix_iz.numer`.
- Kolizje należą do `WorldObject` (dane generatora), nie do modeli. Ruch dzielony na kroki <= promień gracza.
- Punkty charakterystyczne i strefy środowiskowe to dane (`FeatureMap`); żadne konkretne lokacje ani pozycje nie zostały ustalone.

## V1 (zasoby 3D)

- Pakiet: Quaternius Stylized Nature MegaKit **Standard** (CC0, 0 USD), zatwierdzony przez autora; wersji płatnych nie pobieramy. Weryfikacja źródła, licencji i SHA-256 archiwum w [zasoby-3d.md](zasoby-3d.md).
- Skały S/M/L: wariant A (skalowanie `Rock_Medium_1..3`, kontrolowana zmienność proporcji); decyzja prototypowa.
- 31 modeli w grze; martwe drzewa pominięte (ponury ton); stare drzewa skalowane do 0,7.
- GLB zawierają tylko geometrię; tekstury i materiały są wspólne (manifest) - jeden materiał i jedna tekstura na wszystkie instancje i modele.
- Oryginały poza repozytorium (SHA-256 w `scripts/assets/source-hashes.json`); potok deterministyczny, narzędzia w `devDependencies`.
- Ładowanie: własny `AssetLibrary` na `GLTFLoader` + meshopt, bez `@react-three/drei` (kompatybilny, ale niepotrzebny; własny cache daje współdzielone zasoby i testy w Node).
- Kolizje w manifeście to rozmiary sugerowane (koło x-z); wiążące są dane obiektów świata z generatora.
- Profile jakości (LOW/MEDIUM/HIGH) są punktem wyjścia; progi i zmierzone koszty w V2.

## W1a (generator lasu v2)

- Generator v2 był wersją roboczą; zarejestrowany w W1b (patrz niżej).
- Rozszerzenia W0 są kompatybilne wstecz (wstęga, żądania `river`/`trail`, `prepareWorld`, `validate`, indeks chodzenia tylko z kolizjami).
- Rzeka na wschodzie (x ok. 100-106, 10-14 m), przekracza mapę z zapasem; most to tylko dane (punkt, lądowiska, przejście z flagą `bridge.built`).
- Profile środowiskowe to dane (`sunny_forest`, `dense_forest`, `clearing`, `riverside` + tło `mixed_forest`); renderer nie decyduje o rozmieszczeniu.
- Sektor jest funkcją czystą (seed, wersja, wariant, sektor), liczoną leniwie; okno 7 x 7 z różnicami wejścia/wyjścia.
- Kod v2 bez funkcji zależnych od silnika JS (sin, cos, tan itd.) i z zaokrągleniem pozycji; znane wyjątki z W0 (`Math.cos` w `bump`/`pad`) opisane w [swiat-w1a.md](swiat-w1a.md).
- Wartości gęstości profili dobrane liczbowo; ocena wizualna i strojenie w V2.

## V2a (prototyp wizualny)

- Prototyp jest stroną deweloperską `/dev/forest` (tylko development) i nie dotyka `ForestScene`, mechaniki, zapisów ani rejestru generatorów.
- Las pochodzi wyłącznie z generatora W1a; renderowane okno 3 x 3 sektory wokół sektora wzorcowego, strefa chodzenia: sektor + 15 m.
- Zmiana jakości nie zmienia świata: tylko zasięgi, rzadzenie drobnej roślinności, LOD, cienie, rozdzielczość i efekty.
- Domyślnie zielone odmiany: czerwone liście starych drzew i krzewu przekolorowane na zielono w shaderze, fioletowe `plant.7*` ukryte w widoku; niebieskie, różowe i pomarańczowe odmiany zostają na strefy magiczne.
- Instancing V1 rozszerzony zgodnie wstecz (`updateWith`); LOD z histerezą i rozrzutem progów zamiast billboardów.
- Żadnego progu FPS nie uznajemy za osiągnięty bez pomiaru autora (instrukcja w [prototyp-v2a.md](prototyp-v2a.md)).

## V2b (jakość wizualna)

- V2a zatwierdzone technicznie; wyniki M3 Max (HIGH, `?stress=49`): średnio 60 FPS, 1% low 56,8 FPS, ok. 2,35 mln trójkątów, 106 draw calls. Nie przerzedzamy lasu ani nie zmniejszamy gęstości tylko z powodu przekroczenia wcześniejszego budżetu trójkątów.
- Przyczyny zbyt ciemnych drzew to płaskie, ciemne tekstury liści (sosna 0,075 luminancji liniowej), twarde cienie z pełnym zasłanianiem słońca (usunięty w Three 0.186 `PCFSoftShadowMap`) i mało światła w cieniu, a nie błąd przestrzeni kolorów ani materiałów. Naprawa jest w materiałach (paleta) i cieniach, a nie w samym podbiciu światła.
- Wygląd regulują presety: ORIGINAL (V2a, bez zmian), NATURAL (domyślny), FAIRYTALE; przełączają się bez przeładowania modeli i świata (uniformy shaderów, światła, tekstura gruntu).
- Paleta ma zostawić pomarańczowe, niebieskie i różowe odmiany na strefy magiczne; nie zmieniamy ID modeli ani manifestu.
- Krzywa dnia V2b ("lato", wschód 5:00, zachód 21:00) obowiązuje w NATURAL i FAIRYTALE; ORIGINAL ma krzywą V2a (19:00 pod horyzontem).
- Domyślny wygląd lasu w grze: preset `MIASTO_DEFAULT` = charakter ORIGINAL (krzywa dnia V2a, grunt V2a, paleta bez korekt) z suwakami 1,00 / 1,22 / 0,67 / 0,58 / 1,00, mgła 1,58, `#c8dcd2`, 0,00. Godzina nie jest ustalona na stałe, światło reaguje na porę dnia. ORIGINAL, NATURAL i FAIRYTALE zostają w panelu deweloperskim do porównań; dalsze strojenie grafiki wstrzymane do czasu questa.
- Migotanie trawy (V2b): przyczyną było odwracanie normalnej na tylnej ściance `DoubleSide` (normalne trawy wskazują w górę, kierunek trójkątów nie) razem z pochyleniem normalnej `up` = 0,5, które zerowało wektor. Naprawa jest w shaderze materiału `grass` (stała normalna z wierzchołków) i w zabezpieczeniu przed zerem dla liści; nie wyłączamy cieni, nie usuwamy trawy ani nie podnosimy ekspozycji. Atmosferyczne światło wschodu i zachodu (ORIGINAL) pozostaje do osobnej decyzji po ocenie autora.
- Konfiguracja wizualna zapisywana jest jako JSON `forest-visual/1` (kopiowanie i wczytywanie w panelu).

## E2 + Q1 + W1b (quest "Most do nieznanego" - silnik, zapis, świat)

- Zapis SaveV2 z kontrolowaną migracją v1 -> v2; stare zapisy pozostają czytelne (kopie `premigration` i `.bak`). Zachowujemy domy, pieniądze, czas, zdrowie, imię i tutorial; niepoprawna pozycja w lesie przenosi gracza do bezpiecznego punktu wejścia.
- Generator v2 jest zarejestrowany jako bieżący; jego odcisk obejmuje kotwice i skrót planu, kotwice nie są zapisywane (wynikają z seeda i wersji).
- Limit noszenia surowców to jeden stos (20) na rodzaj: depozyt po konfiskacie zawsze mieści się w ekwipunku, więc odzysk nie może zablokować questa.
- Surowce, narzędzia i schemat są niezbywalne (`discardable: false`): nie da się zmarnować skończonej puli. Odrzucić można tylko jedzenie.
- Kolejność odzysku z depozytu: najpierw przedmioty niezbywalne, żeby ewentualny brak miejsca dotknął jedzenia.
- Odrodzenie zachowuje narzędzia i surowce (`keepOnDeath`), traci jedzenie.
- Troll: pierwsza nieudana konfrontacja zabiera wszystko poza telefonem (pieniądze zostają), blokada do następnego dnia gry; błędna odpowiedź to blokada +1 godzina (zawsze `max` z istniejącą); zamknięcie okna zagadki nie zużywa próby; kolejność zagadek to stabilne tasowanie ze strumienia `troll.riddles`.
- Pauza: dialog dodaje własną przyczynę systemową (`system.dialog`, z `state.dialog`); zegar rusza dopiero, gdy nie ma żadnej przyczyny.
- Most zbudowany przed przyjęciem questa kończy quest przy przyjęciu. Toast ukończenia questa zastępuje toast budowy mostu.
- Silnik ufa klientowi co do `at` (pozycji gracza) i identyfikatora pozyskiwanego obiektu w granicach zasięgu kotwic; pełna weryfikacja po stronie serwera nie jest potrzebna dla gry lokalnej.
- Wada znaleziona przez walidator na 200 seedach (skała na osi mostu) naprawiona strefami `poi.bridge_axis_*`.

## UI1 + F1 (tablica ogłoszeń i las 3D w grze)

- Logika questa zostaje w silniku; komponenty React tylko wyświetlają `questProgress` i wysyłają komendy `board.read` / `quest.accept`.
- Las w grze to renderer prototypu `/dev/forest` w trybie streamingu; stary las r3f usunięty.
- Kolizje lasu są globalne (jeden `WalkWorld` ze wszystkimi colliderami), niezależne od streamingu renderowania.
- Promienie streamingu: LOW 2, MEDIUM 3, HIGH 4 sektory; MEDIUM domyślnie, wybór zapamiętany w przeglądarce.
- Czas gry jest wstrzymany na czas ładowania lasu; godzina i światło w lesie wynikają z zegara gry.
- Pozycja na moście i wschodnim brzegu jest poprawna w zapisie tylko po `bridge.built`.

## M1 + C1 (skrzynie, interakcje, minimapa)

- Skrzynie leżą dokładnie na kotwicach W1b; generator i jego wersja bez zmian. Model GLB od autora zachowuje kolory wierzchołków; normalne liczy potok.
- Skrzynie renderowane jako dwie siatki instancjonowane (korpusy, pokrywy): stała liczba wywołań rysowania, niezależna animacja pokryw.
- Logika interakcji jest w czystym `ForestInteractor` (testowalnym bez przeglądarki); React wyświetla podpowiedź i okno, a stan skrzyń, zebranych obiektów i ekwipunku pochodzi ze stanu gry.
- E przy celu interakcji ma pierwszeństwo przed jedzeniem; bez celu zachowanie bez zmian.
- Zebrane drzewa i skały znikają (bez pniaków) i tracą kolizję; to uproszczenie do ewentualnej zmiany po ocenie.
- Minimapa nie zdradza położenia skrzyń ani trolla: tylko orientacyjne koła poszukiwań dla celów bieżącego etapu, z przesuniętym środkiem. Mgła odkrywania zostaje na M2.
- Tracker i dziennik pokazują postęp surowców także poza etapem materiałów (`QuestView.parallel`), bo etap trolla nie jest jeszcze dostępny w grze.

## Otwarte

- Sprzęt referencyjny dla progów FPS (HIGH, LOW).
- Treść dwóch zapowiedzi na tablicy.
- Interfejs questa: tablica, dziennik i tracker są w grze (UI1); skrzynie, pozyskiwanie i minimapa w 3D są w grze (M1 + C1); troll i budowa mostu (T1, R1) jeszcze nie istnieją; silnik jest gotowy i przetestowany.
- Tutorial jako maszyna kroków (zastąpienie `tutorialDone`).
- Wygląd trolla (pod kątem dzieci od 8 lat).
- Skały S/M/L i paprocie: wybrano wariant A (V1); decyzja o B (inny pakiet CC0) lub C (płatna wersja Pro, wymaga zgody autora) po ocenie wizualnej w V2 - patrz [zasoby-3d.md](zasoby-3d.md).
- Ocena wizualna modeli (które kolory liści zostają, jakość LOD1, potrzeba billboardów) i progi profili jakości - V2.
- Piła: brak zweryfikowanego kandydata CC0.
- Przegląd drenażu życia pod kątem dzieci (zima: -1% co 5 s w nocy) - osobna propozycja; wartości na razie bez zmian.
- Troll i skrzynia: finalne modele autora; troll ma od 19 października animowany plik (7 klipów, w tym Idle) z testowym spotkaniem i dialogiem (bez zagadek); patrol jest prezentacją do czasu T1. Do decyzji autora: klip Talk, niższa rozdzielczość atlasu trolla na słabszym sprzęcie, czy E ma prowadzić do testowego okna, czy do prawdziwego dialogu T1 (przy T1).

## Animowany troll i testowe spotkanie (19 października 2026)

- Nowy plik autora `forest_troll_animated.glb` (Blender + Mixamo, 7 klipów w miejscu) zastępuje poprzedni model trolla w grze; stary oryginał zostaje w `assets/source`. Skala wysokości 2,7 m jak dotąd; kotwica W1b, generator lasu i `MIASTO_DEFAULT` bez zmian.
- Zachowanie wobec gracza wyłącznie z odległości: alert < 20 m (wyjście > 22 m, zwłoki 0,3 s i 1,5 s), zauważenie < 5 m (obrót całego ciała, `Surprised` raz, potem okno); nowe spotkanie dopiero po oddaleniu o > 10 m i zbliżeniu, E z bliska albo F4 (dev).
- Okno testowe (PRAWIDŁOWY -> `Happy` + `Dance`, ZŁY -> `Angry`) nie zmienia stanu gry, zapisu ani questa: jedynym wejściem do zachowania trolla jest `resolveDialog`, które przejmie prawdziwy system T1.
- Konfiskata, teleport gracza i blokada do następnego dnia po ZŁY nie istnieją w tym teście (to rzecz T1 i wymaga osobnej decyzji).
- Animator liczy wagi przejść sam (suma 1), zamiast `crossFadeFrom` miksera, bo przerwane przejście dawało sumę > 1 (skok pozy).

## Animowany jeleń (19 października 2026)

- Jeden jeleń w lesie jako test zwierzęcia (nie system fauny); szczegóły w [jelen.md](jelen.md). Prezentacja bez wpływu na silnik, zapis, generator i `MIASTO_DEFAULT`.
- Położenie z danych lasu (21-29 m od wejścia), deterministyczne; zachowanie: spacer w promieniu 4,5 m, alert < 10 m, spokojne odejście bez galopu.
- Do decyzji autora: wygląd i pochylenie w marszu, galop i Idle (potrzebne klipy), czy jeleń ma być w przyszłości w zapisie, rozszerzenie na inne zwierzęta.
