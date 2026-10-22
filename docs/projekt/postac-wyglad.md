# AVATAR1: wygląd postaci (fryzury, ubranie, kolory)

Status: kod napisany, **testy, lint, typecheck, build i przeglądarka nie były uruchamiane** (zakaz projektu i brak zgody). Wygląd, kształt i "czucie" ocenia autor.

Trasa deweloperska: `/dev/character-creator` (tylko development; w produkcji `notFound`). Wygląd w grze: zapisywany w SaveV4, zmieniany w panelu Diagnostyka (sekcja "Wygląd (dev)", tylko development).

## Zasada

Wygląd to **dane**, nie logika sterowania: `CharacterAppearanceV1` w `src/lib/character/appearance.ts`. Moduł `src/lib/character/` jest czysty (bez Three.js i Reacta), więc te same dane i funkcje może używać gra, kreator, testy, skrypt i w przyszłości serwer. Jeden szkielet i jeden mikser animacji: fryzura i ubrania doczepiają się do istniejącego szkieletu, nie dodają kości ani animacji.

```
CharacterAppearanceV1 {
  baseId: "player.girl.base"
  hairStyleId: "hair.01" | "hair.02" | null
  hairColor: "#rrggbb"
  topId: "top.01" | null     topColor: "#rrggbb"
  bottomId: "bottom.01" | null  bottomColor: "#rrggbb"
}
```

`normalizeAppearance` nigdy nie rzuca: nieznane ID (np. usunięte w nowszej wersji) daje puste miejsce w slocie, zły kolor wraca do domyślnego. Domyślny wygląd: `hair.01` #5b3a22, `top.01` #4f8f5a, `bottom.01` #6a4e38.

## Rejestr elementów (`src/lib/character/registry.ts`)

| ID | Slot | Nazwa | Źródło | Status | Budżet trójkątów |
| --- | --- | --- | --- | --- | --- |
| `hair.01` | hair | Krótkie, potargane z grzywką | procedural (`hair01`) | ready, prototyp | 3000 |
| `hair.02` | hair | Średnie, prosty bob | procedural (`hair02`) | ready, prototyp | 3500 |
| `hair_tripo_short_01` | hair | Krótkie, naturalne | glb (Tripo3D, `hair/Miasto_Fryzura_HeadLocal_Wstepne_Dopasowanie.glb`) | ready | 23000 (plik: 22 537) |
| `top.01` | top | Tunika / koszula przygodowa | derived (powłoka z ciała) | ready, prototyp | 7000 |
| `bottom.01` | bottom | Spodnie przygodowe | derived (powłoka z ciała) | ready, prototyp | 11000 |

ID są stabilne (zapis, multiplayer): nigdy ich nie zmieniamy ani nie używamy ponownie. Dodanie elementu: nowy wpis w `CATALOG` (ID `slot.NN` albo opisowy `slot_zrodlo_nazwa_NN`, źródło, budżet, reguły ukrywania ciała), ewentualnie generator w `hair/index.ts`; reszta (kreator, zapis, panel) działa z rejestru. Źródła: `procedural` (generator w kodzie), `derived` (powłoka z bazowej siatki), `glb` (osobny plik; dziś fryzura w układzie lokalnym kości głowy; status `missing_asset`, dopóki pliku nie ma; panel i rig nie udają, że element działa, i raportują brak).

## Mechanizm (`src/lib/forest-view/appearance/appearanceRig.ts`)

- **`AppearanceRig`**: jeden obiekt na postać, wspólny dla gry (`ForestRenderer`, tryb TPP) i kreatora. `apply(appearance)` wymienia tylko zmienione elementy: kontroler, animator, pozycja, szkielet i świat nie są dotykane. Powtórne `apply` tego samego wyglądu nic nie przebudowuje.
- **Fryzura**: siatka generowana względem zmierzonej głowy (`measureHead` z wierzchołków o wadze `Head` >= 0,5; domyślnie środek (0; 0,896; 0), półosie (0,1035; 0,104; 0,101)). Zamocowana jako dziecko kości `mixamorig:Head` z macierzą `boneInverse[head] x bindMatrix` (przenosi przestrzeń modelu z pozy wiązania do przestrzeni kości), więc obraca się z głową. Pivot w środku głowy; dopasowanie Position/Rotation/Scale XYZ (`PartFit`, przycinane do rozsądnych zakresów przez `sanitizeFit`).
- **Ubranie**: `THREE.SkinnedMesh` związany z **tym samym `Skeleton` i `bindMatrix`** co ciało (`mesh.bind(skeleton, bindMatrix)`), dodany do tego samego rodzica, z tą samą macierzą lokalną. Animuje się więc dokładnie z ciałem. Powłokę wylicza `deriveShell` z bazowej siatki: wybiera trójkąty regionów (po dominującej kości), przycina je płaszczyznami (linia dołu rękawa, pasa, kolan itd. przez Sutherlanda-Hodgmana), przesuwa wzdłuż wygładzonych normalnych o stały odstęp (góra większy niż dół, żeby tunika leżała na spodniach), lekko rozszerza dolny brzeg (`flare`) i kopiuje wagi skóry od bliższego wierzchołka. Normalne wygładzane po pozycjach, żeby nie było pęknięć na szwach UV.
- **Ukrywanie ciała pod ubraniem**: reguły `BodyHideRule` (regiony, zakres Y, maks. |x| środka trójkąta) wybierają trójkąty bazowej siatki do ukrycia. Zamiast modyfikować geometrię, rig podmienia bufor indeksów na wariant z cache (klucz = zestaw założonych elementów). Przy zdjęciu elementu wraca oryginalny indeks. Margines ukrywania jest mniejszy niż powłoki, więc ewentualna szpara pokazuje ciało, a nie dziurę.
- **Materiały**: jeden `MeshStandardMaterial` na slot (roughness ~0,9, `DoubleSide`), kolor zmieniany niezależnie (`material.color.set`). Brak per-frame operacji na geometrii.
- **Zwalnianie**: wymiana elementu zwalnia jego geometrię z GPU (`dispose`), materiałów i szkieletu nie rusza. `dispose()` rigu zdejmuje elementy, przywraca oryginalny indeks (warianty zwalnia przez `setIndex(wariant); geometry.dispose()`) i zwalnia materiały. Kolejność przy sprzątaniu: wygląd, animator, model.
- **Awaria wyglądu nie psuje gry**: błąd tworzenia `AppearanceRig` jest logowany, a postać zostaje w stroju bazowym. Błąd elementu trafia do `stats().missing` (widoczne w panelu).
- **Wydajność (cel F)**: 1 szkielet, 1 mikser, ciało + do 3 dodatkowych siatek (włosy, góra, dół) = do 3 dodatkowych draw calls; trójkąty elementów w budżetach z rejestru (sprawdzane testem); cień przez te same ustawienia co ciało.

## Fryzura GLB `hair_tripo_short_01` ("Krótkie, naturalne", Tripo3D)

- **Plik**: `public/characters/hair/Miasto_Fryzura_HeadLocal_Wstepne_Dopasowanie.glb` (6 322 500 B, SHA-256 `e9e47f38...e40ad5b`), bajty identyczne z dostarczonym plikiem (test sprawdza rozmiar i skrót, więc geometria i tekstury nie zostały przerobione). Katalog `public/characters/` nie jest odtwarzany przez `assets:build` (w przeciwieństwie do `public/models`). Zawartość: jedna siatka (16 832 wierzchołków, 22 537 trójkątów), bez szkieletu i animacji, jeden materiał PBR (3 tekstury 2048 px: kolor, normalne, metalness/roughness), bez normalnych w geometrii (three.js włącza wtedy cieniowanie płaskie).
- **Rejestr**: ID `hair_tripo_short_01`, nazwa "Krótkie, naturalne", źródło `glb` (`space: "head_bone_local"`), origin `Tripo3D`, kategoria `Short`, `availableFor: ["female"]`, `defaultColor: "#ffffff"` (= oryginalny kolor tekstury). `hair.01` i `hair.02` bez zmian. Walidacja ID w zapisie (`ITEM_ID` w `save/validate.ts`) dopuszcza teraz też `_` (`[a-z][a-z0-9_.]{1,63}`); schemat i wersja zapisu bez zmian.
- **Wczytywanie** (`forest-view/appearance/hairGlb.ts`): ten sam mechanizm co reszta postaci (`createDefaultGlbLoader`, czyli `GLTFLoader`). `GlbHairCache` pobiera i parsuje plik raz (`acquire`), wszystkie instancje współdzielą geometrię, oryginalny materiał i tekstury; licznik odwołań (`release`) zwalnia je dopiero po ostatnim użytkowniku i po 30 s bezczynności (szybkie przełączanie fryzur nie parsuje pliku od nowa). Postać nie jest przeładowywana: przy wyborze fryzury stara zostaje widoczna do chwili wczytania nowej (bez migania łysą głową), a szybka zmiana przed zakończeniem wczytywania zwalnia nieaktualne wczytanie. Błąd trafia do `stats().missing`.
- **Mocowanie**: siatka ma już transformację do układu lokalnego głowy, więc `AppearanceRig` montuje ją **bezpośrednio jako dziecko kości `mixamorigHead`** (nie przez `headMount` fryzur proceduralnych, który przelicza przestrzeń modelu). Baza = transformacja węzła z pliku (tożsamość), brak skalowania względem wzrostu postaci i brak drugiej transformacji. W pozie wiązania kość głowy ma osie świata i skalę 1, więc plik leży tam, gdzie go zaprojektowano (czubek ok. 0,241 nad kością głowy). Fryzura jest sztywna na kości (bez riggingu), więc podąża za głową we wszystkich klipach.
- **Dopasowanie**: grupa nadrzędna (pivot w początku kości głowy) z korektą Position/Rotation/Scale XYZ, dodawaną do bazy z pliku (domyślnie tożsamość). Kreator ma dodatkowo skalę jednolitą, przełącznik widoczności fryzury, "Zapisz (dev)" / "Usuń zapisane" (`localStorage`, klucz `miasto.character.fits`, osobno dla każdej fryzury; w grze używane tylko poza buildem produkcyjnym), "Kopiuj JSON", "Reset dopasowania". Korekta dotyczy wyłącznie wybranej fryzury. Na stałe: wpisz JSON w pole `fit` wpisu w `CATALOG`. Rotacja i skala działają wokół początku kości głowy (podstawa czaszki), nie wokół środka włosów.
- **Kolor bez utraty tekstury**: każda instancja ma własny klon materiału (te same tekstury); wspólny materiał z pliku nie jest zmieniany. Biały kolor (`defaultColor`) = oryginał (shader nic nie zmienia). Inny kolor: w shaderze (`onBeforeCompile`) wynik = wybrany kolor x (jasność piksela tekstury / średnia jasność tekstury), więc pasma, cienie i połysk z mapy koloru zostają, a zmienia się barwa; nie jest to jednolity kolor. Średnia jasność jest mierzona z tekstury w przeglądarce (poza nią stała zastępcza). Zmiana fryzury bez jawnego koloru przenosi kolor domyślny nowej fryzury, o ile gracz nie wybrał własnego (`withAppearance`); przycisk "Oryginalny kolor" w panelu. Przebarwienie jasnych odcieni (blond) z ciemnobrązowej tekstury jest ograniczone przez jej kontrast (to ocena wizualna po stronie autora).
- **Wydajność**: ~22,5 tys. trójkątów i tekstury 3 x 2048 px (ok. 5,7 MB plików, wielokrotnie więcej w GPU po dekompresji) to znacznie więcej niż `hair.01` (3000), do oceny na docelowym sprzęcie. Nic nie zostało zredukowane. Struktura pod LOD jest gotowa: `source.lods` w rejestrze (`GlbLod`: LOD0 = oryginał, LOD1 = uproszczony, LOD2 = dalekie ujęcie), `glbFileForLod(item, level)`; dziś zawsze LOD0, generowania LOD nie ma.
- **Do sprawdzenia przez autora**: README pliku zastrzega możliwe drobne szpary na styku włosów ze skórą i wstępne dopasowanie; nie twierdzimy, że jest dopasowane idealnie. Cieniowanie płaskie (brak normalnych) może wyglądać fasetkowo; ewentualne rozwiązanie to wygładzone normalne dodane w osobnym kroku (zmiana geometrii wymaga decyzji).

## C0: analiza bazowej siatki (`scripts/assets/analyze-player-body.mjs`)

Skrypt tylko do odczytu (nie zmienia pliku). Wyniki uruchomienia na `Miasto_Dziewczynka_9_animacji_beta.glb`:

- Jedna siatka, jeden materiał, atlas 2048x2048, pozycja wiązania T, 65 kości Mixamo.
- Głowa: 4338 wierzchołków (waga `Head` dominująca), wymiary 0,207 x 0,208 x 0,202, Y 0,792..1,000; **łysa, w kolorze skóry**: fryzura musi być dodatkową siatką (nie da się jej "namalować").
- Tułów, biodra i nogi: szary kombinezon bazowy (atlas), ręce, dłonie, stopy i głowa: skóra. Ubranie nie może więc polegać na przemalowaniu atlasu, tylko na osobnej siatce i ukrywaniu ciała pod nią.
- Linie cięcia powłok (liczba przecięć krawędzi): talia Y 0,55 -> 160, biodra 0,5 -> 217, kolano 0,28 -> 178, szyja 0,86 -> 270. To liczby z analizy danych, nie ocena wizualna.
- **Bramka jakości:** powłoki z danych ciała są dopuszczalne jako prototyp (kształt ciała, bez kołnierza, fałd i kieszeni). Finalny wygląd wymaga osobnych assetów (niżej).

## Specyfikacja finalnych assetów ubrań (do przygotowania przez autora: Tripo3D / Blender)

Furtka: wpis w `CATALOG` z `source: { kind: "glb", file }` i `status: "ready"`; ładowanie GLB w `AppearanceRig` jest dziś **niepodłączone** (rig zgłasza to w `stats().missing`), więc to osobny, mały etap.

- Format GLB, jedna siatka skinowana (`SkinnedMesh`) na **dokładnie tym szkielecie** (65 kości Mixamo, te same nazwy i kolejność, ta sama poza wiązania T i skala: wysokość postaci = 1,0 w pozie wiązania).
- Wagi skóry zgodne z ciałem (maks. 4 kości na wierzchołek, suma = 1); na stawach (bark, łokieć, biodro, kolano) wagi gładkie jak w ciele.
- Jeden materiał z kolorem w `baseColor` zbliżonym do bieli/szarości (kolor ustawia gra mnożnikiem); UV do ręcznego malowania detalu opcjonalnie.
- Budżet: góra do 7000 trójkątów, dół do 11000, fryzura do 3500. Bez własnych kości i animacji. Bez wnętrza ciała pod ubraniem (gra ukrywa ciało regułami).
- Dla każdego elementu: lista regionów ciała do ukrycia (`hides`) i testowe pozy (idle, bieg, skok, kucanie) bez przebicia ciała.

## Zapis: SaveV4

- `CURRENT_SAVE_VERSION = 4`; `SaveV3` zamrożony jako typ poprzedniego formatu. `player.appearance` zapisuje `CharacterAppearanceV1`.
- Migracja v3 -> v4 (`save/migrations/v3ToV4.ts`): dodaje domyślny wygląd i nic poza tym; czysta funkcja na kopii; oryginał zostaje w kopii przed migracją (jak przy v1->v2->v3).
- Walidacja sprawdza kształt i bezpieczeństwo (typy, `#rrggbb`, format ID), nie istnienie elementu w rejestrze: nieznane ID z innej wersji nie psuje zapisu, tylko daje puste miejsce przy wczytaniu.
- Komenda `appearance.set` (normalizuje wejście, ignoruje identyczny wygląd, nie działa poza fazą `playing`); nowa gra startuje z wyglądem domyślnym. Wygląd nie wpływa na rozgrywkę.

## Kreator `/dev/character-creator`

Ta sama klasa `PlayerModel`, `PlayerAnimator` i `AppearanceRig` co w grze, własna scena Three.js z kamerą orbitalną (lewy przycisk obrót, prawy przesunięcie, kółko przybliża). Panel: wybór fryzury/góry/dołu i trzech kolorów, przełącznik dziewięciu klipów (`PlayerAnimator.setPreviewClip`: klip gra w pętli z wagą 1; `null` wraca do sterowania z gry), suwaki dopasowania fryzury (pozycja, obrót, skala XYZ i jednolita, widoczność, zapis dev), "Kopiuj JSON" (`{ id, fit }`), "Wczytaj z pola", reset, statystyki trójkątów i draw calls. Dopasowanie jest podglądem: na stałe trzeba wpisać JSON w pole `fit` elementu w `CATALOG`.

## Znane ograniczenia i ryzyka (nic nie było oglądane)

- Fryzura `hair_tripo_short_01` (patrz sekcja wyżej): dopasowanie wstępne, ciężka (22,5 tys. trójkątów, tekstury 2048), cieniowanie płaskie, brak LOD1/LOD2; wygląd i FPS do oceny autora.
- Ubrania są **powłokami ciała**: bez kołnierza, fałd, kieszeni i grubości materiału; kształt zależy od ciała. Szary kombinezon bazowy może prześwitywać w szczelinach na brzegach (margines ukrywania 0,012 vs odstęp powłoki 0,0055-0,0085 dobrany obliczeniowo, nie wizualnie).
- Dół może mieć do ok. 7-8 tys. trójkątów (budżet 11000; sprawdza test).
- Fryzury to prototypy proceduralne (kształt czaszki z grzywką/bobem, bez pasm i połysku); na głowie o innych proporcjach trzeba dostroić dopasowanie.
- Wygląd w grze zmienia się tylko w panelu deweloperskim; docelowy ekran wyboru postaci (nowa gra) to osobny etap.
- Poziom szczegółu (LOD) postaci i cienie fryzury nie były stroione.
- Wersja zapisu zmieniona na 4: starsze zapisy migrują automatycznie, ale zapis V4 nie otworzy się w starszej wersji gry.

## Test ręczny (dla autora)

1. `npm run dev`, otwórz `http://localhost:3000/dev/character-creator`. Postać w idle, zielona tunika, brązowe spodnie, brązowe krótkie włosy z grzywką.
2. Obracaj widok myszą: włosy przylegają do głowy bez dziur na czubku i karku, twarz odsłonięta; ubranie bez dziur (ciało nie prześwituje na talii, w pachach, na kolanach).
3. Przełącz fryzurę na "Średnie, prosty bob" i z powrotem; wybierz "(brak)" w każdym slocie i sprawdź, że ciało wraca w całości (bez dziur po zdjęciu ubrania).
4. Zmień kolory (włosy, góra, dół): każdy działa niezależnie.
5. Klipy: idle, walk, run, jump, crouch_idle, crouch_walk_forward, crouch_walk_back, crouch_sneak_left/right: włosy ruszają się z głową, ubranie z ciałem, bez przebić ciała w skoku, biegu i kucaniu.
6. Suwaki dopasowania fryzury: pozycja, obrót, skala zmieniają włosy na żywo; "Kopiuj JSON" daje `{ id, fit }`; "Reset dopasowania" wraca do wartości z rejestru.
7. Gra: nowa gra, las (TPP). Postać ma domyślny wygląd. W Diagnostyka -> "Wygląd (dev)" zmień fryzurę i kolory: zmiana natychmiast, bez restartu lasu i bez skoku pozycji.
8. Zapisz (autozapis), odśwież stronę, Kontynuuj: wygląd taki sam. Stary zapis (sprzed SaveV4) wczytuje się z wyglądem domyślnym.
9. FPS w panelu Diagnostyka: bez wyraźnego spadku względem TPP1; statystyki wyglądu (trójkąty, +3 draw calls) w panelu.
10. `/dev/third-person`, `/dev/forest`, `/dev/forest-pro` działają jak dotąd (postać w `/dev/third-person` ma teraz domyślny strój).

### Test ręczny: fryzura "Krótkie, naturalne"

1. `/dev/character-creator`: wybierz Fryzura -> "Krótkie, naturalne · Tripo3D". Do czasu wczytania (1-2 s) zostaje poprzednia fryzura, potem pojawia się nowa (statystyki: włosy ok. 22 537 tr.). Kamera, klip i pozycja się nie zmieniają.
2. Obejdź postać dookoła (przód, tył, boki, góra): fryzura siedzi na głowie, brak szpar przy skórze, czoło i uszy sensownie odsłonięte; kolor domyślnie oryginalny brąz z teksturą.
3. Klipy idle, walk, run, jump, crouch_idle, crouch_walk_*, crouch_sneak_*: fryzura porusza się sztywno z głową, bez przesunięć i bez migotania.
4. Dopasowanie: Position/Rotation/Scale XYZ, skala jednolita, "Fryzura widoczna"; "Reset dopasowania" wraca do pliku. "Zapisz (dev)", odśwież stronę: korekta wraca. "Kopiuj JSON" daje `{ id: "hair_tripo_short_01", fit }`. Zmiana na `hair.01` nie dziedziczy korekty.
5. Kolor: wybierz kolor w próbniku: fryzura zmienia barwę, ale pasma i cieniowanie z tekstury zostają (nie jest to płaska plama); "Oryginalny kolor" wraca do brązu.
6. Przełączaj kilka razy `hair.01` / `hair.02` / "Krótkie, naturalne": bez ponownego pobierania pliku w zakładce Network przez ok. 30 s, bez duchów starych włosów, bez błędów w konsoli.
7. Gra (TPP): panel Diagnostyka -> "Wygląd (dev)": wybierz nową fryzurę, zapisz (autozapis), odśwież i Kontynuuj: ta sama fryzura i kolor.

Do uruchomienia przez autora po akceptacji: `npx vitest run src/lib/character src/lib/forest-view src/lib/game/save src/lib/game/systems src/lib/input src/lib/tpp`, następnie `npm run lint`, `npx tsc --noEmit` i `npm run build`.
