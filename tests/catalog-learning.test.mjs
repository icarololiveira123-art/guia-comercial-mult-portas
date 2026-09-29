import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { beginnerGlossary, brimakDocumentLessons, learningByBrand, measurementMethod, qualityMethod } from "../app/lib/catalog-learning.mjs";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const declaredBrands = [...page.matchAll(/type BrandId = ([^;]+);/g)][0][1].match(/"[a-z]+"/g).map((name) => name.slice(1, -1));

test("every catalog brand has a complete novice lesson and a useful self-check", () => {
  assert.deepEqual(Object.keys(learningByBrand).sort(), declaredBrands.sort());
  assert.ok(beginnerGlossary.length >= 8);
  assert.ok(measurementMethod.length >= 4);
  assert.ok(qualityMethod.length >= 4);

  for (const [brand, lesson] of Object.entries(learningByBrand)) {
    assert.ok(lesson.title?.length > 15, `${brand}: missing title`);
    for (const field of ["startingPoint", "measures", "scenario", "reasoning"]) {
      assert.ok(lesson[field]?.length > 40, `${brand}: missing explanation in ${field}`);
    }
    assert.ok(lesson.materials.length >= 2, `${brand}: insufficient material guidance`);
    assert.ok(lesson.quality.length >= 2, `${brand}: insufficient quality guidance`);
    assert.ok(lesson.source.href.startsWith("https://") || lesson.source.href.startsWith("/catalogos/"));
    assert.equal(lesson.quiz.options.length, 3);
    assert.ok(Number.isInteger(lesson.quiz.answer) && lesson.quiz.answer >= 0 && lesson.quiz.answer < 3);
    assert.ok(lesson.quiz.why.length > 40, `${brand}: answer needs teaching feedback`);
  }
});

test("every attached Brimak PDF has a distinct page-based lesson, measuring exercise and check", async () => {
  const hrefs = new Set(brimakDocumentLessons.map((lesson) => lesson.href));
  assert.equal(brimakDocumentLessons.length, 5);
  assert.equal(hrefs.size, 5);
  for (const lesson of brimakDocumentLessons) {
    assert.match(lesson.pages, /p\. /);
    for (const field of ["learn", "measurements", "inspect", "task"]) {
      assert.ok(lesson[field].length > 70, `${lesson.title}: missing ${field}`);
    }
    assert.ok(lesson.quiz.why.length > 40);
    assert.ok(page.includes(lesson.href), `${lesson.title}: missing catalog link in UI`);
    await access(new URL(`../public${lesson.href}`, import.meta.url));
  }
});
