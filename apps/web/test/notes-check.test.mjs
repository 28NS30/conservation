/**
 * What the report form notices in the notes before they are made public.
 *
 * The notes are shown on every record at its exact place, which now includes
 * every report naming an invasive animal, and most reporters are students. So
 * the form warns, without refusing, when the notes look like they carry a
 * location, a way to reach someone, a home address or a school
 * (lib/report/notesCheck.ts). These are the table it is held to: each kind of
 * thing it must notice, and the ordinary roadkill sentences it must not, since
 * a warning on every note about 路邊 or 國道3號 would teach people to ignore it.
 *
 *   node --test test/notes-check.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notesConcerns } from "../lib/report/notesCheck.ts";

const read = (...p) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");

const cases = (concern, texts) =>
  test(concern, () => {
    for (const text of texts)
      assert.ok(notesConcerns(text).includes(concern), `${concern} not noticed in ${JSON.stringify(text)}`);
  });

describe("what the notes check notices", () => {
  // The screen the server applies (lib/abuse.ts through lib/forum/screen.ts).
  cases("location", [
    "found at 25.0330, 121.5654 by the road",
    "https://maps.app.goo.gl/abc123 here",
    "７QQ32GJQ+XV",
    "北緯25.03度 東經121.56度",
  ]);

  cases("contact", [
    "email me at someone@example.org",
    "0912-345-678",
    "+886 912 345 678",
    "加line: birder88",
    // Handles, wider than the server's @[a-z0-9_]{4,}.
    "IG @lin.xiao",
    "我的IG@abc",
    "@小明",
    "t.me/someone",
    "https://www.instagram.com/someone",
  ]);

  cases("address", [
    "台北市中山區民生東路三段100號",
    "15巷3弄",
    "住在8號",
    "中正路二段",
    "民生街100",
    "仁愛路 12",
    "No. 8, Lane 15, Zhongshan Rd",
    "Sec. 2, Minsheng E. Rd",
    "十二巷",
  ]);

  cases("school", [
    "我是建國中學的學生",
    "放學走回家，在XX國小門口",
    "XX國中後面",
    "我們高中旁邊",
    "臺灣大學",
    "a student at Taipei Municipal Jianguo High School",
    "National Taiwan University",
  ]);
});

describe("what it leaves alone", () => {
  test("ordinary notes say nothing", () => {
    for (const text of [
      "",
      "   ",
      "在馬路上被車撞了",
      "路殺，路邊發現",
      "公路 50 公尺處",
      "路邊 3 隻",
      "道路旁的水溝",
      "山路上，大約早上七點",
      "國道3號北上",
      "國道 10 號南下 23 公里處",
      "台9線",
      "民生街附近的田",
      "左後腳受傷，還會動",
      "about 30 cm long, by the 23 km marker",
      "no 2 of them were alive",
      "seen twice, 3 days apart",
      "great tit on the fence",
    ])
      assert.deepEqual(notesConcerns(text), [], JSON.stringify(text));
  });
});

describe("the form shows it", () => {
  const form = read("components", "report", "ReportForm.tsx");
  const catalogue = (l) => JSON.parse(read("messages", `${l}.json`));

  test("a hint under the notes, and the warning beside it, in both languages", () => {
    assert.match(form, /notesConcerns\(notes\)/);
    assert.match(form, /t\("notesPublic"\)/);
    assert.match(form, /t\(`notesWarning\.\$\{/);
    for (const l of ["en", "zh-TW"]) {
      const r = catalogue(l).report;
      assert.equal(typeof r.notesPublic, "string", l);
      for (const k of ["location", "contact", "address", "school"])
        assert.equal(typeof r.notesWarning[k], "string", `${l} notesWarning.${k}`);
    }
    assert.equal(
      catalogue("zh-TW").report.notesPublic,
      "備註會公開顯示在紀錄頁。請不要寫姓名、學校、住址或聯絡方式。",
    );
    assert.equal(
      catalogue("en").report.notesPublic,
      "Notes are shown publicly on the record page. Please don't include names, schools, addresses or contact details.",
    );
  });

  test("it warns and never blocks", () => {
    // The send button's state comes from sendControls, which knows nothing
    // about the notes; nothing about the warning may reach it.
    const controls = form.slice(form.indexOf("sendControls({"), form.indexOf("});", form.indexOf("sendControls({")));
    assert.doesNotMatch(controls, /notes/i);
    assert.match(form, /aria-describedby=\{notesConcern \? "notes-hint notes-warning" : "notes-hint"\}/);
  });
});
