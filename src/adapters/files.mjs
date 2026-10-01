// Adapter: turn a plain directory of text files into records for the core dedup pipeline.
// The most broadly reusable adapter -- no git, no branches, works on any corpus: exported
// conversations, a document dump, a Google Drive export, anything that's just files on disk.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";

const DEFAULT_EXTENSIONS = new Set([".md", ".txt", ".json", ".mjs", ".js", ".ts"]);
const DEFAULT_IGNORE_DIRS = new Set(["node_modules", ".git", ".claude"]);
const DEFAULT_MAX_FILES = 5000;

/**
 * Best-effort, NOT a full .gitignore implementation: reads top-level entries of the target
 * directory's own .gitignore and treats any line naming a bare directory (`/name/`, `name/`,
 * or a plain `name` with no glob characters) as a directory to skip anywhere in the tree.
 * Deliberately skips real glob patterns (a wildcard extension, or a nested-path pattern) rather than mis-handling them --
 * this exists to catch the cheap, common case (a repo owner already said "this whole directory
 * isn't project content"), not to reimplement git's own ignore matching.
 */
function readGitignoreDirs(dir) {
  const path = join(dir, ".gitignore");
  if (!existsSync(path)) return new Set();
  const dirs = new Set();
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    if (/[*?[\]]/.test(line)) continue; // a real glob -- not handled, skip rather than mismatch
    const name = line.replace(/^\//, "").replace(/\/$/, "");
    if (name && !name.includes("/")) dirs.add(name); // only bare top-level directory names
  }
  return dirs;
}

/**
 * @param {string} dir
 * @param {{extensions?: Set<string>, ignoreDirs?: Set<string>, respectGitignore?: boolean, maxFiles?: number|false}} opts
 * @returns {{id: string, content: string}[]}  id is the path relative to `dir`
 */
export function loadRecordsFromDirectory(dir, opts = {}) {
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  const respectGitignore = opts.respectGitignore ?? true;
  const ignoreDirs = new Set([...(opts.ignoreDirs ?? DEFAULT_IGNORE_DIRS), ...(respectGitignore ? readGitignoreDirs(dir) : [])]);
  const maxFiles = opts.maxFiles === false ? Infinity : opts.maxFiles ?? DEFAULT_MAX_FILES;
  const records = [];

  function walk(current) {
    for (const entry of readdirSync(current)) {
      if (records.length >= maxFiles) return;
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!ignoreDirs.has(entry)) walk(full);
        continue;
      }
      if (!extensions.has(extname(entry))) continue;
      let content;
      try {
        content = readFileSync(full, "utf8");
      } catch {
        continue; // binary or unreadable -- skip, not this adapter's job (see README limitations)
      }
      records.push({ id: relative(dir, full).split("\\").join("/"), content });
    }
  }

  walk(dir);
  if (records.length >= maxFiles) {
    throw new Error(
      `Stopped at maxFiles=${maxFiles} while walking ${dir} -- this is a safety cap, not a real limit. ` +
        `Either the corpus is genuinely this large (pass --max-files <n> or --max-files false to proceed, ` +
        `understanding the O(n^2) layers get expensive fast, see README), or a directory that shouldn't be ` +
        `scanned wasn't excluded (check --ignore-dirs and whether .gitignore actually covers it).`
    );
  }
  return records;
}

/** Fast, content-free scan: how many files would be walked, and how big, without reading any of
 * them. Use this before a real run to sanity-check scope on an unfamiliar directory -- the
 * actual lowest-cost step in this whole pipeline is finding out you're about to scan the wrong
 * thing before paying for it. */
export function countRecordsInDirectory(dir, opts = {}) {
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  const respectGitignore = opts.respectGitignore ?? true;
  const ignoreDirs = new Set([...(opts.ignoreDirs ?? DEFAULT_IGNORE_DIRS), ...(respectGitignore ? readGitignoreDirs(dir) : [])]);
  let count = 0;
  let totalBytes = 0;
  const byExtension = new Map();

  function walk(current) {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!ignoreDirs.has(entry)) walk(full);
        continue;
      }
      const ext = extname(entry);
      if (!extensions.has(ext)) continue;
      count++;
      totalBytes += st.size;
      byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1);
    }
  }

  walk(dir);
  return { count, totalBytes, byExtension: Object.fromEntries(byExtension), ignoredDirs: [...ignoreDirs] };
}
