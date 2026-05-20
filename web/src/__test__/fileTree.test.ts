import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildFileTree } from "../lib/fileTree";

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
