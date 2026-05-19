import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { getLanguageFromPath } from "../lib/lang";

describe("getLanguageFromPath", () => {
  it("maps common extensions to shiki languages", () => {
    assert.equal(getLanguageFromPath("src/app.ts"), "ts");
    assert.equal(getLanguageFromPath("src/app.tsx"), "tsx");
    assert.equal(getLanguageFromPath("util.mjs"), "js");
    assert.equal(getLanguageFromPath("util.cjs"), "js");
    assert.equal(getLanguageFromPath("notes.md"), "markdown");
    assert.equal(getLanguageFromPath("a/b/c.py"), "python");
    assert.equal(getLanguageFromPath("a.nix"), "nix");
  });

  it("is case-insensitive", () => {
    assert.equal(getLanguageFromPath("App.TS"), "ts");
    assert.equal(getLanguageFromPath("Foo.PY"), "python");
  });

  it("special-cases extension-less Dockerfile/Makefile by basename", () => {
    assert.equal(getLanguageFromPath("Dockerfile"), "docker");
    assert.equal(getLanguageFromPath("a/b/Dockerfile"), "docker");
    assert.equal(getLanguageFromPath("Makefile"), "makefile");
    assert.equal(getLanguageFromPath("a/Makefile"), "makefile");
  });

  it("returns null for unknown / missing extensions", () => {
    assert.equal(getLanguageFromPath("README"), null);
    assert.equal(getLanguageFromPath("noext."), null);
    assert.equal(getLanguageFromPath("strange.xyz"), null);
    assert.equal(getLanguageFromPath(""), null);
  });
});
