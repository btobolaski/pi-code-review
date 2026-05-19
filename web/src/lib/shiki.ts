// Lazy shiki loader. We hold a single highlighter instance and grow its
// loaded-language set on demand. Returns plain-text for unknown languages or
// when shiki fails to load.

import type { Highlighter, BundledLanguage } from "shiki";

let highlighterPromise: Promise<Highlighter | null> | null = null;
const loadedLangs = new Set<string>();
const loadingLangs = new Map<string, Promise<void>>();

async function getHighlighter(): Promise<Highlighter | null> {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    try {
      const shiki = await import("shiki");
      return await shiki.createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: [],
      });
    } catch (err) {
      console.warn("shiki failed to load; falling back to plain text", err);
      return null;
    }
  })();
  return highlighterPromise;
}

async function ensureLanguage(highlighter: Highlighter, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true;
  let pending = loadingLangs.get(lang);
  if (!pending) {
    pending = (async () => {
      try {
        await highlighter.loadLanguage(lang as BundledLanguage);
        loadedLangs.add(lang);
      } catch (err) {
        // Treat as "unknown language" — caller falls back to plain text.
        console.warn(`shiki: unknown language ${lang}`, err);
      } finally {
        loadingLangs.delete(lang);
      }
    })();
    loadingLangs.set(lang, pending);
  }
  await pending;
  return loadedLangs.has(lang);
}

const prefersDark = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Render the given source as themed HTML. Returns null if shiki failed to
 * load or the language is unknown; the caller renders plain text in that case.
 */
export async function highlightToHtml(code: string, lang: string | null): Promise<string | null> {
  if (lang === null) return null;
  const highlighter = await getHighlighter();
  if (!highlighter) return null;
  const ok = await ensureLanguage(highlighter, lang);
  if (!ok) return null;
  try {
    return highlighter.codeToHtml(code, {
      lang,
      theme: prefersDark() ? "github-dark" : "github-light",
    });
  } catch (err) {
    console.warn("shiki codeToHtml failed", err);
    return null;
  }
}
