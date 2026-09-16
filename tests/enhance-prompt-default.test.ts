// The default template must reproduce the prompt this plugin shipped with,
// byte for byte. tests/goldens/default-prompts.json was generated from the
// PRISTINE upstream buildEnhancePrompt (before it became a template), so this
// test is what makes "editing the prompt is optional" a fact rather than a
// claim: anyone who never opens the setting gets exactly the old behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildEnhancePrompt, type EnhanceContext } from "../lib/enhance-prompt";

interface Golden {
  name: string;
  ctx: EnhanceContext;
  draftLength: number;
  prompt: string;
}

const goldens = JSON.parse(
  readFileSync(new URL("./goldens/default-prompts.json", import.meta.url), "utf8"),
) as Golden[];

test("the golden fixture is present and covers the interesting matrix", () => {
  assert.ok(goldens.length >= 20, `only ${goldens.length} golden cases`);
  const names = new Set(goldens.map((entry) => entry.name));
  for (const required of [
    "new-task/minimal",
    "follow-up/minimal",
    "title+output",
    "kitchen-sink",
    "cap-plus-one",
  ]) {
    assert.ok(names.has(required), `missing golden case ${required}`);
  }
});

for (const golden of goldens) {
  test(`default template reproduces upstream output: ${golden.name}`, () => {
    // draftLength === 0 means the fixture draft was empty; rebuild the exact
    // inputs from the recorded case instead of re-reading the draft text.
    const draft = drafts.get(golden.name);
    assert.notEqual(draft, undefined, `no draft fixture for ${golden.name}`);
    const prompt = buildEnhancePrompt(draft!, golden.ctx);
    assert.equal(prompt, golden.prompt);
  });
}

/** Reconstructs each case's draft, matching the oracle's matrix exactly. */
const drafts = new Map<string, string>([
  ["new-task/minimal", "fix the bug"],
  ["follow-up/minimal", "fix it"],
  ["title-only", "continue"],
  ["output-only", "continue"],
  ["title+output", "fix that bug"],
  ["one-attachment", "go"],
  ["three-attachments", "go"],
  ["custom-instructions", "go"],
  ["custom-instructions-padded", "go"],
  ["custom-instructions-blank", "go"],
  ["custom-instructions-empty", "go"],
  ["references", "hello @world in src/x.ts — see https://x.dev/a?b=1"],
  ["code-and-shell", "run `npm test` then fix pkg/retry.ts:42"],
  ["at-cap", "x".repeat(8000)],
  ["cap-plus-one", "x".repeat(8001)],
  ["cap-plus-500", "x".repeat(8500)],
  ["kitchen-sink", "ok fix that in our code `git rebase` @file.ts"],
  ["draft-with-fences", 'draft with """ inside'],
  ["draft-with-newlines", "line one\nline two\n\nline four"],
  ["empty-draft", ""],
  ["unicode-draft", "oprav chybu v platbách — €100, pri 3 pokusoch"],
]);

test("every golden case has a draft fixture (guards silent test loss)", () => {
  for (const golden of goldens) {
    assert.ok(
      drafts.has(golden.name),
      `golden ${golden.name} has no matching draft fixture`,
    );
  }
});
