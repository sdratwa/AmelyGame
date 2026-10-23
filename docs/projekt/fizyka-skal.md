# Fizyka skał (ROCK1 + ROCK2)

Postać gracza w widoku trzecioosobowym może przeskakiwać niskie skały, wskakiwać na te z odpowiednim wierzchem, stać i chodzić po nich, zeskakiwać oraz skakać ze skały na skałę. Wszystko wynika z geometrii kolizji, położenia stóp oraz zwykłego skoku z grawitacją. Nie ma teleportu, "przyciągania" ani automatycznego wchodzenia na wysokie skały. Parametry skoku i ruchu pozostały bez zmian (`jumpHeight` 1,5 m, `gravity` 12, `airControl` 0,35, `standHeight` 1,55, `crouchHeight` 1,0, chód 2,2, bieg 4,8, kucanie 1,0).

## Model danych: profil kolizji skały

Skała z generatora **v5** ma pole `WorldObject.rock` (`src/lib/game/world/rockPhysics.ts`):

| pole | znaczenie |
| --- | --- |
| `height` | wysokość płaszczyzny wierzchu nad `WorldObject.y` w środku obszaru podparcia (z uwzględnieniem skali osi Y, przechyłu i zagłębienia 0,1·skala Y); dla skały niestojącej to najwyższy punkt bryły |
| `wall` | wysokość najwyższego punktu bryły nad `WorldObject.y`: do niej (z zapasem `clearance`) skała blokuje ruch poziomy |
| `standable` | czy wierzch nadaje się do stania (dość duży i niezbyt stromy) |
| `topOffset` | środek obszaru podparcia względem środka obiektu (m, świat) |
| `topRadius` | promień obszaru podparcia dla **środka kapsuły** (m); 0, gdy skała nie jest "stojąca" |
| `slope` | gradient płaszczyzny wierzchu `[dh/dx, dh/dz]` w osiach świata |

Profil jest liczony przez `buildRockProfile` z gatunku skały, skali (`scaleXYZ`), obrotu (`yaw`), przechyłu (`tilt`) i kolizji kołowej oraz z **zamrożonej tabeli `ROCK_SHAPES_V1`**. Dla każdego z 6 modeli (warianty `.desert` mają identyczną bryłę) tabela zawiera: `peak` (najwyższy punkt siatki) oraz `plane` (największy dysk stania). Pomiar zrobiono jednorazowo na siatkach GLB: górną powierzchnię zrastrowano co 5 cm, dopasowano płaszczyznę najmniejszych kwadratów w kole o promieniu r (reszta ≤ 5 cm, pokrycie ≥ 97%, nachylenie ≤ 30°), wybrano największy promień, a przy zbliżonych (±10 cm) najwyższy dysk. Środek i normalna płaszczyzny są przekształcane tak jak w rendererze (skala osi, obroty w kolejności "YXZ", zagłębienie), więc stopy stoją na widocznym wierzchu, a nie pod nim. Zmiana grafiki, modelu czy LOD nie zmienia kolizji. Wyniki są zaokrąglane do 1 mm, więc klient i serwer widzą te same liczby.

**Korekta tabeli (pierwsze wydanie v5 miało błąd).** Pierwotna tabela mierzyła płaszczyznę ok. 0,2 m za nisko i z błędnymi środkami, przez co postać zapadała się w skałę po pas albo lądowała poza małym obszarem podparcia i zsuwała się na ziemię. Poprawiono ją **w miejscu**: v5 nie było jeszcze wydane, a odcisk świata używa zamrożonego identyfikatora `ROCK_PHYSICS_ID` (`generators/v5/world.ts`), więc istniejące zapisy v5 nadal się wczytują. `rockPhysicsDigest()` (obecna wartość przypięta testem) opisuje bieżącą tabelę. Od wydania v5 każda zmiana tabeli lub `ROCK_PHYSICS` wymaga nowej wersji generatora.

Reguła podparcia: środek kapsuły musi leżeć w kole `topRadius` = promień dopasowanego dysku (skalowany `min(sx, sz)`) + `supportOverhang` (0,1 m, szerokość stopy), przycięty do koła kolizji (z zapasem 0,05 m); minimum 0,15 m. Maksymalne nachylenie wierzchu to 30°. Węższy lub bardziej stromy wierzch daje skałę niestojącą: jest tylko przeszkodą o skończonej wysokości (da się ją przeskoczyć, ale nie stanąć). Na bardzo małej skale (dysk ok. 0,2 m) bieg po lądowaniu niesie postać dalej, więc zwykle zeskakuje się z niej po chwili; to wynik pędu, a nie zsuwania.

Tolerancje są w jednym miejscu (`ROCK_PHYSICS`): zapas ponad szczytem `clearance` 0,05 m, tolerancja kontaktu `landingEpsilon` 0,03 m, wysunięcie stopy `supportOverhang` 0,1 m, `edgeSlideSpeed` 3,5 m/s, `stepUp` 0,12 m.

## Wersje generatora i stare zapisy

- `CURRENT_GEN_VERSION = 5`. Generatory v1-v4 są zamrożone: ich skały **nie mają** `rock` i nadal są ścianami o nieskończonej wysokości. Pozycje, ID, losowania i kolizje kołowe są identyczne we wszystkich wersjach (test porównuje v4 z v5 po zdjęciu pola `rock`).
- Zapis v4 pozostaje czytelny bez migracji i działa po staremu. Ekran kontynuacji pokazuje przycisk "Włącz skakanie po kamieniach w zapisie (kopia zostanie zachowana)" (`migrateWorldV4ToV5`, `src/lib/game/save/worldV4ToV5.ts`). Migracja zmienia tylko `genVersion`, odcisk i historię generatora, sprawdza pozycje zebranych obiektów i pozycję gracza, nie rusza postępu. Zapis v3 przechodzi najpierw przez v3→v4.
- Wspólny świat serwera: `WorldStore` odmawia startu na pliku v4 bez `MIGRATE_WORLD_V4=1` i przed migracją tworzy `world.json.v4.bak` (analogicznie do `MIGRATE_WORLD_V3=1`). Klient online z zapisem v3/v4 dostaje przycisk aktualizacji, gdy serwer jest na v5.

## Zasady ruchu

`WalkWorld.move(from, to, flags, body?)` dostał opcjonalne `body: { footY, supportId?, slideStep? }`. Bez `body` zachowanie jest dawne (NPC, BFS, miejsca startu, tryb pierwszoosobowy). Z `body`:

- skała bez profilu (drzewo, skrzynia, poręcz, skała ze świata v2-v4) zawsze blokuje;
- skała z profilem blokuje ruch poziomy, dopóki stopy nie są powyżej jej szczytu o `clearance` (szczyt = `wall`, najwyższy punkt bryły);
- skała, na której postać stoi, nie blokuje;
- postać zachodząca na skałę (zeszła z wierzchu i opada przy krawędzi) nie jest teleportowana: zsuwa się promieniowo od środka wierzchu najwyżej `edgeSlideSpeed`, nie może wejść głębiej;
- bariera rzeki, granice regionu, strome zbocza, drzewa i NPC działają jak dotąd, niezależnie od wysokości stóp. Rzeka **nie** stała się przeskakiwalna.

`PlayerController` dzieli krok na kroki cząstkowe tylko blisko skał z profilem (`SUBSTEP_MAX_HORIZONTAL` 0,12 m, `SUBSTEP_MAX_VERTICAL` 0,08 m, `SUBSTEP_MAX_TIME` 1/120 s, najwyżej 16), więc przy niskim FPS i dużej prędkości stopy nie przenikają przez wierzch. Lądowanie ma dwie fazy (nad poprzednim punktem, potem w nowym). Stojąca postać dogania powierzchnię w zakresie `stepUp` w górę i `STEP_DOWN_LIMIT` (0,4 m) w dół; stojąc u podstawy skały nie wskakuje na szczyt. Kamera zasłaniana przez skałę z profilem liczy prawdziwy szczyt skały, a kamera podąża za wysokością stóp.

## Diagnostyka

Panel TPP (`/dev/third-person`) i sekcja "Ruch i podparcie (dev)" w Diagnostyce gry pokazują: wysokość stóp, `Vy`, na ziemi/w powietrzu, podparcie (teren/most/skała, wysokość, id skały), ostatnią blokadę, ostatnie lądowanie (z prędkością uderzenia) oraz potencjalne lądowanie (powierzchnia pod stopami, na którą postać opadłaby teraz). Formatowanie: `src/lib/tpp/movementDiagnostics.ts`.

## Multiplayer (M1a)

Serwer nadal **nie symuluje** ruchu: klient jest autorytatywny, a M1b (autorytatywna symulacja po stronie serwera) nie został zmieniony. Klient i serwer używają tego samego generatora v5, więc identycznych profili skał i odcisku świata (niezgodny klient nie dołączy). Y jest synchronizowane w `Motion`.

Dodatkowo serwer ocenia wykonalność kolejnych próbek (`src/lib/multiplayer/motionPhysics.ts`, wywoływane z `ForestRoom`) i **ignoruje** stany niemożliwe: wejście pod teren (ruch ciągły), "stanie" w powietrzu lub na skale nad granicą skoku od ostatnio osiągniętej wysokości, wzniesienie szybsze niż skok, deklarację "na ziemi" bez powierzchni (teren, pokład mostu zbudowanego, wierzch skały), przejście cięciwą przez bryłę skały, nad którą stopy nie były dość wysoko. Reguły używają stałych `TPP_DEFAULTS`, więc lokalne suwaki skoku i grawitacji nie omijają zasad serwera. Po nieciągłości (odrodzenie, pierwsza wiadomość) działają tylko reguły statyczne (np. skała musi być osiągalna z terenu skokiem).

Ograniczenia, dla uczciwości: to sprawdzenie wykonalności z tolerancjami, a nie pełna symulacja; dostatecznie sprytny klient może wysyłać stany wyglądające wiarygodnie; nie ma kanału korekcji (klient nie dowiaduje się o odrzuceniu, a kolejne próbki są oceniane względem ostatniej przyjętej, więc błąd się nie kumuluje); serwer nadal nie weryfikuje położenia poziomego względem drzew (jak dotąd). Tryb pierwszoosobowy nie wskakuje na skały (skała = ściana), co jest ostrożniejsze niż serwer.

## Testy

Vitest: `src/lib/tpp/rockMovement.test.ts` (29 testów ruchu: skoki, lądowanie, stanie, chodzenie, zejście, skała na skałę, nachylenie, wąski wierzch, pozyskanie skały, regresje drzew, NPC, rzeki, granic, stromych zboczy i starych światów), `src/lib/game/world/rockPhysics.test.ts` (profil, v5 kontra v2-v4, klient kontra serwer, niezależność instancji, pozyskanie, prawdziwa skała z generatora), `src/lib/multiplayer/motionPhysics.test.ts` i `rockMotion.multiplayer.test.ts` (walidacja serwera i test z klientami Node), `src/lib/game/save/worldV4ToV5.test.ts`, test `WorldStore` v4→v5, `src/lib/tpp/movementDiagnostics.test.ts`.

Zmienione oczekiwania istniejących testów (z uzasadnieniem): `generators/v3/world.test.ts` (`CURRENT_GEN_VERSION` 4→5, bo v5 jest nową wersją bieżącą) i `multiplayer/save.test.ts` (konfiguracja świata online używa bieżącej wersji generatora zamiast na sztywno v4).

## Test ręczny dla autora (przeglądarka, bez udziału agenta)

Uruchom grę (nowa gra albo zapis po aktualizacji do v5), włącz Diagnostykę i sekcję "Ruch i podparcie (dev)".

1. Znajdź niską skałę (ok. 0,5-0,8 m) i podejdź bez skoku: postać ma się zatrzymać przy skale (blokada `object:rock...`).
2. Rozpędź się, skocz przed niską skałą: przelatujesz na drugą stronę, nic nie przeskakuje o kilka metrów, kamera płynnie podąża.
3. Skocz na skałę ok. 0,9-1,2 m z biegu: ląduje na wierzchu; Diagnostyka pokazuje podparcie "skała", jej id i wysokość, "na ziemi".
4. Postój na skale kilka sekund: wysokość stóp (`Stopy Y`) nie drga, `Vy` = 0.
5. Pochodź po wierzchu: stopy wizualnie na powierzchni skały, bez zapadania (oceń dopasowanie modelu; niedopasowanie zgłoś z id skały). Wypróbuj małe (ok. 0,5 m), średnie i duże skały oraz dwa pomarańczowe warianty z pustyni.
6. Dojdź do krawędzi wierzchu i zejdź: postać zsuwa się/opada płynnie, bez skoku w bok i bez teleportu.
7. Zeskocz ze skały na teren i ponownie wskocz na tę samą skałę.
8. Dwie skały blisko siebie: skocz ze skały na skałę (Diagnostyka pokazuje zmianę id).
9. Spróbuj wskoczyć na dużą skałę (>1,6 m): nie da się; nie wolno przejść ani "wciągnąć się" na szczyt. Spróbuj ją przeskoczyć: nie da się.
10. Skocz na bardzo małą skałę (<0,5 m, wąski wierzch): da się ją przeskoczyć, ale nie stać na niej (podparcie "teren").
11. Skocz na przechyloną skałę: stopy podążają za nachyleniem wierzchu; zbyt stromego wierzchu nie da się używać do stania.
12. Skocz w stronę rzeki: nie da się jej przeskoczyć; most i poręcze działają jak dotąd.
13. Skocz w drzewo, skrzynię i trolla: nadal blokują, także w szczycie skoku.
14. Zbierz skałę (kilof), na której stoisz albo obok której stoisz: postać opada na teren, a skała przestaje blokować.
15. W trybie online dwóch graczy: jeden skacze na skałę, drugi widzi go na wysokości skały; próba "wejścia" na wysoką skałę nie jest akceptowana przez serwer (drugi gracz nie widzi takiego stanu).
16. Wczytaj stary zapis v4: skały zachowują stare zasady (ściany), ekran kontynuacji oferuje włączenie skakania ("kopia zostanie zachowana"); po aktualizacji postęp jest bez zmian.

Ocena wyglądu (dopasowanie powierzchni do modeli), odczucia skoku, dźwięku i FPS należy wyłącznie do autora; agent nie wykonywał testów w przeglądarce.
