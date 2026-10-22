# Zapis gry (E1, E2, Q1, SaveV3) - stan implementacji

Aktualizacja online (23 października 2026): bieżący format to SaveV4 z wyglądem postaci. Online używa osobnego magazynu `miasto.online.<worldInstanceId>`, solo nadal `miasto.save`. Postęp questa i pozycja są odtwarzane przy ponownym wejściu online; zapis jest lokalny dla przeglądarki. Wspólny zegar serwera `worldElapsed` jest stanem sesji i nie trafia do SaveV4. Szczegóły oraz ograniczenia: [multiplayer-m1a.md](multiplayer-m1a.md). Poniższy opis warstw dokumentuje historyczny etap SaveV3.

Opis tego, co działa w kodzie po etapach E1 (magazyn), E2 + Q1 (ekwipunek ze stosami, questy, skrzynie, troll z depozytem, most) oraz po usunięciu telefonu (SaveV3 = SaveV2 bez telefonu). Minimapa (mgła odkrywania) i tutorial jako maszyna kroków dochodzą w kolejnych wersjach formatu, każda z migracją.

## Warstwy

| Moduł | Rola |
| --- | --- |
| `src/lib/game/save/schema.ts` | typy `SaveV3` (bieżący), `SaveV2` i `SaveV1` (zamrożone, tylko dla migracji), `CURRENT_SAVE_VERSION = 3`, lista dozwolonych kluczy |
| `save/serialize.ts` | `serializeState(state, savedAt)`: whitelista pól trwałych (nowe pole stanu nie trafia do zapisu samo) |
| `save/hydrate.ts` | `hydrateState(save)`: stan gry z zapisu; dane sesji startują od zera |
| `save/validate.ts` | `validateSaveV3`: ręczna walidacja kształtu, zakresów i niezmienników (bez bibliotek), w tym niezmiennik księgi i brak duplikatów przedmiotów unikatowych |
| `save/validateV1.ts` | zamrożony `validateSaveV1` (z `LEGACY_ITEM_IDS` i `isLegacyForestPose`), używany wyłącznie przez migrację |
| `save/migrations/v1ToV2.ts` | kontrolowana migracja SaveV1 -> SaveV2 (patrz niżej; dawny telefon jest pomijany) |
| `save/migrations/v2ToV3.ts` | migracja SaveV2 -> SaveV3: usuwa telefon (patrz niżej) |
| `save/codec.ts` | koperta `{ format, envelope, checksum, payload }`; suma kontrolna nad kanonicznym JSON |
| `save/migrate.ts` | `migratePayload`, `MIGRATIONS` (`{ 1: migrateV1ToV2, 2: migrateV2ToV3 }`), `SchemaConfig` |
| `save/store.ts` | interfejs `SaveStore` + `LocalStorageSaveStore` |
| `save/loader.ts` | `verifyWorld`, `loadGame`: magazyn + zgodność świata (odcisk generatora) |
| `save/autosave.ts` | `Autosaver`: debounce istotnych zmian, interwał dla zmian ciągłych, `flush` przy zamknięciu |
| `save/newGame.ts` | `createNewGameParams`: seed i `saveId` z `crypto.getRandomValues` (jedyne miejsce losowości) |
| `src/lib/game/world/` | rejestr wersji generatora (v1 zamrożony, v2 bieżący), odcisk, kotwice questa |

## SaveV3 (to, co jest dziś trwałe)

SaveV3 ma ten sam kształt co SaveV2; różnica to brak przedmiotu `item.phone` (walidator odrzuca go jako nieznany przedmiot i nie wymaga już niczego w slocie 1). Most jest zapisany jako `bridge { built, builtAt }`; wygląd, kolizje poręczy, pokład i latarnie są **pochodną** tego pola i zegara gry, więc nie ma osobnych pól w zapisie.

Pola SaveV1 (`version`, `saveId`, `savedAt`, `world { seed, genVersion, fingerprint, genHistory }`, `time.elapsed`, `player { name, health, drainAcc, dead, deaths, wallet, selected, forestPose }`, `tutorial.done`, `houses`) oraz:

- `player.slots`: stosy `{ id, count } | null` (id z przestrzeni nazw: `item.*`, `resource.*`),
- `player.ledger { gained, spent }`: księga ilości; niezmiennik `gained - spent = w ekwipunku + w depozycie` jest sprawdzany przy wczytaniu,
- `quests` (przyjęte z czasem przyjęcia, ukończone, przeczytane na tablicy), `chests` (otwarta / pobrana), `troll { phase, lockUntil, attempts, deposit }`, `harvested` (zużyte drzewa i skały), `bridge { built, builtAt }`, `discovered` (regiony), `badges`.

Postęp celów questa jest wyliczany ze stanu i nie jest zapisywany. Kotwice świata (pozycje skrzyń, trolla, mostu) także nie: wynikają z `(seed, genVersion)` i są chronione odciskiem świata (odcisk generatora v2 obejmuje kotwice i skrót planu).

Nie jest zapisywane: widok (`view`), komunikaty, stos pauz, dialog (otwarta rozmowa/zagadka), panele, jakiekolwiek obiekty Three/refy. Po wczytaniu gracz zawsze trafia na mapę świata; wejście do lasu przywraca zapisaną pozycję i kierunek (`forestPose`, zapisywane co 2 s i przy wyjściu z lasu).

## Seed świata i generator

- Nowa gra: `createNewGameParams()` losuje `seed` (uint32) i `saveId`; komenda `startLoading { seed, saveId }` generuje świat deterministycznie (`generateWorld(seed, CURRENT_GEN_VERSION)`), liczy `worldFingerprint` i zapisuje je w stanie.
- Generator v1 obejmuje trwałe elementy generowane dziś: 2 domy ze strumienia `rngStream(seed, "houses")`. Kod v1 jest zamrożony (`world/generators/v1/`, sumy w `FROZEN.sha256` sprawdzane testem). Układ lasu w prototypie nie jest jeszcze generowany z seeda (stały układ wizualny, nie jest zapisywany); wejdzie z generatorem v2 (W1a), a zapisy v1 odtwarzają swoje domy bez zmian.
- Test pilnuje, że kod w `src/lib/game/` nie używa `Math.random`, `Date.now`, `new Date(` ani `performance.now`.
- Odcisk: `fp1:` + 14 znaków hex (cyrb53 z kanonicznego JSON; chroni przed błędem, nie przed atakiem).
- Weryfikacja przy wczytaniu (`verifyWorld`): znana wersja generatora, zgodny odcisk, zgodne niezmienne pola domów (id, nazwa, cena, telefon, kolory, flip). Pola gracza (`owned`, `level`) mogą się różnić.

## Magazyn: klucze i kolejność zapisu

`localStorage`, prefiks `miasto.save`:

| Klucz | Zawartość |
| --- | --- |
| `miasto.save` | bieżący zapis (koperta) |
| `miasto.save.bak` | poprzedni poprawny zapis (rotacja przy każdym zapisie) |
| `miasto.save.corrupt`, `.corrupt.bak` | zachowane oryginały uszkodzonych zapisów (do odzysku) |
| `miasto.save.archive.0..4`, `.archive.next` | zapisy odłożone przy starcie nowej gry (inny `saveId`), obieg 5 slotów |
| `miasto.save.premigration.v{N}.{k}` | kopia oryginału przed każdą migracją |

Zapis (`save`): (1) walidacja wychodzącego zapisu (niepoprawnych danych nie zapisujemy), (2) odczyt bieżącego zapisu: poprawny → kopiowany do `.bak` (inny `saveId` → najpierw do archiwum), uszkodzony → do `.corrupt` i bez rotacji (kopia `.bak` nie jest niszczona), zapis z nowszej wersji gry → odmowa, (3) `setItem(primary)` i odczyt kontrolny. `localStorage` nie ma transakcji, ale kolejność gwarantuje, że w każdej chwili istnieje co najmniej jedna poprawna kopia; błąd zapisu (np. brak miejsca) zostawia poprzedni zapis nietknięty.

Odczyt (`load`): główny → kopia `.bak` → komunikat. Uszkodzony główny przy poprawnej kopii: wczytanie kopii, zachowanie uszkodzonego oryginału w `.corrupt`, naprawa klucza głównego. Oba uszkodzone: `corrupt`, nic nie jest kasowane ani nadpisywane. Zapis z nowszej wersji (`unsupported`) i nieudana migracja nie powodują zmian w magazynie ani cichego fallbacku do starszej kopii.

## Migracje

`MIGRATIONS[N]` przekształca payload vN w vN+1 (czysta funkcja na głębokiej kopii; wynik musi mieć `version = N+1`). Przed migracją oryginał trafia do `premigration`; po migracji dane przechodzą pełną walidację; migrowany zapis jest zapisywany zwykłą ścieżką (oryginał ląduje w `.bak`). Błąd na dowolnym etapie (brak kroku, wyjątek, zła wersja, niepoprawny wynik, brak miejsca na kopię) kończy się `migration_failed`, a zapis pozostaje nietknięty. 

### Migracja v2 -> v3 (`migrations/v2ToV3.ts`)

Z gry usunięto telefon (przedmiot w slocie 1). Migracja wycina **wyłącznie** ten przedmiot: ze stosów ekwipunku (zwolniony slot zostaje pusty, pozostałe przedmioty zostają na swoich miejscach), z księgi `gained` / `spent` oraz z depozytu trolla (u zapisów V2 tam go nie było, ale migracja jest odporna). Pieniądze, domy, postęp questa, skrzynie, zebrane obiekty, **zbudowany most**, odkryte regiony, odznaki, pozycja w lesie, `world.seed`, `genVersion` i odcisk świata zostają bez zmian; ukończony quest i zbudowany most nie są cofane, a nagroda nie wypłaca się drugi raz. Czysta funkcja na kopii; oryginał V2 trafia do `miasto.save.premigration.v2.{k}` i `.bak`. Stare zapisy V1 przechodzą łańcuch v1 -> v2 -> v3 (`v1ToV2` pomija dawny `phone`). Lista usuniętych identyfikatorów: `LEGACY_REMOVED_ITEMS` w `content/items.ts`. Testy: `save/migration.test.ts` (sekcja "migracja SaveV2 -> SaveV3").

### Migracja v1 -> v2 (`migrations/v1ToV2.ts`)

Kontrolowana, nie bezwarunkowa wymiana świata. Najpierw pełna walidacja zapisu v1 (`validateSaveV1`); zapis niepoprawny kończy się `migration_failed` bez zmian w magazynie. Zachowane bez zmian: domy (łącznie z `owned` i `level`), portfel, zdrowie, czas gry, imię, tutorial, `saveId`, liczba śmierci. Zmiany:

- generator 1 -> 2: `genVersion = 2`, nowy odcisk, wpis `genHistory { version: 2, atElapsed }`; domy generatora v2 są identyczne z v1 (`generateHousesV1`), więc odcisk domów się nie zmienia, a zmienia się tylko las,
- przedmioty: stare id (`hotdog`, ...) mapowane przez `LEGACY_ITEM_IDS` na id z przestrzeni nazw, stosy po jednej sztuce, księga budowana z posiadanych przedmiotów; stary `phone` jest pomijany (slot zostaje pusty),
- pozycja w lesie: zachowana, jeśli jest poprawna w nowym lesie (`isValidForestPosition`: granice, zachodni brzeg, woda, nachylenie, kolizje); w przeciwnym razie gracz trafia do bezpiecznego punktu wejścia (`forestEntryPose`, zachodni skraj lasu); brak pozycji pozostaje brakiem,
- nowe dane (zadania, skrzynie, troll, depozyt, most, odznaki) startują puste.

Oryginał v1 trafia do `miasto.save.premigration.v1.{k}` oraz do `.bak`, więc stary zapis pozostaje czytelny i odtwarzalny. Testy: `save/migration.test.ts`.

## Interfejs `SaveStore`

```ts
interface SaveStore {
  load(): Promise<LoadResult>;
  save(save: SaveV3): Promise<SaveOutcome>;
  reset(): Promise<void>;
}
```

Metody są asynchroniczne, żeby można było podstawić IndexedDB lub serwer. Implementacja `localStorage` wykonuje zapis synchronicznie w chwili wywołania (potrzebne przy `pagehide`); backend asynchroniczny musi sam zadbać o dokończenie zapisu przy zamykaniu karty.

## Autosave w aplikacji (`GameApp`)

- Pierwszy zapis po starcie gry; kamienie milowe (zbudowany most, odkryty obszar, ukończone zadanie) wymuszają natychmiastowy `flush`; zmiana istotna (portfel, ekwipunek, domy, śmierć, tutorial, imię, księga, questy, skrzynie, troll i depozyt, pozyskane obiekty, most, odkrycia, odznaki) zapisuje się po 300 ms; sam upływ czasu, życie i pozycja w lesie - najwyżej co 5 s; `pagehide`, `beforeunload` i ukrycie karty wymuszają zapis.
- Zapis niezmieniony od ostatniego (bez `savedAt`) jest pomijany; zapis, z którego wystartowała sesja, nie jest powtarzany.
- Błąd zapisu pokazuje komunikat w grze (nie przerywa rozgrywki).

## Ekrany startowe i reset

- Brak zapisu: ekran imienia. Poprawny zapis: ekran „Kontynuuj / Nowa gra” (komunikat, gdy użyto kopii lub zmigrowano format). Problem z zapisem (uszkodzony, nowszy format, nieudana migracja, niezgodny świat): ekran z opisem, „Spróbuj ponownie” i (poza nowszym formatem) „Zacznij nową grę” - stare dane zostają w archiwum.
- Reset dla testów: `?reset=1` w adresie (czyści wszystko, usuwa parametr) oraz przycisk „dev: reset zapisu” (tylko w trybie deweloperskim).
