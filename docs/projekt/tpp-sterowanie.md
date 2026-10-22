# TPP1: sterowanie postacią 3D z kamerą trzecioosobową

Status: kod napisany, **testy, lint, typecheck, build i przeglądarka nie były uruchamiane** (zakaz projektu i brak zgody). Wygląd, dźwięk, FPS i "czucie" sterowania ocenia autor.

**TPP2 (22 października 2026): TPP jest domyślnym sterowaniem w głównej grze** (patrz sekcja "TPP2: integracja z główną grą" niżej). Wygląd postaci (fryzura, ubranie, kolory): [postac-wyglad.md](postac-wyglad.md).

Trasa deweloperska: `/dev/third-person` (tylko development; w produkcji `notFound`). Parametry w adresie: `?seed=` (domyślnie 1), `?gen=2|3` (domyślnie 3, las Pro), `?q=LOW|MEDIUM|HIGH`. Główna gra i `/dev/forest` nadal działają z oczu gracza.

## Zasób

- Plik GLB: `public/characters/Miasto_Dziewczynka_9_animacji_beta.glb` (kopia bez zmian z pliku autora, 4 350 772 B, SHA-256 w manifeście). Katalog `public/characters/`, bo `assets:build` regeneruje `public/models/`.
- Wpis `player.girl.base` w `public/characters/characters.json`: jedna siatka ze skórą (`Female_Character_Mesh`), 65 kości Mixamo, 28 818 trójkątów, przód modelu `+z`, wysokość w pozie wiązania 1,0, docelowa 1,55 m.
- Ładowanie: `loadPlayerAsset()` w `src/lib/assets/characters.ts` (wspólny `loadCharacter`: walidacja szkieletu, siatki i klipów). Brak pliku daje czytelny błąd z oczekiwaną ścieżką; w trybie TPP gracz jest wtedy kapsułą zastępczą.
- Animacje (nazwy dokładnie jak w pliku, sprawdzane przy wczytaniu i w teście): `idle`, `walk`, `run`, `jump`, `crouch_idle`, `crouch_walk_forward`, `crouch_walk_back`, `crouch_sneak_left`, `crouch_sneak_right`. Nie generujemy ani nie zmieniamy modelu, szkieletu i animacji.

## Architektura

Czysta logika (bez Three.js i Reacta), `src/lib/tpp/`:

| Plik | Rola |
| --- | --- |
| `config.ts` | `TppConfig` i `TPP_DEFAULTS`: jedyne miejsce z liczbami (prędkości, skok, kapsuła, kamera, animacje), `TPP_RANGES` dla suwaków. |
| `playerInput.ts` | `PlayerInput`: klawiatura i mysz -> `PlayerIntent` (osie ruchu, bieg, zdarzenia kucania i skoku, ruch myszy); `setExternal` dla pada i dotyku. |
| `playerController.ts` | `PlayerController`: kapsuła, przyspieszanie, skok (prędkość pionowa + grawitacja), kucanie z kontrolą miejsca nad głową, kolizje przez `WalkWorld.move`. |
| `cameraRig.ts` | `ThirdPersonCamera`: orbita, osobne wygładzanie pozycji i obrotu, dociąganie przy terenie i przeszkodach. |
| `animationState.ts` | Wagi klipów z prędkości i kierunku (`targetWeights`), tempo klipów (`clipTimeScale`). |
| `thirdPersonRig.ts` | `ThirdPersonRig`: wejście -> kontroler -> kamera, adaptery świata (`groundAt`, `obstacleTop`), dane diagnostyczne. |

Warstwa Three.js, `src/lib/forest-view/`:

| Plik | Rola |
| --- | --- |
| `clipPrep.ts` | Obróbka kopii klipów (patrz niżej). |
| `playerModel.ts` | `PlayerModel`: skala do 1,55 m, obrót przodu, cienie, `dispose`. |
| `playerAnimator.ts` | `PlayerAnimator`: jeden `AnimationMixer`, crossfade, fazy kroków, skok `LoopOnce`. |
| `renderer.ts` | Opcja `StreamOptions.thirdPerson`; `getTppSnapshot`, `setTppConfig`, `teleportTpp`. |

UI deweloperskie: `src/app/dev/third-person/page.tsx`, `ThirdPersonPrototype.tsx`, `TppDebugPanel.tsx`.

Przepływ klatki (tryb TPP): `rig.update(dt)` (jedno wejście, jeden ruch kapsuły, jedna kamera) -> lustro stanu do `FirstPersonController.state` (pozycja, kierunek ciała, oczy; skrzynie, NPC, zwierzęta i streaming czytają go bez zmian) -> `model.setPose` -> `animator.update` (jeden `mixer.update`) -> kamera renderera z `rig.cameraPose`.

Model i kapsuła są rozdzielone: kolizje liczy wyłącznie kontroler (promień z `WalkWorld.config.playerRadius`), animacja nigdy nie przesuwa postaci.

## Sterowanie

| Klawisz | Akcja |
| --- | --- |
| W / A / S / D (także strzałki) | ruch względem kamery |
| Shift | bieg (w kuckach ignorowany) |
| C | kucanie (przełącznik) |
| Spacja | skok (jeden, tylko z ziemi) |
| mysz | obrót kamery |
| Esc | zwolnienie kursora (przeglądarka); kolejne kliknięcie w scenę przechwytuje go znowu |

Pad (gra i `/dev/third-person`, wspólny `InputHub`): lewy drążek ruch, prawy kamera, L3 bieg, ✕ (A) skok, ○ (B) kucanie (przełącznik), □ (X) interakcja, L2/LT dziennik. Mapowanie skoku i kucania jest w `TPP_BUTTONS` (`src/lib/input/gamepadConfig.ts`); od TPP2 ✕ to skok, a interakcja przeszła na □ (decyzja autora). Pad działa bez kliknięcia w scenę; ustawienia kontrolera (martwe strefy, czułość, odwrócenie Y) są wspólne z grą.

## TPP2: integracja z główną grą

Status: kod napisany, **testy, lint, typecheck, build i przeglądarka nie były uruchamiane**.

- **Jedno źródło prawdy o graczu.** `ForestWorldView` tworzy `ForestRenderer` z `stream.thirdPerson = { config: resolveTppConfig() }`: te same domyślne (`TPP_DEFAULTS` + własne z `localStorage`, klucz `miasto.tpp.defaults`) co w `/dev/third-person`. Pozycję i kolizje liczy `PlayerController`; `FirstPersonController.state` zostaje tylko lustrem (x, z, eyeY i `yaw` = **kierunek kamery**), więc istniejące elementy gry (minimapa, dźwięk, zapis, interactor) czytają ten sam stan bez przepisywania.
- **Kierunek.** `renderer.getPose()` zwraca w TPP pozycję postaci i yaw kamery (kierunek celowania). To on trafia do zapisu (`forest.pose`), strzałki minimapy i odbiornika dźwięku. Wejście do lasu startuje od zapisanej pozycji (`bodyYaw` i kamera = zapisany yaw).
- **Interakcje liczone od postaci, nie od kamery.** `pickInteraction` bierze `x, z` postaci i yaw kamery (dla kierunku patrzenia), a dystans i kierunek skrzyń, drzew, skał i mostu liczy względem postaci. Z dalekiej kamery nie da się więc dosięgnąć celu. Zasięgi (`REACH`, `REACH_*`) bez zmian.
- **Przeszkoda w drodze (tylko TPP).** `src/lib/game/systems/reach.ts`: `isReachClear` sprawdza w 2D odcinek postać-cel względem kolizji lasu (okręgi dokładnie, prostokąty przez Liang-Barsky); wysokości blokerów jak w kamerze (`tree/ancient` 99, `rock` 2,6 x skala, reszta 1,6) kontra wysokość tułowia 0,9 m; sam cel i margines 0,8 m wokół niego są pomijane. Skrzynię lub pień za grubym drzewem trzeba obejść. Włącza to `requireClearReach` w `InteractorDeps` (w pierwszej osobie wyłączone, bez zmiany zachowania).
- **Troll.** `talkToNpc`/`canTalkToNpc` w TPP sprawdzają ten sam zasięg i drożność względem postaci (`NpcLayer.position`).
- **Pad (zmiana mapowania, do akceptacji):** ✕/A skok, ○/B kucanie, □/X interakcja (było: ✕ interakcja), L2/LT dziennik (był □), △ ekwipunek, L1 minimapa, R1/R2/lewo/prawo sloty, Options pauza. Okna z potwierdzeniem (np. skrzynia) mają podpowiedź `padAction="confirm"` (✕). W podpowiedziach i pomocy lasu doszły "skok" i "kucanie".
- **Klawiatura:** Spacja skok, C kucanie (dodane do `FOREST_CONTROLS` i pomocy).
- **Zapis:** bez zmiany układu pozycji (`forestPose {x, z, yaw}`), nowość to `player.appearance` w SaveV4 (patrz [postac-wyglad.md](postac-wyglad.md)).
- **Zostaje:** `/dev/third-person` z `TppDebugPanel`, `mirrorShare`/`mirrorClip`, domyślne w `localStorage`, testy TPP1. Celownik w TPP nie został zmieniony (do oceny przez autora).

## Parametry domyślne

Chód 2,2 m/s, bieg 4,8 m/s, kucanie i skradanie 1,0 m/s (wszystko w `TPP_DEFAULTS`). Przyspieszanie 14, hamowanie 18 m/s^2, obrót ciała do 12 rad/s. Skok 1,5 m przy grawitacji 12 m/s^2 (czas lotu 1,0 s). Kapsuła: stanie 1,55 m, kucanie 1,0 m (zmiana w 0,2 s). Kamera: 2,35 m, 15° w dół, punkt celu 1,25 m nad stopami, przesunięcie w prawo 0,3 m, wygładzanie pozycji 0,08 s i obrotu 0,03 s, pitch -35°..+70° elewacji. Wszystkie wartości niezależne od FPS (stałe czasowe w sekundach, klatka obcinana do 0,1 s).

## Animacje

- Klipy pętlowe grają stale z wagami (suma = 1, więc mikser nie dociąga pozy wiązania); wagi dochodzą do celu liniowo w czasie `animCrossfade` (0,2 s), a przy stanie <-> kucaniu `animCrouchFade` (0,25 s). Akcje nie są restartowane w klatce.
- Chód i bieg dzielą jedną fazę kroku, klipy kucania w ruchu również (bez ślizgania nóg w przejściu). Tempo klipu = prędkość / prędkość nominalna, ograniczone do 0,6-1,8.
- Kucanie w ruchu: ciało patrzy zgodnie z kamerą, a kierunek ruchu w układzie ciała rozkłada się na klipy przód, tył i boki (ukos = mieszanie dwóch).
- Skok: klip `jump` `LoopOnce` z `clampWhenFinished`, tempo dopasowane do czasu lotu (część lotna klipu trwa 0,667 s z 0,867 s, reszta to amortyzacja lądowania). Spadek bez skoku trzyma pozę szczytu.

### Root motion

W pliku ruch ma tylko translacja kości `mixamorig:Hips` (biodra są dzieckiem sceny, oś pionowa = Y). Obróbka jest robiona na **kopiach** klipów w `clipPrep.ts`, nie na pliku:

- klipy pętlowe: odejmowana średnia poziomych X i Z (usuwa stałe przesunięcie boczne klipów kucania), Y i kołysanie zostają;
- `jump`: usuwany tylko pionowy wzrost ponad pozycję startową (`y' = y0 + min(0, y - y0)`), bo łuk skoku daje fizyka; dół amortyzacji, pochylenie Z i wszystkie obroty zostają.

Nie usuwamy całego ruchu bioder.

### Faza kroku w mieszaniu klipów kucania

Klipy kucania w ruchu dzielą jedną fazę, więc w ukosach ich kroki muszą być zgodne. Pomiar z pliku (faza, w której lewa stopa wyprzedza prawą w kierunku ruchu): `crouch_walk_forward` 0,998, `crouch_walk_back` 0,067, `crouch_sneak_right` 0,971, ale `crouch_sneak_left` **0,492**, czyli pół cyklu przesunięcia. Dlatego ukosy w prawo wyglądały dobrze, a ukosy w lewo mieszały przeciwne fazy nóg (ślizganie stóp, ruchy nóg "w złą stronę"). `CLIP_PHASE_ANCHOR` (`clipPrep.ts`) przesuwa fazę każdego klipu, a `PlayerAnimator` stosuje ją przy ustawianiu czasu akcji. Dotyczy też chodu i biegu (drobne przesunięcia 0,02 i 0,01).

### Ukosy w lewo: lustrzane kopie chodu w kuckach

Po wyrównaniu faz ukosy w prawo działały, a tył+lewo nadal ślizgał się. Symulacja na szkielecie (mieszanie obrotów jak w `AnimationMixer`, ruch stopy podparcia względem oczekiwanego ruchu ciała) pokazała, że w tył+lewo stopy poruszają się tylko z 59% oczekiwanej prędkości (stopy "prawie stoją"), a w tył+prawo z 127%. Przyczyna: `crouch_walk_back` i `crouch_walk_forward` nie są symetryczne (miednica skręcona o -57° i -46°, korpus o -73° i -71°). Mieszane z `crouch_sneak_right` tworzą spójny ruch, ale z `crouch_sneak_left` ich płaszczyzny ruchu nóg są prawie przeciwne (różnica ok. 190°) i ruchy nóg się znoszą.

Rozwiązanie: `mirrorClip` tworzy z `crouch_walk_forward` i `crouch_walk_back` lustrzane kopie (`*_m`; zamiana Left/Right, negacja Y i Z obrotów oraz X pozycji; reguła sprawdzona na pliku: odbicie `crouch_sneak_right` pokrywa się z `crouch_sneak_left` z dokładnością 0,0006). Przy ruchu w lewo animator przenosi część wagi przodu i tyłu na kopie (`mirrorShare` w `animationState.ts`: 0 bez składowej w lewo, 100% od ukosu 45°), z kotwicami fazy przesuniętymi o pół cyklu. Ukosy w lewo są wtedy dokładnym odbiciem ukosów w prawo (symulacja: ta sama jakość, np. tył+lewo 127% prędkości stóp jak tył+prawo).

### Kierunek ciała w klipach skradania

Pomiar z pliku (kierunek ruchu z fazy podparcia stóp, przód modelu = +Z; chód i bieg dają ruch 0°): `crouch_sneak_left` ma miednicę obróconą o -161° i ruch w stronę -X, `crouch_sneak_right` o +160° i ruch w stronę +X, czyli postać skrada się tyłem do kierunku patrzenia (w grze: "twarzą do kamery", kroki odwrócone względem ruchu). `clipPrep.ts` obraca oba klipy o 180° wokół osi pionowej (`CLIP_YAW_CORRECTION_DEG`), po czym miednica patrzy do przodu (+/-20°), a ruch idzie w stronę +X (lewo) i -X (prawo) jak trzeba. `crouch_walk_forward` i `crouch_walk_back` mają ruch zgodny z nazwą (-4° i -179°), więc bez zmian; w tych klipach korpus jest skręcony o ok. 45-70° względem ruchu (tak jest w pliku, to styl animacji, nie błąd kierunku).

## Kamera

Orbita za postacią: yaw i pitch z myszy (czułość `cameraSensitivity`), cel na tułowiu. Promień wstecz jest próbkowany 14 razy: teren (`groundAt`) i przeszkody (`WalkWorld.index`: drzewa na całej wysokości, skały do ok. 2,6 m skali, drobnica do 1,6 m). Przeszkoda skraca dystans natychmiast, powrót na zadaną odległość jest płynny (0,25 s). Kamera nigdy nie schodzi pod teren (zapas `cameraMargin`). Brak raycastów Three.js; koszt to kilkanaście zapytań do indeksu przestrzennego na klatkę.

## Panel diagnostyczny

Prawy górny róg `/dev/third-person`: animacja (dominująca i waga skoku), prędkość, grounded i kucanie, XYZ, wysokość terenu, yaw ciała, dystans/yaw/pitch kamery, ostatnia blokada kolizji, FPS. Suwaki: Walk/Run/Crouch Speed, Acceleration, Deceleration, Character Turn Speed, Camera Distance, Camera Height (cel), Camera Sensitivity, Camera Smoothness, Animation Crossfade, Jump Height, Gravity. Przyciski: Ustaw jako domyślne (zapisuje bieżące wartości suwaków w `localStorage` tej przeglądarki, klucz `miasto.tpp.defaults`, i wczytuje je przy każdym otwarciu trasy), Domyślne z kodu (kasuje zapis i wraca do `TPP_DEFAULTS`), Cofnij do domyślnych (do zapisanych albo z kodu), Kopiuj zmiany (JSON do wklejenia w `config.ts`), Wróć na start, Ukryj panel. Zapis w przeglądarce nie zmienia kodu: żeby wartości trafiły do repozytorium, trzeba je przepisać do `TPP_DEFAULTS`. Panel istnieje tylko na trasie deweloperskiej.

## Zakres i granice

- Nie zmieniono: generatora świata, kolizji `WalkWorld`, zapisu, zadań, trolla, skrzyń, mostu, wartości życia, zegara, mapy i `MIASTO_DEFAULT`.
- (TPP1) Interakcje z grą w `/dev/third-person` nie były podpięte; od TPP2 działają w głównej grze (patrz niżej).
- Single-player; `PlayerIntent` i czysta logika w `src/lib/tpp/` są gotowe do przeniesienia na serwer (bez implementacji synchronizacji).

## Znane ograniczenia i ryzyka

- Kolizje poziome to koło (`WalkWorld`), bez wymiaru pionowego: wysokie przeszkody (skały) można w TPP przeskoczyć tylko w sensie wizualnym; kolizja pozostaje taka jak w pierwszej osobie. Sufity nad głową nie istnieją, więc `canStand` zawsze pozwala wstać (hak jest w `PlayerWorld.canStand`).
- Faza chodu i biegu jest wspólna, więc nominalne prędkości klipów (`nominalWalk`, `nominalRun`, `nominalCrouch`) trzeba dostroić na oko do ślizgania stóp.
- Kierunek przodu modelu (`modelYawDeg`) jest ustawiony z manifestu (`+z`); gdyby postać szła tyłem, korekta to jedna wartość `modelYawDeg = 180` (nie ma jeszcze suwaka).
- Materiał z pliku GLB bez strojenia pod oświetlenie lasu (jasność, cień): do oceny przez autora.
- Pad: skok (✕) i kucanie (○) są wybrane roboczo, do zatwierdzenia przez autora; przyciski nie są jeszcze w oknie podpowiedzi.
- Nic z tego nie zostało uruchomione.

## Test ręczny (dla autora)

1. `npm run dev`, otwórz `http://localhost:3000/dev/third-person` (opcjonalnie `?seed=2030&q=HIGH`). Poczekaj na koniec ładowania lasu; powinna być widoczna dziewczynka w idle i kamera za nią.
2. Kliknij w scenę (przechwycenie myszy). Ruszaj myszą: kamera obraca się wokół postaci.
3. W/A/S/D: chód względem kamery, ciało obraca się w stronę ruchu; stopy nie ślizgają się wyraźnie.
4. Shift + W: bieg; po puszczeniu Shift płynny powrót do chodu; po puszczeniu W do idle (bez skoku pozy).
5. Spacja: jeden skok, w powietrzu druga Spacja nic nie robi; lądowanie bez teleportu; postać nie odjeżdża w trakcie animacji.
6. C: kucanie (animacja `crouch_idle`), W/S/A/D w kuckach: klipy `crouch_walk_forward`, `crouch_walk_back`, `crouch_sneak_left`, `crouch_sneak_right`; ukosy mieszają dwa klipy; prędkość ok. 1,0 m/s w panelu.
7. C jeszcze raz: wstanie (płynnie, bez snapu kapsuły).
8. Spacja w kuckach: wstaje i skacze.
9. Wejdź na wzgórze i zejdź: stopy na terenie, bez drgań i unoszenia; zejście z krawędzi daje spadanie i lądowanie.
10. Podejdź do drzewa i skały: kolizja jak w pierwszej osobie, kamera dociąga się przed przeszkodą i wraca.
11. Ustaw się plecami do drzewa lub wzgórza: kamera nie wchodzi w teren ani pień.
12. Idź do rzeki bez mostu: zatrzymuje cię jak w grze; most (flagi mostu) w tej trasie nie jest budowany.
13. Esc: kursor zwolniony, panel dostępny; kliknięcie w scenę przechwytuje go ponownie.
14. Suwaki panelu (prędkość, kamera, crossfade, skok): zmiany działają na żywo; "Domyślne" przywraca wartości.
15. Zmiana rozmiaru okna: proporcje kamery poprawne.
16. FPS w panelu bez wyraźnych spadków (porównaj z `/dev/forest-pro`); zmiana jakości przez `?q=`.
17. Trasa `/dev/forest` i `/dev/forest-pro` działają jak dotąd; główna gra (las) nadal z oczu gracza.
18. Odśwież stronę kilkakrotnie i wyjdź z trasy: brak błędów w konsoli, brak narastającej liczby geometrii (`dispose`).

Do uruchomienia przez autora po akceptacji: `npx vitest run src/lib/tpp src/lib/forest-view/clipPrep.test.ts src/lib/forest-view/player.glb.test.ts`, następnie `npm run lint`, `npx tsc --noEmit` i `npm run build`.
