# Troll: matowe materiały (MATTE MATERIAL FIX)

Stan: 19 października 2026. Poprawka wyglądu istniejącego trolla w normalnej grze: skóra, broda i nos nie mają wyglądać jak lakier, a oczy nie mają migotać nocą. Zmiany dotyczą wyłącznie właściwości powierzchni (materiał i jedna mapa chropowatości). Geometria, szkielet, wagi, siedem animacji, patrol, dialog, `MIASTO_DEFAULT`, oświetlenie lasu, generator, quest i zapis bez zmian.

## Co jest w pliku

`public/characters/troll.forest.glb` ma **jeden** `MeshStandardMaterial` ("Troll") i jedną siatkę ze skórą. Pipeline `assets:troll` scalił 22 części z oryginału (`tripo_part_N`) w jedną siatkę z atlasem 2048 x 2048 (kolor, normalne, MR). Dlatego nie ma osobnych materiałów dla skóry, brody, nosa i oczu: o tym, co jest czym, decyduje dopiero miejsce w atlasie. Części oryginału też nie są semantyczne (jedna wyspa UV zawiera twarz, brodę i włosy).

Parametry z pliku: `metallicFactor` 1 i `roughnessFactor` 1 (mnożniki domyślne), `doubleSided`, `metallicRoughnessTexture` (ta sama tekstura jest metalnessMap i roughnessMap w Three.js), `normalTexture`.

## Przyczyna połysku

Zmierzone na atlasie MR (test regresyjny `trollMaterials.test.ts`):

- Kanał G (chropowatość): średnio ok. 0,30; ponad 90% tekseli ma chropowatość poniżej 0,4. To jest wartość lakieru/plastiku: skóra, broda i nos dostają szeroki, wyraźny refleks od jedynego źródła światła z odbiciem (słońce/księżyc).
- Kanał B (metaliczność): średnio 0,009, więc **metal nie jest przyczyną**.
- Kanał G spada do 0 w obu oczach i w pustych polach między wyspami UV.
- W scenie nie ma mapy środowiska (`scene.environment`), więc odbić IBL nie ma; zostaje wyłącznie specular od `DirectionalLight` (`sun` w rendererze lasu). Materiał nie ma clearcoat, sheen ani transmission (zwykły `MeshStandardMaterial`).
- Mapa normalnych jest poprawnie zinterpretowana: przestrzeń styczna, +Y (konwencja glTF), `NoColorSpace`, brak tangentów w siatce (Three.js liczy ramkę z pochodnych); nie ma powodu jej odłączać.

## Przyczyna jasnych punktów w oczach nocą

Oczy są namalowane w teksturze koloru, a w atlasie MR oraz normalnych mają osobne wartości: chropowatość ≈ 0 (lustro) w obu oczach i ostry wał normalnych wokół gałki (długość wektora normalnej poza płaszczyzną > 0,5, widać pierścień na mapie). Efekt to bardzo wąski, bardzo jasny lobe specular od światła kierunkowego (nocą: księżyc), który jest mniejszy niż piksel i przy ruchu kamery oraz animacji głowy migocze (aliasing podpikselowy). Three.js ogranicza chropowatość od dołu do 0,0525 i dodaje geometryczny składnik, ale to nadal ostry lobe.

Sprawdzone i odrzucone jako przyczyna:

- **globalna jasność / ekspozycja**: nie ruszane (nie maskujemy tym problemu);
- **emissive**: oczy nie mają emissive i nie dostają go;
- **z-fighting**: oczy są częścią jednej siatki twarzy (nie ma nakładających się powierzchni; liczba trójkątów bez zmian);
- **cienie**: akne dałoby pasy ciemne/jasne na skórze, nie punktowe odblaski; do oceny w przeglądarce (instrukcja niżej), bo wymaga obrazu.

Rozwiązanie: w oczach (i w pustych polach, które mipmapy mieszają z krawędziami wysp) chropowatość 0,7, więc zostaje szeroki, miękki i stabilny refleks.

## Co zmienia `prepareTrollMaterials()`

Plik: `src/lib/npc/trollMaterials.ts` (logika klasyfikacji w `src/lib/npc/trollSurface.ts`, czysta, bez Three.js).

1. Tryb matte dostaje **klon** materiału z pliku; oryginał zostaje nietknięty (przełącznik ORIGINAL/MATTE w panelu dev), więc modyfikacje nie dotyczą żadnego innego modelu (troll ma własny `scene` z własnymi materiałami, a klon dzieli tylko tekstury).
2. `metalness = 0`, `metalnessMap = null` (B ≈ 0, ale mapa jest zbędna).
3. Chropowatość: z atlasu koloru i oryginalnej mapy MR klasyfikujemy teksele i wypiekamy mapę (1024 x 1024, RG8, 2 MB, mipmapy; `roughness = 1`, bo wartość niesie mapa). Klasyfikacja po kolorze albedo (HSV):

| Klasa | Reguła | Chropowatość | Udział w atlasie |
|---|---|---|---|
| oczy | MR < 0,2 (i nie czarne pole) | 0,70 | ok. 0,6% |
| nos | różowy (odcień ≥ 340° lub < 12°, nasycenie > 0,2/0,3) | 0,70 | ok. 0,8% |
| skóra | ciepły beż/pomarańcz | 0,85 | ok. 26% |
| włosy, broda, futro | biało-niebieskie/szare i zielone | 0,95 | ok. 71% |
| dodatki | nasycony czerwono-pomarańczowy (kwiaty, grzyby) | 0,80 | ok. 1,7% |
| puste pola | czarne albedo | 0,85 | nie liczone |

   Każdy teksel wynikowy to średnia z bloku 2 x 2 źródła, potem rozmycie 3 x 3, żeby granice klas nie dawały skoków połysku. Wartości są punktem wyjścia, nie stałymi (`TROLL_ROUGHNESS`).
4. `envMapIntensity` 0,25 (na wypadek dodania IBL), `normalScale` bez zmian (1).
5. Gdyby materiał był `MeshPhysicalMaterial` (np. nowy plik): clearcoat, sheen, transmission, iridescence = 0, `specularIntensity` ≤ 0,5. Dziś nie dotyczy.
6. Gdy nie da się odczytać pikseli (poza przeglądarką, brak tekstur, błąd): tryb zapasowy z jednolitą chropowatością 0,9 i powodem w diagnostyce; troll nigdy nie znika przez błąd materiału.

Koszt: brak dodatkowych siatek, materiałów w rysowaniu ani draw calls (nadal jedna siatka z jednym materiałem). Pamięć: +2 MB (mapa chropowatości), a oryginalna mapa MR (2048², ok. 16 MB z mipmapami) nie trafia na GPU, dopóki nie włączysz ORIGINAL. Czas przygotowania ok. 0,2-0,4 s przy ładowaniu trolla (wypiekanie na CPU); wartość jest w panelu.

Życie zasobów: `NpcLayer.dispose()` zwraca oryginał siatce i zwalnia tylko klon oraz wypieczoną mapę; współdzielone tekstury sprząta `asset.dispose()` jak dotąd.

## Przełącznik w panelu O / F3

W sekcji NPC troll jest podsekcja "MATERIAŁY TROLLA": przyciski **ORIGINAL MATERIALS** i **MATTE MATERIALS** (aktywny jest podświetlony) oraz rzeczywiste parametry materiału na modelu (typ, metalness, roughness, mapa chropowatości, mapa metaliczności, normalne, env, klasy z udziałami, czas przygotowania). Wybór pamięta renderer do końca wizyty w lesie (nie jest zapisywany; domyślnie MATTE).

## Instrukcja porównania w przeglądarce

1. `npm run dev`, wejdź do lasu normalnej gry, kliknij widok, `O` (lub F3) otwiera panel.
2. Podejdź do trolla na 2-3 m (dystans w panelu), skieruj kamerę na twarz.
3. Przełączaj ORIGINAL MATERIALS i MATTE MATERIALS. W ORIGINAL skóra, broda i nos mają lakierowany refleks; w MATTE refleks jest szeroki i miękki.
4. Pory dnia: w sekcji AUDIO przyciski ŚWIT 06:00 (poczekaj 20 s, aby mieć 07:00), DZIEŃ 12:00, ZMIERZCH 19:30, NOC 01:00 (czas idzie tylko do przodu).
5. Noc: stań w miejscu, patrz w oczy trolla z bliska; w ORIGINAL szukaj jasnych migoczących punktów, w MATTE powinien zostać stabilny, delikatny refleks. Jeśli nadal widzisz punkty w MATTE, zrób zrzut z godziną i przyciskiem w panelu: to wtedy ślad do cieni lub normalnych (nie wyrównujemy tego jasnością sceny).

## Strojenie

`TROLL_ROUGHNESS` (tabela klas), `TROLL_NORMAL_SCALE`, `TROLL_ENV_INTENSITY`, `TROLL_ROUGHNESS_MAP_SIZE` w `trollMaterials.ts` / `trollSurface.ts`. Klasyfikacja po kolorze jest heurystyką: może zaliczyć fragment skóry do nosa albo odwrotnie, co przy chropowatościach 0,7-0,95 jest mało widoczne. Dokładniejszy podział wymagałby osobnej maski w pipeline `assets:troll` (nie robione, bo zmienia plik GLB).

## Testy

`src/lib/npc/trollMaterials.test.ts` (14): diagnoza na prawdziwym atlasie (lakierowana mapa MR, zerowa chropowatość i ostry wał normalnych w oczach), klasyfikacja, wypiekanie, brak połyskliwych tekseli po korekcie (minimum 0,69), zachowanie tekstur koloru i normalnych, przełączanie bez dodatkowych siatek, brak zmian w geometrii, kościach, wagach i animacjach, sprzątanie, tryb zapasowy, ograniczanie warstw `MeshPhysicalMaterial`, `NpcLayer` (stan, statystyki, dispose).

## Czego nie weryfikuje się w testach

Wygląd i migotanie wymagają obrazu: ocenia je autor w przeglądarce (a pomocniczo test w przeglądarce opisany w raporcie etapu).
