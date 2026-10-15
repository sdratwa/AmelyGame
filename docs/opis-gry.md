# Gra Miasto — opis stanu gry (do dalszego rozwoju merytorycznego)

Dokument opisuje **to, co jest zaimplementowane** (stan na 14 października 2026), a nie pełną wizję gry. Można go wkleić innemu modelowi jako kontekst. Model ma projektować treść i zasady na tej bazie. Nie zakładaj mechanik, których tu nie ma.

Język interfejsu i fabuły: **polski**. Waluta: **złoty (zł)**.

## Czym jest gra

Przygodowa gra przeglądarkowa dla jednej osoby, bez konta, z automatycznym zapisem w przeglądarce. Gracz podaje imię, dostaje milion złotych i telefon, a potem musi przeżyć w mieście, w którym czas i pogoda zabierają życie. Start: **zima roku 2030**.

Docelowo świat ma się **odkrywać przez eksplorację** (mgła wojny / nieodkryte fragmenty mapy). Tego jeszcze nie ma. Teraz mapa startowa jest od razu w pełni widoczna i ma cztery miejsca: las, sklep i dwa domy na sprzedaż.

Zakres pierwszego wycinka był świadomie wąski („zacznijmy od tego”): jeden ekran świata, jeden las, jeden sklep, dwa domy, ekwipunek, czas i śmierć. Bez fabuły, zadań, NPC, dialogów i wielu lokacji.

## Technologia

- **Next.js 16** (App Router, TypeScript, React 19), **Tailwind CSS 4**, prymitywy **shadcn/ui** (przycisk, dialog).
- Mapa świata: **ilustrowane SVG** (nie kafelki, nie silnik 2D). Las z pierwszej osoby: **three.js + react-three-fiber**.
- Cała logika reguł jest czysta i testowalna w `src/lib/game/engine.ts` (reducer + zegar). Testy: Vitest, `src/lib/game/engine.test.ts`.
- **Brak backendu, bazy i kont.** Stan zapisuje się automatycznie w `localStorage` (wersjonowany zapis z kopią zapasową); po odświeżeniu można kontynuować grę. Szczegóły: `docs/projekt/zapis-gry.md`.
- Dev server: `npm run dev` → port **43217**. Inne: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
- Debug czasu: w adresie `?speed=20` mnoży upływ czasu (1–200). Przydatne do testowania zimy i śmierci.

### Gdzie co leży

- `src/lib/game/engine.ts` — reguły: czas, życie, sklep, ekwipunek, domy, śmierć.
- `src/components/game/GameApp.tsx` — spina fazy i tyka czas (co 250 ms).
- `src/components/game/Screens.tsx` — imię, ładowanie, ekran śmierci.
- `src/components/game/Hud.tsx` — pasek życia/portfela/czasu i ekwipunek.
- `src/components/game/WorldMap.tsx` + `src/components/game/scene/` — scena świata (SVG): teren, ścieżki, las, sklep, domy, dialog domu.
- `src/components/game/ShopInterior.tsx` — wnętrze Żappki.
- `src/components/game/ForestView.tsx` + `ForestScene.tsx` — las FPV.

## Przebieg, który już działa

1. **Imię.** Puste imię jest odrzucane. Maks. 20 znaków.
2. **Ładowanie** (~2,6 s, pasek postępu). W tym momencie powstaje świat z losowego seeda nowej gry (dwa domy).
3. **Mapa świata.** Tutorial: las jest podświetlony z wykrzyknikiem, sklep i domy są wyszarzone i nieklikalne. Trzeba kliknąć las.
4. Do kliknięcia lasu **czas stoi** (życie nie spada, zegar się nie rusza).
5. Po wejściu do lasu tutorial się kończy, czas rusza, a sklep i domy stają się dostępne.
6. Z lasu i ze sklepu wraca się na mapę klawiszem **Esc** albo przyciskiem.

## Mapa świata

Widok z góry, stylizowany na ilustrację (ścieżki z kamienia zbiegające się na placu, drzewa, latarnie, trawa zależna od pory roku, śnieg zimą, winieta). To nie jest siatka pól. Są dwa układy: poziomy (desktop) i pionowy (telefon, `orientation: portrait`).

Cztery klikalne miejsca, zawsze te same:

1. **Las** — gęsty zagajnik, drogowskaz „Las”.
2. **Sklep „Żappka”** — budynek ze żabką, markizą i ladą.
3. **Dom na sprzedaż** i **4. drugi dom** — wygląd z poziomu (niżej).

Noc przyciemnia scenę i rozjaśnia okna oraz latarnie. Zimą na dachach leży śnieg, jesienią pojawiają się dynie, wiosną korony drzew są jaśniejsze i różowe.

## Czas

Liczy się **czas rzeczywisty** od końca tutoriala (`elapsed` w sekundach).

- 1 godzina gry = **20 sekund** rzeczywistych.
- Doba = 24 h gry = **480 sekund** rzeczywistych (8 minut).
- Dzień: **06:00–18:00** (12 h). Noc: 18:00–06:00 (12 h).
- Pora roku = **30 dni** gry. Kolejność: zima → wiosna → lato → jesień → zima…
- Rok startowy **2030**. Po pełnym cyklu 120 dni rok rośnie o 1.
- Na pasku: dzień/noc + godzina, nazwa pory roku, dzień pory (1–30) i rok.

## Życie

Start i maksimum: **100%**. Spadek jest w sekundach rzeczywistych, nie w czasie gry.

| Pora | Dzień | Noc |
|---|---|---|
| Wiosna, lato, jesień | bez spadku | −1% co 10 s |
| Zima | −1% co 10 s | −1% co 5 s |

- Zimą poza schronieniem przy życiu widać **„Jest zimno”**.
- **Schronienie = wyłącznie wnętrze sklepu Żappka.** Tam życie nie spada (czas płynie dalej). Las, mapa i własne domy **nie** dają schronienia.
- Jedzenie leczy (wartości niżej), nigdy powyżej 100%.
- Przy 0% gra się zatrzymuje (ekran śmierci). Po śmierci czas stoi do odrodzenia.

## Śmierć i odrodzenie

Ekran „Nie przetrwałeś” i przycisk „Odrodź się”.

Po odrodzeniu:

- życie 100%, widok mapy świata,
- **zostaje tylko telefon** w slocie 1 (zaznaczenie wraca na slot 1),
- portfel, posiadane domy, imię, rok/pora i licznik śmierci **zostają**,
- kupione jedzenie **przepada**.

Telefonu nie da się wyrzucić, zjeść ani stracić. Jest w pierwszym slocie od początku i po każdej śmierci.

## Pieniądze

Start: **1 000 000 zł**. Wydatki: jedzenie (kilka–kilkanaście zł) oraz domy (setki tysięcy). Nie ma dochodu, pracy, odsetek ani sklepu z przedmiotami innymi niż jedzenie.

## Ekwipunek

8 slotów. Slot 1 na starcie: telefon. Reszta pusta.

- Klik albo klawisze **1–8** zaznaczają slot.
- Zaznaczony przedmiot widać w rączce w lesie (pierwsza osoba).
- Jedzenie: przycisk **„Zjedz”** albo klawisz **E**. Przedmiot znika, życie rośnie o jego wartość (przycięte do 100). Po zjedzeniu zaznaczenie wraca na telefon.
- Telefonu nie da się użyć (nie leczy, nie dzwoni). Numer z ogłoszenia domu jest tylko napisem.
- Pełny ekwipunek blokuje zakupy.

## Sklep Żappka

Po kliknięciu mapa znika i widać wnętrze: lada, ceny, przycisk „Kup”, licznik zajętych slotów. W środku jest schronienie.

| Przedmiot | Cena | Leczenie |
|---|---|---|
| Hot-dog | 12 zł | +25% |
| Kanapka | 9 zł | +20% |
| Kawa | 7 zł | +10% |
| Czekolada | 5 zł | +8% |
| Woda | 3 zł | +5% |

Zakup wchodzi do pierwszego wolnego slotu i odejmuje cenę. Brak pieniędzy albo brak miejsca daje krótki komunikat (toast).

## Domy

Na starcie powstają **dwa** domy, deterministycznie z seeda świata (ten sam seed = te same domy). Każdy ma: nazwę ulicy (jedna z sześciu + numer), cenę, 6-cyfrowy telefon, kolory ścian/dachu/drzwi i losowe odbicie lustrzane.

Cena: losowa z przedziału **200 000–500 000 zł**, zaokrąglona do tysiąca. **Poziom wynika z ceny**, nie odwrotnie:

| Cena | Poziom | Nazwa | Wygląd |
|---|---|---|---|
| poniżej 275 tys. | 1 | Chatka | mała, deski, jedne drzwi i okno, komin |
| 275–349 tys. | 2 | Domek | większy, płot, skrzynka, beczka |
| 350–424 tys. | 3 | Dom z poddaszem | skrzydło boczne, piętro, poddasze, płot, latarnia |
| od 425 tys. | 4 | Rezydencja | duży korpus, wieża, dwa kominy, balkon, ławka, dwie latarnie |

Maks. **4 poziomy**. Po kliknięciu domu otwiera się karta: rysunek, pipsy poziomu, a przed kupnem także cena i telefon.

- **Kupno** odejmuje cenę z portfela. Etykieta zmienia się na „Twój dom · poz. N”. Drugi dom zostaje na sprzedaż.
- **Ulepszenie** tylko własnego domu, o jeden poziom, do 4:
  - 1→2: 60 000 zł
  - 2→3: 90 000 zł
  - 3→4: 130 000 zł
- Ulepszenie zmienia **wygląd**, nie cenę z ogłoszenia i nie daje żadnej mechaniki (brak schronienia, spania, czynszu, przechowywania rzeczy).
- Po śmierci dom zostaje Twój.

## Las (widok pierwszej osoby)

Osobna scena 3D, nie kontynuacja mapy SVG.

- Sterowanie: strzałki (przód/tył i obrót), **W/S** przód/tył, **A/D** w bok. Na telefonie przyciski na ekranie.
- Ruch jest **ciągły**. Nie ma kratek, pól ani siatki logicznej.
- Podłoże to jedno gładkie koło (kolor zależny od pory roku). Zimą pada śnieg. Drzewa (~350) stoją w stałym, losowym układzie (ziarno 2030): część w kole, gęstszy pierścień na obrzeżu.
- Kolizje: gracz jest odpychany od pni (okręgi), a na promieniu ~51 jednostek zatrzymuje go niewidzialna granica.
- Nie ma przedmiotów do podniesienia, ścieżek, zwierząt, dnia/nocy jako osobnej mechaniki poza kolorem nieba i światłem, ani powrotu „inną drogą”. Jedyna akcja to chodzenie i Esc.

## Czego świadomie nie ma

- Konta i wielu graczy (zapis lokalny jest, serwerowego nie ma).
- Odkrywania mapy / mgły wojny (jest w zamyśle, nie w kodzie).
- Siatki pól w lesie ani na mapie świata.
- NPC, dialogów, zadań, fabuły, dziennika.
- Dzwonienia pod numer z ogłoszenia. Telefon to przedmiot-kotwica.
- Schronienia w domu, spania, przechowywania przedmiotów w domu, przeprowadzki, więcej niż dwóch działek.
- Dochodu. Milion starcza na jeden drogi dom i ulepszenia; drugi dom często zostaje poza zasięgiem, jeśli kupi się rezydencję.
- Craftingu, broni, walki, głodu i pragnienia osobno od „życia”.
- Sklepu z czymkolwiek poza pięcioma produktami spożywczymi.
- Zmiany pór roku wpływającej na coś poza wyglądem i tabelą spadku życia.

## Założenia, których nie wolno „domyślić”

- Życie to jeden pasek. Jedzenie tylko go podnosi. Nie ma osobnej głodu, temperatury jako zasobu ani ubrania. „Jest zimno” to napis przy zimie, nie osobny licznik.
- Schronienie jest binarne i tylko w Żappce.
- Domy są treścią ekonomiczną i wizualną, nie bazą wypadową.
- Świat startowy jest mały z premedytacji: 4 miejsca. Nowe lokacje to decyzja projektowa, nie brak dokończenia.
- Reguły czasu i życia są już ustalone liczbami wyżej. Zmiana ich to zmiana projektu, nie poprawka błędu.

## Co ma sens rozwijać merytorycznie (otwarte)

Poniższe **nie jest obietnicą** — to luki, o które warto pytać autora, zanim powstanie treść:

- Po co jest telefon i numery z ogłoszeń, skoro nie da się dzwonić.
- Co daje własny dom poza obrazkiem (sen? brak zimna? magazyn?).
- Skąd brać pieniądze po pierwszym domu.
- Co jest w lesie poza spacerem (znaleziska, zgubienie się, dzień/noc jako zagrożenie już jest przez pasek życia).
- Jak ma wyglądać odkrywanie świata: nowe miejsca dochodzą do tej samej mapy czy mapa rośnie.
- Czy śmierć ma koszt fabularny. Dziś koszt to utrata jedzenia; dom i pieniądze zostają.
- Ton: teraz to lekka, konkretna symulacja (zima, Żappka, ceny w złotych, rok 2030), bez lochu, potworów i punktów doświadczenia.
