# Quest "Most do nieznanego" (`quest.bridge_01`)

Pierwszy kompletny quest i samouczek. Wymaganie: gra dla dzieci od 8 lat, bez brutalności.

## Fabuła

Mały las pozostaje w większości niezbadany. Dawny drewniany most nad rzeką został zniszczony. Tablica ogłoszeń prosi o jego odbudowę. Po ukończeniu gracz uzyskuje dostęp do nowego obszaru.

Ogłoszenie: "Dawny most nad rzeką został zniszczony. Bez niego nie możemy dotrzeć do dalszej części lasu. Potrzebujemy kogoś odważnego, kto odnajdzie stary plan mostu, zgromadzi materiały i pomoże go odbudować." Przycisk: "Podejmij zadanie".

## Tablica ogłoszeń

Nowa klikalna lokacja na mapie 2D: drewniana tablica w centralnym punkcie miasta. Wykrzyknik nad tablicą, gdy jest nieprzeczytane ogłoszenie; znika po zapoznaniu się (przeczytane != zaakceptowane). Statusy: Niedostępny, Dostępny, Aktywny, Ukończony. Na tablicy: pierwszy quest oraz dwie zapowiedzi przyszłych zadań (status "Niedostępny"; treści robocze). Quest ma: ID, tytuł, opis, status, podzadania, warunki rozpoczęcia i ukończenia, nagrody, opcjonalne zależności.

## Etapy i podzadania (dane, wyliczane ze stanu gry)

1. Narzędzia: `item.pickaxe`, `item.saw` (dowolna kolejność; wczesne znalezienie liczy się dzięki `ledger.obtained`).
2. Schemat: `item.bridge_blueprint` (po zagadce trolla albo po odzyskaniu depozytu).
3. Materiały: `resource.wood` 5, `resource.stone` 10 (bieżące zasoby).
4. Budowa: `recipe.bridge_01` w wyznaczonym miejscu przy rzece.

Cel warunkowy "Odzyskaj przedmioty od trolla" jest widoczny, gdy depozyt trolla nie jest pusty. Cele "znaleziono" są monotoniczne, cele ilościowe liczone z bieżącego stanu. Ukończenie questa następuje przy budowie mostu. Odkrycie `region.beyond_bridge` jest osobnym zdarzeniem po przejściu.

Nagroda: 5000 zł i odznaka odkrywcy (`badge.explorer`).

## Skrzynie (pozycje losowane raz przy nowym świecie)

- `chest.bridge.pickaxe` - kilof.
- `chest.bridge.saw` - piła.
- `chest.bridge.blueprint` - schemat mostu, pilnowana przez trolla (`npc.troll.bridge`).

Skrzynie są osiągalne bez przedmiotów z siebie nawzajem, poza wodą, nie przy starcie, z odstępami. Otwarcie jest oddzielone od odebrania zawartości; pełny ekwipunek zostawia przedmiot w skrzyni.

## Troll

Po podejściu zatrzymuje gracza i rozmawia ("Hola, hola! Dokąd to? Ta skrzynia jest pod moją opieką."). Wybory: 1) "Spróbuję cię pokonać!", 2) "Może się dogadamy?".

- Konfrontacja (tylko za pierwszym razem): krótka, niebrutalna scena. Wszystkie przedmioty poza telefonem trafiają do depozytu (tak, także narzędzia), gracz wraca na mapę miasta, troll blokuje interakcję do następnego dnia gry, w dzienniku pojawia się cel odzyskania. Troll nie zabiera pieniędzy.
- Negocjacje i odzyskiwanie: zagadka matematyczna (odpowiedź wpisywana jako liczba). Poprawna odpowiedź: troll gratuluje, odsuwa się, zezwala na otwarcie skrzyni, zwraca depozyt (z uwzględnieniem wolnych miejsc; reszta zostaje u trolla). Błędna: blokada jednej godziny czasu gry.
- Po pierwszej konfrontacji dalsze interakcje odbywają się wyłącznie przez zagadki.
- Zagadki jako dane (ID, treść, poprawna odpowiedź, trudność, typ, wskazówka), min. 10 (dodawanie, odejmowanie, mnożenie, proste rozumowanie), losowanie stabilne w ramach próby. Przykład: 3 kosze po 7 jabłek, oddano 5 -> 16. Poprawna odpowiedź jest weryfikowana w silniku.
- Czas gry zatrzymuje się podczas dialogów i zagadek (centralny mechanizm pauzy).

## Narzędzia i surowce

Kilof: kamień ze skał. Piła: drewno z wybranych drzew. Drzewa małe/średnie/duże = 1/2/5 drewna, skały = 1/2/5 kamienia. Zasoby skończone, zapas >= 3x przed mostem. Po pozyskaniu drzewo zmienia stan (pień), skała znika lub zmienia wygląd. Brak narzędzia: komunikat "Potrzebujesz piły, aby pozyskać drewno" (analogicznie kilof). Drzewa i skały dekoracyjne pozostają elementami otoczenia.

## Schemat i budowa

Schemat jest ogólną recepturą budowlaną (ID, nazwa, opis, ikona, wymagania, warunki użycia, typ budowanego obiektu): "Drewniany most" - 5 drewna, 10 kamieni. Dziennik projektów pokazuje postęp (np. Drewno 3/5, Kamienie 7/10); budowa możliwa wyłącznie w wyznaczonym miejscu przy rzece (komunikaty "Tutaj kiedyś stał most", "Masz wszystko, czego potrzeba, aby odbudować most", przycisk "Zbuduj most"). Budowa jest atomowa: weryfikacja, odjęcie materiałów, animacja, zamiana modelu, aktualizacja kolizji, otwarcie przejścia, zapis stanu mostu, ukończenie questa, nagroda. Nie można odjąć materiałów dwukrotnie ani zbudować mostu drugi raz.

## Rzeka i nowy obszar

Rzeka (w przybliżeniu z północy na południe, we wschodniej części lasu) jest fizyczną granicą: kolizje blokują wodę poza przeprawami. Za rzeką widać fragment `region.beyond_bridge`, niedostępny do czasu budowy. Po przejściu przez most: komunikat "Odkryto nowy obszar!".

## Minimapa i dziennik

Minimapa (`M`): pozycja, kierunek, granice, rzeka, obszary poszukiwań aktywnych podzadań (strefy, nie dokładne punkty); mgła odkrywania później. Dziennik (`J`): aktywny quest, etap, podzadania z postępem, ukończone etapy, opis celu; mały zwijany tracker w HUD. Postęp aktualizuje się automatycznie ze stanu gry.

## Tutorial

Kontekstowy, z zapamiętywaniem kroków: imię, krótkie wprowadzenie, podświetlona tablica, quest, panel zadań, wejście do lasu, ruch i minimapa, pierwsza skrzynia, interakcja i ekwipunek, samodzielna kontynuacja. Jedna podpowiedź naraz. Po wczytaniu zapisu nie zaczyna się od początku.

## Kryteria ukończenia etapu 1

Gracz: uruchamia grę i tutorial, widzi ogłoszenie, podejmuje quest, wchodzi do lasu, otwiera minimapę, znajduje skrzynię z kilofem i z piłą, spotyka trolla, rozwiązuje zagadkę, zdobywa schemat, pozyskuje 5 drewna i 10 kamieni, znajduje miejsce budowy, buduje most, przechodzi, odkrywa nowy obszar, otrzymuje nagrodę i może zamknąć grę oraz wrócić bez utraty postępu. Etap nie jest ukończony, jeśli działa tylko interfejs bez aktualizacji stanu świata.
