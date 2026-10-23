/**
 * Ograniczenia uczestnika w trakcie zabawy (izolacja minigry od questów, ekwipunku i zapisów). Lista jest po stronie
 * klienta tylko warstwą wygody; wspólny świat (zbieranie, most) pilnuje serwer (`HideSeekHost.mayRunWorldCommand`).
 */
const BLOCKED = new Set([
  "chest.open",
  "chest.take",
  "harvest",
  "bridge.build",
  "troll.talk",
  "troll.choose",
  "troll.claim",
  "riddle.answer",
  "quest.accept",
  "board.read",
  "region.discover",
  "buy",
  "buyHouse",
  "upgradeHouse",
  "leave",
]);

/** Czy komenda gry jest zablokowana uczestnikowi zabawy. Wejście do lasu jest dozwolone (start i wznowienie); inne widoki nie. */
export function blockedDuringGame(command: { type: string; view?: string }): boolean {
  if (command.type === "enter") return command.view !== "forest";
  return BLOCKED.has(command.type);
}
