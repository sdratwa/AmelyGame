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
| kroki | `mixkit-stepping-on-leaves-in-a-forest-2429.wav` | **brak pliku** | patrz "Kroki" |

## Potok zasobów

`npm run assets:audio` (`scripts/assets/build-audio.mjs`, wymaga `ffmpeg` z libopus i aac): 48 kHz, normalizacja głośności (EBU R128, stała poprawka w dB, szczyt <= -1 dBFS: tła -23 LUFS, ptaki -17, wilki -19), pętle ze skróconym o 0,3 s bezszwowym crossfade równej mocy końca z początkiem, efekty mono z 5 ms wejścia i wyjścia. Wynik w `public/audio/`: `<id>.ogg` (Opus, format główny) i `<id>.m4a` (AAC, zapas dla Safari) plus `audio.json` (manifest: pliki, czasy, poprawki głośności, pomiary szwu po zakodowaniu, sha256 źródeł). Razem ok. 2,9 MB obu formatów (przeglądarka pobiera jeden).

Pomiary szwu pętli po zakodowaniu (odczyt zwrotny): skok na złączeniu mniejszy niż typowa różnica sąsiednich próbek (dzień 0,0008, noc 0,028 przy typowej 0,025). Test `assets.test.ts` pilnuje tych wartości.

## Architektura

Jeden kontroler `ForestAudioController` (`src/lib/audio/controller.ts`, instancja przez `getForestAudio()`), trzy warstwy w jednym grafie Web Audio:

- **A. Ambient**: dwie pętle (`loop = true`, losowy punkt startu) -> głośność ambientu -> tryb dialogu -> wyciszenie na wilki -> fade -> master.
- **B. Zwierzęta i zdarzenia**: losowe ptaki i wilki: źródło -> głośność -> filtr dolnoprzepustowy (pochłanianie powietrza zależne od odległości) -> `PannerNode` (HRTF, model `inverse`) -> głośność efektów -> master.
- **C. Kroki**: źródło -> głośność -> filtr -> głośność efektów (bez przestrzeni: kroki są przy graczu).
- master -> kompresor (ochrona przed przesterowaniem) -> wyjście.

Jedna pętla czasu (`setInterval` 200 ms) i jedna kolejka wczytywania (`AssetLoader`). Komponent React `ForestWorldView` tylko wywołuje kontroler przez hook `useForestAudio`: wejście i wyjście z lasu, `elapsed` ze stanu gry, tryb (dialog i blokada ruchu), pozycja gracza co 50 ms z `renderer.getPose()` (kroki i orientacja słuchacza). Renderer lasu nie został zmieniony.

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

### Kroki

Gdy plik `mixkit-stepping-on-leaves-in-a-forest-2429.wav` nie został dostarczony (w paczce plików go nie było), gra używa **syntetycznego zastępnika** (4 warianty szumu z chrzęstem, `synth.ts`), jawnie oznaczonego w diagnostyce ("syntetyczne (brak pliku)"). Gdy dodasz plik do `assets/source/audio/` i uruchomisz `npm run assets:audio`, potok sam rozpozna, czy to jeden krok, czy sekwencja (`src/lib/audio/onsets.ts`): zapisze segmenty kroków w manifeście, a gra będzie odtwarzać pojedyncze kroki po losowym segmencie.

Logika (`footsteps.ts`): każdy krok przypada na przebyty odcinek (1,35 m chodem, 1,75 m biegiem; bieg od 4,4 m/s), więc sprint (5,6 m/s) przyspiesza kroki, a stanie i obracanie kamery (brak przemieszczenia) ich nie wywołuje. Pierwszy krok po ruszeniu słychać po 60% kroku. Dialog, okno, panel i zablokowany ruch zatrzymują kroki. Warianty bez powtórki pod rząd, ton +-8%, losowy filtr, najwyżej 3 jednoczesne.

### Pauza, dialogi, karta, autoplay

- Pauza zegara: czas stoi, więc nic nowego się nie wyzwala; tło i ptaki grają dalej. Dialog (troll lub dialog silnika): ambient 45%, ptaki rzadziej i ciszej, kroki wyłączone.
- Karta w tle: `AudioContext.suspend()`, scheduler ptaków stoi; po powrocie `resume()`. Wilki o północy w tle są pomijane (bez zapisu).
- Autoplay: kontekst powstaje przy wejściu do lasu (po kliknięciu na mapie) i jest wznawiany przy pierwszym geście (`pointerdown`, `keydown`, `touchend`). Dopóki jest zablokowany, zasoby się wczytują, a efekty i wilki są pomijane.
- Wyjście z lasu: fade 0,12 s, po 0,7 s zatrzymanie źródeł, rozłączenie grafu, zamknięcie kontekstu i skasowanie buforów. Ponowne wejście tworzy nowy kontekst.

### Ustawienia

Przycisk "Dźwięk" w lewym górnym rogu lasu: wyciszenie całości, głośność główna, ambient, efekty (domyślnie 80%). Zapis w `localStorage` (`miasto.audio.settings`), działają od razu i po przeładowaniu.

### Panel diagnostyczny (O / F3), sekcja AUDIO

Godzina gry i pora, aktywne tło, głośność obu pętli, liczba aktywnych efektów (i kroków), ostatni efekt (nazwa, odległość, strona, ton, czas), ostatnia północ z wilkami (doba) i wynik ostatniej północy, stan kontekstu, tryb, liczba wczytanych nagrań. W trybie deweloperskim przyciski: ŚWIT 06:00, DZIEŃ 12:00, ZMIERZCH 19:30, NOC 01:00, TEST WILKÓW.

Przyciski godziny wysyłają komendę deweloperską `dev.setClock` (`src/lib/game/systems/devClock.ts`): przesuwa `elapsed` wyłącznie **do przodu**, do najbliższej takiej godziny (maks. 2 doby), nic poza czasem nie zmienia, więc blokady czasowe tylko wygasają. To jedyna zmiana w kodzie silnika; używa jej wyłącznie panel dev.

## Pamięć i wydajność

- Zdekodowane PCM float32 przy 48 kHz: dzień ok. 21 MB, noc ok. 18 MB (stereo), ptaki łącznie ok. 1 MB, wilki ok. 2 MB. Dzień: grana jedna pętla (ok. 21 MB), w przejściach dwie (do 39 MB). Nagrania wczytują się leniwie; ptaki dopiero gdy ich aktywność > 0, wilki od 22:45 do 00:30 (albo na żądanie).
- CPU: 5 odczytów tła na sekundę, 20 odczytów pozycji, najwyżej 2 efekty 3D (HRTF) i 3 kroki naraz. Nie dotyka renderera ani pętli klatek.
- Zasoby: wszystkie źródła, węzły, nasłuchy i timery są zwalniane przy wyjściu; testy sprawdzają, że po `leave` licznik timerów to 0, a kontekst jest zamknięty.

## Znane ograniczenia

- Brak nagrania kroków (2429): działa syntetyczny zastępnik do czasu dostarczenia pliku; nie jest to nagranie.
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
7. **Kroki** – tylko podczas ruchu; szybciej przy sprincie; cisza przy staniu, obrocie, w dialogu i przy blokadzie ruchu.
8. Przycisk „Dźwięk”: wyciszenie i suwaki (zapamiętywane po przeładowaniu).
