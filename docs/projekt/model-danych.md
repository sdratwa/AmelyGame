# Model danych

## Ekwipunek i kontenery

Cele: brak utraty i duplikacji przedmiotów, większe ilości surowców, możliwość dodania magazynu bez przebudowy silnika.

```ts
type ItemStack = { id: ItemId; qty: number; meta?: Record<string, unknown> };

type ContainerSpec = {
  id: ContainerId;            // "container.player.inventory", w przyszłości "container.house.storage.<id>"
  kind: "inventory" | "storage" | "chest" | "deposit";
  slots: number | "unlimited";
  stackLimit?: (item: ItemDef) => number | "unlimited"; // nadpisuje item.maxStack
};
```

- `qty` jest zwykłą liczbą całkowitą; kod nie zakłada, że ilość <= 20 (test z milionami).
- Limit stosu pochodzi z definicji przedmiotu (`maxStack`, początkowo 20 dla surowców) i opcjonalnie z kontenera (magazyn może mieć wyższy lub nieograniczony). Ekwipunek gracza: 8 slotów.
- Operacje są dwufazowe: `planMove(from, to, request) -> MovePlan` (czysta, bez zmian stanu, uwzględnia łączenie ze stosami, wolne sloty i limity) oraz `applyMovePlan(state, plan)` (atomowo odejmuje i dodaje, zachowuje sumę). Częściowy zwrot jest jawnym wynikiem planu (`moved`, `remainder`).
- Zapytania o posiadanie idą przez selektor `holdings(state, itemId)` sumujący kontenery gracza dostępne do crafting/questów. Dodanie magazynu to nowa wartość w rejestrze kontenerów, bez zmian w kodzie questów i receptur.
- Cechy przedmiotu: `unique` (najwyżej jeden egzemplarz łącznie w kontenerach i skrzyniach), `protected` (nie znika przy odrodzeniu), `pinned` (telefon, nie można go zabrać ani wyrzucić), `category` (`tool`, `resource`, `food`, `blueprint`, `special`).
- Schematy (`blueprint`) są w osobnej kolekcji `player.projects`, poza slotami.
- Niezmiennik (testowany własnościowo): suma ilości każdego `ItemId` w (kontenery + skrzynie + depozyt + skonsumowane/zbudowane) jest zachowana po każdej komendzie.

Odrodzenie: narzędzia i surowce zostają, jedzenie może przepaść; depozyt i skrzynie nietykalne.

## Skrzynie

```ts
type ChestDef = {            // z generatora; snapshot krytycznych pozycji w zapisie
  id: ChestId;               // "chest.bridge.pickaxe" | "chest.bridge.saw" | "chest.bridge.blueprint"
  worldId: WorldId;
  kind: "wooden";
  pos: { x: number; z: number };
  sector: SectorId;
  contents: ItemStack[];     // z definicji questa, nie z losowania
  openWhen?: ConditionRef;
  guardian?: NpcId;          // "npc.troll.bridge"
  questId?: QuestId;
};
type ChestState = {          // WorldDelta
  opened: boolean;
  openedAt?: number;         // czas gry
  remaining: ItemStack[];    // nieodebrane; jedyne źródło prawdy
};
```

Komendy: `chest.open` (zasięg i `openWhen`; ustawia `opened`, ujawnia zawartość) oraz `chest.take` (przenosi tyle, ile się mieści; reszta zostaje w `remaining`). Otwarcie nie losuje niczego ponownie. Pozycje skrzyń są losowane raz, przy tworzeniu nowego świata, i zapisane.

## Depozyt trolla

```ts
type Deposit = {
  id: DepositId;             // "deposit.troll.bridge"
  saveId: SaveId;
  status: "held" | "released";
  entries: { entryId: string; stack: ItemStack; depositedAt: number }[];
};
```

Konfrontacja jest jedną transakcją: wszystkie przedmioty poza `pinned` trafiają do depozytu (`held`), gracz wraca na mapę miasta, `npcs.troll.lockedUntil = nextDayStart(elapsed)`, w dzienniku pojawia się cel odzyskania. Po blokadzie troll daje zagadkę; poprawna odpowiedź ustawia `released` i uruchamia zwrot (`planMove` do ekwipunku, z depozytu schodzi dokładnie tyle, ile przeniesiono; resztę gracz odbiera u trolla bez nowej zagadki). Błędna odpowiedź: `retryAt = elapsed + SECONDS_PER_GAME_HOUR`. Po pierwszej konfrontacji opcja walki znika. Depozyt przeżywa zapis, odczyt, zmianę widoku i odrodzenie. Schematy (`projects`) nie są zabierane.

## Czas i blokady

Wszystkie blokady to bezwzględny czas gry (`lockedUntil`, `retryAt`). Pozostały czas = `lockedUntil - elapsed`. `nextDayStart(elapsed)` zwraca najbliższą wielokrotność `SECONDS_PER_DAY` większą od `elapsed` (czyli kolejne 06:00). Po wczytaniu zapisu nie doliczamy czasu ściennego. Pauza zegara: patrz [architektura.md](architektura.md).

## Zapis (`SaveV1`)

> Stan implementacji po E1 (to, co jest dziś zapisywane, i szczegóły magazynu): [zapis-gry.md](zapis-gry.md). Poniżej docelowy kształt; pola dla questów, skrzyń, trolla itd. dochodzą w kolejnych wersjach formatu z migracjami. Nazwy pól w kodzie: `world { seed, genVersion, fingerprint, genHistory }`, `player.forestPose`, `genHistory[].atElapsed` (czas gry zamiast czasu ściennego).

Zapis lokalny (`localStorage`, klucz `miasto.save` i kopia `miasto.save.bak`) za interfejsem `SaveStore { load, save, reset }`. Tylko dane serializowalne.

```ts
type SaveV1 = {
  version: 1;
  saveId: SaveId;
  worldSeed: number;
  worldGenVersion: number;      // wersja generatora (patrz swiat-generator.md)
  worldFingerprint: string;     // odcisk wygenerowanego WorldBase
  worldGenHistory: { version: number; migratedAt: number }[];
  worldId: WorldId;
  criticalPlacements: { chests: ChestDef[]; troll: Placement; bridgeSite: Placement; regions: RegionDef[] };
  time: { elapsed: number };
  player: {
    name: string; health: number; drainAcc: number; deaths: number; wallet: number;
    containers: Record<ContainerId, { slots: (ItemStack | null)[] }>;
    projects: BlueprintId[]; badges: BadgeId[];
    ledger: { obtained: ItemId[] };
    forestPos?: { x: number; z: number; yaw: number };
  };
  houses: House[];
  quests: Record<QuestId, QuestState>;
  noticeboard: { readIds: string[] };
  world: {
    chests: Record<ChestId, ChestState>;
    harvested: Record<NodeId, number>;
    bridge: { built: boolean; builtAt?: number };
    discovered: string;          // bitset siatki odkrycia, base64
    unlockedRegions: RegionId[];
  };
  npcs: { troll: { state: "guarding" | "solved"; lockedUntil: number; retryAt: number;
                   attempt?: { riddleId: RiddleId; attemptNo: number }; confrontations: number;
                   deposit: Deposit } };
  tutorial: { completed: TutorialStepId[] };
  savedAt: number;               // informacyjnie
};
```

Niezapisywane: toasty, otwarte panele, jawne pauzy, obiekty Three, refy. Zasady: walidacja kształtu przy wczytaniu, migracje `vN -> vN+1` z testami, uszkodzony zapis -> kopia `.bak`, potem komunikat i "Nowa gra" (oryginał nie jest nadpisywany). Autosave po istotnych komendach (debounce) i co kilka sekund. Reset zapisu dla testów (`?reset=1` i przycisk w dev). Domy generowane ze strumienia `rng(seed, "houses")` i zapisane.

Dodatkowo: pozycję gracza w lesie walidujemy przy wczytaniu (musi być przechodnia w świecie danej wersji generatora); w razie problemu gracz trafia na bezpieczny punkt startu.
