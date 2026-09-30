/**
 * How the forum's feeds are ordered (lib/forum/rank.ts): Reddit's Hot, and
 * what the words in a feed's address mean.
 *
 * Hot is held to its properties rather than to numbers copied out of the
 * function: more score ranks higher at the same age, newer ranks higher at the
 * same score, ten times the score is worth 12.5 hours, and a thread voted down
 * sinks as fast as one voted up rises. test/forum-votes.test.mjs holds the
 * database's `hot` column to the same function.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  hotRank,
  parseFeedSort,
  feedQuery,
  parseReplySort,
  HOT_DECAY_SECONDS,
  FEED_SORTS,
  TOP_WINDOWS,
} from "../lib/forum/rank.ts";

const t0 = new Date("2026-10-01T08:00:00Z");
const later = (hours) => new Date(t0.getTime() + hours * 3600_000);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

describe("hot", () => {
  test("at the same age, a higher score ranks higher", () => {
    const scores = [-50, -2, -1, 0, 1, 2, 10, 500];
    for (let i = 1; i < scores.length; i++) {
      const [lo, hi] = [scores[i - 1], scores[i]];
      assert.ok(hotRank(hi, t0) >= hotRank(lo, t0), `${hi} vs ${lo}`);
    }
    assert.ok(hotRank(2, t0) > hotRank(1, t0));
    assert.ok(hotRank(-2, t0) < hotRank(-1, t0));
  });

  test("at the same score, a newer thread ranks higher", () => {
    for (const s of [-10, 0, 1, 100]) assert.ok(hotRank(s, later(1)) > hotRank(s, t0), String(s));
  });

  test("ten times the score is worth 12.5 hours", () => {
    assert.equal(HOT_DECAY_SECONDS, 45000);
    close(hotRank(100, t0), hotRank(10, later(12.5)), "100 now ranks with 10 twelve and a half hours later");
    close(hotRank(10, t0), hotRank(1, later(12.5)), "and 10 with 1");
  });

  test("the first votes count most", () => {
    const gain = (from, to) => hotRank(to, t0) - hotRank(from, t0);
    close(gain(1, 10), gain(10, 100), "1 to 10 is worth 10 to 100");
    assert.ok(gain(1, 2) > gain(101, 102));
  });

  test("voted down sinks as fast as voted up rises", () => {
    close(hotRank(10, t0) - hotRank(0, t0), hotRank(0, t0) - hotRank(-10, t0), "symmetric about zero");
  });

  test("a score of 1 or -1 is no different from none", () => {
    // log10(1) is 0: one person's vote alone does not lift a thread above
    // one posted a minute later.
    close(hotRank(1, t0), hotRank(0, t0), "1");
    close(hotRank(-1, t0), hotRank(0, t0), "-1");
    assert.ok(hotRank(0, later(1 / 60)) > hotRank(1, t0));
  });

  test("a day-old thread needs a score of about 83 to stay level with a new one", () => {
    // 24 hours is 1.92 powers of ten of score (86,400 / 45,000), and
    // 10^1.92 is 83. That is what makes the front page turn over.
    assert.ok(hotRank(1, later(24)) > hotRank(80, t0));
    assert.ok(hotRank(1, later(24)) < hotRank(90, t0));
  });
});

describe("a feed's address", () => {
  test("Hot is the default, and anything unknown is Hot", () => {
    for (const s of [undefined, "", "HOT", "best", "rising", "top ", 1])
      assert.deepEqual(parseFeedSort(s, undefined), { sort: "hot", window: "all" }, JSON.stringify(s));
  });

  test("New and Hot ignore the window; Top without one is all time", () => {
    assert.deepEqual(parseFeedSort("new", "day"), { sort: "new", window: "all" });
    assert.deepEqual(parseFeedSort("hot", "week"), { sort: "hot", window: "all" });
    assert.deepEqual(parseFeedSort("top", undefined), { sort: "top", window: "all" });
    assert.deepEqual(parseFeedSort("top", "year"), { sort: "top", window: "all" });
  });

  test("Top today, this week and all time", () => {
    for (const w of TOP_WINDOWS) assert.deepEqual(parseFeedSort("top", w), { sort: "top", window: w });
  });

  test("every order writes an address that reads back as itself, defaults left out", () => {
    for (const s of FEED_SORTS)
      for (const w of TOP_WINDOWS) {
        const q = feedQuery(s, w);
        const back = parseFeedSort(q.sort, q.t);
        assert.equal(back.sort, s);
        if (s === "top") assert.equal(back.window, w);
      }
    assert.deepEqual(feedQuery("hot", "all"), {});
    assert.deepEqual(feedQuery("top", "all"), { sort: "top" });
    assert.deepEqual(feedQuery("top", "week"), { sort: "top", t: "week" });
  });

  test("replies are Best unless the address says New", () => {
    assert.equal(parseReplySort(undefined), "best");
    assert.equal(parseReplySort("new"), "new");
    assert.equal(parseReplySort("top"), "best");
  });
});
