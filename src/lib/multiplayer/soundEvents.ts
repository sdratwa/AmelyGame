import { SOUND_REGISTRY, type PlayerSoundEvent, type Player } from "./protocol";
/** No URLs from the wire. Future recordings are bound to this registry by the application. */
export function createSoundEvent(
  player: Player,
  worldInstanceId: string,
  soundId: keyof typeof SOUND_REGISTRY,
  sequence: number,
  serverTime: number,
): PlayerSoundEvent {
  return {
    eventId: `${worldInstanceId}:${player.playerId}:${sequence}`,
    playerId: player.playerId,
    worldInstanceId,
    soundId,
    sequence,
    serverTime,
    x: player.x,
    y: player.y + 1.4,
    z: player.z,
  };
}
export class SoundEventGate {
  private sequences = new Map<string, number>();
  accept(
    event: PlayerSoundEvent,
    instance: string,
    players: readonly Player[],
    now: number,
  ): boolean {
    if (
      event.worldInstanceId !== instance ||
      !players.some((p) => p.playerId === event.playerId) ||
      !Object.hasOwn(SOUND_REGISTRY, event.soundId) ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= (this.sequences.get(event.playerId) ?? 0) ||
      Math.abs(now - event.serverTime) > 5000
    )
      return false;
    if (![event.x, event.y, event.z].every(Number.isFinite)) return false;
    this.sequences.set(event.playerId, event.sequence);
    return true;
  }
  clear() {
    this.sequences.clear();
  }
}
