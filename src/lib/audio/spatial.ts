export type Pose2D = { x: number; z: number; yaw: number };

/**
 * Kierunek źródła względem kierunku patrzenia gracza w stopniach: 0 = wprost przed graczem, dodatni = na prawo, ±180 = za plecami.
 * Układ jak w kamerze Three.js i w odbiorniku Web Audio: przód to (-sin yaw, -cos yaw), prawo to (cos yaw, -sin yaw).
 */
export function relativeBearingDeg(pose: Pose2D, x: number, z: number): number {
  const dx = x - pose.x;
  const dz = z - pose.z;
  const fx = -Math.sin(pose.yaw);
  const fz = -Math.cos(pose.yaw);
  const rx = Math.cos(pose.yaw);
  const rz = -Math.sin(pose.yaw);
  return Math.round((Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) * 180) / Math.PI) + 0;
}
