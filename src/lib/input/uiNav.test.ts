import { describe, expect, it } from "vitest";
import { ModalGrace, pickInitial, pickNeighbor, type NavRect } from "./uiNav";

const rect = (left: number, top: number, w = 100, h = 40): NavRect => ({ left, top, right: left + w, bottom: top + h });

describe("nawigacja przestrzenna", () => {
  // 0 1
  // 2 3
  const grid = [rect(0, 0), rect(200, 0), rect(0, 100), rect(200, 100)];

  it("wybiera sąsiada w zadanym kierunku", () => {
    expect(pickNeighbor(grid, 0, "right")).toBe(1);
    expect(pickNeighbor(grid, 0, "down")).toBe(2);
    expect(pickNeighbor(grid, 3, "left")).toBe(2);
    expect(pickNeighbor(grid, 3, "up")).toBe(1);
  });

  it("zwraca -1 na krawędzi", () => {
    expect(pickNeighbor(grid, 0, "left")).toBe(-1);
    expect(pickNeighbor(grid, 0, "up")).toBe(-1);
    expect(pickNeighbor(grid, 3, "right")).toBe(-1);
    expect(pickNeighbor(grid, 3, "down")).toBe(-1);
  });

  it("preferuje element na wprost przed bliższym, ale odsuniętym", () => {
    const list = [rect(0, 0), rect(150, 60), rect(0, 200)]; // 1 jest bliżej po przekątnej, 2 dokładnie pod spodem
    expect(pickNeighbor(list, 0, "down")).toBe(2);
  });

  it("lista pionowa przechodzi element po elemencie", () => {
    const list = [rect(0, 0), rect(0, 60), rect(0, 120)];
    expect(pickNeighbor(list, 0, "down")).toBe(1);
    expect(pickNeighbor(list, 1, "down")).toBe(2);
    expect(pickNeighbor(list, 2, "up")).toBe(1);
  });

  it("pierwszy element to lewy górny", () => {
    expect(pickInitial(grid)).toBe(0);
    expect(pickInitial([rect(300, 200), rect(10, 10), rect(500, 10)])).toBe(1);
    expect(pickInitial([])).toBe(-1);
  });

  it("nieznany bieżący indeks daje -1", () => {
    expect(pickNeighbor(grid, 9, "left")).toBe(-1);
  });
});

describe("ModalGrace", () => {
  it("ignoruje zatwierdzanie tuż po zmianie okien i pozwala po chwili", () => {
    const g = new ModalGrace(250);
    g.noteChange(1000);
    expect(g.allowsConfirm(1100)).toBe(false);
    expect(g.allowsConfirm(1250)).toBe(true);
  });

  it("bez zmian okien zatwierdzanie jest dozwolone", () => {
    expect(new ModalGrace(250).allowsConfirm(0)).toBe(true);
  });
});
