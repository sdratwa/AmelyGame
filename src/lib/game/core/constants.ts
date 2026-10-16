export const SECONDS_PER_GAME_HOUR = 20;
export const HOURS_PER_DAY = 24;
export const SECONDS_PER_DAY = SECONDS_PER_GAME_HOUR * HOURS_PER_DAY;
export const DAYS_PER_SEASON = 30;
export const START_YEAR = 2030;
export const START_WALLET = 1_000_000;
export const MAX_HEALTH = 100;
export const INVENTORY_SLOTS = 8;
export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 18;

/** Promień obszaru lasu w prototypie (metry); pozycja zapisana poza nim jest odrzucana. */
export const FOREST_RADIUS = 52;

/** Zasięgi interakcji (m) sprawdzane przez silnik względem kotwic świata. */
export const CHEST_RANGE = 3.5;
export const TROLL_RANGE = 6;
export const HARVEST_RANGE = 3.5;
export const BUILD_RANGE = 8;

/** Zasięgi podpowiedzi [E] w lesie (m): zawsze mniejsze od zasięgów silnika, więc widoczna podpowiedź oznacza, że komenda przejdzie. */
export const CHEST_PROMPT_RANGE = 2.6;
export const HARVEST_PROMPT_RANGE = 3;

/** Błędna odpowiedź trolla: blokada na godzinę czasu gry. */
export const RIDDLE_LOCK_HOURS = 1;
