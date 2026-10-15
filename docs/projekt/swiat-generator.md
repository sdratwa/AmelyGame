# Generator świata - las startowy 300 x 300 m

Stan implementacji rdzenia (współrzędne, teren, indeks, walkable): [swiat-w0.md](swiat-w0.md).

Wymiary i układ dotyczą pierwszego lasu; nie są regułą dla przyszłych lokacji.

## Skala i organizacja

- 1 jednostka Three.js = 1 metr. Współrzędne x, z w [-150, 150].
- Logiczne sektory 30 x 30 m (siatka 10 x 10, `sector.<region>.<ix>_<iz>`, np. `sector.forest_start.3_4`). Siatka jest niewidoczna dla gracza; ruch jest swobodny. Sektory służą do generowania, indeksu kolizji, odkrywania mapy i okna renderowania. Streaming zasobów nie jest potrzebny w etapie 1.
- Organizacja oparta na `RegionDef { id, bounds, sectorSize, unlockedBy }`, nie na sztywnych 100 sektorach. Regiony startowe: `region.forest_start` i `region.beyond_bridge` (wschodni brzeg ok. 35 m + polana, odblokowywany przez quest). Przyszłe regiony dochodzą jako dane.

## Baza a zmiany gracza

1. `WorldBase`: czysty wynik `generate(worldSeed, worldGenVersion)`: teren, rzeka, ścieżki, drzewa, skały, węzły surowców, skrzynie, troll, miejsce mostu, obszary poszukiwań.
2. `WorldDelta`: zapisane zmiany gracza (otwarte i odebrane skrzynie, ścięte drzewa, wydobyte skały, most, odkrycie mapy, odblokowane regiony, stan trolla i depozyt).
3. `resolveWorld(base, delta)`: to, co widzą renderer i walidatory kolizji.

Przykład: ziarno określa położenie drzewa, zapis określa, czy drzewo zostało ścięte. Obiekty mają stabilne ID (`tree.<sektor>.<numer>` itd.), w które celuje delta.

## Wysokość terenu

`createTerrain(worldSeed, version) -> Terrain` z metodami `height(x, z)`, `normal(x, z)`, `slope(x, z)`; `terrainHeight(terrain, x, z)` to jedyne źródło wysokości dla: generatora (y obiektów, odrzucanie zboczy, spłaszczenia pod kotwice), kolizji i ruchu (wysokość kamery, blokada zboczy), interakcji (odległość 3D z tolerancją), renderera (siatka terenu, instancje) oraz walidatora i minimapy. Funkcja jest czysta i deterministyczna; teren nie jest zapisywany. Początkowo łagodny (ok. 1,5-3 m), architektura obsługuje więcej. Rzeka: koryto obniżone w `height`, ale autorytatywna jest jawna maska rzeki w `walkable`.

## Potok generatora (wersja 1)

Każdy etap ma własny strumień RNG (`rng(seed, "river")`, `"paths"`, `"chests"` itd.), więc dodanie obiektów w jednym etapie nie przesuwa innych.

1. Teren (wysokość, spłaszczenia pod kotwice, brzegi rzeki, ścieżki).
2. Rzeka N-S w wschodniej części mapy (ok. x = +100..+115, szerokość 10-14 m) przez całą wysokość mapy (brak obejścia); zniszczony most w środkowej części.
3. Regiony i start gracza (zachód), z prześwitem.
4. Ścieżki: pas 3 m wolny od przeszkód; rozsiew drzew, skał i roślin (odrzucanie z prześwitami, `y` z `terrainHeight`), gęsty pas przy krawędzi, niewidzialna ściana na granicy.
5. Kotwice: trzy skrzynie (odstępy, odległość od startu i brzegu, poza wodą), troll z polaną, miejsce mostu, obszary poszukiwań (koło ok. 45 m zawierające skrzynię, środek przesunięty losowo, etykieta strony świata), węzły surowców (małe/średnie/duże = 1/2/5) z zapasem >= 3x.
6. Walidator, naprawa lokalna, warianty `variant+1` (deterministyczny pod-seed).

Obiekty nie są rozmieszczane niezależnie: kotwice dostają polany i dojścia, ścieżki pozostają przechodnie, zasoby leżą przed mostem, rzeka nie ma obejścia.

> Uwaga: opisany tu potok to generator v1 (zamrożony). Generator lasu v2 (W1a, wersja robocza, niezarejestrowana) działa inaczej: leniwe sektory i profile środowiskowe, patrz [swiat-w1a.md](swiat-w1a.md).

## Walidator

Raport zawiera listę naruszeń: granice; brak nakładania (z promieniem gracza); skrzynie poza wodą, niezbyt blisko siebie i startu, osiągalne pieszo (BFS ~0,5 m z uwzględnieniem nachylenia) i niezależne od przedmiotów z innych skrzyń; ścieżki przechodnie; brak przecieku do `region.beyond_bridge` przed mostem i przejście po moście; zasoby przed mostem >= 3x (>= 15 drewna, >= 30 kamieni) plus część węzłów blisko głównego szlaku; spłaszczenia kotwic w limitach nachylenia (kotwice <= 8 stopni, drzewa <= 35, ścieżka <= 12).

Naprawa: lokalne przesunięcie/usunięcie kolidujących obiektów; jeśli nie wystarczy, ponowienie z `variant+1` (maks. N prób). Wynik zależy wyłącznie od (seed, wersja generatora), numer wariantu jest zapisywany w `worldId`.

## Zgodność zapisów: worldGenVersion

Snapshot pozycji krytycznych nie wystarcza (zmieniłaby się geometria otoczenia i kolizje), dlatego świat jest odtwarzany przez ten sam generator, który go stworzył.

Zasady:

1. **Rejestr wersji.** `world/generators/v1/`, `v2/` ... Każda wersja to kompletny, zamrożony pakiet: teren, rzeka, ścieżki, rozsiew, kotwice, profile colliderów (promienie kolizji per rodzaj obiektu), reguły walidatora. `generate(seed, version)` wybiera pakiet z rejestru. Wersja nie importuje "żywych" fragmentów, które mogą się zmienić (stałe/narzędzia wspólne są albo kopiowane do pakietu, albo mają kontrakt bitowej stabilności z testem golden, np. `core/rng`).
2. **Zamrożenie po wydaniu.** Wydanej wersji nie edytujemy. Ulepszenie = nowa wersja. Sumy kontrolne plików zamrożonej wersji (`FROZEN.sha256`) i testy golden (odciski `WorldBase` dla stałych ziaren) wykrywają przypadkową zmianę w CI.
3. **Nowe gry** używają `CURRENT_GEN_VERSION`; istniejące zapisy zachowują swoją wersję bezterminowo.
4. **Wygląd rozdzielony od gry.** Kolizje i geometria pochodzą z profili colliderów wersji generatora, nie z aktualnych modeli. Zamiana modelu 3D (np. inny pakiet drzew) nie zmienia gry ani zapisów; renderer mapuje `kind -> modelId` niezależnie.
5. **Odcisk świata.** Zapis ma `worldFingerprint` (hash kanonicznej serializacji `WorldBase`: próbki terenu na stałej siatce, maska rzeki, obiekty, collidery). Przy wczytaniu generujemy świat i porównujemy odcisk. Niezgodność = błąd integralności: zapis nie jest nadpisywany, gracz widzi komunikat, kopia jest zachowana, gra proponuje "Nową grę" (oryginał pozostaje w `.bak`).
6. **Migracja zamiast cichej zmiany.** Podniesienie wersji świata nigdy nie dzieje się automatycznie przy aktualizacji aplikacji. Dopuszczalne wyłącznie przez jawną migrację `migrateWorld(from, to)`, która: tworzy kopię zapasową; przenosi `WorldDelta` po stabilnych ID (para wersji dostarcza mapowanie ID); generuje nowy świat z "przypiętymi" kotwicami (generator wersji >= 2 przyjmuje `pins`: skrzynie, troll, miejsce mostu zachowują współrzędne, a otoczenie jest dostosowane); uruchamia walidator nowej wersji; bezpiecznie przenosi gracza i depozyt; jest atomowa (wszystko albo nic). Jeśli któryś krok się nie powiedzie, świat zostaje na starej wersji. Świat bez postępu gracza (pusta delta) można podnieść bez ryzyka.
7. **Wycofanie starej wersji** generatora dopiero po dostarczeniu ścieżki migracji i udokumentowaniu okresu przejściowego.
8. **Pozycja gracza** zapisana w lesie jest przy wczytaniu walidowana względem świata danej wersji; w razie niezgodności gracz wraca do bezpiecznego punktu startu.

Snapshot pozycji krytycznych pozostaje zapisem pomocniczym (diagnostyka i wejście do migracji z `pins`), nie zamiennikiem generatora.

## Renderowanie dużego lasu

Jedno `InstancedMesh` na typ obiektu, wypełniane tylko dla okna aktywnych sektorów (np. 7 x 7) wokół gracza; przebudowa przy zmianie sektora lub stanu obiektu. LOD dla dużych modeli, kolizje przez indeks sektorowy (zamiast liniowego skanu). Szczegóły budżetów: [wydajnosc.md](wydajnosc.md).
