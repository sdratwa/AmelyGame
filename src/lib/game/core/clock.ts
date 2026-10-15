import {
  DAYS_PER_SEASON,
  DAY_START_HOUR,
  HOURS_PER_DAY,
  NIGHT_START_HOUR,
  SECONDS_PER_DAY,
  SECONDS_PER_GAME_HOUR,
  START_YEAR,
} from "./constants";

export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABEL: Record<Season, string> = {
  winter: "Zima",
  spring: "Wiosna",
  summer: "Lato",
  autumn: "Jesień",
};

export type ClockInfo = {
  day: number;
  dayInSeason: number;
  hour: number;
  minute: number;
  isDay: boolean;
  season: Season;
  year: number;
};

export function getClock(elapsedSeconds: number): ClockInfo {
  const dayIndex = Math.floor(elapsedSeconds / SECONDS_PER_DAY);
  const secondsIntoDay = elapsedSeconds - dayIndex * SECONDS_PER_DAY;
  const hoursIntoDay = secondsIntoDay / SECONDS_PER_GAME_HOUR;
  const clockHours = (DAY_START_HOUR + hoursIntoDay) % HOURS_PER_DAY;
  const hour = Math.floor(clockHours);
  const minute = Math.floor((clockHours - hour) * 60);
  const seasonIndex = Math.floor(dayIndex / DAYS_PER_SEASON) % SEASONS.length;
  return {
    day: dayIndex,
    dayInSeason: (dayIndex % DAYS_PER_SEASON) + 1,
    hour,
    minute,
    isDay: hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR,
    season: SEASONS[seasonIndex],
    year:
      START_YEAR +
      Math.floor(dayIndex / (DAYS_PER_SEASON * SEASONS.length)),
  };
}

export function formatClock(clock: ClockInfo): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(clock.hour)}:${pad(clock.minute)}`;
}

export function gameHoursToSeconds(hours: number): number {
  return hours * SECONDS_PER_GAME_HOUR;
}

/** Początek następnego dnia gry (kolejne 06:00), liczony w czasie gry. */
export function nextDayStart(elapsedSeconds: number): number {
  return (Math.floor(elapsedSeconds / SECONDS_PER_DAY) + 1) * SECONDS_PER_DAY;
}
