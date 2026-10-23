# Telefon: mobilny HUD i sterowanie dotykowe (iPhone, wersja 1)

Cel: na telefonie w poziomie scena lasu zajmuje prawie cały ekran, HUD jest lekką nakładką, a postacią steruje się kciukami. Desktop i pad działają bez zmian.

## Wykrywanie trybu

`src/lib/input/touchMode.ts` (`isTouchUi`) i hook `useTouchUi()` w `src/components/input/hooks.ts`. Tryb dotykowy włącza się, gdy jednocześnie:

- główny wskaźnik jest dotykowy (`pointer: coarse`) i bez hover (`hover: none`),
- `navigator.maxTouchPoints > 0`,
- krótszy bok okna <= 600 px (`TOUCH_UI_MAX_MIN_DIM`; tablety i iPad są poza wersją 1).

Ręczne wymuszenie (do testów): `?touch=1` / `?touch=0` albo `localStorage["miasto.touchUi"]` = `on` / `off`. Parametr ma pierwszeństwo.

## HUD

- `mobile/MobileHud.tsx`: jedna linia kapsułek (❤ %, 👛 kwota, ☀/🌙 godzina, sezon i dzień, Dziennik, Menu); `flex-wrap` na bardzo wąskim ekranie. Komponent jest `memo` i dostaje tylko wartości proste, więc nie renderuje się przy każdym ticku.
- "Jest zimno" / "Schronienie": mała kapsułka pod HUD.
- `mobile/OnlineChip.tsx`: ikona połączenia, "2/8", przycisk wyjścia online i (tylko przy rozłączeniu) ponowne łączenie. Nagłówek `GameEntry` na telefonie nie jest rysowany.
- Las: lewy stos przycisków zastąpiony chipem ⚙ (`mobile/TouchForestMenu.tsx`): powrót do miasta, jakość, dźwięk, minimapa, czułość kamery. Minimapa jest mała (104 px), leży w prawym dolnym rogu i ma własny przycisk włącz/wyłącz (`mobile/TouchMinimap.tsx`); zwinięta zostaje sama ikona. Róg jest stale zarezerwowany, więc przyciski akcji stoją na lewo od niego. Przełącznik jest też w ⚙.
- `QuestTracker`: kompaktowa wersja (tytuł i etap; dotknięcie rozwija cele).

## Plecak

`mobile/MobileInventoryDrawer.tsx` + `inventoryDrawer.ts` (czysty reducer). Stany: schowany (sama ikona plecaka, dolny środek ekranu), `mini` (jeden rząd slotów, nazwa przedmiotu, "Zjedz") i `expanded` (większe sloty, opis, "Pełna lista rzeczy" otwiera istniejące okno ekwipunku). Pusty ekwipunek to jedna linia "Plecak pusty". Stan UI nie trafia do zapisu.

## Lampa naftowa

Mały przycisk "Lampa" (`data-testid="touch-lantern"`) stoi nad skokiem, z dala od joysticka, skoku, kucania i "Użyj"; ta sama ścieżka co L i pad (`InputHub`, akcja `lantern`). W wysuwanym plecaku jest wiersz lampy nad slotami (stałe wyposażenie, nie zajmuje miejsc; "Plecak pusty" dotyczy tylko przedmiotów). Telefon: pula 2 świateł, brak cieni lampy, mniejsza tekstura blasku. Szczegóły: [lampa-naftowa.md](lampa-naftowa.md).

## Sterowanie

`mobile/TouchControls.tsx` (warstwa nad sceną lasu) zapisuje do `TouchInput`, a renderer czyta go raz na klatkę przez `touchAdapter.ts` (`applyTouchToTpp`, `externalMove`), czyli przez te same wejścia co pad: `PlayerInput.setExternal`, `requestJump`, `requestCrouchToggle`, `camera.look`.

| Element | Zachowanie |
| --- | --- |
| Joystick | Pływający, w lewych 45% ekranu (`touchZones.ts`); baza pojawia się pod kciukiem. Deadzone 0,12; chodzenie przy małym wychyleniu, **bieg** powyżej 85% wychylenia (histereza 70%). Joystick ma pierwszeństwo przed padem. |
| Kamera | Przeciągnięcie palcem po reszcie ekranu. Przeliczenie: `TOUCH_LOOK_GAIN` (1,6) razy czułość użytkownika (0,5-2,5, suwak w ⚙; `touchSettings.ts`). Pojedynczy skok ograniczony do 120 px. |
| Skok / Kucnij | Przyciski po prawej; Kucnij przełącza (jak `C`). |
| Użyj | `InputHub.emit("interact", "touch")`: ta sama ścieżka co `E` i pad (`InteractGate`, a gdy nic nie jest w zasięgu, zjedzenie zaznaczonego przedmiotu). Podświetlony, gdy jest cel. |

Joystick i kamera działają równocześnie (osobne `pointerId`). Ruch palca zmienia tylko `style` i `TouchInput`, bez `setState`. Utrata fokusu, `pointercancel`, zawieszenie sceny (okno, dialog, menu) i odmontowanie zerują wejście.

## Safe area

`viewport-fit=cover` (`layout.tsx`) + zmienne `--sat/--sar/--sab/--sal` (`globals.css`). HUD, joystick, przyciski i plecak używają `max(odstęp, safe area)`. Ekrany poza lasem (menu, imię, ładowanie) i widoki miasta/sklepu dostają `safe-pad`; na desktopie wartości wynoszą 0.

`appleWebApp` (capable, `black-translucent`): po "Dodaj do ekranu początkowego" gra działa bez paska Safari. W samej karcie Safari pasek adresu zostaje (iPhone nie ma Fullscreen API).

## Ograniczenia

- iPad, Android i tablety: poza wersją 1 (jedna stała do zmiany).
- Modale shadcn (menu gry, ekwipunek, ustawienia kontrolera) mogą być wysokie na ekranie poziomym ok. 390 px: do sprawdzenia ręcznie.
- Na telefonie `InputHint` nie pokazuje klawiszy ani glifów pada.
- Wygląd, płynność i czułość kamery ocenia autor na telefonie; agent nie używał przeglądarki.

## Test ręczny (iPhone)

1. Otwórz grę na iPhone (poziomo; najlepiej też jako aplikacja z ekranu początkowego).
2. HUD ma być jedną cienką linią kapsułek, bez granatowych pasków.
3. Scena zajmuje prawie cały ekran; nic ważnego nie wchodzi pod notch ani pasek domowy.
4. Dotknij "Plecak": otwiera się panel mini; rozwiń go strzałką; zamknij. Po zamknięciu zostaje mały przycisk.
5. Połóż kciuk w lewej części ekranu i przesuń: postać chodzi; wychyl mocno do krawędzi bazy: biegnie.
6. Przeciągnij palcem po prawej części ekranu: kamera się obraca; rób to jednocześnie z ruchem joysticka.
7. Użyj Skok, Kucnij i Użyj (skrzynia, drzewo, troll; zjedzenie przy zaznaczonym jedzeniu).
8. Tryb online: po lewej w HUD ikona połączenia, "n/8", przycisk wyjścia; sprawdź wyjście i ponowne łączenie.
9. Chip ⚙: jakość, dźwięk, minimapa, czułość kamery, powrót do miasta.
10. Sprawdź desktop: stary pasek górny, pasek ekwipunku, klawiatura i mysz bez zmian.
