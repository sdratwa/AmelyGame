# Multiplayer M1a i przestrzenne kroki

Stan: implementacja przygotowana do ręcznej oceny. Testy M1a przechodzą; pełny zestaw ma jeden istniejący błąd materiałów GLB. Obrazu, rozgrywki dwóch osób i jakości HRTF nie sprawdzano w przeglądarce.

## Baza i zakres

Gałąź `feature/multiplayer-m1a`, baza Cursora `d201c0496ed6bba170a06bbd1491d93efa13358a`, zgodna z pobranym stanem jego gałęzi na origin. Zachowane TPP, PlayerController, ForestRenderer, WalkWorld, generator v3, SaveV4 i kreator.

Przypięte pakiety: `@colyseus/core` 0.18.23, `@colyseus/ws-transport` 0.18.4, `@colyseus/sdk` 0.18.6, `@colyseus/schema` 5.0.42, `tsx` 4.23.15. Synchronizacja używa wiadomości ze snapshotami, nie schematów całego modelu gry.

## Architektura i pliki

| Warstwa | Pliki | Odpowiedzialność |
| --- | --- | --- |
| Proces Node | `server/src/index.ts`, `server.ts`, `ForestRoom.ts` | WebSocket, instancja, limit 8, tożsamość z połączenia, walidacja, rozsyłanie stanu |
| Kontrakt | `src/lib/multiplayer/protocol.ts`, `soundEvents.ts` | typy, walidacja ruchu, rejestr nagrań, kolejność zdarzeń |
| Świat | `src/lib/multiplayer/world.ts` | konfiguracja, własny WalkWorld instancji, bezpieczne starty |
| Klient | `src/lib/multiplayer/client.ts` | handshake, snapshoty, interpolacja, ping, reconnect, sekwencje |
| Wejście | `src/components/game/GameEntry.tsx`, `src/app/page.tsx` | wybór solo/online, status, wyjście, panel developerski |
| Gra | `GameApp.tsx`, `ForestWorldView.tsx`, `Minimap.tsx` w `src/components/game/` | osobny zapis postępu online, wspólna pora dnia, renderer i znaczniki |
| Postacie | `src/lib/forest-view/renderer.ts`, `remotePlayers.ts` | istniejący lokalny TPP, klony GLB, niezależne animatory |
| Audio | `src/lib/audio/controller.ts`, `playerSpatial.ts` | wspólny kontekst i bufory, emitery, HRTF, tłumienie, cleanup |
| Testy | `src/lib/multiplayer/*.test.ts`, `src/lib/audio/controller.test.ts` | Node WebSocket, protokół, świat, audio i atrapy Web Audio |
| Konfiguracja | `package.json`, lockfile, `.env.multiplayer.example`, `.gitignore` | zależności, uruchomienie, wzór środowiska |

Drobna korekta `src/lib/character/registry.ts`: literal `level: 0 as const`, wymagany przez istniejący typ manifestu; bez zmiany zachowania kreatora.

Warstwa sieciowa i domena świata nie importują React, DOM ani Three.js. Przepływ: LocalPlayer → stan ruchu → ForestRoom → snapshot → bufor interpolacji → RemotePlayers oraz audio. Interakcje i nagrody nie są obsługiwane przez ten protokół.

## Instancja i deterministyczność

`worldId=forest_start` identyfikuje rodzaj świata, `worldInstanceId=world_001` konkretny pokój, `worldSeed=2030`, `generatorVersion=3`. `playerId` to serwerowy UUID postaci obecnej sesji; `sessionId` jest identyfikatorem połączenia Colyseus. Nie są identyfikatorami konta ani trwałego zapisu.

Proces przed udostępnieniem komunikatu gotowości tworzy jeden pokój. Klient używa `joinById("world_001")`; pełny pokój nie tworzy automatycznie drugiego lasu. Pusty pokój pozostaje do końca życia procesu. Restart procesu usuwa obecność wszystkich graczy.

Serwer przesyła konfigurację, klient sprawdza wersję i fingerprint świata oparty na istniejącym gameplayDigest, a następnie generuje las lokalnie. Nie przesyłamy geometrii. Test porównuje dodatkowo wynik: plan z rzeką i ścieżkami, wszystkie obiekty kolizyjne, próbki wysokości oraz starty.

Niezmienne dane generatora mogą korzystać z istniejącego cache. Każda instancja ma osobny indeks WalkWorld oraz skopiowane obiekty, collidery, bariery i przejścia. Test sprawdza odrębność colliderów i dodaje przeszkodę do jednej instancji, potwierdzając brak wpływu na drugą. Nie wprowadzono współdzielonych mutowalnych questów czy skrzyń.

Osiem startów leży w jednym spójnym komponencie siatki na zachodnim brzegu. Każdy punkt przechodzi `checkPoint`, a krawędzie przeszukiwania `walk.move`; uwzględniane są drzewa, skały, skrzynie, bariery i teren. Pierwsze dwa starty dzieli 50–100 m. Kolejne są oddalone o ponad 8 m od zajętych. Nie ma losowania pozycji przy każdym dołączeniu: przydzielany jest pierwszy wolny slot.

## LocalPlayer, RemotePlayer i ruch

LocalPlayer korzysta z dotychczasowego kontrolera, kamery, klawiatury, myszy i gamepada. Sieć wysyła `bodyYaw`, a nie kierunek kamery zapisany w `forestPose.yaw`.

RemotePlayer jest klonem już załadowanej sceny GLB przez `SkeletonUtils.clone`, z własnym szkieletem i `AnimationMixer`. Nie pobiera osobnego GLB. Geometria i materiały pozostają współdzielone; usunięcie zdalnej postaci zwalnia jej szkielet i etykietę, a nie wspólne zasoby. Odtwarzanie wykorzystuje istniejący PlayerAnimator, przygotowanie klipów, mirrorClip/mirrorShare i fazy animacji. Ruch wybiera wszystkie dziewięć stanów na podstawie prędkości, kierunku względem ciała, kucania i lotu; nazwa dominującego klipu jest również przesyłana diagnostycznie.

Domyślnie wysyłanie i snapshoty: 20 Hz (`NET.hz`). Interpolacja: 100 ms (`NET.interpolationMs`), regulacja w panelu 50–250 ms. Pozycja jest interpolowana liniowo, obrót najkrótszą drogą kątową. Brak ekstrapolacji po ostatnim snapshotcie. Animatory nie są restartowane przez pakiety.

`sequence` i `jumpSequence` należą do połączenia, więc przebudowa renderera nie zeruje liczników. Wzrost numeru skoku uruchamia zdarzenie animatora. Nie przesyłamy kości ani klatek animacji.

### Protokół

| Wiadomość | Kierunek | Dane / zasady |
| --- | --- | --- |
| join | klient → serwer | zgodna wersja protokołu 2 i fingerprint |
| hello / welcome | oba | konfiguracja świata, własna postać/start i worldElapsed |
| motion | klient → serwer | XYZ, bodyYaw, vx/vz, speed, crouching, grounded, running, animation, sequence, jumpSequence |
| snapshot | serwer → pokój | serverTime, worldElapsed i tablica Player, 20 Hz |
| notice | serwer → pokój | neutralny komunikat o dołączeniu/wyjściu |
| ping / pong | oba | pomiar RTT |
| sound | oba | klient wybiera tylko soundId; serwer tworzy pełne PlayerSoundEvent |
| soundUnavailable | serwer → nadawca | „Brak pliku audio” |

Motion odrzuca pola spoza kontraktu, obce identyfikatory, NaN/Infinity, niepoprawne typy i animacje, przestarzałą sekwencję, cofnięcie licznika skoków oraz wartości poza limitami (XZ <150 m modułu, Y <100 m modułu, szybkość/składowe ≤20 m/s). Limit wiadomości: 35/s na połączenie. To kontrola struktury i podstawowych granic, nie fizyka autorytatywna: teleport w dozwolonym obszarze nadal jest możliwy. Dane te nie autoryzują wspólnych nagród.

### Wyjście i reconnect

„Wróć do miasta” przełącza widok bez rozłączenia. ESC otwiera pauzę po zwolnieniu myszy. Tylko „Wyjdź online” zapisuje aktualny postęp i pozycję, opuszcza pokój i wraca do wyboru trybu; błąd zapisu zatrzymuje wyjście. Serwer usuwa postać, slot i limity oraz natychmiast rozsyła snapshot. Model i emitery znikają u odbiorców. Zamknięcie karty obsługuje zerwanie WebSocket; przy utracie sieci wykrycie może potrwać do timeoutu transportu.

Po utracie połączenia UI pokazuje stan i przycisk „Połącz ponownie”. Jest to nowa sesja transportu i nowy playerId, ale GameApp pozostaje zamontowany i zachowuje lokalny postęp oraz pozycję. Test potwierdza brak duplikatu po opuszczeniu i ponownym wejściu. Pełny pokój i niedostępny serwer są błędami wejścia, nie powodem utworzenia innej instancji.

## Spatial audio

Wykorzystane istniejące pliki: `public/audio/footsteps.light.1.ogg` do `footsteps.light.4.ogg` oraz ich warianty `.m4a`; manifest `public/audio/audio.json`. Nie dodano żadnego nagrania. Bufory dekoduje i współdzieli dotychczasowy AssetLoader w jednym ForestAudioController/AudioContext na sesję lasu.

Lokalne kroki pozostają w istniejącym harmonogramie i busie, otrzymały pozycjonowanie HRTF. Własny playerId jest wykluczony z listy zdalnych emiterów. RemotePlayer ma osobny PlayerStepEmitter z kontrolowanym harmonogramem opartym na pokonanym dystansie (stride chodzenia 1,2 m, biegu 1,8 m). Snapshot nie resetuje harmonogramu. Idle i lot nie tworzą zwykłych kroków. To kontrolowany rytm, nie dokładne wyznaczanie kontaktu stopy z kości.

Każdy krótki krok ma PannerNode z `panningModel=HRTF`, pozycją przy stopach (`y+0,1`). Aktywne źródła podążają za postacią, mają aktualizowaną głośność. Limit: trzy jednoczesne kroki na zdalnego gracza. Wyjście usuwa emitery i rozłącza węzły; wspólne bufory pozostają dostępne.

Słuchacz znajduje się przy lokalnej postaci, na wysokości 92% kapsuły (także przy kucaniu/skoku). Orientacja podąża za yaw kamery. Odsunięcie kamery nie przesuwa słuchacza. W tej wersji orientacja jest pozioma: pitch kamery nie zmienia kierunku uszu.

| Parametr | Domyślnie |
| --- | --- |
| Zasięg chodu / biegu / kucania | 22 / 36 / 6 m |
| Głośność zdalna | 1 |
| Mnożnik kucania / biegu | 0,25 / 1,3 |
| Odległość odniesienia / rolloff | 2 m / 1 |
| Przyszły HELP_SHOUT | 120 m, gain 1, refDistance 12 m, rolloff 1, priority 2 |

Kroki używają odwrotnego tłumienia odległościowego pomnożonego przez smoothstep wygaszający ostatnie 35% zasięgu. Panner ma rolloff=0, by nie liczyć tłumienia drugi raz; odpowiada za HRTF. Nie ma nagłego skoku głośności na granicy zasięgu. Nie ma akustycznych raycastów ani przesłaniania przez skały/drzewa.

Panel developerski „Multiplayer / audio” pokazuje pozycje, animacje, ID, konfigurację świata, ping, liczbę aktualizacji, AudioContext, emitery wraz z playerId i aktywnymi głosami oraz najbliższą odległość. Umożliwia zmianę interpolacji, wyłączenie zdalnych kroków, regulację głośności, trzech zasięgów i tłumienia. Nie jest renderowany w produkcji. Parametry są sesyjne.

Autoplay obsługuje istniejący mechanizm resume po pointerdown/keydown/touchend. Jeśli kontekst jest zablokowany, wejście do gry nadal działa; kliknij w grę lub naciśnij klawisz. Ukrycie karty wstrzymuje kontekst i usuwa zdalne kroki, powrót wznawia istniejącą sesję bez tworzenia kontekstu na gracza.

## Przyszłe nagrane komendy

Rejestr SOUND_REGISTRY ma HELP_SHOUT z `asset:null`. W zwykłej grze nie ma przycisku udającego działający okrzyk; panel informuje o braku nagrania. Odtwarzacz zwraca false, serwer odpowiada nadawcy „Brak pliku audio”.

PlayerSoundEvent zawiera eventId, playerId, worldInstanceId, soundId, sequence, serverTime oraz XYZ głowy z chwili emisji. Pozycja okrzyku jest zamrożona w momencie emisji. Nadawca wynika z połączenia, nie pola dostarczonego przez klienta; klient nie wybiera URL. Cooldown wynosi 2 s, broadcast jest ograniczony do pokoju. Odbiorca sprawdza instancję, obecność nadawcy, rosnący numer i wiek ≤5 s z korektą zegara na podstawie snapshotów. Duplikaty i stare zdarzenia są odrzucane.

Aby uruchomić HELP_SHOUT: dostarczyć docelowe nagranie (najlepiej mono), dodać wpis i formaty w audio.json, przypisać jego **ID manifestu**, nie URL, do asset w SOUND_REGISTRY po obu stronach, dodać świadomie wywoływaną predefiniowaną akcję UI i przeprowadzić test odsłuchowy. Odtwarzacz, przesłanie zdarzenia i rejestr są przygotowane; priorytet jest polem kontraktu, nie gotową kolejką arbitrażu wielu komend. Mikrofon, voice chat i synteza nie są implementowane.

## Uruchomienie lokalne i LAN

W katalogu repozytorium po pobraniu zależności (`npm ci`):

```sh
npm run multiplayer
```

Serwer słucha na `0.0.0.0:2567`. Poczekaj na `Miasto multiplayer: 2567`. Drugi terminal:

```sh
npm run dev
```

Next.js słucha na `0.0.0.0:43217`. Otwórz ręcznie grę pod adresem komputera hosta, np. `http://192.168.1.10:43217`, na obu komputerach i wybierz „Gra online”. Domyślny WebSocket używa hostname z adresu strony, portu 2567 i protokołu ws/wss zależnego od strony, więc localhost nie jest narzucony drugiemu urządzeniu. Oba komputery muszą mieć dostęp do portów 43217 i 2567 hosta w LAN; wyklucz izolację klientów Wi-Fi.

Przy dostępie przez LAN dodaj do `.env.local` także `ALLOWED_DEV_ORIGINS=IP_HOSTA` (np. `192.168.1.243`, bez protokołu i portu). Istniejący next.config.ts odczytuje tę listę. Zrestartuj `npm run dev` i odśwież stronę. Bez tego Next.js może blokować zasoby developerskie, w tym HMR, i strona może nie reagować na kliknięcia. Po zmianie adresu hosta przez DHCP zaktualizuj wpis.

Opcjonalnie skopiuj wartości z `.env.multiplayer.example`: `NEXT_PUBLIC_MULTIPLAYER_URL=ws://IP_HOSTA:2567` do `.env.local` klienta, a następnie zrestartuj Next. Zmiana publicznego endpointu w produkcji wymaga rebuilda. Port serwera ustaw zmienną procesu, np. `MULTIPLAYER_PORT=2568 npm run multiplayer`. Proces tsx nie wczytuje automatycznie `.env.local` Next.js. Nie kopiuj przykładowego IP bez dostosowania.

Przyszły VPS: osobny proces Node i reverse proxy HTTPS/WSS z poprawnym Upgrade/Connection, publiczny adres WSS w NEXT_PUBLIC_MULTIPLAYER_URL, proxy do wewnętrznego portu Node. Jeden proces zarządza world_001; nie uruchamiać kilku replik z tym samym ID bez wspólnej koordynacji. Sekrety nigdy do NEXT_PUBLIC. Brak wdrożenia, kont i autoryzacji dostępu: obecny prototyp przeznaczony jest do zaufanego LAN. Przed publikacją potrzebne są zabezpieczenia dostępu i aktualizacja podatnej wersji Next.js.

## SaveV4 i ograniczenia M1a

Online używa osobnego SaveV4 w localStorage pod kluczem miasto.online.<worldInstanceId>. Wczytuje osobisty postęp i pozycję, a nową grę tworzy tylko przy braku zapisu. Uszkodzony lub niezgodny zapis nie jest zastępowany nową grą. Autosave solo pozostaje niezależny. Zapis jest lokalny dla przeglądarki, nie jest kontem na serwerze.

Questy, ekwipunek, skrzynie, troll, zasoby i most są indywidualne i zapisywane lokalnie online. Dwaj gracze mogą widzieć różny stan skrzyni/mostu i przechodzić inaczej po własnych interakcjach. Serwer nie rozstrzyga tych zdarzeń. Wygląd kreatora nie jest przesyłany: zdalne modele korzystają z lokalnego wzorca GLB. Gracze nie mają wzajemnych kolizji. Pora dnia i sezon pochodzą z zegara serwera. Pogoda i NPC nie są synchronizowane.

Przy przestojach lub ukryciu karty ostatnia pozycja pozostaje do aktualizacji albo wykrycia rozłączenia. Reconnect zachowuje postęp w aktywnej grze; ponowne wejście odczytuje lokalny zapis. Generator/seed pierwszego świata są ustalone po obu stronach do weryfikacji handshake; wybór innych światów wymaga rozszerzenia wejścia. Nie ma migracji działających instancji pomiędzy wersjami generatora.

M1b: przenieść symulację PlayerController/WalkWorld do fixed timestep serwera, wysyłać input z sekwencją i ack, dodać predykcję i reconciliation. Zachować warstwy interpolacji, modeli i audio. M1c: autorytatywne interakcje, rozdział questów solo/co-op i trwały model świata; nie przenosić po prostu autosave klienta na serwer.

## Ręczny scenariusz odbioru

1. Uruchom serwer i Next zgodnie z instrukcją; użyj słuchawek stereo.
2. Na dwóch komputerach otwórz adres hosta i wybierz online. Oba panele powinny pokazywać world_001 i 2/8.
3. Sprawdź różne playerId i starty około 50–100 m od siebie, na dostępnym terenie.
4. Odszukaj drugą postać; sprawdź etykiety i niezależność modeli.
5. Niech druga osoba chodzi i biega: oceń płynność, obrót ciała, animacje i brak restartów klipu.
6. Sprawdź kucanie, ruch w kuckach do przodu/tyłu/na boki oraz skok. W powietrzu zwykłe kroki mają milczeć.
7. Sprawdź aktualizowanie znaczników na minimapie i ich usunięcie przy wyjściu.
8. Podejdźcie na 5–10 m; kliknij w grę, jeśli AudioContext jest suspended.
9. Jedna osoba stoi, druga chodzi dookoła. Oceń kroki z miejsca stóp, bez podwajania własnych kroków.
10. Obróć kamerę bez przesuwania postaci: kierunek słyszenia powinien się zmieniać, dystans nie. Zmień odsunięcie kamery.
11. Oddalajcie się: sprawdź płynne zanikanie przy zakresach chodu/biegu; dostrój zasięg i rolloff w panelu.
12. Porównaj bieg i skradanie: bieg powinien być częstszy, głośniejszy i słyszalny dalej.
13. Zatrzymaj drugą postać: po wybrzmieniu krótkiej próbki nie powinny powstawać kolejne kroki.
14. Wyjdź online lub zamknij kartę drugiej osoby: postać i jej emitery muszą zniknąć. Ponownie dołącz i sprawdź brak duplikatu. Sprawdź też ukrycie/powrót karty i chwilową utratę sieci.
15. Schowaj minimapę/na moment zamknij oczy: oceń możliwość odnalezienia drugiej osoby po kierunku kroków. Przód/tył HRTF może zależeć od słuchacza i sprzętu.
16. Wróć do menu i otwórz solo: sprawdź wcześniejszy SaveV4, ruch, kreator i kroki. Online nie powinno nadpisać zapisu.

Po dostarczeniu okrzyku: wykonaj emisję z lewej/prawej/przodu/tyłu oraz z 20/80/120/150 m. Sprawdź pozycję głowy utrwaloną podczas emisji, cooldown, pojedyncze odtworzenie, wyjście nadawcy, brak zdarzenia w innej instancji oraz brak zastępczego dźwięku przy brakującym pliku.

## Automatyczna weryfikacja

Wyłącznie Node/Vitest/TypeScript/ESLint/build; bez przeglądarki, automatyzacji GUI i screenshotów. Test integracyjny uruchamia tymczasowy serwer na losowym porcie, dwóch niezależnych klientów SDK, ruch, obrót, skok, podszywanie, izolację dźwięku, cooldown, 8 miejsc i odrzucenie 9. osoby, wyjście oraz ponowne dołączenie. Po teście połączenia i serwer są zamykane.

Testy audio sprawdzają niezależny rytm emiterów, Idle/Jump, tłumienie, odrzucanie własnej postaci, kolejność zdarzeń i brak WAV. Atrapy Web Audio potwierdzają współdzielenie kontekstu/dekodowanych buforów, konfigurację HRTF, aktualizowanie pozycji stóp, brak kroków przy postoju i cleanup. Nie dowodzą jakości słyszalnego obrazu HRTF.

Wyniki końcowe i dokładne polecenia znajdują się poniżej.

| Polecenie | Wynik końcowy |
| --- | --- |
| `npx vitest run src/lib/multiplayer` | 4 pliki, 23 zaliczone, 0 błędów; testy kontrolera audio również objęte pełnym zestawem |
| `npm test` | 1165 zaliczonych, 1 niezaliczony, 2 pominięte; pliki: 99 zaliczonych, 1 niezaliczony, 2 pominięte |
| `npm run typecheck` oraz `npx tsc --noEmit` | zaliczone |
| `npm run lint` | 0 błędów, 2 istniejące ostrzeżenia unused-vars |
| `npm run build` | końcowe ponowienie zaliczone; 9 stron wygenerowanych; ostrzeżenie o podatności Next.js 16.4.0 |
| `git diff --check` | bez błędów whitespace |

Jedyny błąd pełnego zestawu: `src/lib/assets/assets.test.ts:202`, liczba materiałów 19 zamiast oczekiwanych 20. Odtworzony poleceniem `npx vitest run src/lib/assets/assets.test.ts -t 'materiały i geometrie'` w osobnej kopii bazowego HEAD d201c049, bez zmian M1a (1 błąd, 26 pominiętych). Nie zmieniano oczekiwania testu ani manifestu, aby ukryć rozbieżność.

Ostrzeżenia linta: `scripts/assets/analyze-player-body.mjs` (fs) i `src/lib/character/clothing/deriveShell.ts` (n). Build początkowo zatrzymywał się na komunikacie SecurityFatalError o podatności Next.js; po ponowieniu przechodził. Jedna późniejsza próba zgłosiła też MODULE_NOT_FOUND dla baseline-browser-mapping; sprawdzenie npm ls wykazało zainstalowaną zależność, kolejne wykonanie przeszło bez zmiany pakietów. Nie wykonano aktualizacji Next.js w ramach M1a. Aktualizacja bezpieczeństwa jest zalecana przed udostępnieniem poza LAN.

Wynik odbioru: **M1a — implementacja i testy automatyczne modułu ukończone; jeden potwierdzony błąd bazowego zestawu; oczekuje na ręczną weryfikację multiplayera i dźwięku przestrzennego.**


## Poprawka utraty postępu i nakładania UI (23 października 2026)

Pliki: GameEntry.tsx, GameApp.tsx, ForestWorldView.tsx, multiplayer/save.ts i save.test.ts.
Panel sieciowy zajmuje własny pas nad grą, zamiast nakładki fixed z-index 50. Diagnostyka jest zwinięta i ma ograniczoną wysokość z przewijaniem. Bez zmian modeli, draw calls, trójkątów i tekstur.

Odbiór ręczny autora: zdobądź schemat i kilof, odejdź od startu, naciśnij ESC i wznów grę; następnie wyjdź online i dołącz ponownie oraz odśwież stronę. Sprawdź przedmioty, etap questa i pozycję. Sprawdź także reconnect po utracie sieci, powrót do miasta i przyjęcie ogłoszenia przy zwiniętej oraz rozwiniętej diagnostyce. Zapis solo ma pozostać bez zmian. Postępu utraconego przed tą poprawką nie można odtworzyć, jeśli nigdy nie został zapisany.

Weryfikacja poprawki: `npm test` — 1162 zaliczone, 2 pominięte, 1 istniejący błąd assets.test.ts:202 (19 materiałów zamiast 20). Dwa nowe testy postępu online przechodzą, obejmują schemat, kilof, quest, pozycję, most, niezależność solo i ochronę niezgodnego/uszkodzonego zapisu. `npm run typecheck` zaliczony; `npm run lint` bez błędów, dwa istniejące ostrzeżenia; `npm run build` zaliczony po ponowieniu wymaganym przez ostrzeżenie bezpieczeństwa Next.js. Aktualizacja Next.js pozostaje osobnym zadaniem. Bez testów GUI.


## Wspólna pora dnia online (23 października 2026)

Serwer pokoju mierzy upływ czasu monotonicznie i wysyła `worldElapsed` w welcome oraz snapshotach (20 Hz). Protokół podniesiono do 2; po aktualizacji trzeba zrestartować proces multiplayer i odświeżyć klientów. Zegar startuje o 06:00 podczas tworzenia pokoju i działa także bez graczy. Zachowano tempo: 20 sekund rzeczywistych na godzinę gry. Restart procesu serwera rozpoczyna dobę od nowa; trwały zapis zegara serwera nie jest jeszcze implementowany.

HUD, oświetlenie, dzień/noc, sezon i harmonogram audio korzystają ze wspólnego czasu. Menu, dialog, utrata życia i lokalny mnożnik prędkości nie zatrzymują ani nie przesuwają pory dnia online. Przy rozłączeniu klient zatrzymuje się na ostatniej otrzymanej wartości; reconnect pobiera aktualny czas serwera. Lokalny panel developerski nie może ustawiać godziny online.

Czas osobistego postępu `elapsed` pozostaje w SaveV4 i nadal obsługuje dotychczasowe blokady questów oraz pauzę lokalnych mechanik. `worldElapsed` jest polem sesji, nie trafia do zapisu ani nie nadpisuje terminów questa. Drenaż zachowuje dotychczasowe stawki i zasady pauzy, ale porę dnia/sezon wybiera z zegara serwera. Solo działa jak wcześniej.

Odbiór ręczny: uruchom ponownie multiplayer, otwórz grę na dwóch komputerach z różnymi zapisami, dołącz w różnym czasie, porównaj godzinę i światło. Otwórz menu tylko na jednym komputerze, odczekaj, wznów; następnie rozłącz i dołącz ponownie. Wspólna pora dnia ma pozostać zgodna. Bez testów GUI po stronie agenta.

Weryfikacja zegara: 23 testy modułu multiplayer zaliczone. Pełny `npm test`: 1165 zaliczonych, 2 pominięte, jeden wcześniej opisany błąd materiałów GLB (assets.test.ts:202, 19 zamiast 20). Typecheck i build zaliczone; lint bez błędów, dwa istniejące ostrzeżenia. Build wymagał ponowienia po ostrzeżeniu o podatności Next.js; aktualizacja bezpieczeństwa pozostaje osobnym zadaniem. Testy obejmują zegar dwóch klientów, upływ czasu, ponowne dołączenie, różne zapisy, lokalną pauzę, drenaż według wspólnej pory dnia, odrzucanie błędnych wartości i niezależność SaveV4.
