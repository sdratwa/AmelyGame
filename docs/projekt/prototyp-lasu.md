# Wizualny prototyp sektora lasu 30 x 30 m (etap V2)

Cel: jak najszybciej pokazać atrakcyjny wizualnie fragment docelowego lasu z prawdziwymi modelami i zmierzyć wydajność, zanim zbudujemy cały las 300 x 300 m. Prototyp wchodzi po V1 (zatwierdzone i przetworzone modele) i W1a (generator terenu, ścieżek i rozsiewu); nie czeka na skrzynie, trolla ani walidator.

Dostęp: trasa tylko deweloperska (np. `/dev/las-sektor`, w produkcji 404), ziarno z URL. Sektor pochodzi z generatora (etapy 1-4 potoku).

## Zawartość

- Docelowe modele z zatwierdzonych pakietów: >= 3 gatunki/warianty drzew w >= 2 rozmiarach, >= 2 modele skał w 3 klasach S/M/L, >= 2 modele paproci/roślin runa plus trawa i krzewy. Zero roślinności z prostych brył; placeholdery tylko dla obiektów mechaniki (których w prototypie nie ma).
- Teren z siatki próbkowanej z `terrainHeight` (różnica wysokości w sektorze >= 1,5 m), tekstury gruntu CC0 <= 1024 px, ścieżka (pas 3 m) wtopiona w teren, nachylenie ścieżki <= 12 stopni.
- Światło: słońce kierunkowe, cienie (HIGH 2048 px, MEDIUM 1024, LOW wyłączone), mgła atmosferyczna zależna od pory dnia i pory roku, opcjonalne tanie promienie słońca (HIGH).
- Ruch: WASD + mysz (pointer lock) + strzałki, wysokość kamery z `terrainHeight`, kolizje z pniami i skałami (profile colliderów), prędkość jak w obecnym lesie.
- Overlay `?debug=1` i tryb `?stress=49` (kafelkowanie sektora w oknie 7 x 7).

## Kryteria mierzalne

Automatyczne (agent):
- `terrainHeight` jednolite w siatce renderera, kolizjach i generatorze (próbki, tolerancja 1 cm).
- Ten sam seed daje identyczną listę instancji sektora (hash).
- Brak instancji w kolizji i na zboczach powyżej limitu.
- Skrypt manifestu: każdy użyty GLB ma wpis (źródło, autor, licencja, atrybucja, `placeholder: false`, zatwierdzenie) i zgodną sumę kontrolną.

Budżety (odczyt z overlayu): patrz [wydajnosc.md](wydajnosc.md).

Wydajność (mierzy autor, raport JSON): HIGH średnio >= 60 FPS (1% low >= 45) w 1920x1080; LOW >= 30 FPS na najsłabszym wskazanym sprzęcie; stress na MEDIUM średnio >= 45 FPS.

Wizualnie (decyzja autora, bramka G2): zgodność z kierunkiem "stylized fantasy, ciepłe filmowe światło, gęsta roślinność, delikatna mgła, czytelność interaktywnych obiektów". Odrzucenie wraca do wyboru pakietu (V0/V1) bez wpływu na silnik.

## Bramka G2

Integracja z całym lasem (F1) rozpoczyna się dopiero po akceptacji prototypu przez autora.

## Znane ryzyko

Wersja Standard MegaKit zawiera tylko 3 średnie skały i jedną paproć; patrz [zasoby-3d.md](zasoby-3d.md) (warianty A/B/C).
