/**
 * Generates docs/redesign/zh-tw-review.md: every zh-TW string the trust-tier
 * branches add or rewrite, English beside Chinese, with a blank line under each
 * for the replacement.
 *
 *   node docs/redesign/tools/zh-diff.mjs > docs/redesign/zh-tw-review.md
 *
 * Generated rather than typed because the alternative is a hand-kept list that
 * silently drifts from the catalogues. A key is included when its zh-TW value
 * differs from main's — so a rewrite of existing copy counts, not only a new
 * key. First branch in BRANCHES order owns a key both touch.
 *
 * After the branches merge, point BRANCHES at whatever is unmerged and re-run.
 */
import { execSync } from "node:child_process";

const BRANCHES = [
  ["blur-unknown-taxa", "#44 Blur records nobody has identified"],
  ["map-legend-truth", "#46 Map legend describes what the map draws"],
  ["copy-that-is-true", "#47 Stop telling visitors untrue things"],
  ["keep-what-you-chose", "#48 Stop throwing away what the reader chose"],
  ["report-receipts-truth", "#49 Tell the reporter what the server said"],
];

const sh = (c) => execSync(c, { encoding: "utf8", maxBuffer: 1 << 28 });
const show = (ref, path) => { try { return JSON.parse(sh(`git show ${ref}:${path}`)); } catch { return {}; } };

// Flatten a catalogue to dotted key -> string.
const flat = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o ?? {})) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") flat(v, key, out);
    else out[key] = String(v);
  }
  return out;
};

const mainZh = flat(show("main", "apps/web/messages/zh-TW.json"));
const mainEn = flat(show("main", "apps/web/messages/en.json"));

const rows = new Map(); // key -> {en, zh, from}
for (const [br, label] of BRANCHES) {
  const zh = flat(show(`origin/${br}`, "apps/web/messages/zh-TW.json"));
  const en = flat(show(`origin/${br}`, "apps/web/messages/en.json"));
  for (const [k, v] of Object.entries(zh)) {
    if (mainZh[k] === v) continue;          // unchanged
    if (rows.has(k)) continue;              // first branch that owns it wins
    rows.set(k, { en: en[k] ?? "", zh: v, was: mainZh[k], from: label, isNew: !(k in mainZh) });
  }
}

const groups = new Map();
for (const [k, r] of rows) {
  if (!groups.has(r.from)) groups.set(r.from, []);
  groups.get(r.from).push([k, r]);
}

let out = `# zh-TW copy review

${rows.size} strings across five branches. Every one is machine-written Traditional Chinese
that no native reader has seen. The English is the source; the Chinese is what the site
will show a Taiwanese visitor.

**What to do:** read the 中文 column. If it is wrong, unnatural, or too formal for a
public conservation site, write the replacement in the blank line under it. Leave it
blank if it is fine. Keys marked *(rewrite)* already existed — the old wording is shown
so you can see what changed.

Tone already chosen: plain, second person, no exclamation marks, no 您.

---
`;

for (const [label, items] of groups) {
  out += `\n## ${label}\n\n`;
  for (const [k, r] of items) {
    out += `### \`${k}\`${r.isNew ? "" : " *(rewrite)*"}\n\n`;
    out += `| | |\n|---|---|\n`;
    out += `| EN | ${r.en.replace(/\|/g, "\\|").replace(/\n/g, " ")} |\n`;
    if (!r.isNew && r.was) out += `| 舊 | ${r.was.replace(/\|/g, "\\|").replace(/\n/g, " ")} |\n`;
    out += `| 中文 | ${r.zh.replace(/\|/g, "\\|").replace(/\n/g, " ")} |\n`;
    out += `\n改成：\n\n\n`;
  }
}

process.stdout.write(out);
console.error(`${rows.size} strings, ${groups.size} groups`);
