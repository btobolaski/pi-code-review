import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildFileTree, flattenFileTree } from "../lib/fileTree";

describe("buildFileTree", () => {
  it("returns an empty tree for no rows", () => {
    assert.deepEqual(buildFileTree([]), []);
  });

  it("keeps a single root file as a leaf node", () => {
    assert.deepEqual(buildFileTree([{ filePath: "README.md", status: "modified", count: 0 }]), [
      {
        kind: "file",
        row: { filePath: "README.md", status: "modified", count: 0 },
      },
    ]);
  });

  it("groups sibling files under the same directory", () => {
    assert.deepEqual(
      buildFileTree([
        { filePath: "extension/src/diff.ts", status: "modified", count: 0 },
        { filePath: "extension/src/command.ts", status: "modified", count: 1 },
      ]),
      [
        {
          kind: "dir",
          name: "extension",
          children: [
            {
              kind: "dir",
              name: "src",
              children: [
                {
                  kind: "file",
                  row: { filePath: "extension/src/command.ts", status: "modified", count: 1 },
                },
                {
                  kind: "file",
                  row: { filePath: "extension/src/diff.ts", status: "modified", count: 0 },
                },
              ],
            },
          ],
        },
      ],
    );
  });

  it("orders files before sub-directories within a directory", () => {
    assert.deepEqual(
      buildFileTree([
        { filePath: "extension/src/diff.ts", status: "modified", count: 0 },
        { filePath: "extension/index.ts", status: "added", count: 0 },
      ]),
      [
        {
          kind: "dir",
          name: "extension",
          children: [
            {
              kind: "file",
              row: { filePath: "extension/index.ts", status: "added", count: 0 },
            },
            {
              kind: "dir",
              name: "src",
              children: [
                {
                  kind: "file",
                  row: { filePath: "extension/src/diff.ts", status: "modified", count: 0 },
                },
              ],
            },
          ],
        },
      ],
    );
  });

  it("sorts root files before directories and preserves deep nesting", () => {
    assert.deepEqual(
      buildFileTree([
        { filePath: "web/src/App.tsx", status: "modified", count: 0 },
        { filePath: "README.md", status: "modified", count: 0 },
        { filePath: "extension/src/command.ts", status: "renamed", count: 0 },
      ]),
      [
        {
          kind: "file",
          row: { filePath: "README.md", status: "modified", count: 0 },
        },
        {
          kind: "dir",
          name: "extension",
          children: [
            {
              kind: "dir",
              name: "src",
              children: [
                {
                  kind: "file",
                  row: { filePath: "extension/src/command.ts", status: "renamed", count: 0 },
                },
              ],
            },
          ],
        },
        {
          kind: "dir",
          name: "web",
          children: [
            {
              kind: "dir",
              name: "src",
              children: [
                {
                  kind: "file",
                  row: { filePath: "web/src/App.tsx", status: "modified", count: 0 },
                },
              ],
            },
          ],
        },
      ],
    );
  });
});

describe("flattenFileTree", () => {
  it("returns an empty list for no nodes", () => {
    assert.deepEqual(flattenFileTree([]), []);
  });

  it("returns the path for a single root file", () => {
    assert.deepEqual(
      flattenFileTree([
        {
          kind: "file",
          row: { filePath: "README.md", status: "modified", count: 0 },
        },
      ]),
      ["README.md"],
    );
  });

  it("returns sibling files in alphabetical basename order", () => {
    const tree = buildFileTree([
      { filePath: "extension/src/diff.ts", status: "modified", count: 0 },
      { filePath: "extension/src/command.ts", status: "modified", count: 0 },
    ]);

    assert.deepEqual(flattenFileTree(tree), ["extension/src/command.ts", "extension/src/diff.ts"]);
  });

  it("returns files before sub-directories recursively", () => {
    const tree = buildFileTree([
      { filePath: "extension/src/z-last.ts", status: "modified", count: 0 },
      { filePath: "extension/index.ts", status: "added", count: 0 },
      { filePath: "extension/docs/README.md", status: "modified", count: 0 },
      { filePath: "extension/src/command.ts", status: "modified", count: 0 },
    ]);

    assert.deepEqual(flattenFileTree(tree), [
      "extension/index.ts",
      "extension/docs/README.md",
      "extension/src/command.ts",
      "extension/src/z-last.ts",
    ]);
  });

  it("matches the sidebar DFS order for non-alphabetical diff input", () => {
    const tree = buildFileTree([
      { filePath: "web/src/App.tsx", status: "modified", count: 0 },
      { filePath: "README.md", status: "modified", count: 0 },
      { filePath: "extension/src/command.ts", status: "modified", count: 0 },
    ]);

    assert.deepEqual(flattenFileTree(tree), [
      "README.md",
      "extension/src/command.ts",
      "web/src/App.tsx",
    ]);
  });
});
