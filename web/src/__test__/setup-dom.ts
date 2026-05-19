/**
 * Tiny happy-dom bootstrap for the Preact UI workflow tests. Importing this
 * module attaches the Window globals (document, navigator, Event, ...) to
 * `globalThis` before `@testing-library/preact` or any component module loads
 * its DOM references, which is what makes those libraries work under
 * `node --test`.
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });

// Properties we explicitly proxy onto globalThis. Anything the components or
// testing libraries reach for must live here.
const KEYS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "InputEvent",
  "FocusEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "DocumentFragment",
  "NodeFilter",
] as const;

const w = win as unknown as Record<string, unknown>;
const g = globalThis as unknown as Record<string, unknown>;

g.window = win;
for (const key of KEYS) {
  if (key in w && g[key] === undefined) {
    g[key] = w[key];
  }
}
g.document = win.document;
