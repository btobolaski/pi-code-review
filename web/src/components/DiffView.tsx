import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { DiffFile, DiffFileStatus, DiffPayload } from "../../../extension/src/types";
import type { CommentDraft, StoredComment } from "../App";
import {
  buildFileTree,
  fileName,
  flattenFileTree,
  type FileTreeNode,
  type SidebarFileRow,
} from "../lib/fileTree";
import { FilePane } from "./FilePane";

export type DiffViewProps = {
  diff: DiffPayload;
  commentsByFile: Map<string, StoredComment[]>;
  onAddComment: (draft: CommentDraft, body: string) => void;
  onUpdateComment: (id: number, body: string) => void;
  onDeleteComment: (id: number) => void;
};

export function DiffView(props: DiffViewProps): preact.JSX.Element {
  const { diff, commentsByFile } = props;
  const summary = useMemo<SidebarFileRow[]>(() => {
    return diff.files.map((f) => ({
      filePath: f.filePath,
      status: f.status,
      count: commentsByFile.get(f.filePath)?.length ?? 0,
    }));
  }, [diff.files, commentsByFile]);
  const fileTree = useMemo(() => buildFileTree(summary), [summary]);
  const filesByPath = useMemo(
    () => new Map<string, DiffFile>(diff.files.map((file) => [file.filePath, file])),
    [diff.files],
  );
  const orderedFiles = useMemo(() => {
    const files: DiffFile[] = [];
    for (const filePath of flattenFileTree(fileTree)) {
      const file = filesByPath.get(filePath);
      if (file) files.push(file);
    }
    return files;
  }, [fileTree, filesByPath]);

  const [activeFile, setActiveFile] = useState<string>(orderedFiles[0]?.filePath ?? "");
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const mainRef = useRef<HTMLElement | null>(null);
  const intersectingFilesRef = useRef<Map<string, ObservedFileSection>>(new Map());
  const sidebarButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const filePaths = new Set(diff.files.map((file) => file.filePath));
    setActiveFile((current) => {
      if (current && filePaths.has(current)) return current;
      return orderedFiles[0]?.filePath ?? "";
    });
    setCollapsedFiles((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const filePath of current) {
        if (!filePaths.has(filePath)) {
          changed = true;
          continue;
        }
        next.add(filePath);
      }
      return changed ? next : current;
    });
  }, [diff.files, orderedFiles]);

  useEffect(() => {
    const root = mainRef.current;
    const IntersectionObserverCtor = globalThis.IntersectionObserver;
    if (!root || typeof IntersectionObserverCtor !== "function") return;

    const elementToFilePath = new Map<Element, string>();
    intersectingFilesRef.current.clear();

    const observer = new IntersectionObserverCtor(
      (entries) => {
        for (const entry of entries) {
          const filePath = elementToFilePath.get(entry.target);
          if (!filePath) continue;

          if (entry.isIntersecting) {
            intersectingFilesRef.current.set(filePath, {
              filePath,
              element: entry.target,
            });
            continue;
          }

          intersectingFilesRef.current.delete(filePath);
        }

        const rootTop = root.getBoundingClientRect().top;
        const nextActiveFile = pickTopFile(
          [...intersectingFilesRef.current.values()].map((file) => ({
            filePath: file.filePath,
            top: file.element.getBoundingClientRect().top - rootTop,
          })),
        );
        if (!nextActiveFile) return;
        setActiveFile((current) => (current === nextActiveFile ? current : nextActiveFile));
      },
      {
        root,
        rootMargin: "0px 0px -85% 0px",
      },
    );

    for (const file of diff.files) {
      const element = document.getElementById(fileAnchorId(file.filePath));
      if (!element) continue;
      elementToFilePath.set(element, file.filePath);
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      intersectingFilesRef.current.clear();
    };
  }, [diff.files]);

  useEffect(() => {
    if (!activeFile) return;
    sidebarButtonRefs.current.get(activeFile)?.scrollIntoView({ block: "nearest" });
  }, [activeFile]);

  const toggleCollapsed = (filePath: string) => {
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const handleFileClick = (filePath: string) => {
    setActiveFile(filePath);
    setCollapsedFiles((current) => {
      if (!current.has(filePath)) return current;
      const next = new Set(current);
      next.delete(filePath);
      return next;
    });
    const el = document.getElementById(fileAnchorId(filePath));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSidebarButtonRef = (filePath: string, element: HTMLButtonElement | null) => {
    if (element) {
      sidebarButtonRefs.current.set(filePath, element);
      return;
    }
    sidebarButtonRefs.current.delete(filePath);
  };

  return (
    <>
      <nav class="sidebar">
        <div class="sidebar-heading">
          Files ({diff.files.length}) · {diff.vcs} {diff.revset}
        </div>
        <div class="sidebar-tree">
          {renderSidebarNodes(fileTree, 0, activeFile, handleFileClick, handleSidebarButtonRef)}
        </div>
      </nav>
      <main class="main" ref={mainRef}>
        {orderedFiles.map((file, fileIdx) => (
          <FilePane
            key={file.filePath}
            file={file}
            fileIdx={fileIdx}
            anchorId={fileAnchorId(file.filePath)}
            comments={commentsByFile.get(file.filePath) ?? []}
            collapsed={collapsedFiles.has(file.filePath)}
            onToggleCollapsed={toggleCollapsed}
            onAddComment={props.onAddComment}
            onUpdateComment={props.onUpdateComment}
            onDeleteComment={props.onDeleteComment}
          />
        ))}
      </main>
    </>
  );
}

function fileAnchorId(filePath: string): string {
  // Anchor IDs must be valid HTML ids; encode slashes etc.
  return `file-${encodeURIComponent(filePath)}`;
}

type ObservedFileSection = {
  filePath: string;
  element: Element;
};

type RankedFileSection = {
  filePath: string;
  top: number;
};

function pickTopFile(files: Iterable<RankedFileSection>): string | null {
  let closestAboveTop: RankedFileSection | null = null;
  let closestBelowTop: RankedFileSection | null = null;

  for (const file of files) {
    if (file.top <= 0) {
      if (!closestAboveTop || file.top > closestAboveTop.top) {
        closestAboveTop = file;
      }
      continue;
    }

    if (!closestBelowTop || file.top < closestBelowTop.top) {
      closestBelowTop = file;
    }
  }

  return closestAboveTop?.filePath ?? closestBelowTop?.filePath ?? null;
}

function renderSidebarNodes(
  nodes: ReadonlyArray<FileTreeNode>,
  depth: number,
  activeFile: string,
  onFileClick: (filePath: string) => void,
  onFileButtonRef: (filePath: string, element: HTMLButtonElement | null) => void,
  parentPath = "",
): preact.JSX.Element[] {
  return nodes.map((node) => {
    if (node.kind === "dir") {
      const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
      return (
        <div key={`dir:${nodePath}`}>
          <div class="sidebar-dir" style={{ paddingLeft: `${16 + depth * 12}px` }}>
            {node.name}
          </div>
          {renderSidebarNodes(node.children, depth + 1, activeFile, onFileClick, onFileButtonRef, nodePath)}
        </div>
      );
    }

    const status = sidebarStatus(node.row.status);
    return (
      <button
        key={node.row.filePath}
        aria-label={sidebarAriaLabel(node.row)}
        class={`sidebar-file${node.row.filePath === activeFile ? " active" : ""}`}
        style={{ paddingLeft: `${16 + depth * 12}px` }}
        onClick={() => onFileClick(node.row.filePath)}
        ref={(element) => onFileButtonRef(node.row.filePath, element)}
      >
        <span class="sidebar-file-label">{fileName(node.row.filePath)}</span>
        <span class="sidebar-file-meta">
          <span class={`sidebar-file-status ${status.className}`} aria-hidden="true">
            {status.glyph}
          </span>
          {node.row.count > 0 ? <span class="sidebar-file-count">{node.row.count}</span> : null}
        </span>
      </button>
    );
  });
}

function sidebarAriaLabel(row: SidebarFileRow): string {
  const suffix = row.count > 0 ? ` ${row.count} comment${row.count === 1 ? "" : "s"}` : "";
  return `${row.filePath} ${row.status}${suffix}`;
}

function sidebarStatus(status: DiffFileStatus): { glyph: string; className: string } {
  switch (status) {
    case "added":
      return { glyph: "+", className: "status-added" };
    case "deleted":
      return { glyph: "-", className: "status-deleted" };
    case "modified":
    case "renamed":
      return { glyph: "~", className: "status-modified" };
  }
}
