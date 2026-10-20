# Audio lasu (AUDIO F1)

Dynamiczny pejzaż dźwiękowy lasu 3D zależny od pory dnia zegara gry. Cała warstwa prezentacji: silnik gry, zapis (SaveV2), generator świata, renderer lasu, trolle, jeleń i quest nie znają audio.

## Nagrania (podstawa pierwszej wersji, bez zamienników)

Źródła (Mixkit, plik WAV) leżą w `assets/source/audio/`, poza zasobami publicznymi. Licencja: Mixkit Sound Effects Free License (https://mixkit.co/license/#sfxFree).

| Rola | Plik | Czas | Użycie |
| --- | --- | --- | --- |
| tło dnia | `mixkit-birds-in-forest-loop-1239.wav` | 54,7 s | pętla stereo, 08:00-18:00 |
| tło nocy | `mixkit-forest-at-night-1224.wav` | 47,0 s | pętla stereo, 21:00-05:00 |
| ptak 1 | `mixkit-cockatoo-bird-squawk-2437.wav` | 1,5 s | losowy efekt 3D |
| ptak 2 | `mixkit-bird-screeching-in-the-jungle-2436.wav` | 1,5 s | losowy efekt 3D |
| ptak 3 | `mixkit-bird-screech-2435.wav` | 2,0 s | losowy efekt 3D |
| wilki | `mixkit-wolves-at-scary-forest-2485.wav` | 9,7 s | północ, jednorazowo, 3D |
| kroki (4 warianty) | `footsteps/light-footstep-1..4.wav` (dostarczone przez autora) | ok. 1 s każdy, do gry przycięte do ok. 0,5 s mono | gracz i troll, patrz "Kroki" |

## Potok zasobów

`npm run assets:audio` (`scripts/assets/build-audio.mjs`, wymaga `ffmpeg` z libopus i aac): 48 kHz, normalizacja głośności (EBU R128, stała poprawka w dB, szczyt <= -1 dBFS: tła -23 LUFS, ptaki -17, wilki -19), pętle ze skróconym o 0,3 s bezszwowym crossfade równej mocy końca z początkiem, efekty mono z 5 ms wejścia i wyjścia. Wynik w `public/audio/`: `<id>.ogg` (Opus, format główny) i `<id>.m4a` (AAC, zapas dla Safari) plus `audio.json` (manifest: pliki, czasy, poprawki głośności, pomiary szwu po zakodowaniu, sha256 źródeł). Razem ok. 2,9 MB obu formatów (przeglądarka pobiera jeden).

Pomiary szwu pętli po zakodowaniu (odczyt zwrotny): skok na złączeniu mniejszy niż typowa różnica sąsiednich próbek (dzień 0,0008, noc 0,028 przy typowej 0,025). Test `assets.test.ts` pilnuje tych wartości.

## Architektura

Jeden kontroler `ForestAudioController` (`src/lib/audio/controller.ts`, instancja przez `getForestAudio()`), trzy warstwy w jednym grafie Web Audio:

- **A. Ambient**: dwie pętle (`loop = true`, losowy punkt startu) -> głośność ambientu -> tryb dialogu -> wyciszenie na wilki -> fade -> master.
- **B. Zwierzęta i zdarzenia**: losowe ptaki i wilki: źródło -> głośność -> filtr dolnoprzepustowy (pochłanianie powietrza zależne od odległości) -> `PannerNode` (HRTF, model `inverse`) -> głośność efektów -> master.
- **C. Kroki**: dwie osobne szyny w tym samym grafie. Gracz: źródło -> głośność kroku -> filtr -> szyna gracza -> głośność efektów (bez przestrzeni, kroki są przy graczu). Troll: źródło -> głośność kroku -> półka niskich tonów -> filtr dolnoprzepustowy (zależny od odległości) -> jeden stały `PannerNode` (HRTF, `inverse`) w pozycji trolla -> szyna trolla -> głośność efektów.
- master -> kompresor (ochrona przed przesterowaniem) -> wyjście.

Jedna pętla czasu (`setInterval` 200 ms) i jedna kolejka wczytywania (`AssetLoader`). Komponent React `ForestWorldView` tylko wywołuje kontroler przez hook `useForestAudio`: wejście i wyjście z lasu, `elapsed` ze stanu gry, tryb (dialog i blokada ruchu), pozycja i kierunek słuchacza co 50 ms z `renderer.getPose()`. Kroki nie idą przez ten odczyt: renderer lasu woła kontroler z własnej pętli klatek (`StepSink`: `playerMotion` i `npcStep`, bez stanu Reacta i bez dodatkowych timerów).

Losowość: własny generator (`Math.random`, w testach wstrzykiwany); nie używa `rngStream`, seeda świata ani niczego z logiki questów (test izolacji w `assets.test.ts`).

### Pory dnia (`mix.ts`)

| Pora | Godziny | Tło | Pojedyncze ptaki |
| --- | --- | --- | --- |
| noc | 21:00-05:00 | tylko noc | brak |
| świt | 05:00-08:00 | noc cichnie, dzień rośnie (crossfade stałej mocy, wygładzone) | rosną, szczyt ok. 07:00 (x1,7) |
| dzień | 08:00-18:00 | tylko dzień | x1 (rano nieco częściej) |
| zmierzch | 18:00-21:00 | dzień cichnie, noc rośnie | maleją do zera przy 21:00 |

Poziomy docelowe liczy się z godziny ułamkowej, a do węzłów trafia `setTargetAtTime` (stała 0,8 s), więc zmiana godziny (też ręczna) zawsze jest płynnym crossfade, bez urywania. Jedna godzina gry to 20 s, więc przejście świtu trwa 60 s rzeczywistych. Pętla spoza okna godzin wczytuje się z wyprzedzeniem 1,25 godziny gry, a nieużywana jest zwalniana po 90 s ciszy.

### Losowe ptaki (`wildlife.ts`)

- Przerwa: 12-35 s (konfigurowalne, `DEFAULT_WILDLIFE_CONFIG`) z rozrzutem 0,85-1,15, 12% szans na szybką odpowiedź po 4-9 s. Licznik maleje z tempem równym aktywności pory dnia (rano szybciej, wieczorem wolniej, w nocy stoi i jest zerowany).
- Losowane: rodzaj (bez tego samego dwa razy pod rząd), głośność (0,55-1 x głośność pory), ton (+-6%), kierunek (kolejny co najmniej 55 stopni od poprzedniego), odległość 15-60 m (z przewagą dalszych), wysokość 3-14 m nad uszami.
- Najwyżej 2 efekty naraz; przy zajętym limicie próba za 2-5 s.
- Dialog NPC: 4 razy rzadziej i 40% ciszej.
- Źródła są stałe w świecie: obrót kamery zmienia stronę, z której słychać ptaka; orientacja i pozycja `AudioListener` z kamery gracza.

### Wilki o północy

- Północ to numer `midnightIndex(elapsed)`: doba gry zaczyna się o 06:00, więc pierwsza północ wypada po 18 godzinach (360 s), potem co 480 s.
- `MidnightWatcher` porównuje numer północy przed i po zmianie czasu (nie warunek `hour === 0`), więc to samo wywołanie ani pauza (ten sam `elapsed`) nie powtórzą zdarzenia, a przejście 23:59 -> 00:00 daje dokładnie jedno.
- Skok to zmiana > 6 godzin gry, cofnięcie czasu albo ręczna zmiana godziny zapowiedziana przez `jumpClock`: tylko przesuwa punkt odniesienia, nigdy nie daje wilków (także za pominięte północe).
- Wilki grają tylko, gdy gracz jest w lesie (kontroler istnieje tylko w lesie), karta nie jest w tle i `AudioContext` działa. Późniejsze wejście do lasu nie odtwarza zaległych wilków.
- Trwałość: `WolvesLedger` zapisuje w `localStorage` (`miasto.audio.wolves`) numer ostatniej północy z wilkami osobno dla każdego `saveId` w chwili odtworzenia. **SaveV2 nie został zmieniony** (decyzja: wpis musi powstać natychmiast, a autozapis bywa starszy; przy przeładowaniu starszego autozapisu tej samej nocy wilki nie wrócą). Wpis zniknie z przeglądarką, co kosztuje najwyżej jedną powtórkę.
- Wilki: pozycja 85-115 m od gracza, `PannerNode` z `refDistance` 40 i `rolloffFactor` 0,6, wzmocnienie 1,5, ambient przyciszony do 60% na czas efektu (wygładzone) i przywracany po `onended`; bez pętli.
- TEST WILKÓW: ten sam efekt bez zapisu północy i bez zmiany harmonogramów.

### Kroki (FOOTSTEPS V2)

**Próbki.** Autor dostarczył 4 nagrania lekkiego kroku w lesie (`assets/source/audio/footsteps/light-footstep-1..4.wav`, ok. 1 s, stereo, różnej głośności). Sam krok to tylko początek każdego nagrania, a reszta to wybrzmienie i szum tła. Potok `npm run assets:audio` (logika w `src/lib/audio/stepSamples.ts`): mono z uśrednienia kanałów, znalezienie uderzenia (obwiednia po filtrze górnoprzepustowym 80 Hz), przycięcie do kroku (15 ms zapasu przed uderzeniem, koniec gdy obwiednia spada o 34 dB, najwyżej 0,5 s), wejście 3 ms i wyjście 80 ms (cosinus), a potem **jedna stała poprawka głośności na próbkę** do wspólnego RMS -32,8 dBFS (poprawki +16,9, +8,2, +10,4, +19,6 dB; szczyty po wyrównaniu od -9,8 do -6,0 dBFS). Bez kompresji, limitera i normalizacji szczytów, więc szum tła nie rośnie bardziej niż sam sygnał (szum ogona ok. -51 dBFS). Wynik: `footsteps.light.N.ogg` (Opus) i `.m4a` (AAC), ok. 3-4 KB każdy; pomiary (`level`, `cut`, sha256 źródła) w `audio.json`. Stary wpis `footsteps.leaves` (2429) został usunięty z manifestu i potoku; pozostałe nagrania bez zmian.

**Losowanie.** `ShuffleBag` (`shuffleBag.ts`): wszystkie 4 próbki w losowej kolejności, potem tasowanie od nowa; ta sama próbka nigdy nie pada dwa razy z rzędu, także na granicy rund; pierwsza próbka zależy od losowania. Gracz i troll mają **osobne worki i osobne generatory** (`forkRng` z generatora audio; nie z seeda świata), więc nie wpływają na swoje sekwencje. Subtelna zmienność każdego kroku: gracz `playbackRate` 0,96-1,04, głośność +-8%, filtr dolnoprzepustowy x0,9-1,1, bieg o 12% głośniejszy; troll `playbackRate` 0,90-0,98 (cięższy), głośność +-6%.

**Kroki gracza** (`footsteps.ts`, `FootstepScheduler`). Renderer co klatkę liczy faktyczne przesunięcie poziome po kolizjach i woła `playerMotion(odległość, dt, x, z)`. Akumulator drogi wyzwala krok co 1,45 m chodem i co 2,0 m biegiem (od 4,4 m/s; sprint 5,6 m/s, czyli częściej). Poniżej 0,35 m/s kroków nie ma, a po 0,12 s bez ruchu akumulator się zeruje, więc krok urywa się od razu po zatrzymaniu. Napieranie na drzewo nie przyspiesza kroków (liczy się tylko przesunięcie), samo obracanie kamery ich nie daje. Minimalny odstęp 0,22 s. Klatka dłuższa niż 0,1 s (zacięcie) i skok o ponad 4 m (teleport) nie wnoszą drogi. Dialog, okno, panel, blokada ruchu, pauza, karta w tle i zablokowany kontekst wstrzymują kroki; poza lasem kontrolera nie ma. Najwyżej 3 jednoczesne głosy gracza.

**Nawierzchnie** (`surfaces.ts`). Gotowa struktura `SURFACE_PROFILES` (ściółka, ścieżka, trawa, skały, drewniany most): pula próbek, mnożnik głośności i barwa. Nawierzchnię czyta `ForestWorld.surfaceAt(x, z)` (dane świata, bez raycastów i bez nowych map) tylko przy zdarzeniu kroku: ścieżka z geometrii ścieżek, trawa z profilu środowiska (polana i brzeg rzeki), reszta to ściółka. **Skały i most nie są dziś rozpoznawane**: świat nie podaje ich pod stopami za darmo (zostawiono `detected: false`). Cztery dostarczone próbki to warianty jednego kroku, a nie nagrania różnych materiałów, więc wszystkie nawierzchnie używają wspólnej puli z drobnymi korektami głośności i barwy. Osobne nagrania dodaje się jako nową pulę w `FOOTSTEP_POOLS` i wskazuje w profilu.

**Kroki trolla.** Zdarzenia pochodzą z animacji, nie z timera: `trollSteps.ts` wylicza z klipu Walk (wysokość kostek `LeftFoot`/`RightFoot` w 120 próbkach cyklu) chwile kontaktu stopy z ziemią: lewa ok. 0,21 s, prawa ok. 0,78 s cyklu 1,43 s (mocap jest lekko niesymetryczny, więc odstępy też). `FootfallTracker` wyzwala zdarzenie przy przejściu czasu klipu przez kontakt, tylko gdy animator jest w stanie Walk z wagą >= 0,85 (bez crossfade) i prędkość patrolu >= 0,15 m/s; pomija klatkę wejścia w stan i skoki czasu większe niż pół cyklu. Tempo kroków jest więc zawsze tempem animacji (też po zmianie prędkości), a Idle, Nervous bez ruchu, Surprised, Happy, Angry, Dance, dialog i pauza kroków nie dają. Zdarzenie niesie pozycję trolla w świecie (`patrol.x/z`), nie gracza ani kamery.

**Dźwięk 3D trolla.** Te same 4 `AudioBuffer`y co gracz (dekodowane raz przy wejściu do lasu, bez pobierania i dekodowania na krok), osobny worek i generator, osobna szyna głośności i **jeden** stały `PannerNode`, którego pozycję ustawia każdy krok (bez źródła na krok poza głosem odtwarzania). `inverse`, `refDistance` 3 m, `rolloff` 1,2: 0-3 m bez tłumienia, 10 m ok. -12 dB, 25 m ok. -20 dB; od 28 m dodatkowe gładkie wygaszanie, a od 40 m kroki nie powstają (liczone jako "pominięte"). Filtr dolnoprzepustowy ciemnieje z odległością (14 kHz - 330 Hz/m, nie niżej niż 1,6 kHz), półka +3 dB od 240 Hz dodaje ciężaru. HRTF i orientacja `AudioListener` z kamery dają kierunek (lewo, prawo, tył). Bez raycastów okluzji. Najwyżej 3 jednoczesne głosy trolla.

**Głośności.** Kroki płyną przez głośność efektów, master i wyciszenie jak pozostałe efekty. Stałe bazowe `STEP_LEVELS` (gracz 1,3, troll 1,6) są do strojenia po odsłuchu. W trybie deweloperskim suwaki PLAYER FOOTSTEPS i NPC FOOTSTEPS (0-2, mnożą `STEP_LEVELS`) w panelu O / F3; nie są zapisywane (system ustawień bez zmian).

### Pauza, dialogi, karta, autoplay

- Pauza zegara: czas stoi, więc nic nowego się nie wyzwala; tło i ptaki grają dalej. Dialog (troll lub dialog silnika): ambient 45%, ptaki rzadziej i ciszej, kroki gracza i trolla wyłączone.
- Karta w tle: `AudioContext.suspend()`, scheduler ptaków stoi; po powrocie `resume()`. Wilki o północy w tle są pomijane (bez zapisu).
- Autoplay: kontekst powstaje przy wejściu do lasu (po kliknięciu na mapie) i jest wznawiany przy pierwszym geście (`pointerdown`, `keydown`, `touchend`). Dopóki jest zablokowany, zasoby się wczytują, a efekty i wilki są pomijane.
- Wyjście z lasu: fade 0,12 s, po 0,7 s zatrzymanie źródeł, rozłączenie grafu, zamknięcie kontekstu i skasowanie buforów. Ponowne wejście tworzy nowy kontekst.

### Ustawienia

Przycisk "Dźwięk" w lewym górnym rogu lasu: wyciszenie całości, głośność główna, ambient, efekty (domyślnie 80%). Zapis w `localStorage` (`miasto.audio.settings`), działają od razu i po przeładowaniu.

### Panel diagnostyczny (O / F3), sekcja AUDIO

Godzina gry i pora, aktywne tło, głośność obu pętli, liczba aktywnych efektów, ostatni efekt (nazwa, odległość, strona, ton, czas), ostatnia północ z wilkami (doba) i wynik ostatniej północy, stan kontekstu, tryb, liczba wczytanych nagrań. W trybie deweloperskim przyciski: ŚWIT 06:00, DZIEŃ 12:00, ZMIERZCH 19:30, NOC 01:00, TEST WILKÓW, ODSŁUCH KROKÓW 1-4 (cztery próbki po kolei, 0,75 s odstępu), ODSŁUCH KROKÓW TROLLA (te same próbki przestrzennie, 6 m przed graczem) i suwaki PLAYER/NPC FOOTSTEPS.

Wiersz GRACZ: ruch (stoi/chód/bieg), ostatnia próbka (#1-#4), liczba wygenerowanych kroków, częstotliwość kroków (na sekundę z ostatnich 5 s) i bieżąca nawierzchnia. Wiersz TROLL: odległość od gracza, stan animacji, ostatnia próbka z nogą (L/P), liczba kroków, tłumienie w dB, kierunek względem kamery, czy emiter jest aktywny i ile kroków pominięto jako zbyt dalekie.

Przyciski godziny wysyłają komendę deweloperską `dev.setClock` (`src/lib/game/systems/devClock.ts`): przesuwa `elapsed` wyłącznie **do przodu**, do najbliższej takiej godziny (maks. 2 doby), nic poza czasem nie zmienia, więc blokady czasowe tylko wygasają. To jedyna zmiana w kodzie silnika; używa jej wyłącznie panel dev.

## Pamięć i wydajność

- Zdekodowane PCM float32 przy 48 kHz: dzień ok. 21 MB, noc ok. 18 MB (stereo), ptaki łącznie ok. 1 MB, wilki ok. 2 MB. Dzień: grana jedna pętla (ok. 21 MB), w przejściach dwie (do 39 MB). Nagrania wczytują się leniwie; ptaki dopiero gdy ich aktywność > 0, wilki od 22:45 do 00:30 (albo na żądanie).
- Cztery próbki kroków to razem ok. 0,4 MB PCM (4 x 0,5 s mono, float32), wspólne dla gracza i trolla. CPU: 5 odczytów tła na sekundę, 20 odczytów pozycji, najwyżej 2 efekty 3D (HRTF), 3 kroki gracza i 3 kroki trolla naraz. Krok to jedno źródło i dwa lekkie węzły; w pętli klatek jedno wywołanie `playerMotion` bez alokacji (akumulator liczb), `surfaceAt` tylko przy kroku.
- Zasoby: wszystkie źródła, węzły, nasłuchy i timery są zwalniane przy wyjściu; testy sprawdzają, że po `leave` licznik timerów to 0, a kontekst jest zamknięty.

## Znane ograniczenia

- Kroki: cztery nagrania to warianty jednego lekkiego kroku. Nawierzchnie (ścieżka, trawa) różnią się tylko drobnymi korektami głośności i barwy, a skały i drewniany most nie są rozpoznawane. Prawdziwe zróżnicowanie wymaga osobnych nagrań.
- Kroki trolla: mocap jest lekko niesymetryczny (lewa i prawa stopa nie dzielą cyklu równo); poziomy `STEP_LEVELS` i tłumienie z odległością są dobrane liczbowo, bez odsłuchu w przeglądarce. Troll używa tych samych próbek co gracz (tempo 0,90-0,98 i półka niskich tonów), osobne nagrania cięższego kroku można dodać później jako nową pulę.
- Brak awaryjnego zastępnika: jeśli próbki kroków się nie wczytają, kroków nie ma (diagnostyka pokazuje `próbki kroków 0/4`).
- Wygląd i brzmienie, proporcje głośności (tła -23 LUFS, ptaki -17, wilki -19 przed tłumieniem odległością), siła wilków i odległości wymagają oceny autora na słuchawkach i głośnikach.
- Zapamiętanie północy wilków jest w `localStorage` przeglądarki, nie w pliku zapisu; kasowanie danych witryny pozwoli na jedną powtórkę.
- AAC (Safari): bezszwowość pętli zależy od dekodera; zweryfikowane tylko odczytem zwrotnym `ffmpeg`, nie w Safari.
- Ptaki nie są powiązane z modelami ani z terenem (brak okluzji, pogłosu, wysokości terenu).
- Przesunięcie godziny z panelu działa tylko do przodu.

## Instrukcja ręcznego odsłuchu

Wejdź do lasu (kliknij w oknie, aby odblokować dźwięk), otwórz panel diagnostyczny klawiszem `O` (lub F3) i sekcję AUDIO.

1. **ŚWIT 06:00** – cichnie noc, rośnie pętla dnia, ptaki są bardzo częste (aktywność szczytowa ok. 07:00).
2. **DZIEŃ 12:00** – tylko pętla dnia, ptaki co 12–35 s z różnych stron.
3. **ZMIERZCH 19:30** – dzień się wycisza, noc narasta, ptaków coraz mniej; po 21:00 zero ptaków.
4. **NOC 01:00** – tylko pętla nocy, brak ptaków.
5. **TEST WILKÓW** – daleki, jednorazowy zew z ściszonym tłem; nie zmienia stanu północy.
6. **Naturalna północ** – skocz na NOC, następnie poczekaj; wilki odzywają się raz na dobę gry. Przeładowanie strony w tę samą noc nie powtarza wycia.
7. **Kroki gracza** – tylko podczas ruchu; naturalnie zróżnicowane, nigdy ta sama próbka dwa razy z rzędu (wiersz GRACZ: ostatnia próbka zmienia się #1-#4); sprint częstszy i nieco głośniejszy; cisza przy staniu, obrocie kamery, napieraniu na drzewo, w dialogu i przy blokadzie ruchu. ODSŁUCH KROKÓW 1-4 gra cztery próbki po kolei.
8. **Kroki trolla** – podejdź do trolla na 5-10 m w czasie patrolu: kroki słychać z jego strony (obracaj kamerę: lewo, prawo, tył), w rytmie jego nogi; oddalaj się: ciszej i ciemniej, od ok. 30 m ledwo słyszalne, od 40 m wcale; gdy troll stoi, w dialogu albo reaguje (Surprised, Angry) kroków nie ma. Wiersz TROLL pokazuje odległość, animację, tłumienie i kierunek; ODSŁUCH KROKÓW TROLLA daje próbkę referencyjną 6 m przed Tobą.
9. **Głośności kroków** – suwaki PLAYER FOOTSTEPS i NPC FOOTSTEPS (dev) działają od razu; przycisk „Dźwięk” (master, efekty, wyciszenie) obejmuje także kroki.
10. Przycisk „Dźwięk”: wyciszenie i suwaki (zapamiętywane po przeładowaniu).
