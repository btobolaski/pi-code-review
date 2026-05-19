import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Comment, DiffPayload, ReviewSide, SubmitPayload } from "./types.js";

export type ReviewDecision = { kind: "submitted"; payload: SubmitPayload } | { kind: "cancelled" };

export type ReviewSession = {
  url: string;
  port: number;
  waitForDecision(): Promise<ReviewDecision>;
  stop(): void;
};

export type StartReviewServerOptions = {
  diff: DiffPayload;
  /** Absolute path to the directory containing index.html + assets/. */
  webDistDir: string;
};

/**
 * Default location for the built frontend assets, computed from this module's
 * file URL. Used by the extension when the caller does not override it.
 */
export function defaultWebDistDir(): string {
  // server.ts -> extension/src/server.ts
  // dist -> ../../web/dist relative to that file when running from source.
  const here = fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "..", "..", "web", "dist");
}

export function webDistMissingMessage(webDistDir: string): string {
  return (
    `Frontend assets are missing at ${webDistDir}. ` +
    `Run \`pnpm install && pnpm --filter web build\` in the pi-code-review repo first.`
  );
}

const PORT_ENV = "PI_CODE_REVIEW_PORT";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export async function startReviewServer(options: StartReviewServerOptions): Promise<ReviewSession> {
  const { diff, webDistDir } = options;

  if (!existsSync(join(webDistDir, "index.html"))) {
    throw new Error(webDistMissingMessage(webDistDir));
  }

  let resolveDecision!: (decision: ReviewDecision) => void;
  const decisionPromise = new Promise<ReviewDecision>((r) => {
    resolveDecision = r;
  });
  let decided = false;
  const decide = (decision: ReviewDecision): void => {
    if (decided) return;
    decided = true;
    resolveDecision(decision);
  };

  const server = createServer((req, res) => {
    void handle(req, res, diff, webDistDir, decide).catch((err) => {
      // Belt-and-braces: any unhandled error becomes a 500 without crashing
      // the long-lived server.
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }
      res.end(`Internal server error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  const port = await listen(server);

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    waitForDecision: () => decisionPromise,
    stop: () => {
      // Resolve to "cancelled" if the caller stops the server before the user
      // makes a decision, so any waiting awaiter unblocks.
      decide({ kind: "cancelled" });
      server.close();
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  diff: DiffPayload,
  webDistDir: string,
  decide: (d: ReviewDecision) => void,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/api/diff" && req.method === "GET") {
    sendJson(res, 200, diff);
    return;
  }

  if (pathname === "/api/submit" && req.method === "POST") {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : "invalid request body",
      });
      return;
    }
    const validated = validateSubmitPayload(body);
    if (validated === null) {
      sendJson(res, 400, { ok: false, error: "invalid submit payload" });
      return;
    }
    sendJson(res, 200, { ok: true });
    decide({ kind: "submitted", payload: validated });
    return;
  }

  if (pathname === "/api/cancel" && req.method === "POST") {
    sendJson(res, 200, { ok: true });
    decide({ kind: "cancelled" });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end();
    return;
  }

  const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  await serveStatic(res, webDistDir, relPath, req.method === "HEAD");
}

async function serveStatic(
  res: ServerResponse,
  root: string,
  relPath: string,
  headOnly: boolean,
): Promise<void> {
  // Resolve against root, then make sure the resolved path stays inside root.
  const safeRel = normalize(relPath).replace(/^([./\\])+/g, "");
  const fullPath = join(root, safeRel);
  if (!fullPath.startsWith(root)) {
    res.statusCode = 403;
    res.end();
    return;
  }

  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    // SPA fallback: serve index.html so client-side routing works if we add it.
    const fallback = join(root, "index.html");
    if (existsSync(fallback)) {
      res.statusCode = 200;
      res.setHeader("content-type", MIME[".html"]);
      const html = await readFile(fallback);
      res.end(headOnly ? undefined : html);
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  const ext = extname(fullPath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("cache-control", "no-store");

  if (headOnly) {
    res.end();
    return;
  }
  createReadStream(fullPath).pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * Submit/cancel bodies are tiny review payloads; even a verbose review
 * shouldn't exceed a few hundred KB. Cap at 1 MB so a malformed or runaway
 * client can't grow our memory unboundedly.
 */
const MAX_BODY_BYTES = 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("request body is not valid JSON");
  }
}

/**
 * Best-effort validator that only keeps comments whose required fields are
 * well-typed. Discards malformed entries rather than rejecting the whole
 * payload — the reviewer's other comments shouldn't be lost to one bad row.
 * Returns `null` if the top-level shape is wrong.
 */
export function validateSubmitPayload(value: unknown): SubmitPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary : undefined;
  if (obj.summary !== undefined && typeof obj.summary !== "string") return null;

  let commentsIn: unknown[];
  if (obj.comments === undefined) commentsIn = [];
  else if (Array.isArray(obj.comments)) commentsIn = obj.comments;
  else return null;
  const comments: Comment[] = [];
  for (const raw of commentsIn) {
    const c = validateComment(raw);
    if (c !== null) comments.push(c);
  }
  return { summary, comments };
}

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function validateComment(value: unknown): Comment | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.filePath !== "string" || c.filePath === "") return null;
  if (typeof c.body !== "string") return null;
  if (c.kind === "file") {
    return { kind: "file", filePath: c.filePath, body: c.body };
  }
  if (c.kind === "line") {
    const side = c.side;
    if (side !== "left" && side !== "right") return null;
    const startLine = c.startLine;
    const endLine = c.endLine;
    if (!isPositiveSafeInt(startLine)) return null;
    if (!isPositiveSafeInt(endLine)) return null;
    if (startLine > endLine) return null;
    return {
      kind: "line",
      filePath: c.filePath,
      side: side as ReviewSide,
      startLine,
      endLine,
      body: c.body,
    };
  }
  return null;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const portEnv = process.env[PORT_ENV];
    const port = portEnv ? Number(portEnv) : 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      rejectPort(new Error(`Invalid ${PORT_ENV}: ${portEnv}`));
      return;
    }
    server.once("error", rejectPort);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", rejectPort);
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        rejectPort(new Error("Unexpected server address"));
        return;
      }
      resolvePort(addr.port);
    });
  });
}
