import type { ActionEvent, NavDirection } from "./actions";
import { navDirectionOf } from "./actions";
import { ModalGrace, pickInitial, pickNeighbor, type NavRect } from "./uiNav";

/**
 * Cienka warstwa DOM nad `uiNav.ts`: korzysta z natywnego fokusu elementów (bez symulowania kursora). Zakres nawigacji
 * to najwyższe okno modalne albo cały dokument.
 */

export const MODAL_SELECTOR = '[data-slot="dialog-content"], [data-gamepad-modal]';

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[role="button"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Okno, które się zamyka (animacja wyjścia), nie liczy się jako otwarte. */
function isClosing(el: Element): boolean {
  return el.hasAttribute("data-closed") || el.hasAttribute("data-ending-style");
}

export function topModal(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
  for (let i = all.length - 1; i >= 0; i--) {
    if (!isClosing(all[i])) return all[i];
  }
  return null;
}

export function isModalOpen(): boolean {
  return topModal() !== null;
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (el.closest("[inert]")) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function candidates(scope: ParentNode): Element[] {
  const out: Element[] = [];
  scope.querySelectorAll(FOCUSABLE).forEach((el) => {
    if (!visible(el)) return;
    // Zagnieżdżone okno w tle (gdy nie jesteśmy w oknie) pomijamy: zakres to dokument bez ukrytych gałęzi.
    if (el.closest('[aria-hidden="true"]')) return;
    out.push(el);
  });
  return out;
}

function toRect(el: Element): NavRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function scopeRoot(): ParentNode {
  return topModal() ?? document.body;
}

function isScrollable(el: Element): boolean {
  const style = window.getComputedStyle(el);
  const oy = style.overflowY;
  return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 2;
}

function canScroll(el: Element, dir: "up" | "down"): boolean {
  return dir === "down" ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 1;
}

function findScrollable(root: ParentNode, from: Element | null): Element | null {
  for (let el: Element | null = from; el; el = el.parentElement) {
    if (isScrollable(el)) return el;
  }
  let found: Element | null = null;
  root.querySelectorAll("*").forEach((el) => {
    if (!found && isScrollable(el)) found = el;
  });
  return found;
}

/**
 * Fokus początkowy okna (dla `initialFocus` Base UI): element oznaczony `data-gamepad-initial` (bezpieczna, zamierzona
 * akcja, np. "Zabierz" zamiast "Zostaw"), a gdy go nie ma, domyślne zachowanie okna.
 */
export function preferredInitialFocus(): HTMLElement | true {
  const el = topModal()?.querySelector<HTMLElement>("[data-gamepad-initial]:not([disabled])");
  return el ?? true;
}

function focusEl(el: Element): void {
  (el as HTMLElement | SVGElement).focus({ preventScroll: false });
}

/** Przesuwa fokus w kierunku `dir` (albo wybiera pierwszy element); gdy brak sąsiada, przewija zawartość. */
export function navigate(dir: NavDirection): boolean {
  const root = scopeRoot();
  const list = candidates(root);
  if (list.length === 0) return false;
  const active = document.activeElement;
  const currentIdx = active ? list.indexOf(active) : -1;
  if (currentIdx < 0) {
    const preferred = list.findIndex((el) => el.hasAttribute("data-gamepad-initial") || el.hasAttribute("autofocus"));
    const idx = preferred >= 0 ? preferred : pickInitial(list.map(toRect));
    if (idx >= 0) focusEl(list[idx]);
    return true;
  }
  // Fokus na samym przewijanym obszarze (dziennik, tablica): najpierw przewijamy treść, dopiero potem przechodzimy dalej.
  if ((dir === "up" || dir === "down") && active && isScrollable(active) && canScroll(active, dir)) {
    active.scrollBy({ top: dir === "down" ? 96 : -96, behavior: "auto" });
    return true;
  }
  const next = pickNeighbor(list.map(toRect), currentIdx, dir);
  if (next >= 0) {
    focusEl(list[next]);
    return true;
  }
  if (dir === "up" || dir === "down") {
    const sc = findScrollable(root, active);
    if (sc) {
      sc.scrollBy({ top: dir === "down" ? 96 : -96, behavior: "auto" });
      return true;
    }
  }
  return false;
}

/** Zatwierdza element z fokusem (klik). Bez fokusu wybiera pierwszy element i kończy (kolejne naciśnięcie zatwierdza). */
export function confirmFocused(): boolean {
  const active = document.activeElement;
  const list = candidates(scopeRoot());
  if (!active || active === document.body || list.indexOf(active) < 0) {
    if (list.length === 0) return false;
    focusEl(list[Math.max(0, pickInitial(list.map(toRect)))]);
    return true;
  }
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const type = (active as HTMLInputElement).type;
    if (tag === "INPUT" && (type === "checkbox" || type === "radio" || type === "button" || type === "submit")) {
      (active as HTMLElement).click();
    }
    return true;
  }
  if (typeof (active as HTMLElement).click === "function") (active as HTMLElement).click();
  else active.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  return true;
}

/** Odpowiednik Esc: syntetyczny `keydown` na dokumencie (reużywa obsługi okien, sklepu i skrótów klawiatury). */
export function cancelFocused(): boolean {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  return true;
}

/** Obserwuje pojawianie się i znikanie okien, aby chronić przed zatwierdzeniem tym samym naciśnięciem. */
export function watchModals(grace: ModalGrace): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  let count = document.querySelectorAll(MODAL_SELECTOR).length;
  const observer = new MutationObserver(() => {
    const now = document.querySelectorAll(MODAL_SELECTOR).length;
    if (now !== count) {
      count = now;
      grace.noteChange(performance.now());
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Handler akcji interfejsu (priorytet wysoki): nawigacja, zatwierdzanie i cofanie. */
export function createNavigatorHandler(grace: ModalGrace): (e: ActionEvent) => boolean {
  return (e) => {
    if (e.source !== "gamepad") return false;
    const dir = navDirectionOf(e.action);
    if (dir) return navigate(dir);
    if (e.action === "confirm") {
      if (!grace.allowsConfirm(e.time)) return true;
      return confirmFocused();
    }
    if (e.action === "cancel") return cancelFocused();
    return false;
  };
}
