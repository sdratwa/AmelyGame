import type { RiddleId } from "../core/ids";

export type RiddleType = "add" | "sub" | "mul" | "reason";

/** Zagadka matematyczna trolla; poprawna odpowiedź (liczba) jest weryfikowana wyłącznie w silniku. */
export type Riddle = {
  id: RiddleId;
  text: string;
  answer: number;
  difficulty: 1 | 2 | 3;
  type: RiddleType;
  hint: string;
};

export const RIDDLES: readonly Riddle[] = [
  { id: "riddle.baskets", text: "W 3 koszach jest po 7 jabłek. Troll zjadł 5 jabłek. Ile jabłek zostało?", answer: 16, difficulty: 2, type: "reason", hint: "Najpierw policz wszystkie jabłka, potem odejmij zjedzone." },
  { id: "riddle.mushrooms", text: "Zebrałeś 14 grzybów, a potem jeszcze 9. Ile masz grzybów?", answer: 23, difficulty: 1, type: "add", hint: "Dodaj do siebie obie liczby." },
  { id: "riddle.acorns", text: "Wiewiórka miała 30 żołędzi i zakopała 12. Ile żołędzi jej zostało?", answer: 18, difficulty: 1, type: "sub", hint: "Od 30 odejmij 12." },
  { id: "riddle.logs", text: "Stos ma 6 rzędów po 4 kłody. Ile jest kłód?", answer: 24, difficulty: 1, type: "mul", hint: "6 razy 4." },
  { id: "riddle.birds", text: "Na drzewie siedziało 25 ptaków. 8 odleciało, ale po chwili wróciło 3. Ile ptaków siedzi na drzewie?", answer: 20, difficulty: 2, type: "reason", hint: "Odejmij te, które odleciały, i dodaj te, które wróciły." },
  { id: "riddle.stones", text: "Troll ma 5 woreczków po 8 kamieni. Daje ci 2 woreczki. Ile kamieni ci da?", answer: 16, difficulty: 2, type: "mul", hint: "Liczą się tylko 2 woreczki: 2 razy 8." },
  { id: "riddle.berries", text: "48 jagód podzielono po równo między 6 dzieci. Ile jagód dostało jedno dziecko?", answer: 8, difficulty: 2, type: "reason", hint: "Ile razy 6 mieści się w 48?" },
  { id: "riddle.fish", text: "W rzece pływa 17 ryb, a w stawie 26. Ile ryb jest razem?", answer: 43, difficulty: 1, type: "add", hint: "17 plus 26." },
  { id: "riddle.steps", text: "Most miał 50 desek. Zostało 18. Ile desek zniknęło?", answer: 32, difficulty: 1, type: "sub", hint: "Od 50 odejmij 18." },
  { id: "riddle.paws", text: "Na polanie stoi 4 zajęcy. Każdy ma 4 łapy. Ile łap mają razem?", answer: 16, difficulty: 1, type: "mul", hint: "4 razy 4." },
  { id: "riddle.lanterns", text: "Troll zapalił 9 lampionów rano i 12 wieczorem, a 7 zgasło od wiatru. Ile płonie?", answer: 14, difficulty: 3, type: "reason", hint: "Dodaj oba zapalone razy, potem odejmij zgaszone." },
  { id: "riddle.pinecones", text: "Masz 7 szyszek, a troll ma 3 razy więcej. Ile szyszek ma troll?", answer: 21, difficulty: 2, type: "mul", hint: "3 razy 7." },
  { id: "riddle.coins", text: "Za most płaci się 15 monet. Przeszło 4 podróżnych. Ile monet zebrano?", answer: 60, difficulty: 3, type: "mul", hint: "4 razy 15, możesz liczyć 4 razy 10 i 4 razy 5." },
];

export const RIDDLE_BY_ID: ReadonlyMap<string, Riddle> = new Map(RIDDLES.map((r) => [r.id, r]));
