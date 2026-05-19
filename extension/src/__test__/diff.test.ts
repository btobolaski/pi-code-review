import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDiffCommand, detectVcs, getDiff, parseUnifiedDiff, resolveRevset } from "../diff.js";

describe("parseUnifiedDiff", () => {
  it("normalizes a modified file with add/del/context lines", () => {
    const raw = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@ function f
 line 1
-old
+new
+added
 line 3
`;
    const files = parseUnifiedDiff(raw);
    assert.equal(files.length, 1);
    const file = files[0];
    assert.equal(file.filePath, "src/a.ts");
    assert.equal(file.status, "modified");
    assert.equal(file.oldPath, "src/a.ts");
    assert.equal(file.newPath, "src/a.ts");
    assert.equal(file.hunks.length, 1);
    assert.equal(file.hunks[0].header, "function f");
    assert.deepEqual(file.hunks[0].lines, [
      { kind: "context", oldLine: 1, newLine: 1, text: "line 1" },
      { kind: "del", oldLine: 2, newLine: null, text: "old" },
      { kind: "add", oldLine: null, newLine: 2, text: "new" },
      { kind: "add", oldLine: null, newLine: 3, text: "added" },
      { kind: "context", oldLine: 3, newLine: 4, text: "line 3" },
    ]);
  });

  it("marks an added file as status='added' and clears oldPath", () => {
    const raw = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`;
    const [file] = parseUnifiedDiff(raw);
    assert.equal(file.status, "added");
    assert.equal(file.oldPath, null);
    assert.equal(file.newPath, "new.txt");
    assert.equal(file.filePath, "new.txt");
  });

  it("marks a deleted file as status='deleted' and clears newPath", () => {
    const raw = `diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-hello
-world
`;
    const [file] = parseUnifiedDiff(raw);
    assert.equal(file.status, "deleted");
    assert.equal(file.oldPath, "old.txt");
    assert.equal(file.newPath, null);
    assert.equal(file.filePath, "old.txt");
  });

  it("marks a renamed file when from != to", () => {
    const raw = `diff --git a/a.ts b/b.ts
similarity index 100%
rename from a.ts
rename to b.ts
--- a/a.ts
+++ b/b.ts
@@ -1 +1 @@
-old
+new
`;
    const [file] = parseUnifiedDiff(raw);
    assert.equal(file.status, "renamed");
    assert.equal(file.oldPath, "a.ts");
    assert.equal(file.newPath, "b.ts");
    assert.equal(file.filePath, "b.ts");
  });

  it("strips the leading +/-/space char from content", () => {
    const raw = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
- a    leading space remains
+ b    leading space remains
`;
    const [file] = parseUnifiedDiff(raw);
    assert.equal(file.hunks[0].lines[0].text, " a    leading space remains");
    assert.equal(file.hunks[0].lines[1].text, " b    leading space remains");
  });

  it("parses multiple files in one diff stream", () => {
    const raw = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-x
+y
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-p
+q
`;
    const files = parseUnifiedDiff(raw);
    assert.equal(files.length, 2);
    assert.deepEqual(
      files.map((f) => f.filePath),
      ["a.ts", "b.ts"],
    );
  });

  it("handles file paths containing spaces", () => {
    const raw = `diff --git "a/with space.ts" "b/with space.ts"
--- "a/with space.ts"
+++ "b/with space.ts"
@@ -1 +1 @@
-x
+y
`;
    const [file] = parseUnifiedDiff(raw);
    // parse-diff exposes the path with or without the surrounding quotes
    // depending on version; either way it should still resolve to a non-empty
    // filePath that contains the space.
    assert.ok(file.filePath.includes("with space.ts"));
  });

  it("tolerates the '\\ No newline at end of file' marker", () => {
    const raw = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
 line 1
-old
+new
\ No newline at end of file
`;
    const [file] = parseUnifiedDiff(raw);
    assert.equal(file.hunks.length, 1);
    // Only the +/-/space-prefixed lines become DiffLine entries; the no-newline
    // marker is consumed silently.
    assert.equal(file.hunks[0].lines.length, 3);
    assert.deepEqual(
      file.hunks[0].lines.map((l) => l.kind),
      ["context", "del", "add"],
    );
  });

  it("omits the trailing header when @@ has no trailing text", () => {
    const raw = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-x
+y
`;
    const [file] = parseUnifiedDiff(raw);
    assert.equal(file.hunks[0].header, undefined);
  });
});

describe("resolveRevset", () => {
  it("defaults to '@' for jj", () => {
    assert.equal(resolveRevset("jj"), "@");
    assert.equal(resolveRevset("jj", ""), "@");
    assert.equal(resolveRevset("jj", "   "), "@");
  });
  it("defaults to 'HEAD' for git", () => {
    assert.equal(resolveRevset("git"), "HEAD");
  });
  it("trims the user-supplied revset", () => {
    assert.equal(resolveRevset("jj", "  trunk()  "), "trunk()");
    assert.equal(resolveRevset("git", "main..feature"), "main..feature");
  });
});

describe("buildDiffCommand", () => {
  it("builds the jj command with --git and -r <revset>", () => {
    assert.deepEqual(buildDiffCommand("jj", "@"), {
      command: "jj",
      args: ["diff", "--git", "-r", "@"],
    });
  });
  it("builds the git command with --no-pager and --no-color", () => {
    assert.deepEqual(buildDiffCommand("git", "main..feature"), {
      command: "git",
      args: ["--no-pager", "diff", "--no-color", "main..feature"],
    });
  });
});

describe("getDiff", () => {
  it("throws a user-facing error when no VCS marker is found", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-code-review-novcs-"));
    try {
      await assert.rejects(() => getDiff({ cwd: dir }), /No VCS detected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("detectVcs", () => {
  const created: string[] = [];
  const makeTmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), "pi-code-review-vcs-"));
    created.push(d);
    return d;
  };

  it("returns null when no marker exists", () => {
    const dir = makeTmp();
    assert.equal(detectVcs(dir), null);
  });

  it("returns jj when only .jj exists", () => {
    const dir = makeTmp();
    mkdirSync(join(dir, ".jj"));
    assert.deepEqual(detectVcs(dir), { vcs: "jj", root: dir });
  });

  it("returns git when only .git exists", () => {
    const dir = makeTmp();
    mkdirSync(join(dir, ".git"));
    assert.deepEqual(detectVcs(dir), { vcs: "git", root: dir });
  });

  it("prefers jj when both .jj and .git exist", () => {
    const dir = makeTmp();
    mkdirSync(join(dir, ".jj"));
    mkdirSync(join(dir, ".git"));
    assert.deepEqual(detectVcs(dir), { vcs: "jj", root: dir });
  });

  it("walks up to find the marker", () => {
    const dir = makeTmp();
    mkdirSync(join(dir, ".git"));
    const nested = join(dir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    assert.deepEqual(detectVcs(nested), { vcs: "git", root: dir });
  });

  // Clean up all tmpdirs created by this suite. Node 22's node:test supports
  // `after()` as a describe-level hook that runs once after every `it`.
  after(() => {
    for (const d of created) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
