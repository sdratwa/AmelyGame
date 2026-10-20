import { INVENTORY_SLOTS, MAX_HEALTH } from "../core/constants";
import { isLegacyForestPose } from "../core/pose";
import { LEGACY_ITEM_IDS, LEGACY_REMOVED_ITEMS } from "../content/items";
import { FINGERPRINT_PATTERN } from "../world/fingerprint";
import type { SaveV1 } from "./schema";
import { type ValidationResult } from "./validate";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isUint32 = (v: unknown): v is number => isInt(v) && (v as number) >= 0 && (v as number) <= 0xffff_ffff;
const isItemId = (v: unknown): v is string =>
  isStr(v) && (Object.prototype.hasOwnProperty.call(LEGACY_ITEM_IDS, v) || LEGACY_REMOVED_ITEMS.includes(v));
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SAVE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_HOUSES = 64;
const MAX_NAME = 40;

/** Walidacja formatu SaveV1 (zamrożona; służy migracji v1 -> v2). Walidacja ręczna (bez zewnętrznych bibliotek): sprawdza strukturę, typy i niezmienniki. */
export function validateSaveV1(input: unknown): ValidationResult<SaveV1> {
  const problems: string[] = [];
  const bad = (path: string, why: string) => problems.push(`${path}: ${why}`);

  if (!isObj(input)) return { ok: false, problems: ["save: oczekiwano obiektu"] };
  if (input.version !== 1) bad("version", "oczekiwano 1");
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
      player.slots.forEach((s, i) => {
        if (s !== null && !isItemId(s)) bad(`player.slots[${i}]`, "nieznany przedmiot");
      });
      if (player.slots[0] !== "phone") bad("player.slots[0]", "telefon musi zajmować pierwsze miejsce");
    }
    if (!isInt(player.selected) || player.selected < 0 || player.selected >= INVENTORY_SLOTS) bad("player.selected", "poza zakresem");
    if (player.forestPose !== null && !isLegacyForestPose(player.forestPose)) bad("player.forestPose", "niepoprawna pozycja");
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

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: input as unknown as SaveV1 };
}
