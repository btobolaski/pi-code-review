import type { DiffFileStatus } from "../../../extension/src/types";

export type SidebarFileRow = {
  filePath: string;
  status: DiffFileStatus;
  count: number;
};

export type FileTreeNode =
  | {
      kind: "file";
      row: SidebarFileRow;
    }
  | {
      kind: "dir";
      name: string;
      children: FileTreeNode[];
    };

type MutableDir = {
  files: SidebarFileRow[];
  dirs: Map<string, MutableDir>;
};

/**
 * Group flat sidebar rows into a recursive directory tree. Within each
 * directory, file leaves are ordered alphabetically before sub-directories.
 */
export function buildFileTree(rows: ReadonlyArray<SidebarFileRow>): FileTreeNode[] {
  const root = createMutableDir();

  for (const row of rows) {
    const parts = row.filePath.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let child = dir.dirs.get(part);
      if (!child) {
        child = createMutableDir();
        dir.dirs.set(part, child);
      }
      dir = child;
    }
    dir.files.push(row);
  }

  return finalizeDir(root);
}

function createMutableDir(): MutableDir {
  return {
    files: [],
    dirs: new Map(),
  };
}

function finalizeDir(dir: MutableDir): FileTreeNode[] {
  const files = [...dir.files]
    .sort((left, right) => fileName(left.filePath).localeCompare(fileName(right.filePath)))
    .map((row) => ({ kind: "file", row }) satisfies FileTreeNode);

  const dirs = [...dir.dirs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, child]) =>
        ({
          kind: "dir",
          name,
          children: finalizeDir(child),
        }) satisfies FileTreeNode,
    );

  return [...files, ...dirs];
}

export function fileName(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}
