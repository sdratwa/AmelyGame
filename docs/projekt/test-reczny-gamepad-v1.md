# Test ręczny: Gamepad V1 (macOS + Chrome + DualSense PS5)

Scenariusz dla autora. Agent **nie** uruchamiał gry, przeglądarki, Vitest, lint, typecheck ani build (zakaz z reguł projektu): wszystko poniżej do sprawdzenia przez Ciebie. Każdy krok ma trzy pola: **Zrób**, **Powinno być**, **Błąd, jeśli**.

## Przygotowanie

- Najpierw (jednorazowo, skoro agent niczego nie uruchamiał): `npm run typecheck`, `npm run lint`, `npm test`. Nowe testy jednostkowe: `src/lib/input/*.test.ts`, `src/lib/forest-view/controller.lookAnalog.test.ts`.
- Adres: `http://localhost:43217` (`npm run dev`). Chrome na macOS, okno aktywne (Chrome nie podaje stanu pada karcie w tle).
- Dla kroków wymagających czystego startu: `http://localhost:43217/?reset=1`.
- Mapowanie (DualSense / Xbox):
  - lewy analog: ruch; prawy analog: kamera; **L3** (wciśnięcie lewego analoga): bieg;
  - **✕ / A**: interakcja w lesie, zatwierdzanie w oknach i mieście; **○ / B**: cofnij / zamknij okno (w wolnym lesie nic nie robi);
  - **△ / Y**: ekwipunek; **□ / X**: dziennik; **L1 / LB**: minimapa; **OPTIONS / MENU**: menu gry;
  - **R1 / R2** (RB / RT) albo **D-pad lewo/prawo** w lesie: poprzedni / następny slot paska ekwipunku;
  - **D-pad** i lewy analog: nawigacja po oknach i mieście.
- Wibracje (opcjonalne) i ustawienia: menu gry (OPTIONS) -> "Ustawienia kontrolera".

---

## 1. Połączenie DualSense z Maciem przez Bluetooth

- **Zrób:** na DualSense przytrzymaj jednocześnie **PS** i **Create** (przycisk po lewej od panelu dotykowego), aż dioda zacznie szybko migać. Na Macu: Ustawienia systemowe -> Bluetooth -> "DualSense Wireless Controller" -> Połącz. Dioda przestaje migać i świeci stale.
- **Powinno być:** pad widoczny jako połączony w ustawieniach Bluetooth.
- **Błąd, jeśli:** dioda miga bez końca (powtórz parowanie: usuń urządzenie z listy Bluetooth i sparuj od nowa); pad połączony przez USB-C działa inaczej niż przez Bluetooth (zanotuj).

## 2. Uruchomienie gry i rozpoznanie pada

- **Zrób:** otwórz grę (`?reset=1`). **Naciśnij dowolny przycisk na padzie** (Chrome udostępnia pada stronie dopiero po pierwszym naciśnięciu). Na ekranie imienia zobacz klawiaturę ekranową pod polem.
- **Powinno być:** po naciśnięciu pojawia się klawiatura ekranowa (litery), czyli gra przełączyła się na pada. Wejdź na ekranie imienia D-padem w dół na klawiaturę, wpisz imię (✕ na literach, "⌫" kasuje; pierwsza litera jest wielka), D-padem na przycisk "Zaczynam przygodę" i ✕.
- **Błąd, jeśli:** po naciśnięciu przycisku nic się nie zmienia (sprawdź `chrome://gamepad` lub https://hardwaretester.com/gamepad, czy Chrome widzi pada); fokus nie jest widoczny (żółta obwódka); pad nie przechodzi D-padem po klawiaturze.

## 3. Sterowanie lewym analogiem (miasto i las)

- **Zrób:** po przyjęciu zadania (krok 13) wejdź do lasu. Wychylaj lewy analog delikatnie, średnio i do oporu we wszystkich kierunkach, także po przekątnej. Puść analog.
- **Powinno być:** małe wychylenie = powolne chodzenie, duże = normalne tempo; przekątna nie jest szybsza niż ruch na wprost; po puszczeniu analoga postać staje i **nie dryfuje**; podpowiedź "Kliknij w scenę" się **nie** pokazuje przy padzie, bo pad nie wymaga pointer lock (nie klikaj w scenę).
- **Błąd, jeśli:** postać sama idzie przy puszczonym analogu (dryf: zwiększ deadzone w ustawieniach); ruch skokowy; ruch do tyłu przy wychyleniu w górę (odwrócona oś); pointer lock jest wymagany do ruchu.

## 4. Rozglądanie prawym analogiem

- **Zrób:** poruszaj prawym analogiem w lewo/prawo/górę/dół, najpierw lekko, potem do oporu. Spójrz w niebo i w ziemię.
- **Powinno być:** płynny obrót; małe wychylenie = precyzyjny, powolny obrót; pion ograniczony (nie da się przewrócić kamery do góry nogami); prędkość taka sama przy 60 i 120 Hz; brak wyczuwalnego opóźnienia. W "Ustawieniach kontrolera" czułość poziomą/pionową i odwrócenie osi Y widać od razu.
- **Błąd, jeśli:** kamera sama się obraca (dryf prawego analoga); obrót zależy od FPS (zmień jakość grafiki: obrót powinien mieć tę samą prędkość); kamera przechodzi przez pion.

## 5. Chodzenie i bieg L3

- **Zrób:** wychyl lewy analog do przodu i **wciśnij L3** (kliknij lewy analog) trzymając go. Puść L3, potem puść analog. Wciśnij L3 bez wychylenia.
- **Powinno być:** z L3 postać biegnie wyraźnie szybciej (a kroki są szybsze); po puszczeniu L3 wraca do marszu; L3 bez wychylenia nic nie robi.
- **Błąd, jeśli:** bieg działa bez L3; bieg zostaje po puszczeniu L3; L3 powoduje ruch w miejscu.

## 6. Interakcja ze skrzynią

- **Zrób:** podejdź do skrzyni (patrz na nią, podpowiedź pojawia się u góry środka). Naciśnij **✕** raz. Poczekaj na animację; pojawi się okno zawartości. Okno zamknij **○**, otwórz skrzynię ponownie (✕), tym razem zatwierdź **✕** na "Zabierz".
- **Powinno być:** podpowiedź pokazuje **[✕]** zamiast [E]; jedno ✕ = jedna interakcja (przytrzymanie niczego nie powtarza); okno ma domyślnie podświetlone "Zabierz"; po zabraniu przedmiot trafia do ekwipunku; lekka wibracja przy otwarciu skrzyni i przy zabraniu przedmiotu (jeśli włączona i obsługiwana); drugie szybkie ✕ nie zatwierdza okna "z rozpędu" (ok. 0,25 s ochrony).
- **Błąd, jeśli:** podpowiedź pokazuje "E" przy aktywnym padzie; okno od razu się zatwierdza tym samym naciśnięciem; ✕ nie robi nic przy skrzyni, choć E działa; kamera obraca się przy otwartym oknie (prawy analog ma być wtedy martwy).

## 7. Rozmowa z trollem i wybór odpowiedzi

- **Zrób:** podejdź do trolla (rozpocznie się spotkanie) i/lub naciśnij ✕ z bliska. W oknie wybierz D-padem (albo lewym analogiem) odpowiedź; ✕ zatwierdza. Spróbuj ścieżki "Może się dogadamy?", potem w zagadce wpisz odpowiedź klawiaturą ekranową (cyfry) i "Odpowiadam". Sprawdź **○** (odejście bez rozmowy) i podpowiedź.
- **Powinno być:** po otwarciu dialogu postać nie chodzi, kamera **nie reaguje** na prawy analog; domyślnie podświetlone jest **"Może się dogadamy?"** (nie "Spróbuję cię pokonać!"); wybrana odpowiedź ma wyraźną żółtą obwódkę; ✕ zatwierdza; ○ zamyka dialog (jak Esc); pod zagadką jest klawiatura cyfr; zegar gry stoi w dialogu; animacje trolla, zagadki, blokady i depozyt działają jak dotąd.
- **Błąd, jeśli:** tym samym ✕, które otworzyło rozmowę, wybierasz odpowiedź; domyślny fokus to opcja walki; nie da się wpisać liczby; po zamknięciu dialogu trzeba kliknąć scenę, żeby znów chodzić padem.

## 8. Otwieranie ekwipunku

- **Zrób:** naciśnij **△**. D-padem/lewym analogiem przejdź po przedmiotach (każdy wiersz można podświetlić; przy schemacie jest przycisk "Czytaj": ✕ otwiera schemat). Naciśnij **○**, potem znów △ i △ ponownie (zamknięcie).
- **Powinno być:** △ otwiera i zamyka ekwipunek; w opisie okna widać "Zamknięcie: △ lub ○"; wiersze są kolejno podświetlane; zegar gry stoi; ✕ na "Czytaj" otwiera schemat, ○ wraca do ekwipunku/lasu.
- **Błąd, jeśli:** △ nic nie robi; opis okna mówi "I lub Esc" przy padzie; fokus gubi się poza oknem (D-pad przesuwa podświetlenie na elementy pod spodem).

## 9. Otwieranie dziennika

- **Zrób:** naciśnij **□**. D-padem w dół/górę przewijaj treść i przejdź na "Zapisz teraz"; ✕ zapisuje. □ ponownie zamyka.
- **Powinno być:** dziennik otwiera się i zamyka; D-pad przewija długą treść (najpierw przewijanie, potem przejście do przycisku); "Ostatni zapis" aktualizuje się po ✕ na "Zapisz teraz".
- **Błąd, jeśli:** treści nie da się przewinąć; □ otwiera dziennik, gdy jest otwarty inny panel (ma być ignorowane).

## 10. Pokazywanie i ukrywanie minimapy

- **Zrób:** w wolnym lesie naciśnij **L1** (kilka razy), potem otwórz ekwipunek (△) i naciśnij L1.
- **Powinno być:** L1 pokazuje i ukrywa minimapę (zapamiętane po odświeżeniu, jak M); przy otwartym oknie L1 nic nie robi.
- **Błąd, jeśli:** L1 zmienia minimapę przy otwartym oknie; stan minimapy nie zgadza się z klawiszem M.

## 11. Budowa mostu

- **Zrób:** (wymaga przejścia questa: schemat, piła, kilof, drewno, kamienie) przy zachodnim lądowisku naciśnij **✕**. W oknie budowy sprawdź podświetlenie, ✕ na "ZBUDUJ MOST", potem ○ (anuluj) w osobnej próbie.
- **Powinno być:** ✕ przy miejscu budowy otwiera okno; gdy masz wszystko, domyślnie podświetlone jest "ZBUDUJ MOST", w przeciwnym razie "Anuluj"; po budowie mocniejsza (nadal delikatna) wibracja; most pojawia się, quest przechodzi dalej; ścinanie drzew i rozbijanie skał też działają samym ✕.
- **Błąd, jeśli:** ✕ nie reaguje przy drzewie/skale, choć E działa; budowa startuje bez drugiego naciśnięcia; warunki (zasięg, narzędzia) zachowują się inaczej niż z klawiaturą.

## 12. Powrót z lasu do miasta

- **Zrób:** w wolnym lesie naciśnij **OPTIONS**. W menu wybierz D-padem "Wróć do miasta" i ✕. Osobno: naciśnij ○ w wolnym lesie.
- **Powinno być:** OPTIONS otwiera "Menu gry" (zegar stoi; Wznów, Ustawienia kontrolera, Zapisz teraz, Wróć do miasta); ✕ na "Wróć do miasta" kończy wizytę w lesie; ○ w wolnym lesie **nie** wychodzi z lasu; ○ w menu zamyka menu; OPTIONS ponownie też zamyka menu.
- **Błąd, jeśli:** ○ w wolnym lesie wychodzi do miasta; menu nie pojawia się; po powrocie trzeba użyć myszy.

## 13. Sterowanie tablicą ogłoszeń (miasto)

- **Zrób:** na mapie miasta (po nowej grze) D-padem wybierz tablicę ogłoszeń (podświetlona obwódką), ✕ otwiera. W oknie D-pad/analog: "Przyjmij zadanie", ✕. ○ zamyka. Następnie wybierz "Las" i ✕. Spróbuj też sklep i dom (✕ na domu: domyślnie podświetlone jest "Zamknij", nie "Kup").
- **Powinno być:** na starcie pierwszy ruch D-padem podświetla dostępny element; kafelki (sklep, dom, las, tablica) są osiągalne; przed przyjęciem zadania nie da się wybrać lasu; po przyjęciu ✕ na "Las" wchodzi do lasu; ✕ na "Przyjmij zadanie" przyjmuje je raz.
- **Błąd, jeśli:** D-pad nic nie podświetla; nie da się dojść do tablicy bez myszy; zakup domu następuje samym podwójnym ✕.

## 14. Rozłączenie i ponowne połączenie pada

- **Zrób:** podczas chodzenia w lesie rozłącz pada (przytrzymaj PS ok. 10 s albo wyłącz Bluetooth w pasku menu). Potem połącz ponownie i naciśnij dowolny przycisk. Powtórz z otwartym oknem.
- **Powinno być:** po rozłączeniu postać staje (bez "zacięcia" ruchu), podpowiedzi wracają do klawiatury (E zamiast ✕), gra działa z klawiaturą i myszą; po ponownym połączeniu pad znów steruje; chwilowy (mniej niż pół sekundy) brak danych nie zmienia podpowiedzi.
- **Błąd, jeśli:** postać idzie dalej po rozłączeniu; po ponownym połączeniu pad nie reaguje bez przeładowania strony; w konsoli są błędy.

## 15. Przełączanie między padem, myszą i klawiaturą

- **Zrób:** na zmianę: naciskaj przyciski pada, klawisze (W, E), poruszaj myszą i klikaj. Zobacz podpowiedź przy skrzyni/trollu, listę "Sterowanie" w lesie, napisy w ekwipunku i dzienniku. Połóż pada na stole z lekkim dryfem i szarp myszą o kilka pikseli.
- **Powinno być:** po ruchu padem podpowiedzi pokazują ✕ / △ / □ (PlayStation); po użyciu klawiatury lub wyraźnym ruchu myszy wracają do E / I / J; dryf analoga i drobne drgnięcia myszy **nie** przełączają podpowiedzi; przełączenie nie migocze (odstęp co najmniej ok. 0,4 s); jednoczesne E i ✕ (w tej samej chwili) nie wykonują interakcji dwa razy; mysz z pointer lock dalej obraca kamerą.
- **Błąd, jeśli:** podpowiedzi migają między padem a klawiaturą; po użyciu myszy zostają glify pada; pad wymusza pointer lock albo odbiera myszy rozglądanie.

## 16. Sprawdzenie FPS i braku dryfu analogów

- **Zrób:** w lesie otwórz panel diagnostyczny klawiszem **O** (albo przyciskiem "Diagnostyka"). Przez minutę chodź i biegaj padem w okolicy trolla, jelenia i latarni mostu (nocą), obracając kamerę prawym analogiem. Porównaj FPS z klawiaturą i myszą. Potem odłóż pada na płaskiej powierzchni na 30 s bez dotykania.
- **Powinno być:** FPS (i 1% low) taki sam jak przy klawiaturze i myszy (odczyt pada nie obciąża klatki; stan Reacta nie zmienia się co klatkę); po 30 s odłożenia pada pozycja i kierunek patrzenia w panelu się **nie zmieniają**; przy zmianie deadzone (Ustawienia kontrolera) dryf znika.
- **Błąd, jeśli:** FPS spada względem klawiatury; pozycja z diagnostyki zmienia się przy puszczonych analogach (dryf: zwiększ deadzone do 0,20-0,25 i zgłoś, jak duży dryf ma Twój pad).

---

## Dodatkowe sprawdzenia (krótko)

- **Sklep:** ✕ na "Sklep Żappka", D-padem po przyciskach "Kup", ○ wychodzi (jak Esc).
- **Ekran "Kontynuuj":** po przeładowaniu strony (bez `?reset=1`) pierwszy przycisk "Kontynuuj" jest podświetlony; ✕ wczytuje grę.
- **Śmierć (jeśli się zdarzy):** ✕ na "Odrodź się".
- **Niestandardowy pad:** podłącz kontroler z niestandardowym mapowaniem: ustawienia kontrolera mówią, że nie jest obsługiwany, a sterowanie nim nie robi przypadkowych akcji.
- **Wibracje:** w "Ustawieniach kontrolera" wyłącz wibracje: skrzynia/most nie wibrują; włącz: delikatny impuls.

## Znane ograniczenia (do oceny)

- Tylko standardowe mapowanie Gamepad API (DualSense i Xbox w Chrome); brak edytora przycisków.
- Wibracje zależą od Chrome i systemu (na macOS przez Bluetooth mogą być niedostępne); gra działa bez nich.
- W wolnym lesie ○ celowo nie wychodzi z lasu: wyjście przez OPTIONS -> "Wróć do miasta".
- Klawiatura i mysz zostały na swoich zdarzeniach DOM, ale wywołują te same funkcje akcji co pad (pełne przepięcie klawiatury przez hub jest odłożone).
