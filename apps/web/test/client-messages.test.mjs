/**
 * The browser gets the messages its code reads, and no others
 * (i18n/clientMessages.ts).
 *
 * Every page used to carry the whole catalogue, about 70 KB, most of a report
 * page's HTML. Cutting it has one way to go wrong: a client component that
 * reads a namespace left out shows its reader a message key instead of words.
 * So this walks every client module ("use client", and everything such a
 * module imports, which runs in the browser too) and holds each namespace it
 * reads to the list. The forum's modules may also read the forum's namespaces,
 * which the forum's own providers add.
 *
 *   node --test test/client-messages.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { CLIENT_NAMESPACES, FORUM_NAMESPACES } from "../i18n/clientMessages.ts";

const WEB = join(import.meta.dirname, "..");
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
    return /\.(tsx?|mjs|js)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

const FILES = ["app", "components", "lib", "i18n"].flatMap((d) => sources(join(WEB, d)));
const text = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));
const directive = (src, d) => new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${d}["']`).test(src);

/** The file an import names, if it is one of ours. */
function resolve(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(WEB, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")])
    if (text.has(c)) return c;
  return null;
}

function imports(file) {
  const src = text.get(file);
  const specs = [
    ...src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'"]*?\bfrom\s+["']([^"']+)["']/g),
    ...src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g),
    ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
  return specs.map((s) => resolve(file, s)).filter(Boolean);
}

/** Every module that runs in the browser: the "use client" ones and all they import. */
function clientModules() {
  const seen = new Set();
  const queue = FILES.filter((f) => directive(text.get(f), "use client"));
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const g of imports(f)) {
      // A server action is called from the browser, not run there.
      if (!directive(text.get(g), "use server")) queue.push(g);
    }
  }
  return [...seen];
}

/** The namespaces a module reads through useTranslations. */
function namespacesRead(src) {
  const out = new Set();
  const dynamic = [];
  for (const m of src.matchAll(/useTranslations\(([^)]*)\)/g)) {
    const arg = m[1].trim();
    if (arg === "") {
      // The whole catalogue: the namespace is the first part of each key.
      for (const k of src.matchAll(/\bt(?:\.rich|\.raw|\.has|\.markup)?\(\s*["'`]([A-Za-z]+)\./g)) out.add(k[1]);
      continue;
    }
    const literal = /^["'`]([A-Za-z]+)(?:\.[A-Za-z.]+)?["'`]$/.exec(arg);
    if (literal) out.add(literal[1]);
    else dynamic.push(arg);
  }
  return { out, dynamic };
}

const isForum = (f) => {
  const r = relative(WEB, f);
  return r.startsWith(join("components", "forum")) || r.startsWith(join("app", "[locale]", "(site)", "community"));
};

describe("the messages a page gives the browser", () => {
  const catalogue = JSON.parse(readFileSync(join(WEB, "messages", "en.json"), "utf8"));
  const client = clientModules();

  test("the walk finds the client modules", () => {
    assert.ok(client.length > 50, `only ${client.length} client modules found`);
    assert.ok(client.some((f) => f.endsWith(join("components", "report", "ReportForm.tsx"))));
  });

  test("every namespace a client module reads is given to it", () => {
    const missing = [];
    for (const f of client) {
      const { out, dynamic } = namespacesRead(text.get(f));
      const allowed = new Set([...CLIENT_NAMESPACES, ...(isForum(f) ? FORUM_NAMESPACES : [])]);
      for (const ns of out) if (!allowed.has(ns)) missing.push(`${relative(WEB, f)} reads "${ns}"`);
      for (const d of dynamic) missing.push(`${relative(WEB, f)} reads a namespace named at run time (${d})`);
    }
    assert.deepEqual(missing, []);
  });

  test("and no namespace is given that no client module reads", () => {
    const read = new Set(client.flatMap((f) => [...namespacesRead(text.get(f)).out]));
    assert.deepEqual(CLIENT_NAMESPACES.filter((ns) => !read.has(ns)), []);
  });

  test("each listed namespace exists, in both languages", () => {
    const zh = JSON.parse(readFileSync(join(WEB, "messages", "zh-TW.json"), "utf8"));
    for (const ns of [...CLIENT_NAMESPACES, ...FORUM_NAMESPACES]) {
      assert.ok(catalogue[ns], `en has no "${ns}"`);
      assert.ok(zh[ns], `zh-TW has no "${ns}"`);
    }
  });

  test("the pages only the server renders keep their text there", () => {
    for (const ns of ["about", "privacy", "terms", "home", "moderationGuide", "forum"])
      assert.ok(!CLIENT_NAMESPACES.includes(ns), ns);
  });

  test("the root layout gives the cut-down messages, and the forum adds its own", () => {
    const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
    assert.match(read("app", "[locale]", "layout.tsx"), /<NextIntlClientProvider messages=\{clientMessages\(await getMessages\(\)\)\}>/);
    for (const p of [["app", "[locale]", "(site)", "community", "layout.tsx"], ["components", "forum", "ForumAccount.tsx"]])
      assert.match(read(...p), /messages=\{clientMessages\(await getMessages\(\), FORUM_NAMESPACES\)\}/, p.join("/"));
    assert.doesNotMatch(read("app", "[locale]", "layout.tsx"), /<NextIntlClientProvider>/);
  });

  test("a report page carries the report form's words and not the privacy page's", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    for (const path of ["/en/report/roadkill", "/report/wildlife"]) {
      const html = await fetch(`${BASE_URL}${path}`).then((r) => r.text());
      const has = (ns) => new RegExp(`\\\\?"${ns}\\\\?":\\{`).test(html);
      assert.ok(has("report") && has("offline"), `${path} lacks the form's messages`);
      for (const ns of ["privacy", "terms", "moderationGuide", "forum"]) assert.ok(!has(ns), `${path} carries "${ns}"`);
    }
  });
});

