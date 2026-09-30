import { REPLY_DEPTH_MAX } from "./policy.ts";
import type { ReplySort } from "./rank.ts";

/**
 * A thread's replies as a tree: who answered whom, in the order the reader
 * asked for.
 *
 * Pure, so test/forum-tree.test.mjs can build awkward trees by hand — a
 * removed reply with answers under it, a conversation past the fourth level —
 * and check where everything lands without a database or a page.
 */

/** What the tree needs of a post. The rows carry more; the tree hands them back untouched. */
export type TreeRow = {
  id: string;
  /** The reply it answers; null for a reply to the thread, or once the one it answered is purged. */
  parent_id: string | null;
  /** Where it sits: the ids above it, top first (migration 0030 sets it). */
  path: string[];
  score: number;
  created_at: Date;
};

export type ReplyNode<T extends TreeRow> = {
  id: string;
  /** 0 for a reply to the thread, up to REPLY_DEPTH_MAX - 1. */
  depth: number;
  /**
   * Null for "[removed]": a post this reader cannot see (held, hidden,
   * deleted or purged), kept as a place so the replies under it stay where
   * they were instead of jumping to the top or vanishing with it.
   */
  post: T | null;
  /**
   * The reply this one answers, when that is not the one it sits under: on
   * the last level replies go beside what they answer, not below it.
   */
  answers: string | null;
  children: ReplyNode<T>[];
};

/**
 * Arrange a thread's replies (not its opening post) into a tree.
 *
 * `rows` is every reply this reader may see. An id in someone's path that is
 * not among them becomes a "[removed]" node, under whatever was above it.
 *
 * Order within each level:
 *   best  highest score first; ties, the older first. "[removed]" places go
 *         after the posts, since nobody here can see what they scored.
 *   new   newest first. A "[removed]" place counts as old as the first reply
 *         under it, the nearest thing to its own time this reader may know.
 * On the last level it is always oldest first, whichever was asked for: that
 * level is a back-and-forth, and a conversation read out of order is not one.
 *
 * `maxDepth` is REPLY_DEPTH_MAX; the tests pass smaller ones. Paths longer
 * than it allows (the database keeps them to REPLY_DEPTH_MAX - 1) are cut to
 * fit, so the tree never goes deeper whatever it is given.
 */
export function buildReplyTree<T extends TreeRow>(
  rows: readonly T[],
  sort: ReplySort,
  maxDepth: number = REPLY_DEPTH_MAX,
): ReplyNode<T>[] {
  const levels = Math.max(1, Math.floor(maxDepth));
  const nodes = new Map<string, ReplyNode<T>>();
  /** A node's parent in the tree: null for the top. */
  const above = new Map<string, string | null>();

  const placeOf = (r: T) => r.path.slice(0, levels - 1);

  for (const r of rows) {
    const path = placeOf(r);
    const parent = path.at(-1) ?? null;
    nodes.set(r.id, {
      id: r.id,
      depth: path.length,
      post: r,
      answers: r.parent_id !== null && r.parent_id !== parent ? r.parent_id : null,
      children: [],
    });
    above.set(r.id, parent);
  }
  // A place for each missing post above a visible one. Every path through it
  // agrees on what is above it, so the first one found is as good as any.
  for (const r of rows) {
    const path = placeOf(r);
    path.forEach((id, i) => {
      if (nodes.has(id)) return;
      nodes.set(id, { id, depth: i, post: null, answers: null, children: [] });
      above.set(id, i === 0 ? null : path[i - 1]);
    });
  }

  const top: ReplyNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = above.get(node.id) ?? null;
    if (parent === null) top.push(node);
    else nodes.get(parent)!.children.push(node);
  }

  const seen = new Map<string, number>();
  const firstSeen = (n: ReplyNode<T>): number => {
    const known = seen.get(n.id);
    if (known !== undefined) return known;
    const t = n.post ? n.post.created_at.getTime() : Math.min(Infinity, ...n.children.map(firstSeen));
    seen.set(n.id, t);
    return t;
  };
  const byId = (a: ReplyNode<T>, b: ReplyNode<T>) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const oldestFirst = (a: ReplyNode<T>, b: ReplyNode<T>) => firstSeen(a) - firstSeen(b) || byId(a, b);
  const order =
    sort === "new"
      ? (a: ReplyNode<T>, b: ReplyNode<T>) => firstSeen(b) - firstSeen(a) || byId(a, b)
      : (a: ReplyNode<T>, b: ReplyNode<T>) => {
          if (!a.post || !b.post) return a.post ? -1 : b.post ? 1 : oldestFirst(a, b);
          return b.post.score - a.post.score || oldestFirst(a, b);
        };

  const arrange = (list: ReplyNode<T>[], depth: number) => {
    list.sort(depth === levels - 1 ? oldestFirst : order);
    for (const n of list) arrange(n.children, depth + 1);
  };
  arrange(top, 0);
  return top;
}
