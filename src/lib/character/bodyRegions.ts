/**
 * Regiony bazowej siatki postaci (wg dominującej kości) i reguły ukrywania fragmentów ciała pod ubraniem.
 * Czysta logika bez three: te same funkcje obsługują grę, panel kreatora i testy.
 */
export type BodyRegion = "head" | "neck" | "torso" | "hips" | "armL" | "armR" | "handL" | "handR" | "legL" | "legR" | "footL" | "footR" | "other";

/** Region ciała dla kości Mixamo (nazwa z dwukropkiem `mixamorig:Head` albo po sanityzacji `mixamorigHead`). */
export function regionOfBone(name: string): BodyRegion {
  const n = name.replace(/^mixamorig:?/, "");
  if (/^HeadTop|^Head$/.test(n)) return "head";
  if (/^Neck/.test(n)) return "neck";
  if (/Hand/.test(n)) return n.startsWith("Left") ? "handL" : "handR";
  if (/Shoulder|Arm|ForeArm/.test(n)) return n.startsWith("Left") ? "armL" : "armR";
  if (/ToeBase|Toe_End|Foot/.test(n)) return n.startsWith("Left") ? "footL" : "footR";
  if (/UpLeg|Leg/.test(n)) return n.startsWith("Left") ? "legL" : "legR";
  if (/^Spine/.test(n)) return "torso";
  if (/^Hips/.test(n)) return "hips";
  return "other";
}

/**
 * Które trójkąty bazowej siatki są niewidoczne pod elementem ubrania: wszystkie trzy wierzchołki w podanych regionach,
 * a środek trójkąta w zakresie (jednostki modelu, poza pozą wiązania: wysokość postaci = 1, ramiona w T).
 */
export type BodyHideRule = {
  regions: readonly BodyRegion[];
  yMin?: number;
  yMax?: number;
  /** Maks. |x| środka trójkąta (rękaw: ukrywamy tylko część ramienia pod rękawem). */
  absXMax?: number;
};

export type TriangleProbe = { regions: readonly [BodyRegion, BodyRegion, BodyRegion]; cx: number; cy: number };

export function ruleHidesTriangle(rule: BodyHideRule, t: TriangleProbe): boolean {
  if (!t.regions.every((r) => rule.regions.includes(r))) return false;
  if (rule.yMin !== undefined && t.cy < rule.yMin) return false;
  if (rule.yMax !== undefined && t.cy > rule.yMax) return false;
  if (rule.absXMax !== undefined && Math.abs(t.cx) > rule.absXMax) return false;
  return true;
}

export function anyRuleHides(rules: readonly BodyHideRule[], t: TriangleProbe): boolean {
  return rules.some((r) => ruleHidesTriangle(r, t));
}
