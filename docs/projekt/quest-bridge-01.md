# Quest "Most do nieznanego" (`quest.bridge_01`)

Pierwszy kompletny quest i samouczek. Wymaganie: gra dla dzieci od 8 lat, bez brutalności.

## Fabuła

Mały las pozostaje w większości niezbadany. Dawny drewniany most nad rzeką został zniszczony. Tablica ogłoszeń prosi o jego odbudowę. Po ukończeniu gracz uzyskuje dostęp do nowego obszaru.

Ogłoszenie: "Dawny most nad rzeką został zniszczony. Bez niego nie możemy dotrzeć do dalszej części lasu. Potrzebujemy kogoś odważnego, kto odnajdzie stary plan mostu, zgromadzi materiały i pomoże go odbudować." Przycisk: "Podejmij zadanie".

## Tablica ogłoszeń

Nowa klikalna lokacja na mapie 2D: drewniana tablica w centralnym punkcie miasta. Wykrzyknik nad tablicą, gdy jest nieprzeczytane ogłoszenie; znika po zapoznaniu się (przeczytane != zaakceptowane). Statusy: Niedostępny, Dostępny, Aktywny, Ukończony. Na tablicy: pierwszy quest oraz dwie zapowiedzi przyszłych zadań (status "Niedostępny"; treści robocze). Quest ma: ID, tytuł, opis, status, podzadania, warunki rozpoczęcia i ukończenia, nagrody, opcjonalne zależności.

## Etapy i podzadania (dane, wyliczane ze stanu gry)

Kolejność rozgrywki (zmieniona w przebudowie pierwszego questa; wcześniej narzędzia były przed schematem):

1. Schemat mostu: `item.bridge_blueprint`, po rozmowie z trollem i zagadce (albo po odzyskaniu depozytu). Tablica ogłoszeń jest dostępna od początku gry (wykrzyknik od razu przy tablicy, bez wcześniejszego wejścia do lasu).
2. Narzędzia: `item.saw`, `item.pickaxe` (dowolna kolejność, **dopiero po zdobyciu schematu**; wcześniej skrzynie są zamknięte z komunikatem "Najpierw zdobądź schemat mostu"; cele są monotoniczne dzięki `ledger.gained`, więc zużycie lub konfiskata narzędzia nie cofa postępu).
3. Materiały: `resource.wood` 5, `resource.stone` 10 (bieżące zasoby; jedno źródło wymagań: `RECIPE_BRIDGE_01`).
4. Budowa: `recipe.bridge_01` w wyznaczonym miejscu przy rzece, tekst etapu: "Masz już wszystkie potrzebne materiały. Odszukaj miejsce budowy mostu."
5. Przeprawa: przejście przez most na drugi brzeg (`region.beyond_bridge`).

Cel warunkowy "Odzyskaj przedmioty od trolla" jest widoczny, gdy depozyt trolla nie jest pusty. Cele "znaleziono" są monotoniczne, cele ilościowe liczone z bieżącego stanu. Wydanie materiałów na most nie cofa etapu (etapy po zbudowaniu mostu domykają wcześniejsze). Quest kończy się dopiero po odkryciu `region.beyond_bridge` (warunek `beyond.discovered`): nagroda 5000 zł i odznaka wypłacane **raz**, przy pierwszym wejściu w obszar za rzeką po zbudowaniu mostu. Samo zbudowanie mostu quest tylko przesuwa do etapu "Przeprawa".

Minimapa pokazuje wyłącznie obszary bieżącego etapu: schemat (obszar trolla), narzędzia (dwa obszary skrzyń), brak obszarów przy zbieraniu materiałów, miejsce budowy przy rzece, miejsce przeprawy. Nie zdradza przyszłych lokalizacji.

Nagroda: 5000 zł i odznaka odkrywcy (`badge.explorer`).

## Skrzynie (pozycje losowane raz przy nowym świecie)

- `chest.bridge.pickaxe` - kilof.
- `chest.bridge.saw` - piła.
- `chest.bridge.blueprint` - schemat mostu, pilnowana przez trolla (`npc.troll.bridge`).

Skrzynie są osiągalne bez przedmiotów z siebie nawzajem, poza wodą, nie przy starcie, z odstępami. Otwarcie jest oddzielone od odebrania zawartości; pełny ekwipunek zostawia przedmiot w skrzyni.

## Troll

Po podejściu zatrzymuje gracza i rozmawia ("Hola, hola! Dokąd to? Ta skrzynia jest pod moją opieką."). Wybory: 1) "Spróbuję cię pokonać!", 2) "Może się dogadamy?".

- Konfrontacja (tylko za pierwszym razem): krótka, niebrutalna scena. Wszystkie przedmioty trafiają do depozytu (tak, także narzędzia; telefonu w grze już nie ma), gracz wraca na mapę miasta, troll blokuje interakcję do następnego dnia gry, w dzienniku pojawia się cel odzyskania. Troll nie zabiera pieniędzy.
- Negocjacje i odzyskiwanie: zagadka matematyczna (odpowiedź wpisywana jako liczba). Poprawna odpowiedź: troll gratuluje, odsuwa się, zezwala na otwarcie skrzyni, zwraca depozyt (z uwzględnieniem wolnych miejsc; reszta zostaje u trolla). Błędna: blokada jednej godziny czasu gry.
- Po pierwszej konfrontacji dalsze interakcje odbywają się wyłącznie przez zagadki.
- Zagadki jako dane (ID, treść, poprawna odpowiedź, trudność, typ, wskazówka), min. 10 (dodawanie, odejmowanie, mnożenie, proste rozumowanie), losowanie stabilne w ramach próby. Przykład: 3 kosze po 7 jabłek, oddano 5 -> 16. Poprawna odpowiedź jest weryfikowana w silniku.
- Czas gry zatrzymuje się podczas dialogów i zagadek (centralny mechanizm pauzy).

## Narzędzia i surowce

Kilof: kamień ze skał. Piła: drewno z wybranych drzew. Drzewa małe/średnie/duże = 1/2/5 drewna, skały = 1/2/5 kamienia. Zasoby skończone, zapas >= 3x przed mostem. Po pozyskaniu drzewo zmienia stan (pień), skała znika lub zmienia wygląd. Brak narzędzia: komunikat "Potrzebujesz piły, aby pozyskać drewno" (analogicznie kilof). Drzewa i skały dekoracyjne pozostają elementami otoczenia.

## Schemat i budowa

Schemat jest ogólną recepturą budowlaną (ID, nazwa, opis, ikona, wymagania, warunki użycia, typ budowanego obiektu): "Drewniany most" - 5 drewna, 10 kamieni. Dziennik projektów pokazuje postęp (np. Drewno 3/5, Kamienie 7/10); budowa możliwa wyłącznie w wyznaczonym miejscu przy rzece (komunikaty "Tutaj kiedyś stał most", "Masz wszystko, czego potrzeba, aby odbudować most", przycisk "Zbuduj most"). Budowa jest atomowa: weryfikacja, odjęcie materiałów, animacja, zamiana modelu, aktualizacja kolizji, otwarcie przejścia, zapis stanu mostu, ukończenie questa, nagroda. Nie można odjąć materiałów dwukrotnie ani zbudować mostu drugi raz.

### Interakcja budowy (E)

Przy zachodnim lądowisku (do 6 m, bez wymogu patrzenia w konkretny punkt) podpowiedź "Zbuduj most" [E] (ze schematem) albo "Tutaj kiedyś stał most." (bez). E otwiera okno "Budowa mostu": Drewno X/5, Kamień X/10, Schemat posiadany/brak, przycisk ZBUDUJ MOST (aktywny tylko przy komplecie). Okno wstrzymuje czas (powód pauzy `ui.bridge_build`). Komendę `bridge.build` wysyła dopiero przycisk, a silnik **ponownie** sprawdza widok (las), zasięg (8 m od lądowiska), schemat i materiały, w jednej transakcji: zabiera dokładnie 5 drewna i 10 kamienia (nadwyżka zostaje), ustawia `bridge.built`, aktualizuje etap questa. Powtórzenie komendy jest bez skutku. Zapis następuje natychmiast (kamienie milowe: most, odkrycie obszaru, ukończenie zadania).

### Model mostu (`bridge.wooden`)

Źródło: `assets/source/miasto_bridge_optimized.glb` (kopia 1:1 w `public/props/bridge.glb`, wpis w `public/props/props.json`, sha256 `f8758699...87ff18a`, 49 999 trójkątów, jedna siatka z teksturą koloru 2048 i metallicRoughness 1024). Model ma łuk i stałą długość (ok. 1,7 j. modelu), więc **nie jest rozciągany**: w czasie wczytywania siatka jest cięta płaszczyznami z=const na przyczółki (końce z opadającym pokładem), segmenty środkowe (okres belek i słupków ok. 0,21 j.) i segment z latarnią; środek jest składany z powielonych segmentów (po spłaszczeniu łuku), a rozciągnięcie osi wynosi najwyżej 4%. Skala jednostajna 5,8 (użyteczna szerokość ok. 4,4 m, długość pokładu 19-23 m: `2w + 9` dla szerokości rzeki `w` 5-7 m). Układ: `src/lib/game/world/bridgeLayout.ts` (czysty, testowalny), składanie: `src/lib/forest-view/bridgeModules.ts`, warstwa renderera: `src/lib/forest-view/bridge.ts`, wczytywanie: `src/lib/assets/bridge.ts`.

Kolizje i chodzenie (bez pełnej geometrii GLB):

- Przejście przez rzekę: istniejący pas `passage.bridge` (flaga `bridge.built`, półszerokość 2,2 m) generatora lasu. Generator rzeki, szerokość przejścia i `worldSeed` bez zmian. Przed zbudowaniem rzeka blokuje, po zbudowaniu otwarty jest tylko pas mostu.
- Poręcze: dwa proste prostokątne collidery po bokach pokładu dodawane i usuwane razem z flagą (`syncBridgeColliders`).
- Wysokość: teren nadal liczy wyłącznie `terrainHeight`; kontroler gracza dostaje **dodatkową warstwę wysokości pokładu** (`deckHeight`, tylko przy zbudowanym moście; wynik to maksimum z pokładu i terenu, więc oczy nigdy nie schodzą poniżej gruntu). Pokład zaczyna się dokładnie na terenie przy obu lądowiskach i ma płynne podjazdy.
- Wygląd: niewidoczny przed budową; po budowie z krótką animacją wyrastania (ok. 1,2 s), po wczytaniu zapisu od razu stoi.

### Latarnie

`src/lib/forest-view/bridgeLamps.ts`: pozycje wynikają z modelu (lampa co trzeci segment, symetrycznie po obu stronach, nigdy przy samym końcu), konfiguracja w `BRIDGE_LAMP_CONFIG` (barwa 2400 K, natężenie, zasięg, promień świecącej powierzchni, poprawka pozycji). Każda lampa: mała świecąca powierzchnia (`MeshBasicMaterial`, instancjonowana), a światło to stała pula 3 ciepłych, bezcieniowych `PointLight` przydzielanych najbliższym lampom (cięcie dystansowe: 48 m, wygaszanie od 34 m). Bez bloomu, preset MIASTO_DEFAULT bez zmian. Poziom wg godziny gry (ten sam zegar co atmosfera): dzień 8-18 wyłączone, zmierzch 18-21 stopniowo włącza, noc 21-5 pełne, świt 5-8 stopniowo gasi. Brak lamp przed zbudowaniem mostu i w trakcie animacji wyrastania. Markery deweloperskie pozycji: przycisk w panelu O.

## Rzeka i nowy obszar

Rzeka (w przybliżeniu z północy na południe, we wschodniej części lasu) jest fizyczną granicą: kolizje blokują wodę poza przeprawami. Za rzeką widać fragment `region.beyond_bridge`, niedostępny do czasu budowy. Po przejściu przez most: komunikat "Odkryto nowy obszar!".

## Minimapa i dziennik

Minimapa (`M`): pozycja, kierunek, granice, rzeka, obszary poszukiwań aktywnych podzadań (strefy, nie dokładne punkty); mgła odkrywania później. Dziennik (`J`): aktywny quest, etap, podzadania z postępem, ukończone etapy, opis celu; mały zwijany tracker w HUD. Postęp aktualizuje się automatycznie ze stanu gry.

## Tutorial

Kontekstowy, z zapamiętywaniem kroków: imię, krótkie wprowadzenie, podświetlona tablica, quest, panel zadań, wejście do lasu, ruch i minimapa, pierwsza skrzynia, interakcja i ekwipunek, samodzielna kontynuacja. Jedna podpowiedź naraz. Po wczytaniu zapisu nie zaczyna się od początku.

## Kryteria ukończenia etapu 1

Gracz: uruchamia grę i tutorial, widzi ogłoszenie, podejmuje quest, wchodzi do lasu, otwiera minimapę, znajduje skrzynię z kilofem i z piłą, spotyka trolla, rozwiązuje zagadkę, zdobywa schemat, pozyskuje 5 drewna i 10 kamieni, znajduje miejsce budowy, buduje most, przechodzi, odkrywa nowy obszar, otrzymuje nagrodę i może zamknąć grę oraz wrócić bez utraty postępu. Etap nie jest ukończony, jeśli działa tylko interfejs bez aktualizacji stanu świata.
