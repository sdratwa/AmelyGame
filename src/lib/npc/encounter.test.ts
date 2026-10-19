import { beforeEach, describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/game/core/rng";
import { ENCOUNTER, TrollEncounter, type EncounterBody } from "./encounter";

/** Postać zastępcza: zapisuje polecenia i pozwala testowi sterować spoczynkiem, obrotem i końcem animacji. */
class FakeBody implements EncounterBody {
  patrolRunning = true;
  facing = false;
  atRest = false;
  yawError = Math.PI;
  base: "walk" | "idle" = "walk";
  current: string | null = null;
  chain: string[] = [];
  played: string[] = [];
  cancelled = 0;

  get reacting() {
    return this.current !== null;
  }

  get locked() {
    return this.current !== null && this.current !== "nervous";
  }

  runPatrol() {
    this.patrolRunning = true;
    this.facing = false;
  }

  stopPatrol(face: boolean) {
    this.patrolRunning = false;
    this.facing = face;
  }

  setBase(state: "walk" | "idle") {
    this.base = state;
  }

  play(state: string, then: readonly string[] = []) {
    if (this.reacting) return false;
    this.current = state;
    this.chain = [...then];
    this.played.push(state);
    return true;
  }

  cancelReaction() {
    if (this.current !== null && !this.locked) this.cancelled++;
    if (!this.locked) this.current = null;
    return !this.reacting;
  }

  count(state: string) {
    return this.played.filter((s) => s === state).length;
  }
}

const DT = 1 / 60;
let body: FakeBody;
let encounter: TrollEncounter;
let dialogRequests: number;
let changes: string[];
let distance: number;

const step = (seconds: number, d = distance) => {
  distance = d;
  for (let i = 0; i < Math.round(seconds / DT); i++) encounter.update(DT, { distance: d });
};

/** Kończy bieżący klip jak animator: po ostatnim w łańcuchu przychodzi zdarzenie dla encounter. */
const finishClip = () => {
  const id = body.current!;
  const next = body.chain.shift();
  body.current = next ?? null;
  encounter.animationFinished(id);
};

/** Stoi i patrzy na gracza: warunek, po którym wolno zagrać Surprised. */
const settle = () => {
  body.atRest = true;
  body.yawError = 0;
};

beforeEach(() => {
  body = new FakeBody();
  dialogRequests = 0;
  changes = [];
  distance = 100;
  encounter = new TrollEncounter(body, mulberry32(7), {
    onDialogRequested: () => dialogRequests++,
    onStateChange: (from, to) => changes.push(`${from}>${to}`),
  });
});

const toDialog = () => {
  step(1, 15);
  expect(encounter.state).toBe("alert");
  body.atRest = true;
  step(0.5, 3);
  expect(encounter.state).toBe("notice");
  settle();
  step(0.1, 3);
  expect(encounter.state).toBe("surprised");
  finishClip();
  expect(encounter.state).toBe("dialog");
};

describe("encounter: patrol i alert (20 m)", () => {
  it("daleko od gracza troll patroluje i niczego nie odtwarza", () => {
    step(30, 60);
    expect(encounter.state).toBe("patrol");
    expect(body.patrolRunning).toBe(true);
    expect(body.played).toEqual([]);
  });

  it("poniżej 20 m patrol jest przerwany dopiero po krótkiej zwłoce, a troll przestaje iść (bez obrotu ku graczowi)", () => {
    step(0.2, ENCOUNTER.alertEnter - 0.5);
    expect(encounter.state).toBe("patrol");
    step(0.3, ENCOUNTER.alertEnter - 0.5);
    expect(encounter.state).toBe("alert");
    step(0.1, ENCOUNTER.alertEnter - 0.5);
    expect(body.patrolRunning).toBe(false);
    expect(body.facing).toBe(false);
  });

  it("odległość chwiejąca się wokół 20 m nie włącza alertu (zwłoka liczy się od nowa)", () => {
    for (let i = 0; i < 600; i++) encounter.update(DT, { distance: i % 2 === 0 ? 19.9 : 20.1 });
    expect(encounter.state).toBe("patrol");
  });

  it("histereza: między 20 a 22 m alert trwa, powyżej 22 m po zwłoce wraca patrol", () => {
    step(1, 15);
    expect(encounter.state).toBe("alert");
    step(10, 21);
    expect(encounter.state).toBe("alert");
    step(1, 23);
    expect(encounter.state).toBe("alert");
    step(0.8, 23);
    expect(encounter.state).toBe("patrol");
    expect(body.patrolRunning).toBe(true);
    expect(changes).toEqual(["patrol>alert", "alert>patrol"]);
  });

  it("krótkie wyjście poza 22 m (poniżej zwłoki) nie kończy alertu", () => {
    step(1, 15);
    step(1.2, 24);
    step(0.1, 18);
    step(1.2, 24);
    expect(encounter.state).toBe("alert");
  });

  it("Nervous gra dopiero, gdy troll stoi, po krótkiej chwili, a potem co jakiś czas (nigdy w marszu)", () => {
    step(1, 15);
    body.atRest = false;
    step(5, 15);
    expect(body.played).toEqual([]);
    body.atRest = true;
    step(ENCOUNTER.firstNervousDelay - 0.2, 15);
    expect(body.count("nervous")).toBe(0);
    step(0.4, 15);
    expect(body.count("nervous")).toBe(1);
    expect(body.base).toBe("idle");
    finishClip();
    step(ENCOUNTER.nervousGapMin - 0.2, 15);
    expect(body.count("nervous")).toBe(1);
    step(ENCOUNTER.nervousGapMax - ENCOUNTER.nervousGapMin + 0.5, 15);
    expect(body.count("nervous")).toBe(2);
  });

  it("w alercie nie ma Surprised ani dialogu", () => {
    step(60, 12);
    expect(encounter.state).toBe("alert");
    expect(body.count("surprised")).toBe(0);
    expect(dialogRequests).toBe(0);
  });

  it("powrót do patrolu przerywa Nervous (płynnie) i nie zostawia reakcji", () => {
    step(1, 15);
    body.atRest = true;
    step(2, 15);
    expect(body.current).toBe("nervous");
    step(2, 30);
    expect(encounter.state).toBe("patrol");
    expect(body.current).toBeNull();
  });
});

describe("encounter: zauważenie gracza (5 m)", () => {
  it("poniżej 5 m troll staje i obraca się; Surprised startuje dopiero po zatrzymaniu i obrocie ku graczowi", () => {
    step(1, 15);
    step(0.1, 4.5);
    expect(encounter.state).toBe("notice");
    expect(body.facing).toBe(true);
    expect(body.patrolRunning).toBe(false);
    step(1, 4.5);
    expect(body.count("surprised")).toBe(0);
    body.atRest = true;
    step(1, 4.5);
    expect(body.count("surprised")).toBe(0);
    body.yawError = 0.5;
    step(1, 4.5);
    expect(body.count("surprised")).toBe(0);
    body.yawError = ENCOUNTER.facingTolerance - 0.01;
    step(0.1, 4.5);
    expect(body.count("surprised")).toBe(1);
    expect(encounter.state).toBe("surprised");
  });

  it("można zauważyć gracza także z patrolu (bez alertu), gdy ten wejdzie od razu blisko", () => {
    step(0.1, 4);
    expect(encounter.state).toBe("notice");
  });

  it("Surprised gra raz od początku do końca, a dialog otwiera się dopiero na zdarzenie końca klipu (nie po czasie)", () => {
    step(1, 15);
    settle();
    step(1, 4);
    expect(encounter.state).toBe("surprised");
    step(60, 4);
    expect(encounter.state).toBe("surprised");
    expect(dialogRequests).toBe(0);
    expect(body.count("surprised")).toBe(1);
    finishClip();
    expect(encounter.state).toBe("dialog");
    expect(dialogRequests).toBe(1);
    expect(encounter.dialogActive).toBe(true);
  });

  it("w dialogu troll stoi i patrzy na gracza (stan podstawowy: idle), a odległość nie zmienia stanu", () => {
    toDialog();
    step(5, 3);
    expect(body.facing).toBe(true);
    expect(body.base).toBe("idle");
    step(5, 30);
    expect(encounter.state).toBe("dialog");
    expect(dialogRequests).toBe(1);
  });

  it("gracz, który cofnie się w trakcie obrotu (> 7 m), nie wywołuje reakcji", () => {
    step(1, 15);
    step(0.2, 4);
    expect(encounter.state).toBe("notice");
    step(0.2, 8);
    expect(encounter.state).toBe("alert");
    expect(body.count("surprised")).toBe(0);
    expect(encounter.isArmed).toBe(true);
  });

  it("reakcja zdarza się raz na spotkanie: stanie przy trollu po dialogu nie otwiera go ponownie, nawet przez minutę", () => {
    toDialog();
    expect(encounter.encounterCount).toBe(1);
    expect(encounter.resolveDialog("dismissed")).toBe(true);
    step(60, 2);
    step(60, 4.9);
    expect(dialogRequests).toBe(1);
    expect(body.count("surprised")).toBe(1);
    expect(encounter.encounterCount).toBe(1);
    expect(encounter.state).toBe("alert");
    expect(encounter.isArmed).toBe(false);
  });

  it("kolejne spotkanie po oddaleniu się (> 10 m przez 0,5 s) i ponownym zbliżeniu", () => {
    toDialog();
    encounter.resolveDialog("dismissed");
    step(2, 8);
    expect(encounter.isArmed).toBe(false);
    step(0.3, 12);
    expect(encounter.isArmed).toBe(false);
    step(0.4, 12);
    expect(encounter.isArmed).toBe(true);
    body.atRest = false;
    body.yawError = Math.PI;
    step(0.2, 3);
    expect(encounter.state).toBe("notice");
    settle();
    step(0.2, 3);
    expect(encounter.encounterCount).toBe(2);
    finishClip();
    expect(dialogRequests).toBe(2);
  });

  it("restart (dev) i E z bliska uzbrajają spotkanie bez resetowania gry; z daleka E nic nie robi", () => {
    toDialog();
    encounter.resolveDialog("dismissed");
    step(1, 3);
    expect(encounter.canTalk).toBe(true);
    expect(encounter.requestTalk()).toBe(true);
    body.yawError = Math.PI;
    step(0.2, 3);
    expect(encounter.state).toBe("notice");
    expect(encounter.canTalk).toBe(false);

    const far = new TrollEncounter(new FakeBody(), mulberry32(1));
    far.update(DT, { distance: 12 });
    expect(far.canTalk).toBe(false);
    expect(far.requestTalk()).toBe(false);
  });

  it("restart jest odrzucany w trakcie sekwencji spotkania", () => {
    toDialog();
    expect(encounter.restart()).toBe(false);
    expect(encounter.requestTalk()).toBe(false);
  });
});

describe("encounter: wynik dialogu", () => {
  it("poprawny: Happy, potem Dance po kolei (łańcuch), a zwykłe zmiany odległości ich nie przerywają", () => {
    toDialog();
    expect(encounter.resolveDialog("correct")).toBe(true);
    expect(body.played.slice(-1)).toEqual(["happy"]);
    expect(body.chain).toEqual(["dance"]);
    expect(encounter.state).toBe("celebrate");
    for (const d of [2, 30, 6, 80, 3]) {
      step(1, d);
      expect(encounter.state).toBe("celebrate");
      expect(body.patrolRunning).toBe(false);
    }
    expect(body.cancelled).toBe(0);
    expect(body.current).toBe("happy");
    finishClip();
    expect(body.current).toBe("dance");
    expect(encounter.state).toBe("celebrate");
    finishClip();
    expect(body.current).toBeNull();
    expect(encounter.state).toBe("alert");
    expect(dialogRequests).toBe(1);
  });

  it("po Dance z daleka (> 22 m) wraca patrol, z bliska alert; dialog się nie powtarza", () => {
    toDialog();
    encounter.resolveDialog("correct");
    step(1, 40);
    finishClip();
    finishClip();
    expect(encounter.state).toBe("patrol");
    step(60, 40);
    expect(dialogRequests).toBe(1);
    expect(body.count("surprised")).toBe(1);
  });

  it("zły: Angry raz, bez przerwania, potem alert albo patrol zależnie od odległości; bez pętli dialogu", () => {
    toDialog();
    expect(encounter.resolveDialog("wrong")).toBe(true);
    expect(body.played.slice(-1)).toEqual(["angry"]);
    expect(encounter.state).toBe("angry");
    step(5, 40);
    expect(encounter.state).toBe("angry");
    expect(body.current).toBe("angry");
    finishClip();
    expect(encounter.state).toBe("patrol");
    step(30, 2);
    expect(dialogRequests).toBe(1);
    expect(body.count("angry")).toBe(1);
  });

  it("zły z bliska: po Angry troll jest w alercie, nie otwiera dialogu i nie gniewa się drugi raz", () => {
    toDialog();
    encounter.resolveDialog("wrong");
    finishClip();
    expect(encounter.state).toBe("alert");
    step(60, 2);
    expect(dialogRequests).toBe(1);
    expect(body.count("angry")).toBe(1);
    expect(body.count("surprised")).toBe(1);
  });

  it("zamknięcie dialogu bez wyboru (Esc) nie odtwarza żadnej reakcji", () => {
    toDialog();
    const before = body.played.length;
    expect(encounter.resolveDialog("dismissed")).toBe(true);
    expect(body.played.length).toBe(before);
    expect(encounter.state).toBe("alert");
  });

  it("wynik działa tylko w dialogu i tylko raz", () => {
    expect(encounter.resolveDialog("correct")).toBe(false);
    toDialog();
    expect(encounter.resolveDialog("correct")).toBe(true);
    expect(encounter.resolveDialog("wrong")).toBe(false);
    expect(encounter.resolveDialog("dismissed")).toBe(false);
  });

  it("jeśli animacji nie da się zagrać, dialog zostaje otwarty (nic nie ginie po cichu)", () => {
    toDialog();
    body.current = "locked-other";
    expect(encounter.resolveDialog("correct")).toBe(false);
    expect(encounter.state).toBe("dialog");
  });
});

describe("encounter: gniew z gry i sprzątanie", () => {
  it("reactAngry działa poza sekwencją spotkania, a w sekwencji jest odrzucany", () => {
    expect(encounter.reactAngry()).toBe(true);
    expect(encounter.state).toBe("angry");
    expect(encounter.reactAngry()).toBe(false);
    finishClip();
    expect(encounter.state).toBe("patrol");
  });

  it("reactAngry nie psuje dialogu", () => {
    toDialog();
    expect(encounter.reactAngry()).toBe(false);
    expect(encounter.state).toBe("dialog");
  });

  it("po dispose nic się nie dzieje: brak zdarzeń końca klipu, brak dialogu, brak zmian stanu", () => {
    step(1, 15);
    settle();
    step(1, 4);
    expect(encounter.state).toBe("surprised");
    encounter.dispose();
    const log = [...changes];
    finishClip();
    step(5, 3);
    expect(dialogRequests).toBe(0);
    expect(changes).toEqual(log);
    expect(encounter.resolveDialog("correct")).toBe(false);
    expect(encounter.reactAngry()).toBe(false);
    expect(encounter.restart()).toBe(false);
  });

  it("zmiany stanów całego spotkania: patrol, alert, notice, surprised, dialog, celebrate, alert", () => {
    toDialog();
    encounter.resolveDialog("correct");
    finishClip();
    finishClip();
    expect(changes).toEqual(["patrol>alert", "alert>notice", "notice>surprised", "surprised>dialog", "dialog>celebrate", "celebrate>alert"]);
  });
});
