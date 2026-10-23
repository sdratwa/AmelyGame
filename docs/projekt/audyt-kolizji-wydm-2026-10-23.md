# Audyt niewidocznych blokad w lesie — 23 października 2026

Zakres: diagnoza i propozycja poprawki, bez zmiany kodu gry, generatorów ani zapisów. Bez przeglądarki i testów GUI.

**Aktualizacja po zatwierdzeniu etapu:** poprawkę wdrożono w generatorze v4. Historyczna diagnoza i pomiary poniżej opisują stan sprzed poprawki. Nowe światy używają v4; v3 pozostaje zamrożony. Zapis solo v3 można jawnie zaktualizować na ekranie kontynuacji, a zapis online na ekranie niezgodności wersji. Migracja pliku wspólnego świata serwera v3→v4 wymaga jawnego uruchomienia z `MIGRATE_WORLD_V3=1`, wykonuje walidację i tworzy kopię `.v3.bak`. Bez flagi serwer nie uruchomi starego świata i zachowa plik.

## Przyczyna

Odtworzono problem dla generatora v3 i seeda 2030, używanego domyślnie przez serwer multiplayer (`src/lib/multiplayer/world.ts`). Solo z tym samym światem używa tej samej geometrii i logiki `WalkWorld`.

`ForestGeometry.trailIndex` w `src/lib/game/world/generators/v2/geometry.ts` ma zasięg 8 m od krawędzi ścieżki. Poza nim `trailGap` zwraca `Infinity`. Tymczasem `createDuneOffset` w `dunes.ts` wygasza wydmy na odcinku od 2 do 11 m (`trailClear=2`, `trailRamp=9` w `pro.ts`). Przy przekroczeniu 8 m współczynnik wygaszania skacze z około 0,741 do 1. Wysokość terenu staje się nieciągła.

Przykład: z=30, x=17,8 daje wysokość 1,88092 m i `trailGap=Infinity`; x=17,9 daje wysokość 1,65303 m i `trailGap=7,95347`. Spadek to około 23 cm na 10 cm ruchu. `WalkWorld` odrzuca punkty o nachyleniu ponad 35° (`too_steep`), również podczas schodzenia. Nie jest to collider drzewa, skały ani bariera rzeki.

Renderer próbuje tę samą funkcję wysokości na rzadszej siatce (nominalnie 0,7–1,25 m zależnie od jakości), natomiast gradient kolizji używa różnic centralnych ±0,25 m. Siatka może rozłożyć uskok na łagodniejsze trójkąty. To wyjaśnienie z kodu, nie potwierdzenie wyglądu w przeglądarce.

Minimapa zaokrągla pozycję przez `Math.round`. Tymczasowy test Vitest odtworzył zatrzymanie ruchu o +0,1 m w osi X w następujących punktach:

| Wskazanie minimapy (x, z) | Pozycja testowa (x, z) | Obecny kod | Wariant poprawki |
| --- | --- | --- | --- |
| 17, 30 | 17,4; 29,6 | `too_steep`, brak ruchu | ruch do x=17,5 |
| 15, 26 | 14,6; 25,9 | `too_steep`, brak ruchu | ruch do x=14,7 |
| 14, 24 | 13,5; 24,3 | `too_steep`, brak ruchu | ruch do x=13,6 |

## Sprawdzenie innych miejsc

Przeskanowano teren od -149 do 149 m w obu osiach co 0,5 m: 356 409 punktów na seed, cztery seedy. Porównano nachylenie obecnego terenu z wariantem wykorzystującym osobny indeks ścieżek o zasięgu 11 m. Nie zmieniano plików produkcyjnych. Wariant zachowywał dotychczasową wysokość bazową i zastępował tylko offset wydm.

| Seed | Próbki ponad 35° przed | Po | Przykładowe dodatkowe miejsce |
| --- | ---: | ---: | --- |
| 2030 | 19 | 0 | x=10, z=17: 36,01° → 5,10° |
| 1 | 1 | 0 | x=18, z=34,5: 35,06° → 14,13° |
| 777 | 0 | 0 | brak w badanej siatce |
| 4000000000 | 9 | 0 | x=24,5, z=40,5 oraz x=65, z=33 |

Liczby oznaczają próbki, nie odrębne ściany. W żadnym seedzie wariant nie utworzył nowej próbki ponad 35°. Skan nie wyklucza węższych usterek między próbkami ani innych błędów modeli, streamingu czy kolizji. Nie sprawdzano produkcyjnego zapisu ani stanu pozyskanych obiektów użytkownika.

Obecny test nachylenia wydm w `generators/v2/pro.test.ts` bada tylko x,z od 30 do 140 co 5 m. Zgłoszone miejsca są poza jego zakresem, a wąskie uskoki mogą wypaść między próbkami.

## Proponowana poprawka

1. Zapewnić wydmom zapytanie o odległość od ścieżki o zasięgu co najmniej `trailClear + trailRamp` (obecnie 11 m), wyliczanym z konfiguracji. Preferowany osobny indeks dla wydm: zachowuje semantykę istniejącego `trailGap` używanego również przez rozsiew i grafikę.
2. Zachować limit nachylenia 35°. Podnoszenie limitu maskowałoby nieciągłość i zmieniało reguły chodzenia w całym lesie.
3. Dodać testy ciągłości wysokości po obu stronach granicy zasięgu, ruchu w trzech odtworzonych miejscach oraz skan wielu seedów. Nie ograniczać zakresu do x,z≥30; testować granice bezpośrednio, nie wyłącznie rzadką siatkę.
4. Wprowadzić zmianę jako nową wersję generatora (v4), pozostawiając v2/v3 bez zmian. Wymaga to rzeczywistego rozdzielenia ścieżek generacji: obecnie `lookup.ts` kieruje wszystkie wersje ≥3 do tej samej konfiguracji Pro. Serwer również wskazuje v3 na sztywno.
5. Dla istniejącego świata przygotować jawną, atomową migrację z kopią zapasową i walidacją. Przeliczyć odcisk, wysokości i poprawność pozycji graczy oraz obiektów, zachować i zweryfikować postęp, identyfikatory obiektów i stan pozyskania. Sama publikacja v4 nie naprawi starego świata. Klient i serwer muszą używać zgodnej wersji.

Zgodność generatorów i migracji wynika z `.cursor/rules/miasto-swiat-i-zapis.mdc` oraz `docs/projekt/swiat-generator.md`. Nie należy po prostu zmieniać 8 na 11 we współdzielonej implementacji wydanych generatorów.

Wpływ na wydajność: osobny indeks zwiększy nieco pamięć i liczbę rozpatrywanych segmentów podczas generacji/zapytań terenu. Bez nowych draw calls, modeli ani tekstur. FPS nie był mierzony.

## Weryfikacja

Tymczasowy test diagnozy i wariantu poprawki przeszedł; wraz z testami v3, Pro i chodzenia: 47/47 testów. Test diagnostyczny został usunięty po analizie, aby nie utrwalać oczekiwania błędnego zachowania jako regresji produkcyjnej.

Pełne kontrole obecnego repozytorium:

- `npm test`: 1282 zaliczone, 2 pominięte, 1 błąd. `src/lib/assets/assets.test.ts:202`: biblioteka raportuje 19 materiałów wobec 20 w manifeście. Kod produkcyjny i zasoby nie były zmieniane w tym audycie; to osobna rozbieżność wymagająca sprawdzenia, nie dowód kolejnej niewidocznej przeszkody.
- `npm run lint`: bez błędów, dwa ostrzeżenia o nieużywanych zmiennych (`scripts/assets/analyze-player-body.mjs`, `src/lib/character/clothing/deriveShell.ts`).
- `npm run typecheck`: zaliczone.
- `npm run build`: zaliczone.

Po wdrożeniu: autor powinien przejść przez wskazane miejsca na wschód i zachód w solo i multiplayer, sprawdzić dodatkową okolicę x=10,z=17 oraz ciągłość gruntu. Po migracji sprawdzić ponowne wczytanie świata, postęp questa i pozyskane obiekty.
