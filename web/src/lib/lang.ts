// Map a file extension to a shiki language id. Returns null when we have no
// confident match — callers fall back to plain text.

const TABLE: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "bash",
  zsh: "shell",
  fish: "fish",
  ps1: "powershell",
  sql: "sql",
  nix: "nix",
  dockerfile: "docker",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql",
  gql: "graphql",
};

export function getLanguageFromPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith("/dockerfile") || lower === "dockerfile") return "docker";
  if (lower.endsWith("/makefile") || lower === "makefile") return "makefile";

  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return null;
  const ext = lower.slice(dot + 1);
  return TABLE[ext] ?? null;
}
