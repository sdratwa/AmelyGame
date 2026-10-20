# Test ręczny: pierwszy quest "Most do nieznanego"

Scenariusz dla autora. Agent **nie** uruchamiał gry, przeglądarki, Vitest, lint, typecheck ani build (zakaz z reguł projektu): wszystko poniżej jest do sprawdzenia przez Ciebie. Każdy krok ma trzy pola: **Zrób**, **Powinno być**, **Błąd, jeśli**.

## Przygotowanie

- Adres lokalny: `http://localhost:43217` (start: `npm run dev`, port 43217, nasłuch na wszystkich interfejsach).
- Przeglądarka z włączoną akceleracją sprzętową (WebGL), okno w normalnym rozmiarze. Najlepiej Chrome lub Edge.
- Skróty w lesie: **W A S D** ruch, **Shift** bieg, mysz rozglądanie (kliknij w scenę), **E** interakcja, **I** ekwipunek, **J** dziennik, **M** minimapa, **O** (albo F3) panel diagnostyczny, **Esc** zamknięcie okna / zwolnienie myszy (kolejny Esc wraca do miasta).
- Pomocnicze adresy: `http://localhost:43217/?reset=1` czyści zapis; `http://localhost:43217/?speed=20` przyspiesza czas gry (przydatne do świtu i zmierzchu, ale lepiej użyć przycisków w panelu O, patrz sekcja E).
- Panel O w trybie deweloperskim (`npm run dev`) ma przyciski zegara **ŚWIT 06:00 / DZIEŃ 12:00 / ZMIERZCH 19:30 / NOC 01:00**, "Powtórz spotkanie" i (po zbudowaniu mostu) sekcję "Most" z przyciskiem markerów latarni.
- Zagadki trolla są liczbowe. Ściąga odpowiedzi (z `src/lib/game/content/riddles.ts`) jest na końcu dokumentu; troll losuje jedną z 13.

---

## A. Start nowej gry

### A1. Nowa gra

- **Zrób:** otwórz `http://localhost:43217/?reset=1` (czyści stary zapis). Podaj imię, zatwierdź. Poczekaj na ładowanie świata.
- **Powinno być:** mapa miasta (widok z góry): Żabka, wejście do lasu, tablica ogłoszeń. U góry podpowiedź: "Podejdź do tablicy ogłoszeń (wykrzyknik) i przyjmij zadanie. Dopiero potem ruszysz do lasu." **Wykrzyknik jest od razu przy TABLICY OGŁOSZEŃ** (z napisem "nowe zadanie!"), nie przy lesie ani przy innym budynku. Wejście do lasu nie działa, dopóki nie przyjmiesz zadania.
- **Błąd, jeśli:** wykrzyknik jest gdzie indziej niż przy tablicy; da się wejść do lasu przed przyjęciem zadania; w górnym pasku brak życia i pieniędzy (start 1 000 000 zł); pasek ekwipunku na dole nie jest **pusty** (patrz sekcja G).

### A2. Przyjęcie zadania

- **Zrób:** kliknij tablicę ogłoszeń, wybierz "Most do nieznanego", **Przyjmij zadanie**.
- **Powinno być:** komunikat "Przyjęto zadanie: Most do nieznanego"; wykrzyknik znika; tracker zadania (etap 1/5 "Schemat mostu") i wpis w dzienniku J; las staje się dostępny.
- **Błąd, jeśli:** brak komunikatu; zadanie da się przyjąć drugi raz; tracker pokazuje etapy z narzędziami lub materiałami zamiast schematu.

### A3. Wejście do lasu

- **Zrób:** kliknij wejście do lasu. Poczekaj na koniec ładowania, kliknij w scenę (mysz zablokowana).
- **Powinno być:** widok pierwszoosobowy z samym otoczeniem, bez ręki i bez telefonu na ekranie. Pasek ekwipunku u dołu jest pusty.
- **Błąd, jeśli:** na dole ekranu widać dłoń, telefon lub inny model "w ręku".

---

## B. Troll i schemat

### B1. Obszar poszukiwań trolla

- **Zrób:** w lesie naciśnij **M**.
- **Powinno być:** na minimapie jest **tylko jeden** obszar poszukiwań, związany ze schematem (troll i skrzynia ze schematem). Obszar jest orientacyjny (okrąg, nie punkt) i nie zdradza skrzyń z narzędziami.
- **Błąd, jeśli:** widać obszary skrzyń z piłą i kilofem lub miejsce budowy już na tym etapie.

### B2. Podejście do trolla

- **Zrób:** idź w stronę obszaru z minimapy (troll patroluje obok skrzyni ze schematem; dystans do niego pokazuje panel O).
- **Powinno być:** troll zauważa Cię (zmiana animacji). Przy dojściu na kilka metrów pojawia się podpowiedź "Porozmawiaj z trollem" (E).
- **Błąd, jeśli:** troll nie reaguje; skrzynia ze schematem otwiera się bez trolla.

### B3. Rozmowa: obie opcje zostają

- **Zrób:** naciśnij **E** przy trollu.
- **Powinno być:** okno "Troll leśny" z dwoma przyciskami: **Spróbuję cię pokonać!** i **Może się dogadamy?** oraz link "Odejdź bez rozmowy (Esc)". Czas gry jest zatrzymany, ruch zablokowany.
- **Błąd, jeśli:** brakuje którejś opcji; w oknie widać testowe przyciski PRAWIDŁOWY / ZŁY (te są tylko w trybie dev z otwartym panelem O, patrz niżej).

### B4. Zagadka: odpowiedź błędna

- **Zrób:** wybierz "Może się dogadamy?". Wpisz złą liczbę (np. 1) i kliknij **Odpowiadam**.
- **Powinno być:** troll reaguje (animacja niezadowolenia), komunikat "To nie jest dobra odpowiedź. Troll prosi, abyś pomyślał i wrócił za godzinę." Skrzynia nadal pilnowana. Ponowna rozmowa przed upływem godziny gry: troll odmawia i podaje, ile jeszcze czekać. Nie dostajesz żadnej trwałej kary.
- **Błąd, jeśli:** zamknięcie okna bez odpowiedzi liczy się jako próba; błędna odpowiedź blokuje quest na stałe.

### B5. Zagadka: odpowiedź prawidłowa

- **Zrób:** po upływie blokady (albo od razu, jeśli pierwsza odpowiedź ma być dobra) porozmawiaj z trollem i wpisz poprawną liczbę ze ściągi. Przycisk "Podpowiedź" jest dostępny.
- **Powinno być:** troll się cieszy (animacja radości), komunikat "Brawo! Troll odsuwa się od skrzyni…", troll przestaje pilnować skrzyni.
- **Błąd, jeśli:** po dobrej odpowiedzi troll nadal blokuje skrzynię; brak komunikatu; animacja gniewu zamiast radości.

### B6. Skrzynia ze schematem (nigdy automatycznie)

- **Zrób:** podejdź do skrzyni ze schematem (3-4 m od trolla). Podpowiedź "Otwórz skrzynię" (E). Naciśnij **E**, poczekaj na animację pokrywy, w oknie skrzyni wybierz **Zabierz** (lub E).
- **Powinno być:** skrzynia otwiera się dopiero po Twoim E; schemat **nie** wskakuje do ekwipunku sam; po wzięciu: komunikat **"Zdobyto schemat mostu"**; przedmiot widoczny w ekwipunku (**I**) z przyciskiem **Czytaj**; dziennik (**J**) i tracker przechodzą do etapu "Narzędzia". Przycisk "Czytaj" otwiera okno schematu z wymaganiami (Drewno 5, Kamień 10) i informacją, że potrzebne są piła i kilof. Tracker pokazuje już **Drewno 0/5 i Kamień 0/10** oraz wskazówkę o narzędziach.
- **Błąd, jeśli:** schemat pojawia się bez otwarcia skrzyni; brak komunikatu; schematu nie można ponownie przeczytać z ekwipunku; wymagania w oknie różnią się od 5 i 10.

### B7. Droga alternatywna: walka z trollem (konfiskata)

Do osobnego przejścia (na nowej grze, po przyjęciu zadania).

- **Zrób:** zbierz coś do ekwipunku (np. kup jedzenie w sklepie), wejdź do lasu, porozmawiaj z trollem i wybierz **Spróbuję cię pokonać!**.
- **Powinno być:** krótka, niebrutalna scena (troll reaguje gniewem), komunikat "Troll był szybszy! Zabrał twoje rzeczy i odesłał cię do miasta. Wróć jutro i rozwiąż jego zagadkę.", ekwipunek jest **pusty** (nic nie jest "chronione", telefonu już nie ma), pieniądze zostają, w dzienniku cel "Odzyskaj przedmioty od trolla". Ponowna rozmowa dopiero **od następnego dnia gry**; wtedy troll daje już tylko zagadkę (opcja walki znika). Dobra odpowiedź zwraca cały depozyt.
- **Błąd, jeśli:** zniknęły pieniądze; po odpowiedzi nie wraca depozyt; quest nie da się ukończyć.

---

## C. Narzędzia i surowce

### C1. Dwie skrzynie z narzędziami

- **Zrób:** po zdobyciu schematu naciśnij **M**.
- **Powinno być:** dwa obszary (piła i kilof), brak obszaru trolla; kolejność odwiedzin dowolna.
- **Błąd, jeśli:** skrzynie z narzędziami otwierają się **przed** zdobyciem schematu (przed schematem komunikat: "Skrzynia jest zamknięta. Najpierw zdobądź schemat mostu.").

### C2. Otwarcie i wzięcie narzędzi

- **Zrób:** dojdź do każdej skrzyni, **E**, animacja, **Zabierz**.
- **Powinno być:** komunikaty "Zdobyto: Piła" i "Zdobyto: Kilof"; oba w ekwipunku (I) jako przedmioty zadania/narzędzia; w dzienniku odhaczone "Znajdź piłę" i "Znajdź kilof"; etap przechodzi na "Materiały".
- **Błąd, jeśli:** narzędzie wpada samo; po zabraniu skrzynia da się wyczyścić drugi raz (podwójne narzędzie).

### C3. Drewno 5 i kamień 10

- **Zrób:** podejdź do drzewa (patrz na nie, z piłą podpowiedź "Zetnij … drzewo (drewno +N)", bez piły "Potrzebujesz piły, aby ściąć to drzewo.") i naciśnij E; podobnie przy skałach z kilofem. Zbieraj, aż będzie **Drewno 5/5** i **Kamień 10/10** (większe drzewa i skały dają więcej; limit stosu 20 sztuk).
- **Powinno być:** bez narzędzia tylko podpowiedź o braku narzędzia (po E komunikat błędu) i brak zmian; z narzędziem drzewo/skała znika (także z kolizji), surowiec trafia do ekwipunku; tracker i dziennik (J) na bieżąco pokazują **Drewno X/5, Kamień X/10**; po spełnieniu obu pojawia się etap "Budowa" z tekstem **"Masz już wszystkie potrzebne materiały. Odszukaj miejsce budowy mostu."** Nadwyżka surowców jest dozwolona.
- **Błąd, jeśli:** ten sam obiekt da się zebrać dwa razy; tracker pokazuje inne liczby niż ekwipunek; po zebraniu surowców nie pojawia się etap budowy.

### C4. Minimapa po zebraniu materiałów

- **Zrób:** naciśnij **M**.
- **Powinno być:** znika obszar zbierania; pojawia się **obszar budowy przy rzece** (ikona młotka), orientacyjny.
- **Błąd, jeśli:** na minimapie wciąż stare obszary skrzyń; brak obszaru budowy.

---

## D. Budowa mostu

### D1. Miejsce budowy

- **Zrób:** idź do rzeki wg minimapy (zachodni brzeg, w pobliżu dawnego mostu).
- **Powinno być:** rzeka bez mostu blokuje przejście (nie wejdziesz do wody). W odległości do ok. 6 m od zachodniego lądowiska podpowiedź **"Zbuduj most" [E]**. Bez schematu zamiast tego byłby tekst "Tutaj kiedyś stał most." (bez klawisza).
- **Błąd, jeśli:** podpowiedź pojawia się daleko od rzeki; brak podpowiedzi mimo schematu i bycia przy brzegu.

### D2. Okno budowy

- **Zrób:** naciśnij **E** (mysz się zwalnia, czas stoi).
- **Powinno być:** okno "Budowa mostu": **Drewno 5/5**, **Kamień 10/10**, **Schemat: posiadany**, przycisk **ZBUDUJ MOST** aktywny; **Anuluj** zamyka okno bez zmian. Samo E **nie** buduje mostu.
- **Błąd, jeśli:** most buduje się od razu po E; przycisk aktywny mimo braku materiału (np. 4/5 → przycisk wyłączony).

### D3. Budowa

- **Zrób:** kliknij **ZBUDUJ MOST**.
- **Powinno być:** komunikat "Most odbudowany! Przejdź na drugą stronę rzeki."; most **wyrasta** z gruntu przez ok. 1,2 s (krótka animacja); w ekwipunku znika dokładnie **5 drewna i 10 kamienia** (nadwyżka zostaje), schemat zostaje; tracker: etap "Przeprawa". Okno się zamyka. Ponowne E przy brzegu nie buduje drugiego mostu i nie zabiera materiałów.
- **Błąd, jeśli:** materiały zniknęły podwójnie; po ponownym E widać okno budowy; most nie pojawia się (sprawdź panel O: sekcja "Most", pole błędu "model mostu"; to ważne zgłoszenie).

### D4. Wygląd i proporcje mostu (ocena wizualna, tylko Ty)

- **Zrób:** obejrzyj most z brzegu, z boku (z daleka) i ze środka pokładu.
- **Powinno być:** drewniany most długości ok. **19-23 m** (zależnie od szerokości rzeki), użytkowa szerokość ok. 4,4 m, poręcze i słupki o naturalnych proporcjach (deski, słupki i latarnie **nie** są rozciągnięte; środek to powielone segmenty), płynne wejście i zejście, bez "schodka" na końcach; model nie zapada się w ziemię ani nie wisi nad brzegiem.
- **Błąd, jeśli:** widoczne szwy / skoki między segmentami (zwłaszcza łuk pokładu), rozciągnięte deski, pokład pod terenem lub nad brzegiem, dziury między pokładem a brzegiem. Opisz miejsce (początek, środek, koniec) i, jeśli możesz, numer seeda (Diagnostyka O: sektor/pozycja).

### D5. Przejście na drugi brzeg

- **Zrób:** idź środkiem mostu na wschód i dalej kilka metrów za lądowisko.
- **Powinno być:** wejście na most jest płynne; kamera idzie po pokładzie (lekki łuk, bez skoków); poręcze nie pozwalają zejść do wody po bokach; za mostem nowy obszar: komunikat **"Odkryto nowy obszar!"**, a po chwili komunikat o ukończeniu zadania z nagrodą (**+5000 zł**, odznaka **Odkrywcy**). Na wschodnim brzegu wolno chodzić.
- **Błąd, jeśli:** kamera "zapada się" lub skacze na moście; można wejść do rzeki obok mostu; komunikat odkrycia nie pojawia się mimo dojścia za most; brak nagrody lub odznaki.

### D6. Powrót i dziennik

- **Zrób:** wróć mostem na zachodni brzeg, otwórz **J**.
- **Powinno być:** powrót działa tak samo; w dzienniku quest w sekcji "Ukończone", nagroda 5000 zł, odznaka Odkrywcy w sekcji "Odznaki". Portfel zwiększył się dokładnie o 5000 zł **raz**.
- **Błąd, jeśli:** nagroda wypłacona dwa razy (np. po ponownym przejściu) albo quest cofa się do etapu "Przeprawa".

---

## E. Latarnie (nocą)

Po zbudowaniu mostu, najlepiej stojąc na moście lub obok. Wszystkie godziny ustawiasz w **panelu O** (przyciski czasu, tylko w trybie dev) albo `?speed=20`. Pamiętaj, że przyciski przesuwają zegar gry **do przodu** do wskazanej godziny.

| Przycisk | Godzina | Spodziewany poziom latarni |
| --- | --- | --- |
| DZIEŃ 12:00 | 12:00 | wyłączone (0) |
| ZMIERZCH 19:30 | 19:30 | ok. połowa (0,5), dalej rośnie do 21:00 |
| NOC 01:00 | 01:00 | pełne (1) |
| ŚWIT 06:00 | 06:00 | ok. 0,74 i gaśnie do 08:00 |

W panelu O sekcja "Most" pokazuje bieżący "poziom" i liczbę "aktywnych świateł" (maks. 3 jednocześnie, tylko najbliższe latarnie).

### E1. Dzień

- **Zrób:** DZIEŃ 12:00.
- **Powinno być:** latarnie nie świecą, nic nie "żarzy się" na moście; panel: poziom 0.
- **Błąd, jeśli:** widać ciepłe plamy światła w dzień.

### E2. Zmierzch

- **Zrób:** ZMIERZCH 19:30, potem zostaw grę na kilka minut albo użyj `?speed=20` do 21:00.
- **Powinno być:** latarnie **stopniowo** się zapalają (godz. 18-21): małe ciepłe świecące powierzchnie i miękkie ciepłe światło (ok. 2400 K) na pokładzie i poręczach, bez cieni od latarni, bez bloomu.
- **Błąd, jeśli:** latarnie włączają się skokowo; światło zimne/białe; pokład jako całość świeci jak emisyjny; widać latarnie przed zbudowaniem mostu.

### E3. Noc

- **Zrób:** NOC 01:00, przejdź się po moście i obok.
- **Powinno być:** wszystkie latarnie świecą jednakowo; ciepłe plamy światła przesuwają się przy chodzeniu (świecą tylko najbliższe 3 źródła; to zamierzone cięcie kosztu); latarnie po obu stronach pokładu, symetrycznie, nie przy samych końcach mostu; FPS bez wyraźnego spadku.
- **Błąd, jeśli:** światła "przeskakują" w widoczny, irytujący sposób; brak latarni po jednej stronie; latarnie nie zgadzają się z modelem (świeci coś obok lampy, nie lampa). Pomoże przycisk **Markery latarni** w panelu O (różowe oktaedry pokazują pozycje punktów): jeśli markery nie leżą na lampach modelu, zgłoś; pozycję i jasność można poprawić w `BRIDGE_LAMP_CONFIG` (`src/lib/forest-view/bridgeLamps.ts`: `offset`, `glowRadius`, `intensity`, `kelvin`).

### E4. Świt

- **Zrób:** ŚWIT 06:00, potem czekaj do 08:00 (albo `?speed=20`).
- **Powinno być:** latarnie **stopniowo** gasną między 5:00 a 8:00; o 08:00 są wyłączone.
- **Błąd, jeśli:** nagłe wyłączenie; latarnie wciąż świecą w pełnym dniu.

### E5. Czego nie powinno być

- Brak lamp przed zbudowaniem mostu (także nocą).
- Światło lamp nie zmienia ogólnego oświetlenia lasu (preset MIASTO_DEFAULT bez zmian).

---

## F. Zapis

### F1. Kiedy zapisać

- **Zrób:** po zbudowaniu mostu poczekaj chwilę (ok. 1 s); zapis dla kamieni milowych (budowa mostu, odkrycie obszaru, ukończenie zadania) jest natychmiastowy. Dla pewności wróć do miasta (Esc, Esc).
- **Powinno być:** gra zapisuje się sama; wskaźnik zapisu w górnym pasku bez błędu.
- **Błąd, jeśli:** wskaźnik zapisu pokazuje błąd.

### F2. Odświeżenie i kontynuacja

- **Zrób:** odśwież stronę (`http://localhost:43217` **bez** `?reset=1`). Wybierz **Kontynuuj**. Wejdź do lasu.
- **Powinno być:** ten sam stan: pieniądze, ekwipunek (bez drewna/kamienia, które zużył most, nadwyżka została), most **stoi od razu bez animacji pojawiania się**, kolizje nadal działają (rzeka obok mostu blokuje, po moście można przejść w obie strony), po zmianie godziny na noc latarnie świecą. Quest ukończony, odznaka w dzienniku.
- **Błąd, jeśli:** most znika po wczytaniu, trzeba go budować drugi raz, rzeka jest przechodnia obok mostu albo most jest "duchem" (da się przejść przez poręcz).

### F3. Brak podwójnych nagród

- **Zrób:** po wczytaniu przejdź znowu przez most w obie strony, ponownie otwórz tablicę ogłoszeń.
- **Powinno być:** zadanie oznaczone jako ukończone, nie da się go przyjąć ponownie, portfel nie rośnie, odznaka nadal jedna.
- **Błąd, jeśli:** kolejne +5000 zł lub druga odznaka.

### F4. Stary zapis (opcjonalnie)

Jeśli masz zapis sprzed tej zmiany (SaveV2 z telefonem w pierwszym slocie): **Kontynuuj** powinno wczytać go bez błędu; telefon znika, reszta przedmiotów zostaje na swoich miejscach, pieniądze, domy i postęp bez zmian. Kopie przed migracją (`miasto.save.premigration.v2.*`, `miasto.save.bak`) powstają w `localStorage`. Błąd: komunikat o niepoprawnym zapisie albo utrata przedmiotów/domów.

---

## G. Usunięcie telefonu i ręki

### G1. Ekwipunek

- **Zrób:** nowa gra (`?reset=1`), naciśnij **I** w lesie i spójrz na pasek slotów u dołu.
- **Powinno być:** wszystkie 8 slotów puste; w liście ekwipunku (I) brak pozycji "Telefon". Po zakupie czegokolwiek w Żabce przedmiot trafia do **slotu 1**. Po śmierci i odrodzeniu: jedzenie przepada, narzędzia/schemat/materiały zostają, żadnego telefonu.
- **Błąd, jeśli:** w slocie 1 jest telefon (📱) albo jakakolwiek wzmianka o telefonie w ekranach startowych, śmierci lub wskazówkach (napisy "Masz telefon", "Telefon zawsze zostaje z Tobą"). Numery telefonów **właścicieli domów** w karcie domu to osobna sprawa (zostały).

### G2. Widok pierwszoosobowy

- **Zrób:** w lesie rozejrzyj się myszą, idź, biegnij (Shift), zaznacz inny slot klawiszem lub kliknięciem.
- **Powinno być:** ekran pokazuje wyłącznie otoczenie i interfejs (życie, pasek slotów, podpowiedzi); **żadnej ręki ani trzymanego przedmiotu** w kadrze, niezależnie od wybranego slotu.
- **Błąd, jeśli:** w prawym dolnym rogu widać dłoń, telefon lub emoji przedmiotu "w ręku".

### G3. Funkcje, które mają działać dalej

- **Zrób:** otwórz **I** (ekwipunek), **J** (dziennik), **M** (minimapa).
- **Powinno być:** wszystkie trzy otwierają się i zamykają (klawisz lub Esc), działają w mieście i w lesie.
- **Błąd, jeśli:** któryś panel się nie otwiera lub zawiesza ruch po zamknięciu.

---

## Zgłaszanie wyników

Dla każdego kroku podaj: numer (np. D3), co zobaczyłeś, ewentualnie seed i pozycję z panelu O oraz wpisy z konsoli przeglądarki (zwłaszcza błędy "Most:" i ostrzeżenia WebGL). Agent poprawia wyłącznie na podstawie Twoich wyników; testy automatyczne były **napisane, ale nie uruchamiane**.

## Ściąga: zagadki trolla (poprawne odpowiedzi)

| Zagadka | Odpowiedź |
| --- | --- |
| 3 kosze po 7 jabłek, 5 zjedzonych | 16 |
| 14 + 9 grzybów | 23 |
| 30 żołędzi, 12 zakopanych | 18 |
| 6 rzędów po 4 kłody | 24 |
| 25 ptaków, 8 odleciało, 3 wróciły | 20 |
| 5 woreczków po 8 kamieni, daje 2 | 16 |
| 48 jagód na 6 dzieci | 8 |
| 17 + 26 ryb | 43 |
| 50 desek, zostało 18 | 32 |
| 4 zające po 4 łapy | 16 |
| 9 + 12 lampionów, 7 zgasło | 14 |
| 7 szyszek, troll ma 3 razy więcej | 21 |
| 4 podróżnych po 15 monet | 60 |
