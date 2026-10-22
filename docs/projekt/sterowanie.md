# Sterowanie (macOS, Windows, Linux)

## Las 3D

| Klawisz | Działanie |
| --- | --- |
| W A S D | ruch |
| Shift | bieg |
| mysz | rozglądanie (kliknij w scenę, aby włączyć pointer lock) |
| E | interakcja (skrzynia, drzewo, skała, rozmowa z trollem) |
| I | ekwipunek |
| J | dziennik |
| M | minimapa |
| O (albo F3) | panel diagnostyczny |
| Esc | zamknięcie okna; zwolnienie myszy; kolejny Esc otwiera menu pauzy |

Lista w ekranie pomocy w lesie pochodzi z jednego źródła: `FOREST_CONTROLS` w `src/lib/input/shortcuts.ts`.

## Dlaczego O

Na MacBookach i klawiaturach Apple F3 wymaga Fn albo uruchamia Mission Control, którego strona nie może przechwycić. `O` działa wszędzie. `F3` zostaje dla Windows i innych klawiatur (z `preventDefault`, więc nie otwiera wyszukiwania przeglądarki).

Konflikty: przed zmianą przeszukano wszystkie obsługi `keydown` (`ForestWorldView`, `GameApp`, `Hud`, `ShopInterior`, renderer lasu). `O` nie było używane. Strona `/dev/forest` (prototyp) ma własne skróty (1-9, F, H, L, [ ]) i nie używa `O`.

## Zasady przechwytywania

Wspólna logika: `src/lib/input/shortcuts.ts` (testy: `shortcuts.test.ts`).

- Skróty literowe (E, I, J, M, O) nie działają przy powtórzeniu klawisza, z Ctrl/Cmd/Alt (np. Cmd+O, Option+O na macOS) ani podczas składania znaków (IME).
- Nie działają, gdy fokus jest w polu do wpisywania: `input` tekstowy (nie przyciski, pola wyboru), `textarea`, `select`, `contenteditable`, elementy z rolą `textbox`/`searchbox`/`combobox`.
- F3 nie wpisuje znaku, więc działa także z fokusem w polu; z Ctrl/Cmd/Alt i przy powtórzeniu jest ignorowane.
- Litera jest dopasowana po wydrukowanym znaku (`key`), a dla układów bez liter łacińskich po pozycji klawisza (`code`). Shift nie przeszkadza (można trzymać bieg).
- Podczas pointer lock zdarzenia `keydown` nadal docierają do okna, więc `O`, `F3`, `E`, `I`, `J`, `M` działają. `Esc` zwalnia mysz (przeglądarka), kolejny `Esc` otwiera menu pauzy (strażnik 0,7 s). „Wróć do miasta” zmienia widok bez rozłączania online; „Wyjdź online” zapisuje postęp i opuszcza serwer. Pora dnia online płynie także przy otwartym menu.

## Panel diagnostyczny

Otwiera `O`, `F3` albo (tylko w trybie deweloperskim, `NODE_ENV !== "production"`) przycisk "Diagnostyka" w lewym górnym rogu lasu. Ten sam stan, ten sam panel. Zawartość:

- FPS (i czas klatki), jakość, draw calls, trójkąty;
- sektor i pozycja gracza (x, y, z), stan okna sektorów;
- najbliższy NPC lub zwierzę z dystansem (`nearestCreature`);
- troll: dystans, stan, animacja, patrol, dialog (albo "niedostępny");
- jeleń: dystans, stan, animacja, skala, trójkąty, głowa (albo "niedostępny").

Panel nie przechwytuje myszy (poza przyciskiem "Powtórz spotkanie"), więc można go mieć otwartego podczas gry. Klawisz F4 (powtórka spotkania z trollem) działa, gdy panel jest otwarty.

## Test ręczny (macOS)

1. Wejdź do lasu, poczekaj na koniec ładowania.
2. Naciśnij O: panel się pojawia; drugie O go chowa. F3 robi to samo.
3. Kliknij w scenę (pointer lock) i naciśnij O: panel nadal się przełącza.
4. Otwórz ekwipunek (I) i dziennik (J): działają jak wcześniej.

## Pad (DualSense, Xbox)

Pełna obsługa kontrolera przez Gamepad API: lewy analog ruch, prawy analog kamera (bez pointer lock), L3 bieg, ✕/A interakcja i zatwierdzanie, ○/B cofanie, △/Y ekwipunek, □/X dziennik, L1 minimapa, OPTIONS menu gry, R1/R2 (oraz D-pad lewo/prawo) slot paska, D-pad i lewy analog nawigacja po oknach i mieście. Podpowiedzi w interfejsie przełączają się automatycznie między klawiaturą a padem. Architektura, mapowanie i ograniczenia: [gamepad.md](gamepad.md); test: [test-reczny-gamepad-v1.md](test-reczny-gamepad-v1.md).
