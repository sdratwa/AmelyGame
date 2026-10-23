# Lampa naftowa (LAMPA1)

Stała lampa naftowa w dłoni postaci: model 3D w prawej ręce, prawdziwe światło punktowe, widoczny z daleka blask i synchronizacja z innymi graczami. Kod napisany i sprawdzony testami jednostkowymi, lintem, typecheckiem i buildem. **Wygląd, jakość światła, widoczność ze 150 m, FPS i dotyk nie były oglądane w przeglądarce** (zakaz testów w przeglądarce); ocenia je autor wg scenariusza na końcu.

## Czym jest lampa

- Identyfikator `oil_lantern`, nazwa w interfejsie "Lampa naftowa" (`src/lib/game/content/equipment.ts`).
- To **stałe wyposażenie**, nie przedmiot z `ITEMS`: nie zajmuje miejsc ekwipunku (`INVENTORY_SLOTS = 8` bez zmian), nie trafia do księgi (`ledger`), depozytu trolla ani do skrzyń. Nie da się jej wyrzucić, sprzedać, zużyć ani zgubić (nie ma takiej ścieżki w silniku), nie wymaga paliwa i nie ma trwałości.
- Posiadanie wynika z definicji (każdy gracz ma `EQUIPMENT`), więc zapis przechowuje tylko przełącznik: `GameState.lantern = { enabled }`.
- Można ją zapalać i gasić dowolnie często o każdej porze (w dzień jest po prostu słabiej widoczna).
- Polecenia silnika (`applyCommand`): `lantern.set { enabled }` (idempotentne) i `lantern.toggle`; zdarzenie `lantern.changed`. Martwy gracz nie obsługuje lampy; niepoprawna wartość nic nie zmienia. Czas ani paliwo jej nie wyłączają.

## Zapis: SaveV5

- `CURRENT_SAVE_VERSION = 5`, nowe pole `player.lantern: { enabled: boolean }` (tylko flaga; żadnej geometrii ani parametrów renderowania).
- Migracja v4 -> v5 (`save/migrations/v4ToV5.ts`): dodaje wyłączoną lampę i nic poza tym; czysta funkcja na kopii, oryginał zostaje w kopii `miasto.save.premigration.v4.0`. Starsze zapisy (v1-v3) przechodzą cały łańcuch. Lampa nie jest wpisywana do slotów, więc **nie może się zdublować**.
- Walidacja odrzuca uszkodzone `player.lantern` i `oil_lantern` w slotach.
- Solo: kontynuacja przywraca stan lampy. Online: osobisty zapis jest nadal lokalny dla przeglądarki (`miasto.online.<worldInstanceId>`), serwer **nie ma konta ani trwałego zapisu gracza**, więc po ponownym połączeniu klient zgłasza serwerowi stan lokalny (patrz niżej). To świadome ograniczenie M1a.
- Zmiana wymusiła aktualizację oczekiwań wersji w istniejących testach (4 -> 5) i przesunięcie syntetycznej "wersji przyszłej" w `save.test.ts`; żaden test nie został usunięty ani osłabiony.

## Interfejs i sterowanie

| Urządzenie | Sterowanie |
| --- | --- |
| Klawiatura | **L** (bez autopowtarzania, tylko w wolnym lesie, nie w polach tekstowych) |
| Pad | **krzyżak w górę** w lesie (wolny przycisk; w interfejsie nadal nawigacja). Hint: `↑` |
| Telefon | mały przycisk "Lampa" nad skokiem (z dala od joysticka, skoku, kucania i "Użyj") oraz wiersz w plecaku |
| Mysz | przycisk lampy obok paska ekwipunku (9. osobny slot) oraz sekcja "Wyposażenie stałe" w oknie ekwipunku (I) |

Wszystko idzie jednym poleceniem `lantern.toggle`. Klawisz i hint działają tylko w lesie (w mieście przycisk działa kliknięciem).

## Model 3D i mocowanie

- `src/lib/forest-view/lantern/`: `geometry.ts` (siatki), `materials.ts` (materiały), `visual.ts` (złożenie i interfejs `LanternVisual`), `glow.ts` (blask), `system.ts` (całość), `math.ts` (czysta matematyka), `config.ts` + `configStore.ts` (parametry), `hand.ts` (kość).
- Proceduralna lampa w stylu baśniowym: ciemny postarzany mosiądz (uchwyt-pałąk, daszek z kominkiem, obejmy, pękaty zbiornik, stopka, knot), szklany klosz (półprzezroczysty, ze słabą emisją), płomień w kształcie kropli. Cztery draw calle na lampę (metal, szkło, płomień, blask). Wysokość ok. 0,28 m. Nie ma w repozytorium gotowego zasobu lampy, więc użyto modelu proceduralnego.
- **Podmiana na GLB:** wystarczy podać własną `LanternVisualFactory` (zwraca `{ root, flameAnchor, update, dispose }`) w `LanternSystemOptions.factory`; światło, blask, LOD, mocowanie i sieć nie zależą od geometrii.
- Mocowanie do kości `mixamorig:RightHand` (po sanityzacji `mixamorigRightHand`) jako dziecko kości, więc lampa jedzie z animacją (Idle, Walk, Run, Jump, kucanie). Nie ma nowej animacji trzymania ani zmian w rigu. Pozycja, obrót i skala są konfigurowalne (`attachX/Y/Z`, `attachRotX/Y/Z`, `attachScale`, domyślnie 0 / 0,06 / 0,02 m, obrót X 180 stopni, skala 1). Przesunięcie i skala są dzielone przez skalę rodzica (model ma skalę ok. 1,55), więc rozmiar jest w metrach. Kość dłoni jest też dostępna dla graczy zdalnych (`RemotePlayers.handBone`). Miejsce na przyszłą warstwę górnej połowy ciała: wystarczy zmienić źródło kości/transformacji.
- Test na prawdziwym modelu (`hand.test.ts`): kość istnieje, płomień zostaje ≤ 0,45 m od dłoni w sześciu pozach, w Idle lampa zwisa pod dłonią, rozmiar 0,2-0,45 m, sprzątanie w kolejności lampy -> model.

## Światło rzeczywiste

- `THREE.PointLight`, barwa `#FFBD55` (domyślnie z koloru; opcja z temperatury 2200 K przez `kelvinToRgb`), zasięg silnego oświetlenia 5 m (`radius`), wygaszanie do zera na `radius * fadeReach` = 10 m wzorem three `1/d^decay * (1 - (d/zasięg)^4)^2` (brak twardej krawędzi), `decay` 1,3 (łagodniejszy zanik z bliska niż fizyczne 2), natężenie 1,5 w odległości odniesienia 5 m (`intensity` w jednostkach sceny jak słońce; w kandelach `intensity * ref^decay`). Wzór jest w `lanternIrradiance` (test sprawdza, że to ten sam model co shader).
- Zgodność z modelem fotometrycznym: światło leci przez zwykły pipeline three (ACES, ekspozycja z atmosfery), bez obchodzenia mapowania tonów; zakres jasności dobrano względem słońca i półkuli nocą, ale **jakość światła musisz ocenić Ty**.
- Migotanie lokalne: suma trzech sinusów o niewspółmiernych częstotliwościach (ciągłe, w granicach `1 ± flickerIntensity`, domyślnie ±10%, brak błysków), subtelna zmiana odcienia. Szum jest deterministyczny z `seed` gracza, nigdy nie jest wysyłany przez sieć.
- Pula świateł jest **stała** (4 na komputerze, 2 na telefonie), tworzona razem ze sceną, bo zmiana liczby świateł przeładowuje shadery (tak samo działają latarnie mostu). Koszt: te światła są w scenie zawsze, także gdy nikt nie ma lampy (intensywność 0). Lampy dostają sloty "lepko" (bez przeskakiwania), lampa lokalna ma priorytet.
- LOD (progi konfigurowalne): **NEAR** do 12 m (pełne światło, opcjonalny cień), **MID** do 30 m (płynne zmniejszenie do 60% jasności), **FAR** dalej (tylko blask, bez `PointLight`; światło dogasa w krótkim paśmie za MID, żeby nie znikało skokiem). `maxLights` (domyślnie 3, maks. 4) ogranicza liczbę świateł naraz.
- Cienie: domyślnie wyłączone. Przy włączeniu tylko jedno światło (slot 0, lampa lokalna) rzuca cień (256/512/1024); lampa nie rzuca własnego cienia; gdy nikt nie świeci, nie ma pustego przebiegu cieni. Na telefonie cienie lampy są wyłączone zawsze, niezależnie od ustawień.

## Blask z daleka (bez światła)

- Jeden `THREE.Sprite` na lampę z addytywną teksturą miękkiej poświaty (`DataTexture`, bez DOM), `depthTest` włączony, `depthWrite` wyłączony, `fog: false`, `toneMapped: false`. Sprite stoi w świecie w miejscu płomienia (zachowuje kierunek i lokalizację) i nie oświetla niczego.
- Widoczność (`glowOpacity`): pełna do `farGlowFadeStart` (60 m), liniowo słabnie do `farGlowFadeEnd` (170 m, więc na 150 m zostaje ok. 20%), twarde wyłączenie za `farGlowMaxDistance` (150 m, z wygaszeniem ostatnich 10%). Rozmiar to maks. `glowSize` (0,8 m) i `farGlowMinPixelSize` (6 px), ograniczony od góry do 160 px.
- Mgła: blask nie wyłącza mgły świata; `fogInteraction` (0,35) miesza współczynnik przepuszczalności `FogExp2` z blaskiem, więc w gęstej mgle słabnie, ale nie znika.
- Dzień: blask ma 25% siły w pełnym dniu (lampa działa zawsze, ale ledwo ją widać); używa istniejącego `atmosphere.daylight` z zegara świata, bez własnego zegara.
- Zasłanianie: drzewa i skały zasłania test głębi karty graficznej; wzgórza (poza zasięgiem streamowanych sektorów) liczy CPU: `terrainBlocks` próbkuje wysokość terenu na linii kamera - płomień (co ~3 m, maks. 48 próbek, co ~0,12 s, tylko powyżej 20 m, wynik wygładzany). Bloom: renderer go nie ma, więc "Bloom Contribution" nie został dodany.

## Multiplayer (protokół 4)

- `PROTOCOL = 4`, `Player.lanternOn: boolean`. **Po aktualizacji trzeba zrestartować `npm run multiplayer` i odświeżyć klientów** (stary serwer/klient odrzuci dołączenie).
- Klient -> serwer: wiadomość `lantern` z samą flagą `{ enabled: boolean }` (ścisła walidacja `validLantern`: dokładnie jeden klucz `enabled`, brak `playerId`, brak parametrów światła). Serwer ustala nadawcę z sesji połączenia, więc klient nie może przełączyć cudzej lampy; ruch (`motion`) nie może przenosić `lanternOn` (klucz spoza listy jest odrzucany).
- Serwer zapisuje flagę w `Player` nadawcy i rozsyła ją w zwykłych migawkach 20 Hz razem z pozycją. Nie wysyła się intensywności ani migotania; każdy klient liczy je sam.
- Późne dołączenie: nowa migawka zawiera `lanternOn` wszystkich, więc zapalone lampy widać od razu. Ponowne połączenie: serwer zaczyna od zgaszonej, a `MultiplayerClient.syncLantern` po połączeniu wysyła stan lokalny (z gry), więc lampa wraca. Rozłączenie: gracz znika z listy zdalnych, a `LanternSystem` zwalnia jego model, sprite i światło (brak osieroconych świateł; test sprawdza też zwolnienie przy opuszczeniu świata).
- Ograniczenie: serwer nie przechowuje stanu lampy po rozłączeniu gracza (brak kont); stan wraca z zapisu lokalnego klienta.

## Wydajność (8 graczy i telefon)

- Najwyżej `maxLights` świateł naraz (domyślnie 3, pula 4; telefon 2), reszta lamp to sam blask (jeden sprite, jeden draw call).
- Materiały szkła i płomienia oraz sprite powstają przy zapaleniu i są zwalniane przy zgaszeniu lub odejściu gracza, nigdy w pętli klatki. Metal, geometrie i tekstura blasku są wspólne.
- Telefon: pula 2 światła, brak cieni lampy, tekstura blasku 32x32 zamiast 64x64.
- Test sprawdza stały skład puli świateł (te same obiekty przez wiele zapaleń i zgaszeń).

## Diagnostyka (panel O/F3, sekcja "Lampa naftowa (dev)")

`LanternDiagnostics.tsx`, parametry z jednej listy `LANTERN_PARAMS` (etykiety, zakresy, kroki; `sanitizeLanternConfig` przycina wartości do niej): Light Enabled, Light Color, Color Temperature (z przełącznikiem), Intensity, Effective Radius, Fade Reach, Reference Distance, Decay, Light Height Offset; Flicker Enabled/Speed/Intensity/Color Variation; Flame Emissive Intensity, Glow Size/Opacity/Color; Far Glow Enabled/Max Distance/Minimum Pixel Size/Fade Start/Fade End, Fog Interaction; Near/Mid LOD Distance, Mid Light Scale, Shadows Enabled, Shadow Quality, Max Active Dynamic Lantern Lights; Position X/Y/Z, Rotation X/Y/Z, Scale. Statystyki na żywo (zapalone, światła/pula, NEAR/MID/FAR, blaski, zasłonięte, cienie).

Przyciski: Reset to defaults (fabryczne), Set as default (zapis w `localStorage`, tylko w trybie deweloperskim), Restore saved, Copy JSON config (schowek, a przy braku dostępu pole tekstowe). Wszystko jest lokalne i czysto wizualne: nie zmienia stanu gry, zapisu ani tego, co widzą inni. Inne światła gry (słońce, półkula, latarnie mostu) nie są ruszane. Brak: "Bloom Contribution" (renderer nie ma bloomu).

## Dźwięk (przyszłość)

Brak wygenerowanego audio. Zdarzenie silnika `lantern.changed { enabled }` jest gotowym punktem zaczepienia dla dźwięku zapalenia i zgaszenia; trzask knota można dodać w `LanternSystem` (zna lampy i ich pozycje), bez zmian w pozostałych warstwach.

## Pliki

Silnik i zapis: `content/equipment.ts`, `core/{state,events,apply}.ts`, `systems/lantern.ts`, `save/{schema,serialize,hydrate,validate,migrate}.ts`, `save/migrations/v4ToV5.ts`. Sieć: `multiplayer/{protocol,client}.ts`, `server/src/ForestRoom.ts`. Renderowanie: `forest-view/lantern/*`, `forest-view/{renderer,remotePlayers}.ts`. Wejście: `input/{actions,gamepadConfig,prompts,shortcuts}.ts`. UI: `components/game/{LanternControl,LanternDiagnostics,InventoryPanel,Hud,GameApp,ForestWorldView}.tsx`, `mobile/{TouchControls,MobileInventoryDrawer}.tsx`.

## Testy automatyczne

`systems/lantern.test.ts` (stan, polecenia, zapis, round-trip), `save/migration.test.ts` (v4 -> v5, łańcuch, magazyn), `lantern/lantern.test.ts` (konfiguracja, zanik, LOD, migotanie, blask, teren, mocowanie, magazyn ustawień), `lantern/system.test.ts` (ON/OFF, wiele graczy, późne dołączenie, ponowne połączenie, pula, cienie, blask 20/50/100/150 m, zasłanianie, sprzątanie), `lantern/hand.test.ts` (prawdziwy model), `multiplayer/lantern.multiplayer.test.ts` (klienci Node: A zapala, B widzi, C dołącza później, próby podszycia, gaszenie, rozłączenie, ponowne połączenie), `input/gamepadConfig.test.ts`.

## Ręczny test dla autora (przeglądarka, nie wykonywany przez agenta)

1. Uruchom nową grę (Nowa gra). W oknie ekwipunku (I) jest sekcja "Wyposażenie stałe" z Lampą naftową; 8 slotów przedmiotów bez zmian.
2. Zapal lampę klawiszem L (albo przyciskiem obok paska). Lampa pojawia się w prawej dłoni.
3. Ustaw nocną porę (panel O, zegar) i zapal lampę: sprawdź ciepłe światło wokół postaci (ok. 5 m mocne, dalej płynnie wygasa).
4. Podejdź do pnia i listowia: sprawdź, czy są oświetlone, a światło ma miękki zanik bez twardej krawędzi.
5. Idź, biegnij, skacz i kucaj: lampa ma zostać w dłoni; oceń, czy wygląda naturalnie (nie ma osobnej animacji trzymania).
6. Zgaś (L) i zapal ponownie kilka razy: lampa znika/pojawia się, światło wygasa/wraca.
7. Online: uruchom `npm run multiplayer` (po restarcie po zmianie protokołu), dołącz dwiema kartami; zapal lampę w jednej, w drugiej widać zapaloną lampę gracza.
8. Dołącz trzecią kartą, gdy lampa już świeci: widoczna od razu.
9. Odsuń postacie na 20, 50, 100 i 150 m (w nocy): oceń widoczność blasku, jego wygaszanie z odległością i to, że nie przechodzi przez wzgórze.
10. Ustaw się za wzgórzem względem lampy: blask ma zniknąć (płynnie); odsłoń: wraca.
11. W panelu O > "Lampa naftowa" stroj parametry (intensywność, promień, migotanie, pozycja w dłoni) i sprawdź efekt na żywo; Reset, Set as default (dev), Restore saved, Copy JSON.
12. Zapal lampy na 2-4 graczach i sprawdź FPS (statystyki w panelu: światła/pula, NEAR/MID/FAR).
13. iPhone (`?touch=1` lub prawdziwy telefon): przycisk "Lampa" nie koliduje z joystickiem, skokiem, kucaniem ani "Użyj"; lampa jest też w plecaku; sprawdź FPS.
14. Zapisz grę przy zapalonej lampie, odśwież stronę, Kontynuuj: lampa jest zapalona. Zapis sprzed lampy (SaveV4) wczytuje się z lampą zgaszoną i bez duplikatów.
15. Sprawdź, że latarnie mostu, słońce i mgła działają jak dotąd.

Nie deklaruję, że jakość światła ani widoczność ze 150 m zostały potwierdzone: wymaga to oceny wizualnej autora.
