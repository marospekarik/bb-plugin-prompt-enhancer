// Pure prompt construction for the enhancement child thread. No SDK imports
// so it stays unit-testable; server.ts owns all I/O and passes context in.
//
// The prompt is a TEMPLATE the user owns, not a fixed string. The template
// carries the guidance (persona, rules, output contract) as ordinary text and
// pulls the per-run facts in through placeholders, so editing the instructions
// never means giving up the follow-up/new-task distinction or the conversation
// context. `DEFAULT_PROMPT_TEMPLATE` is the prompt this plugin shipped with;
// rendering it reproduces the original output byte for byte (pinned by
// tests/goldens/default-prompts.json).

/** Draft text is embedded in the child thread's prompt capped at this size. */
export const PROMPT_TEXT_CAP = 8000;
/** User's custom instruction line is capped so it can't dominate the prompt. */
export const CUSTOM_INSTRUCTIONS_CAP = 500;
/** Ceiling on a user-supplied template, so a runaway paste can't blow up. */
export const TEMPLATE_CAP = 20_000;

export interface EnhanceContext {
  kind: "new-task" | "follow-up";
  attachmentCount: number;
  threadTitle: string | null;
  /** Tail of the scope thread's latest assistant output, already capped. */
  lastOutput: string | null;
  customInstructions: string | null;
}

// ---------------------------------------------------------------------------
// Template placeholders
// ---------------------------------------------------------------------------

/** One `{{name}}` token the renderer understands. */
export interface TemplateVariable {
  name: string;
  /** One line, shown in the settings UI. */
  description: string;
}

/**
 * The placeholders a template may use. A placeholder alone on its own line is
 * removed together with that line when its value is absent, which is how the
 * optional blocks vanish cleanly instead of leaving blank lines behind.
 */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  {
    name: "kindRule",
    description:
      "The follow-up vs brand-new-task rule, chosen from where the draft was typed.",
  },
  {
    name: "context",
    description:
      "Thread title and the tail of the last reply, for resolving vague references. The whole block (and the blank line above it) disappears when there is no context.",
  },
  {
    name: "attachmentRule",
    description:
      "The rule about attachments, present only when the draft carries any.",
  },
  {
    name: "customRule",
    description:
      "Your \"Custom rewrite instructions\" preference from this settings page, if set.",
  },
  {
    name: "draft",
    description: "The draft prompt itself, truncated at 8000 characters.",
  },
] as const;

/**
 * A template without `{{draft}}` would send the model nothing to rewrite, so
 * saving one is refused rather than silently producing an empty enhancement.
 */
export const REQUIRED_TEMPLATE_VARIABLES: readonly string[] = ["draft"];

// Names are camelCase, so the character class must accept uppercase: a
// lowercase-only class silently fails to match {{kindRule}} and friends.
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
/** Matches a line that is nothing but a single placeholder. */
const PLACEHOLDER_ONLY_LINE = /^\s*\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*$/;
const KNOWN_VARIABLES = new Set(TEMPLATE_VARIABLES.map((entry) => entry.name));

function variableNamesIn(template: string): Set<string> {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    found.add(match[1]);
  }
  return found;
}

export type TemplateValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Check a user-supplied template before it is stored or used. Refusing an
 * unusable template at save time is the difference between a clear error in
 * the settings page and a broken enhancement thirty seconds later.
 */
export function validatePromptTemplate(template: string): TemplateValidation {
  const errors: string[] = [];
  if (template.trim().length === 0) {
    errors.push("The template is empty.");
  }
  if (template.length > TEMPLATE_CAP) {
    errors.push(
      `The template is ${template.length} characters; the limit is ${TEMPLATE_CAP}.`,
    );
  }
  const used = variableNamesIn(template);
  for (const name of used) {
    if (!KNOWN_VARIABLES.has(name)) {
      errors.push(
        `Unknown placeholder {{${name}}}. Known placeholders: ${TEMPLATE_VARIABLES.map(
          (entry) => `{{${entry.name}}}`,
        ).join(", ")}.`,
      );
    }
  }
  for (const name of REQUIRED_TEMPLATE_VARIABLES) {
    if (!used.has(name)) {
      errors.push(`The template must contain {{${name}}}.`);
    }
  }
  if (!used.has("kindRule")) {
    errors.push(
      "The template should contain {{kindRule}}, or follow-ups stop being treated as follow-ups.",
    );
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Default template
// ---------------------------------------------------------------------------

/**
 * The prompt this plugin ships with, as an editable template. It is the
 * original hardcoded prompt verbatim, so an unedited template produces exactly
 * the output every earlier version produced.
 */
export const DEFAULT_PROMPT_TEMPLATE = [
  "You rewrite rough draft prompts into clear, effective prompts for a coding agent working in an agentic coding IDE.",
  "",
  "{{kindRule}}",
  "{{context}}",
  "",
  "Rules:",
  "- Preserve the draft's intent and meaning exactly; never invent requirements, constraints, file names, or technologies the draft does not imply.",
  "- Preserve verbatim every @mention, file path, identifier, code snippet, shell command, URL, and quoted string — they are live references that must survive untouched.",
  "- Choose the rewrite's shape from the draft itself: a simple ask stays roughly one line; genuinely multi-part work becomes a short brief (goal, constraints, acceptance criteria); append a 'Done when:' list only when the draft implies concrete, checkable outcomes.",
  "- Prefer concrete, actionable phrasing: what to do, where, and how to tell it's done.",
  "- Keep the same language the draft is written in.",
  "{{attachmentRule}}",
  "{{customRule}}",
  "- Return ONLY the rewritten prompt: no preamble, no explanation, no quotes, no markdown fences.",
  "",
  "Draft prompt:",
  '"""',
  "{{draft}}",
  '"""',
].join("\n");

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Resolve every placeholder for this run.
 *
 * A value of `null` means "absent" and removes its line; any string — the
 * empty string included — is substituted as-is. `context` and `kindRule` carry
 * their own blank-line separation exactly as the original builder emitted it,
 * because the surrounding spacing has to survive either outcome: with context,
 * the block sits one blank line below the kind rule; without it, the blank
 * line before "Rules:" is the only one left.
 */
function templateValues(
  draft: string,
  ctx: EnhanceContext,
): Record<string, string | null> {
  const capped =
    draft.length > PROMPT_TEXT_CAP
      ? `${draft.slice(0, PROMPT_TEXT_CAP)}\n[…truncated]`
      : draft;
  const contextLines = [
    "Conversation context — use it ONLY to resolve vague references in the draft (\"that bug\", \"the second option\"); never restate it in the rewrite:",
    ...(ctx.threadTitle !== null ? [`Thread title: ${ctx.threadTitle}`] : []),
    ...(ctx.lastOutput !== null
      ? ["Latest assistant message (tail):", '"""', ctx.lastOutput, '"""']
      : []),
  ];
  const hasContext = ctx.threadTitle !== null || ctx.lastOutput !== null;
  const custom = ctx.customInstructions?.trim() ?? "";
  return {
    kindRule:
      ctx.kind === "follow-up"
        ? "This draft is a follow-up message in an ongoing conversation — the agent already has the full context. Keep it a follow-up: sharpen the ask, but do NOT restate background, re-explain the task, or expand it into a standalone spec."
        : "This draft starts a brand-new task; the rewritten prompt is the agent's entire brief, so make the goal and the definition of done unmistakable.",
    context: hasContext ? `\n${contextLines.join("\n")}` : null,
    attachmentRule:
      ctx.attachmentCount > 0
        ? `- The draft carries ${ctx.attachmentCount} attachment(s) you cannot see. Keep every reference to them intact and never invent or describe their contents.`
        : null,
    customRule:
      custom.length > 0
        ? `- User preference: ${custom.slice(0, CUSTOM_INSTRUCTIONS_CAP)}`
        : null,
    // Always a string: a draft that is empty (or whitespace) must still land
    // inside the fences rather than collapsing the line and shifting them.
    draft: capped,
  };
}

/**
 * Substitute this run's values into a template. Unknown placeholders are left
 * on the page verbatim — validation refuses them at save time, and a template
 * that reached here some other way must not silently lose text.
 */
export function renderPromptTemplate(
  template: string,
  draft: string,
  ctx: EnhanceContext,
): string {
  const values = templateValues(draft, ctx);
  const rendered: string[] = [];
  for (const line of template.split("\n")) {
    const onlyLine = PLACEHOLDER_ONLY_LINE.exec(line);
    if (onlyLine !== null && Object.hasOwn(values, onlyLine[1])) {
      const value = values[onlyLine[1]];
      // Absent block: the line goes with it. Present block: its text replaces
      // the token, and may itself span several lines.
      if (value !== null) rendered.push(value);
      continue;
    }
    rendered.push(
      line.replace(PLACEHOLDER, (match: string, name: string) => {
        if (!Object.hasOwn(values, name)) return match;
        return values[name] ?? match;
      }),
    );
  }
  return rendered.join("\n");
}

/**
 * The two composer situations produce very different "best prompts": a
 * follow-up lands mid-conversation where the agent already holds the context
 * (inflating it into a spec re-litigates settled ground), while a new-task
 * prompt is the agent's entire brief and earns real structure.
 */
export function buildEnhancePrompt(
  draft: string,
  ctx: EnhanceContext,
  template: string = DEFAULT_PROMPT_TEMPLATE,
): string {
  return renderPromptTemplate(template, draft, ctx);
}
