import { INVENTORY_SLOTS, MAX_HEALTH } from "../core/constants";
import { isForestPose } from "../core/pose";
import { isItemId, type ItemStack } from "../content/items";
import { QUEST_BY_ID } from "../content/quests";
import { inventoryProblems } from "../systems/containers";
import { CHEST_CONTENTS } from "../systems/forestQuest";
import { FINGERPRINT_PATTERN } from "../world/fingerprint";
import { isHexColor } from "@/lib/character/appearance";
import type { SaveV4 } from "./schema";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; problems: string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isUint32 = (v: unknown): v is number => isInt(v) && (v as number) >= 0 && (v as number) <= 0xffff_ffff;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SAVE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_HOUSES = 64;
const MAX_NAME = 40;
const MAX_HARVESTED = 5000;
const KNOWN_REGIONS = ["region.beyond_bridge"];
const KNOWN_BADGES = ["badge.explorer"];
const TROLL_PHASES = ["unmet", "confronted", "solved"];

type Stack = ItemStack;

function checkStacks(value: unknown, path: string, bad: (p: string, why: string) => void, allowNull: boolean): boolean {
  if (!Array.isArray(value)) {
    bad(path, "oczekiwano tablicy");
    return false;
  }
  let ok = true;
  value.forEach((s, i) => {
    if (s === null && allowNull) return;
    if (!isObj(s) || !isItemId(s.id) || !isInt(s.count) || (s.count as number) < 1) {
      bad(`${path}[${i}]`, "niepoprawny stos przedmiotów");
      ok = false;
    }
  });
  return ok;
}

/** ID z rejestru: `hair.01` albo `hair_tripo_short_01` (małe litery, cyfry, `_` i `.`); sprawdzenie obecności w rejestrze robi `normalizeAppearance`. */
const ITEM_ID = /^[a-z][a-z0-9_.]{1,63}$/;

/**
 * Wygląd: sprawdzamy kształt i bezpieczeństwo (typy, kolory, format ID), a NIE istnienie elementu w rejestrze: nieznane
 * ID z innej wersji gry nie psuje zapisu, tylko daje puste miejsce przy wczytaniu (`normalizeAppearance`).
 */
function checkAppearance(value: unknown, bad: (p: string, why: string) => void): void {
  if (!isObj(value)) return bad("player.appearance", "oczekiwano obiektu");
  if (!isStr(value.baseId) || value.baseId.length === 0 || value.baseId.length > 40) bad("player.appearance.baseId", "niepoprawna postać bazowa");
  for (const k of ["hairStyleId", "topId", "bottomId"] as const) {
    const v = value[k];
    if (v !== null && (!isStr(v) || !ITEM_ID.test(v))) bad(`player.appearance.${k}`, "oczekiwano ID elementu lub null");
  }
  for (const k of ["hairColor", "topColor", "bottomColor"] as const) {
    if (!isHexColor(value[k])) bad(`player.appearance.${k}`, "oczekiwano koloru #rrggbb");
  }
}

/** Walidacja ręczna (bez zewnętrznych bibliotek): sprawdza strukturę, typy i niezmienniki (ekwipunek, zadania, skrzynie). */
export function validateSaveV4(input: unknown): ValidationResult<SaveV4> {
  const problems: string[] = [];
  const bad = (path: string, why: string) => problems.push(`${path}: ${why}`);

  if (!isObj(input)) return { ok: false, problems: ["save: oczekiwano obiektu"] };
  if (input.version !== 4) bad("version", "oczekiwano 4");
  if (!isStr(input.saveId) || !SAVE_ID.test(input.saveId)) bad("saveId", "niepoprawny identyfikator");
  if (!isNum(input.savedAt) || input.savedAt < 0) bad("savedAt", "oczekiwano liczby >= 0");

  const world = input.world;
  if (!isObj(world)) bad("world", "oczekiwano obiektu");
  else {
    if (!isUint32(world.seed)) bad("world.seed", "oczekiwano uint32");
    if (!isInt(world.genVersion) || (world.genVersion as number) < 1) bad("world.genVersion", "oczekiwano liczby całkowitej >= 1");
    if (!isStr(world.fingerprint) || !FINGERPRINT_PATTERN.test(world.fingerprint)) bad("world.fingerprint", "niepoprawny format");
    if (!Array.isArray(world.genHistory)) bad("world.genHistory", "oczekiwano tablicy");
    else {
      world.genHistory.forEach((h, i) => {
        if (!isObj(h) || !isInt(h.version) || !isNum(h.atElapsed) || h.atElapsed < 0) {
          bad(`world.genHistory[${i}]`, "niepoprawny wpis");
        }
      });
    }
  }

  const time = input.time;
  if (!isObj(time) || !isNum(time.elapsed) || time.elapsed < 0) bad("time.elapsed", "oczekiwano liczby >= 0");
  const elapsed = isObj(time) && isNum(time.elapsed) ? time.elapsed : 0;

  let slotsOk = false;
  let ledgerOk = false;
  const player = input.player;
  if (!isObj(player)) bad("player", "oczekiwano obiektu");
  else {
    if (!isStr(player.name) || !player.name.trim() || player.name.length > MAX_NAME) bad("player.name", "niepoprawne imię");
    if (!isInt(player.health) || player.health < 0 || player.health > MAX_HEALTH) bad("player.health", `oczekiwano 0..${MAX_HEALTH}`);
    if (!isNum(player.drainAcc) || player.drainAcc < -1e-6 || player.drainAcc > 1 + 1e-6) bad("player.drainAcc", "oczekiwano 0..1");
    if (typeof player.dead !== "boolean") bad("player.dead", "oczekiwano boolean");
    else if (isInt(player.health) && player.dead !== (player.health === 0)) bad("player.dead", "niespójne z player.health");
    if (!isInt(player.deaths) || player.deaths < 0) bad("player.deaths", "oczekiwano liczby całkowitej >= 0");
    if (!isInt(player.wallet) || player.wallet < 0) bad("player.wallet", "oczekiwano liczby całkowitej >= 0");
    if (!Array.isArray(player.slots) || player.slots.length !== INVENTORY_SLOTS) bad("player.slots", `oczekiwano tablicy ${INVENTORY_SLOTS} miejsc`);
    else {
      slotsOk = checkStacks(player.slots, "player.slots", bad, true);
    }
    const ledger = player.ledger;
    if (!isObj(ledger) || !isObj(ledger.gained) || !isObj(ledger.spent)) bad("player.ledger", "oczekiwano { gained, spent }");
    else {
      ledgerOk = true;
      for (const part of ["gained", "spent"] as const) {
        for (const [id, n] of Object.entries(ledger[part] as Obj)) {
          if (!isItemId(id) || !isInt(n) || n < 0) {
            bad(`player.ledger.${part}.${id}`, "niepoprawny wpis księgi");
            ledgerOk = false;
          }
        }
      }
    }
    if (!isInt(player.selected) || player.selected < 0 || player.selected >= INVENTORY_SLOTS) bad("player.selected", "poza zakresem");
    if (player.forestPose !== null && !isForestPose(player.forestPose)) bad("player.forestPose", "niepoprawna pozycja");
    checkAppearance(player.appearance, bad);
  }

  const tutorial = input.tutorial;
  if (!isObj(tutorial) || typeof tutorial.done !== "boolean") bad("tutorial.done", "oczekiwano boolean");

  const houses = input.houses;
  if (!Array.isArray(houses) || houses.length > MAX_HOUSES) bad("houses", "oczekiwano tablicy domów");
  else {
    const ids = new Set<string>();
    houses.forEach((h, i) => {
      const p = `houses[${i}]`;
      if (!isObj(h)) return bad(p, "oczekiwano obiektu");
      if (!isStr(h.id) || !h.id) bad(`${p}.id`, "brak id");
      else if (ids.has(h.id)) bad(`${p}.id`, "duplikat id");
      else ids.add(h.id);
      if (!isStr(h.name) || !h.name) bad(`${p}.name`, "brak nazwy");
      if (!isInt(h.level) || h.level < 1 || h.level > 4) bad(`${p}.level`, "oczekiwano 1..4");
      if (!isInt(h.price) || h.price <= 0) bad(`${p}.price`, "niepoprawna cena");
      if (!isStr(h.phone) || !/^\d{6}$/.test(h.phone)) bad(`${p}.phone`, "oczekiwano 6 cyfr");
      if (typeof h.owned !== "boolean") bad(`${p}.owned`, "oczekiwano boolean");
      for (const k of ["wallColor", "roofColor", "doorColor"] as const) {
        if (!isStr(h[k]) || !HEX_COLOR.test(h[k] as string)) bad(`${p}.${k}`, "oczekiwano koloru #rrggbb");
      }
      if (typeof h.flip !== "boolean") bad(`${p}.flip`, "oczekiwano boolean");
    });
  }

  const quests = input.quests;
  if (!isObj(quests)) bad("quests", "oczekiwano obiektu");
  else {
    for (const part of ["accepted", "completed"] as const) {
      const map = quests[part];
      if (!isObj(map)) {
        bad(`quests.${part}`, "oczekiwano obiektu");
        continue;
      }
      for (const [id, v] of Object.entries(map)) {
        if (!QUEST_BY_ID.has(id) || !isObj(v) || !isNum(v.at) || v.at < 0 || v.at > elapsed + 1e-6) {
          bad(`quests.${part}.${id}`, "nieznane zadanie lub niepoprawny czas");
        }
      }
    }
    if (isObj(quests.accepted) && isObj(quests.completed)) {
      for (const id of Object.keys(quests.completed)) {
        if (!(id in quests.accepted)) bad(`quests.completed.${id}`, "ukończone, ale nieprzyjęte");
      }
    }
    if (!Array.isArray(quests.read) || quests.read.some((id) => !isStr(id) || !QUEST_BY_ID.has(id))) bad("quests.read", "oczekiwano listy znanych zadań");
  }

  const chests = input.chests;
  if (!isObj(chests)) bad("chests", "oczekiwano obiektu");
  else {
    for (const [id, c] of Object.entries(chests)) {
      if (!(id in CHEST_CONTENTS) || !isObj(c) || typeof c.opened !== "boolean" || typeof c.taken !== "boolean" || (c.taken && !c.opened)) {
        bad(`chests.${id}`, "nieznana skrzynia lub niepoprawny stan");
      }
    }
  }

  const troll = input.troll;
  let depositOk = false;
  if (!isObj(troll)) bad("troll", "oczekiwano obiektu");
  else {
    if (!isStr(troll.phase) || !TROLL_PHASES.includes(troll.phase)) bad("troll.phase", "niepoprawna faza");
    if (!isNum(troll.lockUntil) || troll.lockUntil < 0) bad("troll.lockUntil", "oczekiwano liczby >= 0");
    if (!isInt(troll.attempts) || troll.attempts < 0) bad("troll.attempts", "oczekiwano liczby całkowitej >= 0");
    depositOk = checkStacks(troll.deposit, "troll.deposit", bad, false);
    if (depositOk) {
      const seen = new Set<string>();
      for (const s of troll.deposit as Stack[]) {
        if (seen.has(s.id)) bad("troll.deposit", `powtórzony stos ${s.id}`);
        seen.add(s.id);
      }
      if (troll.phase === "unmet" && (troll.deposit as Stack[]).length > 0) bad("troll.deposit", "depozyt przy niespotkanym trollu");
    }
    if (isObj(chests)) {
      const guarded = chests["chest.bridge.blueprint"];
      if (isObj(guarded) && guarded.opened === true && troll.phase !== "solved") bad("chests.chest.bridge.blueprint", "otwarta skrzynia pilnowana przez trolla bez rozwiązanej zagadki");
    }
  }

  if (!Array.isArray(input.harvested) || input.harvested.length > MAX_HARVESTED || input.harvested.some((h) => !isStr(h) || h.length === 0 || h.length > 80)) {
    bad("harvested", "oczekiwano listy identyfikatorów");
  } else if (new Set(input.harvested).size !== input.harvested.length) bad("harvested", "powtórzone identyfikatory");

  const bridge = input.bridge;
  if (!isObj(bridge) || typeof bridge.built !== "boolean") bad("bridge", "oczekiwano { built, builtAt }");
  else if (bridge.built ? !isNum(bridge.builtAt) || bridge.builtAt < 0 || bridge.builtAt > elapsed + 1e-6 : bridge.builtAt !== null) bad("bridge.builtAt", "niespójne z bridge.built");

  if (!Array.isArray(input.discovered) || input.discovered.some((r) => !KNOWN_REGIONS.includes(r as string))) bad("discovered", "oczekiwano listy znanych regionów");
  else if (input.discovered.length > 0 && !(isObj(bridge) && bridge.built === true)) bad("discovered", "region za rzeką odkryty bez mostu");
  if (!Array.isArray(input.badges) || input.badges.some((b) => !KNOWN_BADGES.includes(b as string))) bad("badges", "oczekiwano listy znanych odznak");

  if (isObj(quests) && isObj(quests.completed) && "quest.bridge_01" in quests.completed && !(isObj(bridge) && bridge.built === true)) {
    bad("quests.completed", "most_01 ukończony bez zbudowanego mostu");
  }

  if (slotsOk && ledgerOk && depositOk && isObj(player) && isObj(troll)) {
    for (const p of inventoryProblems(player.slots as Stack[], troll.deposit as Stack[], player.ledger as { gained: Record<string, number>; spent: Record<string, number> })) {
      bad("player.ledger", p);
    }
    if (isObj(chests)) {
      for (const [id, c] of Object.entries(chests)) {
        if (isObj(c) && c.taken === true) {
          const item = CHEST_CONTENTS[id];
          if (item && ((player.ledger as { gained: Record<string, number> }).gained[item] ?? 0) < 1) bad(`chests.${id}`, "zabrana zawartość nie jest w księdze");
        }
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: input as unknown as SaveV4 };
}
