# Troll: testowe spotkanie z graczem (animacje i dialog)

Stan: 19 października 2026. Etap "integracja animowanego trolla z zachowaniem NPC i testowym dialogiem". To jest **test animacji i zachowania**, nie zagadka T1: przyciski dialogu nie zmieniają questa, skrzyni, ekwipunku, nagród ani zapisu gry. Model, klipy i koszt renderowania: [modele-skrzynia-troll.md](modele-skrzynia-troll.md).

## Maszyna stanów

Logika jest w `src/lib/npc/encounter.ts` (czysta, bez Three.js i bez stanu gry); `TrollNpc` wykonuje jej polecenia (patrol, obrót, animacje). Wejście to wyłącznie odległość od gracza (bez pola widzenia i raycastów), czas i zdarzenia końca klipów.

| Stan | Wejście | Zachowanie i animacja |
| --- | --- | --- |
| `patrol` | start; gracz > 22 m (po 1,5 s) | Patrol z trasy W1b: `Idle` na postojach, `Walk` w marszu; ruch tylko z patrolu (klip chodzi w miejscu). |
| `alert` | gracz < 20 m (po 0,3 s) | Patrol przerwany, troll hamuje (ok. 0,3 s), `Walk -> Idle` płynnie (0,3 s); po ok. 1,2 s w spoczynku `Nervous` (7 s), potem `Idle`, `Nervous` powtarza się co 3,5-7 s. Bez Surprised i dialogu. |
| `notice` | gracz < 5 m | Troll staje i płynnie obraca się całym ciałem ku graczowi (max 1,6 rad/s, łagodny start i hamowanie, ok. 2 s na pół obrotu). Gracz, który cofnie się w trakcie obrotu poza 7 m, nie wywołuje reakcji. |
| `surprised` | w spoczynku, kąt do gracza < 0,12 rad | `Surprised` raz, od początku do końca (4,03 s); odległość jej nie przerywa. |
| `dialog` | zdarzenie końca klipu `Surprised` | Okno testowe; troll w `Idle`, patrzy na gracza. |
| `celebrate` | wynik PRAWIDŁOWY | `Happy` (3,6 s) raz, płynnie `Dance` (14,8 s) raz, potem `Idle`; stoi w miejscu spotkania. |
| `angry` | wynik ZŁY | `Angry` (3,3 s) raz bez przerwania, potem `Idle`. |

Po `celebrate` i `angry` troll wraca do `alert` (gracz < 22 m) albo `patrol` (dalej). Zamknięcie okna Esc (wynik `dismissed`) wraca tak samo, bez żadnej animacji.

Histereza i zwłoki: wejście w alert < 20 m po 0,3 s, wyjście > 22 m po 1,5 s; odległość chwiejąca się wokół 20 m nie włącza alertu (zwłoka liczy się od nowa).

### Raz na spotkanie

Po `Surprised` spotkanie jest "rozbrojone": stanie przy trollu po dialogu (też minutę) nie otwiera okna ponownie. Uzbraja je ponownie dopiero oddalenie się o > 10 m na 0,5 s i ponowne zbliżenie < 5 m, albo świadoma rozmowa (E w zasięgu 4,5 m, tylko poza sekwencją), albo przycisk testowy "Powtórz spotkanie" (F4 przy włączonym F3).

### Sekwencje nieprzerywalne

`Surprised`, dialog, `Happy`/`Dance` i `Angry` nie są przerywane zmianami odległości. Przerywalny jest tylko `Nervous` (płynnie, gdy gracz odejdzie albo podejdzie bliżej). Żadne czasy reakcji nie są liczone `setTimeout`: o końcu klipu decyduje zdarzenie `finished` miksera.

## Kontroler animacji

`src/lib/npc/animator.ts` (`NpcAnimator`): rejestr klipów i stanów z danych (`TROLL_STATES` w `troll.ts`: id stanu, klip, pętla, czas przejścia, `interruptible`), `setBase`, `trigger(id, { then })`, `cancel`, `onFinished`, `dispose`. Wagi przejść liczy sam: suma zawsze 1 (bez dwóch pełnych animacji i skoku do T-pose także, gdy przejście przerwie następne). `dispose` usuwa nasłuch `finished`, zatrzymuje akcje i czyści pamięć miksera.

## Oddzielenie od logiki questa

- Okno `TrollTestDialog.tsx` nie wysyła komend do silnika. Jedyny skutek wyboru to `renderer.resolveNpcDialog("correct" | "wrong" | "dismissed")` -> animacja trolla.
- Test `npc/isolation.test.ts`: moduły trolla i okno nie importują silnika, zapisu, questów ani zawartości gry; trzy pełne spotkania (każdy wynik) nie zmieniają SaveV2.
- Wymiana na T1: prawdziwy system zagadek wywołuje to samo `resolveDialog` (np. poprawna odpowiedź -> `correct`), a zamiast `TrollTestDialog` renderuje własne okno; kontroler animacji i maszyna spotkania zostają.
- Silnik ma już dialog trolla (`troll.talk`, `riddle.answer`, konfiskata); w UI lasu nie ma jeszcze celu E dla trolla, więc testowe okno z nim nie koliduje. Gdy T1 zostanie podpięte, `E` powinno prowadzić do jednego z nich (decyzja przy T1).

## Pauza, wskaźnik myszy, Esc

- Okno otwiera się po `Surprised`: `useGamePause("ui.panel", "ui.troll_test")` zatrzymuje zegar gry, sterowanie gracza jest wstrzymane (`setSuspended`), mysz jest zwalniana (`exitPointerLock`). Troll dalej się animuje (Idle) i patrzy na gracza.
- Esc zamyka okno bez wyboru (`dismissed`) i nie opuszcza lasu (istniejący strażnik Esc; po zamknięciu 0,7 s zwłoki). Kliknięcie poza oknem go nie zamyka. W oknie E i M nie działają.
- Wyjście z lasu w trakcie animacji lub dialogu: odmontowanie widoku sprząta pauzę, a `renderer.dispose` wywołuje `TrollNpc.dispose` (mikser, nasłuch, zasoby); po tym nie przychodzi żadne zdarzenie.

## Tryb deweloperski (F3)

Sekcja "NPC troll": dystans do trolla, stan zachowania, klip (i stan animacji) z czasem i długością, wagi przejścia, dialog otwarty/zamknięty, liczba spotkań, "gotowy na zauważenie"/"rozbrojony", stan patrolu i pozycja, statystyki modelu. Przycisk "Powtórz spotkanie (F4)" uzbraja spotkanie bez resetowania gry (działa poza sekwencją).

## Instrukcja ręcznego testu w przeglądarce

1. Uruchom grę (`npm run dev`, port 43217), rozpocznij nową grę (albo Kontynuuj) i wejdź do lasu z mapy miasta. Naciśnij F3 (diagnostyka). Troll stoi >= 25 m od punktu startu, 3,4 m od skrzyni ze schematem; jego pozycję i dystans podaje F3.
2. **Patrol (> 20 m)**: podejdź na ok. 25-30 m. Troll chodzi w promieniu ok. 2,6 m od kotwicy i robi postoje; w F3 stan `patrol`, animacja `Walk` w marszu i `Idle` na postoju. Stopy nie powinny ślizgać się po ziemi.
3. **Alert (< 20 m)**: przekrocz 20 m. Troll łagodnie się zatrzymuje, `Walk -> Idle`, po chwili `Nervous`, potem znów `Idle` i powtórki. W F3 stan `alert`; przy jednoczesnym przejściu wagi pokazują dwa klipy sumujące się do 1. Odejdź poza 22 m: po krótkiej zwłoce wraca patrol.
4. **Zauważenie (< 5 m)**: podejdź na < 5 m. Troll staje, obraca się całym ciałem ku tobie (bez skoku), potem `Surprised` raz do końca (ok. 4 s) i otwiera się okno z tekstem "Ho, ho! Kto ośmiela się zakłócać mój spokój? Myślisz, że potrafisz rozwiązać moją zagadkę?" z przyciskami PRAWIDŁOWY i ZŁY. Mysz zostaje zwolniona, zegar gry stoi, troll patrzy na ciebie w `Idle`.
5. **PRAWIDŁOWY**: okno zamyka się, `Happy`, płynnie `Dance` (ok. 15 s) do końca, potem `Idle`. W tym czasie możesz chodzić: animacje nie są przerywane. Po tańcu stan `alert` (blisko) lub `patrol` (daleko); okno nie otwiera się samo.
6. **ZŁY** (po F4 albo po oddaleniu się > 10 m i powrocie): `Angry` raz do końca, potem `Idle`. Nic nie jest zabierane, gracz nie jest przenoszony, nie ma blokady do następnego dnia.
7. **Esc** w oknie: zamyka bez reakcji, troll wraca do `alert`; stanie obok trolla go nie otwiera ponownie.
8. **Powtórka**: F4 (lub przycisk w F3, po Esc zwolnieniu myszy) uzbraja spotkanie bez resetowania gry; E w odległości do 4,5 m też (pojawia się podpowiedź "E Porozmawiaj z trollem (test)").
9. Sprawdź, że po wszystkim ekwipunek, zadanie "Most" i skrzynia ze schematem są bez zmian, a po odświeżeniu strony (Kontynuuj) troll znów jest w stanie `patrol`.
10. Opuść las w trakcie `Dance` lub `Surprised` (Esc, "Wróć do miasta") i wróć: bez błędów w konsoli, animacje działają od początku.

## Ryzyka i uwagi

- Agent nie uruchamia przeglądarki: wygląd (poza, skala, obrót, przejścia, `Dance`), czytelność okna i FPS ocenia autor. Dane liczbowe z testów (kontakt stóp, długości klipów, płynność obrotu) nie zastępują oceny wizualnej.
- Pamięć GPU trolla (ok. 64 MiB na 3 atlasy 2048) to największy koszt; do rozważenia osobno obniżenie rozdzielczości na LOW.
- Teren ma drobne nierówności: podczas płynnych przejść stopa może na chwilę zejść o kilka cm pod teren (test dopuszcza < 10 cm).
- Troll patrzy na gracza przez obrót całego ciała (bez osobnej animacji głowy); jeśli poza `Idle` zapozuje się bokiem do patrzącego gracza, to efekt ruchu klipu, nie błąd obrotu.
- Spotkanie uzbraja się też, gdy gracz oddali się w trakcie `Dance` na > 10 m: po powrocie < 5 m troll znów zauważy gracza (zgodnie z zasadą "kolejne spotkanie po oddaleniu i zbliżeniu").
