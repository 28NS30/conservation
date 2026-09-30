/**
 * A thread's replies as a tree (lib/forum/tree.ts): nesting, Best and New,
 * the fourth level going flat, and a removed reply keeping its place so the
 * answers to it do not jump to the top or vanish with it.
 *
 * The rows here are what migration 0030 would have stored: `path` is the ids
 * above a reply, top first, never more than three.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildReplyTree } from "../lib/forum/tree.ts";

const t = (min) => new Date(Date.UTC(2026, 9, 1, 8, min));
const row = (id, { path = [], parent = path.at(-1) ?? null, score = 0, at = 0 } = {}) => ({
  id,
  parent_id: parent,
  path,
  score,
  created_at: t(at),
});
/** The tree as nested arrays of ids, "[x]" for a removed place, for readable assertions. */
const shape = (nodes) => nodes.map((n) => (n.children.length ? [label(n), shape(n.children)] : label(n)));
const label = (n) => (n.post ? n.id : `[${n.id}]`);

describe("levels", () => {
  test("replies to the thread are the top; replies to them go under them", () => {
    const tree = buildReplyTree(
      [row("a", { at: 1 }), row("b", { at: 2 }), row("a1", { path: ["a"], at: 3 }), row("a1x", { path: ["a", "a1"], at: 4 })],
      "new",
    );
    assert.deepEqual(shape(tree), ["b", ["a", [["a1", ["a1x"]]]]]);
    assert.deepEqual(
      [tree[1].depth, tree[1].children[0].depth, tree[1].children[0].children[0].depth],
      [0, 1, 2],
    );
  });

  test("the rows come back untouched", () => {
    const r = row("a", { score: 3 });
    assert.equal(buildReplyTree([r], "best")[0].post, r);
  });

  test("nothing, for a thread with no replies", () => {
    assert.deepEqual(buildReplyTree([], "best"), []);
  });
});

describe("Best and New", () => {
  const rows = [row("old-3", { score: 3, at: 1 }), row("mid-9", { score: 9, at: 2 }), row("new-3", { score: 3, at: 3 })];

  test("Best: highest score first, the older first on a tie", () => {
    assert.deepEqual(shape(buildReplyTree(rows, "best")), ["mid-9", "old-3", "new-3"]);
  });

  test("New: newest first", () => {
    assert.deepEqual(shape(buildReplyTree(rows, "new")), ["new-3", "mid-9", "old-3"]);
  });

  test("each level is sorted on its own", () => {
    const tree = buildReplyTree(
      [row("p", { score: 0 }), row("c-low", { path: ["p"], score: -2, at: 1 }), row("c-high", { path: ["p"], score: 4, at: 2 })],
      "best",
    );
    assert.deepEqual(shape(tree), [["p", ["c-high", "c-low"]]]);
  });

  test("a negative score sorts below none", () => {
    assert.deepEqual(shape(buildReplyTree([row("down", { score: -1 }), row("none", { at: 1 })], "best")), ["none", "down"]);
  });
});

describe("the fourth level goes flat", () => {
  // a > b > c > d is four levels. e answers d, and f answers e: the database
  // put both beside d, on the fourth level, with parent_id saying whom.
  const chain = [
    row("a", { at: 1 }),
    row("b", { path: ["a"], at: 2 }),
    row("c", { path: ["a", "b"], at: 3 }),
    row("d", { path: ["a", "b", "c"], at: 4, score: 1 }),
    row("e", { path: ["a", "b", "c"], parent: "d", at: 5, score: 10 }),
    row("f", { path: ["a", "b", "c"], parent: "e", at: 6 }),
  ];

  test("nothing is deeper than four levels", () => {
    const tree = buildReplyTree(chain, "best");
    assert.deepEqual(shape(tree), [["a", [["b", [["c", ["d", "e", "f"]]]]]]]);
    const deepest = tree[0].children[0].children[0].children;
    assert.deepEqual(deepest.map((n) => n.depth), [3, 3, 3]);
  });

  test("and says whom each one answers, when it is not the one above it", () => {
    const deepest = buildReplyTree(chain, "best")[0].children[0].children[0].children;
    assert.deepEqual(deepest.map((n) => n.answers), [null, "d", "e"]);
  });

  test("in the order it was said, whatever the sort: e scores highest and still comes after d", () => {
    for (const sort of ["best", "new"]) {
      const deepest = buildReplyTree(chain, sort)[0].children[0].children[0].children;
      assert.deepEqual(deepest.map((n) => n.id), ["d", "e", "f"], sort);
    }
  });

  test("a shallower cap cuts deeper paths to fit", () => {
    const tree = buildReplyTree(chain, "best", 2);
    assert.deepEqual(shape(tree), [["a", ["b", "c", "d", "e", "f"]]]);
    assert.deepEqual(
      tree[0].children.map((n) => n.answers),
      [null, "b", "c", "d", "e"],
    );
  });
});

describe("a removed reply keeps its place", () => {
  test("a reply to a removed reply sits under a [removed], not at the top", () => {
    // "gone" is hidden, held or deleted: this reader was not given it.
    const tree = buildReplyTree([row("a", { at: 1 }), row("answer", { path: ["gone"], at: 5 })], "new");
    assert.deepEqual(shape(tree), [["[gone]", ["answer"]], "a"]);
    const gone = tree[0];
    assert.equal(gone.post, null);
    assert.equal(gone.depth, 0);
  });

  test("in the middle of a branch too, with everything below still in order", () => {
    const tree = buildReplyTree(
      [row("a"), row("c", { path: ["a", "b"], at: 2 }), row("d", { path: ["a", "b", "c"], at: 3 })],
      "best",
    );
    assert.deepEqual(shape(tree), [["a", [["[b]", [["c", ["d"]]]]]]]);
  });

  test("one place for a removed reply, however many answers it had", () => {
    const tree = buildReplyTree(
      [row("x", { path: ["gone"], at: 1 }), row("y", { path: ["gone"], at: 2 }), row("z", { path: ["gone", "y"], at: 3 })],
      "best",
    );
    assert.deepEqual(shape(tree), [["[gone]", ["x", ["y", ["z"]]]]]);
  });

  test("Best puts removed places after the posts: nobody here can see their score", () => {
    const tree = buildReplyTree([row("low", { score: -5, at: 9 }), row("under", { path: ["gone"], score: 50, at: 1 })], "best");
    assert.deepEqual(shape(tree), ["low", ["[gone]", ["under"]]]);
  });

  test("New dates a removed place by the first answer under it", () => {
    const rows = [row("early", { at: 1 }), row("late", { at: 9 }), row("under", { path: ["gone"], at: 5 })];
    assert.deepEqual(shape(buildReplyTree(rows, "new")), ["late", ["[gone]", ["under"]], "early"]);
  });

  test("a reply whose parent was purged keeps its place from its path", () => {
    // The purge sets parent_id null (migration 0030); the path still knows.
    const tree = buildReplyTree([row("orphan", { path: ["purged"], parent: null })], "best");
    assert.deepEqual(shape(tree), [["[purged]", ["orphan"]]]);
    assert.equal(tree[0].children[0].answers, null);
  });

  test("a removed reply nobody answered leaves nothing", () => {
    // There is no row for it and no path through it: nothing to keep a place for.
    assert.deepEqual(shape(buildReplyTree([row("a")], "best")), ["a"]);
  });
});
