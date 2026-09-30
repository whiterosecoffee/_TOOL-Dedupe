// Adapter: turn a plain directory of text files into records for the core dedup pipeline.
// The most broadly reusable adapter -- no git, no branches, works on any corpus: exported
// conversations, a document dump, a Google Drive export, anything that's just files on disk.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const DEFAULT_EXTENSIONS = new Set([".md", ".txt", ".json", ".mjs", ".js", ".ts"]);
const DEFAULT_IGNORE_DIRS = new Set(["node_modules", ".git", ".claude"]);

/**
 * @param {string} dir
 * @param {{extensions?: Set<string>, ignoreDirs?: Set<string>}} opts
 * @returns {{id: string, content: string}[]}  id is the path relative to `dir`
 */
export function loadRecordsFromDirectory(dir, opts = {}) {
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  const ignoreDirs = opts.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
  const records = [];

  function walk(current) {
    for (const entry of readdirSync(current)) {
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
  return records;
}
