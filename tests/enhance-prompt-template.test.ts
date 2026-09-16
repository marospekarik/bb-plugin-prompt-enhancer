// The editable template: substitution, optional blocks, validation, and the
// guarantee that an edited template actually reaches the rewriter.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROMPT_TEMPLATE,
  buildEnhancePrompt,
  renderPromptTemplate,
  TEMPLATE_CAP,
  TEMPLATE_VARIABLES,
  validatePromptTemplate,
  type EnhanceContext,
} from "../lib/enhance-prompt";

function ctx(overrides: Partial<EnhanceContext> = {}): EnhanceContext {
  return {
    kind: "new-task",
    attachmentCount: 0,
    threadTitle: null,
    lastOutput: null,
    customInstructions: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Editing is actually effective
// ---------------------------------------------------------------------------

test("a custom template replaces the shipped instruction entirely", () => {
  const prompt = buildEnhancePrompt(
    "fix the bug",
    ctx(),
    "Only output a one-line title. Draft: {{draft}}",
  );
  assert.equal(prompt, "Only output a one-line title. Draft: fix the bug");
  assert.doesNotMatch(prompt, /You rewrite rough draft prompts/);
});

test("an inline placeholder substitutes inside surrounding prose", () => {
  const prompt = renderPromptTemplate(
    "Rewrite this: {{draft}} — in {{kindRule}} mode",
    "do a thing",
    ctx(),
  );
  assert.match(prompt, /^Rewrite this: do a thing — in This draft starts/);
});

test("whitespace inside the braces is tolerated", () => {
  const prompt = renderPromptTemplate("X{{ draft }}Y", "d", ctx());
  assert.equal(prompt, "XdY");
});

// ---------------------------------------------------------------------------
// Optional blocks vanish cleanly
// ---------------------------------------------------------------------------

test("a placeholder alone on its line removes that whole line when absent", () => {
  const template = ["before", "{{attachmentRule}}", "after"].join("\n");
  assert.equal(renderPromptTemplate(template, "d", ctx()), "before\nafter");
});

test("a present line-only placeholder is replaced by its own text", () => {
  const template = ["Rules:", "{{attachmentRule}}"].join("\n");
  const prompt = renderPromptTemplate(
    template,
    "d",
    ctx({ attachmentCount: 2 }),
  );
  assert.equal(
    prompt,
    "Rules:\n- The draft carries 2 attachment(s) you cannot see. Keep every reference to them intact and never invent or describe their contents.",
  );
});

test("an indented line-only placeholder still removes its line", () => {
  const template = ["a", "   {{customRule}}", "b"].join("\n");
  assert.equal(renderPromptTemplate(template, "d", ctx()), "a\nb");
});

test("the multi-line context block expands and does not leave a gap", () => {
  const prompt = renderPromptTemplate(
    "{{kindRule}}\n{{context}}\nRules:",
    "d",
    ctx({ threadTitle: "T", lastOutput: "tail" }),
  );
  assert.match(prompt, /Thread title: T\nLatest assistant message \(tail\):/);
  assert.match(prompt, /"""\ntail\n"""\nRules:/);
});

test("optional blocks leave no blank lines in the default template", () => {
  const prompt = buildEnhancePrompt("go", ctx());
  assert.doesNotMatch(prompt, /\n\n\n/);
  assert.doesNotMatch(prompt, /\{\{/);
  assert.match(prompt, /Rules:\n- Preserve the draft's intent/);
  assert.match(prompt, /- Keep the same language/);
});

test("the default template renders no leftover placeholders in any mode", () => {
  for (const kind of ["new-task", "follow-up"] as const) {
    for (const count of [0, 1, 4]) {
      for (const custom of [null, "be terse"]) {
        const prompt = buildEnhancePrompt(
          "d",
          ctx({
            kind,
            attachmentCount: count,
            customInstructions: custom,
            threadTitle: "T",
            lastOutput: "L",
          }),
        );
        assert.doesNotMatch(prompt, /\{\{/, `${kind}/${count}/${custom}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Required parts still work
// ---------------------------------------------------------------------------

test("{{draft}} is required so the rewriter is never sent nothing", () => {
  const check = validatePromptTemplate("Rewrite it well. {{kindRule}}");
  assert.equal(check.ok, false);
  assert.ok(
    check.ok === false && check.errors.some((e) => e.includes("{{draft}}")),
  );
});

test("an empty template is refused", () => {
  const check = validatePromptTemplate("   \n  ");
  assert.equal(check.ok, false);
});

test("an unknown placeholder is refused, and the message names the known ones", () => {
  const check = validatePromptTemplate("{{draft}} {{draftText}}");
  assert.equal(check.ok, false);
  assert.ok(
    check.ok === false && check.errors.some((e) => e.includes("{{draftText}}")),
  );
  assert.ok(check.ok === false && check.errors.some((e) => e.includes("draft")));
});

test("dropping {{kindRule}} is refused because follow-ups would regress", () => {
  const check = validatePromptTemplate("Just rewrite: {{draft}}");
  assert.equal(check.ok, false);
  assert.ok(
    check.ok === false && check.errors.some((e) => e.includes("kindRule")),
  );
});

test("an over-long template is refused at the cap", () => {
  // Both templates carry the required placeholders, so length is the only
  // thing under test.
  const ok = validatePromptTemplate(
    `{{kindRule}} {{draft}} ${"z".repeat(TEMPLATE_CAP - 30)}`,
  );
  assert.equal(ok.ok, true);
  const tooLong = validatePromptTemplate(
    `{{kindRule}} {{draft}} ${"z".repeat(TEMPLATE_CAP)}`,
  );
  assert.equal(tooLong.ok, false);
  assert.ok(
    tooLong.ok === false &&
      tooLong.errors.some((e) => e.includes(String(TEMPLATE_CAP))),
  );
});

test("the shipped default is itself valid", () => {
  const check = validatePromptTemplate(DEFAULT_PROMPT_TEMPLATE);
  assert.deepEqual(check, { ok: true });
});

test("every advertised placeholder is one the renderer actually substitutes", () => {
  const template = TEMPLATE_VARIABLES.map(
    (entry) => `${entry.name}: {{${entry.name}}}`,
  ).join("\n");
  const prompt = renderPromptTemplate(
    template,
    "DRAFT",
    ctx({
      attachmentCount: 1,
      customInstructions: "pref",
      threadTitle: "T",
      lastOutput: "L",
    }),
  );
  assert.doesNotMatch(prompt, /\{\{/);
  assert.match(prompt, /draft: DRAFT/);
  assert.match(prompt, /customRule: - User preference: pref/);
  assert.doesNotMatch(prompt, /attachmentRule: \n/);
});

// ---------------------------------------------------------------------------
// Guardrails inherited from the original builder
// ---------------------------------------------------------------------------

test("an empty draft still lands inside the fences", () => {
  const prompt = renderPromptTemplate("Draft:\n{{draft}}\nEND", "", ctx());
  assert.equal(prompt, "Draft:\n\nEND");
});

test("an unknown placeholder that slips through is left verbatim, not blanked", () => {
  // Validation refuses these at save time; this pins the rendering fallback so
  // a bad template degrades to visible text rather than silently losing a line.
  const prompt = renderPromptTemplate("a {{nope}} b", "d", ctx());
  assert.equal(prompt, "a {{nope}} b");
});

test("truncation still applies to a custom template's draft", () => {
  const prompt = renderPromptTemplate(
    "{{draft}}",
    "x".repeat(8500),
    ctx(),
  );
  assert.match(prompt, /\[…truncated\]/);
  assert.ok(!prompt.includes("x".repeat(8001)));
});

test("custom instructions are still capped inside a custom template", () => {
  const prompt = renderPromptTemplate(
    "{{customRule}}",
    "d",
    ctx({ customInstructions: "y".repeat(1000) }),
  );
  assert.ok(!prompt.includes("y".repeat(501)));
});
