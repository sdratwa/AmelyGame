# Zabawa w chowanego (H1)

Opcjonalny tryb multiplayer w lesie. Przełącznik **Menu → Konfiguracja → „Zabawa w chowanego”** jest domyślnie **WYŁĄCZONY**; wtedy gra działa dokładnie jak dotąd (brak dodatkowego UI, filtrów, ograniczeń i zmian w migawkach). Włączenie przez gracza w lesie tworzy sesję na serwerze; organizator jest szukającym, pozostali dostępni gracze w tym samym świecie dostają zaproszenie. Bez drugiego gracza sesja nie powstaje. Stan autorytatywny leży wyłącznie w serwerze (single-player nie jest tym dotknięty).

## Zasady rundy

| Faza | Czas | Co się dzieje |
| --- | --- | --- |
| `INVITING` | odliczanie 30 s od pierwszej akceptacji (koniec wcześniej, gdy wszyscy odpowiedzą); limit zaproszenia 60 s | Modal „ZAPROSZENIE DO ZABAWY!” (DOŁĄCZAM! / NIE TERAZ). Brak odpowiedzi = nie bierze udziału. |
| `HIDING` | 60 s | Szukający zamrożony na serwerze, kamera prosto w dół, nie widzi ukrywających się, ich minimapy ani dźwięków. Ukrywający chodzą i wybierają miejsce: „TO MOJA KRYJÓWKA!” (serwer sprawdza: stoi na ziemi, ruch jest świeży i legalny). Po 60 s kryjówka jest ustalana automatycznie w ostatnim stabilnym miejscu. |
| `SEEKING` | domyślnie 300 s (suwak 1-15 min w ustawieniach) | Szukający dostaje dla każdego ukrywającego losowy obszar o promieniu 50 m (tylko na swojej minimapie). „ZNALAZŁEM!”: serwer bierze własną pozycję szukającego i pozycje ukrytych, 3D dystans < 3 m, wygrywa najbliższy; klient nie wskazuje celu. Maks. 3 pudła (bez zerowania): „JESZCZE NIE TUTAJ!”, „UWAŻAJ, OSTATNIA PRÓBA!”. W ostatnich 30 s serwer wymusza rozbłyski lamp (2-3 s świeci, 5-10 s przerwy, osobno dla każdego ukrywającego); ręczny stan lampy nie jest zmieniany. |
| `FINISHED` / `CANCELLED` | - | Przyjazny ekran wyniku i „WRÓĆ DO GRY”. |

Role: `SEEKER`, `HIDER_MOVING`, `HIDER_LOCKED` (pozycja X/Z zamrożona; skok w miejscu, kucanie, obrót, kamera i lampa działają), `HIDER_FOUND`, `WITHDRAWN`.

Wynik liczy serwer: szukający wygrywa, gdy znajdzie wszystkich; ukryci wygrywają przy upływie czasu lub po wyczerpaniu pudeł. Rezygnacja (z potwierdzeniem) i wyjście ukrywającego to `WITHDRAWN`; gdy zabraknie uczestników albo zniknie szukający (po okresie łaski) runda jest **anulowana**, nikt nie dostaje wygranej. Wygrana/porażka nie ma trwałych kar ani nagród i nigdy nie blokuje wątku głównego.

Nazwy ukrywających się są ukryte dla wszystkich uczestników (centralny nadpis etykiet). Uczestnicy są odizolowani: nie zbierają zasobów, nie otwierają skrzyń, nie budują mostu i nie dostają nagród (serwer odrzuca `worldCommand`, klient dodatkowo blokuje polecenia). Izolacja jest logiczna (filtr widoczności i kolizji per odbiorca), geometria świata jest wspólna.

## Rozłączenie i powrót

Zerwane połączenie (kod inny niż 4000 = świadome wyjście) zostawia „ducha” na 20 s okresu łaski. Serwer wydaje klientowi `resumeToken` (w `welcome`); z nim klient wraca na ten sam `playerId`, rolę i pozycję, a `welcome.hs` przywraca widok sesji. Obcy token nie przejmuje tożsamości. Po upływie łaski ukrywający zostaje `WITHDRAWN`, szukający powoduje anulowanie rundy. Świadome opuszczenie pokoju to natychmiastowa rezygnacja.

## Protokół 5

Klient → serwer: `hs.start {seekMinutes}`, `hs.cancel`, `hs.respond {accept}`, `hs.presence {inForest}`, `hs.hide`, `hs.found {requestId}`, `hs.withdraw`. Serwer → klient: `hs.state` (widok `HsStateView` filtrowany per odbiorca, rośnie `rev`), `hs.event` (hit / found / miss), `hs.notice {code}`, `hs.correct {x,y,z}` (korekta pozycji zablokowanego gracza), a w `welcome` także `resumeToken` i `hs`. Migawki zawierają `mini` (`seeker`/`hider`/`found`) i `lanternForced` tylko w trakcie zabawy. Ruch uczestników ma tryb ścisły w `checkMotion` (brak teleportów, ciągłość próbek, bramka ruchu z fazy). Niezgodny klient (protokół 4) nie dołączy.

Parametry rundy (dystans, limit pudeł, promień, czasy, łaska, cooldown) są zatwierdzane przez serwer przy starcie rundy. Zwykły klient wpływa tylko na `seekMinutes` (1-15). Resztę serwer przyjmuje wyłącznie w trybie deweloperskim (`MIASTO_HIDESEEK_DEV=1`) po przycięciu do granic z `src/lib/hideseek/config.ts`; edytuje się je w panelu Diagnostyka (klawisz `O`, sekcja „Zabawa w chowanego”).

## Pliki

| Obszar | Pliki |
| --- | --- |
| Domena (czysta, wstrzykiwane `now()`/`rng()`) | `src/lib/hideseek/{types,config,areas,lamps,gate,visibility,session,texts,restrictions,clientState,devConfig,testkit}.ts` |
| Serwer | `server/src/HideSeekHost.ts` (most pokój ↔ sesja, filtrowanie migawek, duchy, `resumeToken`), `server/src/ForestRoom.ts` |
| Protokół i klient | `src/lib/multiplayer/{protocol,client,commands,motionPhysics}.ts` |
| Ruch i kamera | `src/lib/tpp/{thirdPersonRig,playerController,cameraRig}.ts` (bramka ruchu, kamera w dół, `snapHorizontal`) |
| Renderer lasu | `src/lib/forest-view/{renderer,remotePlayers,diagSections}.ts` (etykiety, wymuszona lampa, znaczniki) |
| UI | `src/components/game/hideseek/{HideSeekLayer,useHideSeek,HideSeekDiagnostics}.tsx`, ustawienia, pauza, minimapa, mobilny chip online |
| Wejście | klawisz `H` (akcja główna: „TO MOJA KRYJÓWKA!”/„ZNALAZŁEM!”), pad R3, przycisk dotykowy w HUD |

## Testy automatyczne (Node, bez przeglądarki)

- `src/lib/hideseek/*.test.ts`: maszyna stanów, role, brama ruchu, obszary, lampy, widoczność, teksty, ograniczenia, magazyn klienta (m.in. wszystkie punkty z listy 34 testów jednostkowych).
- `src/lib/tpp/thirdPersonRig.test.ts`: bramka ruchu (zamrożenie X/Z, skok w miejscu).
- `src/lib/multiplayer/hideseek.multiplayer.test.ts`: prawdziwy serwer Colyseus, klienci Node, sztuczny zegar wstrzyknięty przez `ForestRoom.hideSeekOptions`. Scenariusze: 3 graczy (odmowa, chowanie, izolacja, odrzucone ruchy i teleporty, kryjówka w locie, trafienie), pudła/duplikaty/cooldown, auto-kryjówka po 60 s i lampy w ostatnich 30 s, 8 graczy (odliczanie 30 s z niedecydentem, izolacja obcego, zakaz zbierania i budowy, spoofing spoza ról, brak wycieku pozycji), rozłączenia z reconnectem i obcym tokenem, anulowanie po zniknięciu szukającego, świadome wyjście, brak partnera, oraz tryb OFF bez zmian w migawkach.

Uruchomienie: `npx vitest run src/lib/hideseek src/lib/multiplayer/hideseek.multiplayer.test.ts`.

## Wdrożenie serwera

Protokół zmienił się z 4 na **5**: po aktualizacji zrestartuj proces serwera (np. `pm2 restart amelygame-mp`) i odśwież strony klientów. Dla parametrów deweloperskich uruchom serwer z `MIASTO_HIDESEEK_DEV=1`. Format zapisu świata i zapisów gry bez zmian.

## Test ręczny dla autora (2-8 graczy)

Wygląd, dźwięk, FPS, dotyk i pad **nie były sprawdzane przez agenta**.

1. Dwie karty (albo komputer i iPhone) wchodzą do „Gra online”, oboje do lasu. Gracz 1 włącza Konfiguracja → Zabawa w chowanego (suwak czasu np. 1 min). Gracz 2 widzi modal; „DOŁĄCZAM!”.
2. 60 s chowania: gracz 1 nie może ruszyć się, kamera patrzy w dół, nie widzi gracza 2; gracz 2 chodzi i naciska „TO MOJA KRYJÓWKA!” (albo `H`). Spróbuj w locie (powinna być odmowa) i poczekaj do auto-zablokowania.
3. Szukanie: obszar 50 m na minimapie gracza 1, brak nazwy nad ukrytym; „ZNALAZŁEM!” z daleka daje „JESZCZE NIE TUTAJ!”, ostatnia próba daje ostrzeżenie; z bliska (< 3 m) trafienie i ekran wyniku. Zablokowany gracz 2 skacze w miejscu, kuca, obraca się, włącza lampę; ruch poziomy jest cofany.
4. Ostatnie 30 s: lampy ukrytych migają same; po końcu wracają do ręcznego stanu.
5. 3-8 graczy: część odmawia, jeden nie odpowiada (po 30 s start bez niego); gracz spoza zabawy nie widzi uczestników i na odwrót; uczestnik nie zbiera drzew ani nie buduje mostu.
6. Rozłączenie: zamknij kartę ukrywającego i otwórz ponownie w ciągu 20 s (powrót do roli i miejsca); po 20 s zostaje wycofany. Zamknięcie karty szukającego po 20 s anuluje rundę (bez wygranej).
7. Wyłączenie przełącznika w trakcie sesji prosi o potwierdzenie anulowania. Rezygnacja z potwierdzeniem działa. Po „WRÓĆ DO GRY” wszyscy widzą się normalnie.
8. Przełącznik OFF: gra bez dodatkowych elementów.

## Ryzyka i ograniczenia

- Ukryta postać szukającego jest widoczna w migawce od startu poszukiwań (z oznaczeniem `hider`, bez nazwy); to zamierzone, ale pozycja jest znana klientowi. Fałszowanie klienta ujawniłoby ją dopiero w SEEKING.
- Ruch pozostaje klient-autorytatywny; tryb ścisły dotyczy tylko uczestników.
- Listy pomocy ze skrótami nie zostały rozszerzone o klawisz `H` (tryb OFF nie pokazuje nic dodatkowego).
- Istniejący błąd `assets.test.ts:202` (19 zamiast 20 materiałów) nie dotyczy tego etapu.
