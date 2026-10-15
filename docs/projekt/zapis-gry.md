# Zapis gry (E1) - stan implementacji

Opis tego, co działa w kodzie po etapie E1. Docelowy, pełny kształt zapisu (questy, skrzynie, depozyt trolla, minimapa) jest w [model-danych.md](model-danych.md); dochodzi on w kolejnych wersjach formatu (SaveV2+), każda z migracją.

## Warstwy

| Moduł | Rola |
| --- | --- |
| `src/lib/game/save/schema.ts` | typ `SaveV1`, `CURRENT_SAVE_VERSION`, lista dozwolonych kluczy |
| `save/serialize.ts` | `serializeState(state, savedAt)`: whitelista pól trwałych (nowe pole stanu nie trafia do zapisu samo) |
| `save/hydrate.ts` | `hydrateState(save)`: stan gry z zapisu; dane sesji startują od zera |
| `save/validate.ts` | `validateSaveV1`: ręczna walidacja kształtu, zakresów i niezmienników (bez bibliotek) |
| `save/codec.ts` | koperta `{ format, envelope, checksum, payload }`; suma kontrolna nad kanonicznym JSON |
| `save/migrate.ts` | `migratePayload`, `MIGRATIONS` (puste: v1 to pierwsza wersja), `SchemaConfig` |
| `save/store.ts` | interfejs `SaveStore` + `LocalStorageSaveStore` |
| `save/loader.ts` | `verifyWorld`, `loadGame`: magazyn + zgodność świata (odcisk generatora) |
| `save/autosave.ts` | `Autosaver`: debounce istotnych zmian, interwał dla zmian ciągłych, `flush` przy zamknięciu |
| `save/newGame.ts` | `createNewGameParams`: seed i `saveId` z `crypto.getRandomValues` (jedyne miejsce losowości) |
| `src/lib/game/world/` | rejestr wersji generatora, odcisk, zamrożony generator v1 (domy) |

## SaveV1 (to, co jest dziś trwałe)

`version`, `saveId`, `savedAt` (informacyjnie), `world { seed, genVersion, fingerprint, genHistory }`, `time.elapsed`, `player { name, health, drainAcc, dead, deaths, wallet, slots, selected, forestPose }`, `tutorial.done`, `houses`.

Nie jest zapisywane: widok (`view`), komunikaty, stos pauz, panele, jakiekolwiek obiekty Three/refy. Po wczytaniu gracz zawsze trafia na mapę świata; wejście do lasu przywraca zapisaną pozycję i kierunek (`forestPose`, zapisywane co 2 s i przy wyjściu z lasu).

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

`MIGRATIONS[N]` przekształca payload vN w vN+1 (czysta funkcja na głębokiej kopii; wynik musi mieć `version = N+1`). Przed migracją oryginał trafia do `premigration`; po migracji dane przechodzą pełną walidację; migrowany zapis jest zapisywany zwykłą ścieżką (oryginał ląduje w `.bak`). Błąd na dowolnym etapie (brak kroku, wyjątek, zła wersja, niepoprawny wynik, brak miejsca na kopię) kończy się `migration_failed`, a zapis pozostaje nietknięty. Zgodność ze starymi zapisami: przed E1 gra niczego nie zapisywała, więc nie ma zapisów legacy do migracji.

## Interfejs `SaveStore`

```ts
interface SaveStore {
  load(): Promise<LoadResult>;
  save(save: SaveV1): Promise<SaveOutcome>;
  reset(): Promise<void>;
}
```

Metody są asynchroniczne, żeby można było podstawić IndexedDB lub serwer. Implementacja `localStorage` wykonuje zapis synchronicznie w chwili wywołania (potrzebne przy `pagehide`); backend asynchroniczny musi sam zadbać o dokończenie zapisu przy zamykaniu karty.

## Autosave w aplikacji (`GameApp`)

- Pierwszy zapis po starcie gry; zmiana istotna (portfel, ekwipunek, domy, śmierć, tutorial, imię) zapisuje się po 300 ms; sam upływ czasu, życie i pozycja w lesie - najwyżej co 5 s; `pagehide`, `beforeunload` i ukrycie karty wymuszają zapis.
- Zapis niezmieniony od ostatniego (bez `savedAt`) jest pomijany; zapis, z którego wystartowała sesja, nie jest powtarzany.
- Błąd zapisu pokazuje komunikat w grze (nie przerywa rozgrywki).

## Ekrany startowe i reset

- Brak zapisu: ekran imienia. Poprawny zapis: ekran „Kontynuuj / Nowa gra” (komunikat, gdy użyto kopii lub zmigrowano format). Problem z zapisem (uszkodzony, nowszy format, nieudana migracja, niezgodny świat): ekran z opisem, „Spróbuj ponownie” i (poza nowszym formatem) „Zacznij nową grę” - stare dane zostają w archiwum.
- Reset dla testów: `?reset=1` w adresie (czyści wszystko, usuwa parametr) oraz przycisk „dev: reset zapisu” (tylko w trybie deweloperskim).
