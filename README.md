# Prompt Enhancer Plus

A spark button in every [bb](https://getbb.app) composer that rewrites your
rough draft into a prompt worth sending — in place, in the composer you are
already typing in.

The rewriter is a hidden bb thread, so it runs on the provider you already
have configured. No API keys, no external service, nothing leaves your bb.

> **This is a fork of [bb-plugin-prompt-enhancer](https://github.com/vburojevic/bb-plugin-prompt-enhancer)
> by Vedran Burojevic (MIT).** Upstream is a finished, well-built plugin; this
> fork changes exactly one thing: **the enhancer prompt is editable**, in
> Settings and from the CLI, instead of being fixed at build time. Everything
> else — the composer action, the reveal animation, the dropped-reference
> guard, the model picker — is upstream's work, unchanged. See
> [Editing the enhancer prompt](#editing-the-enhancer-prompt).

![A rough one-line draft rewritten into a brief with a "Done when:" list](assets/screenshots/hero.png)

## Install

```
bb plugin install git:https://github.com/marospekarik/bb-plugin-prompt-enhancer.git@main
```

The plugin id is `prompt-enhancer-plus`, so it installs **beside** upstream
`prompt-enhancer` rather than replacing it. Only enable one of the two — they
both add a spark button to every composer, and two buttons that do the same
thing is a worse draft area, not a better one.

Then click the spark in any composer — or press **⌘E** (**Ctrl+E on
Windows and Linux) while the composer is focused.

## Editing the enhancer prompt

Upstream hardcodes the instruction the rewriter runs on. This fork turns that
instruction into a **template you own**, so the plugin adapts to how you
actually write prompts instead of the other way round.

Open **Settings → Prompt Enhancer Plus → Enhancer prompt**. The shipped prompt
is there, in a textarea, editable. Edit it, click **Save**, and every
subsequent enhancement uses your version. **Restore shipped prompt** puts the
original back.

The template is plain text. The per-draft facts come in through placeholders,
which you can place anywhere — or delete, if you don't want that input:

| Placeholder | What it becomes |
| --- | --- |
| `{{draft}}` | The draft prompt, truncated at 8000 characters. **Required.** |
| `{{kindRule}}` | The follow-up vs brand-new-task rule, chosen from where the draft was typed. |
| `{{context}}` | Thread title and the tail of the last reply, for resolving vague references. |
| `{{attachmentRule}}` | The attachments rule, present only when the draft carries any. |
| `{{customRule}}` | Your "Custom rewrite instructions" preference, if set. |

A placeholder alone on its own line takes that whole line with it when there
is nothing to put there, so optional rules leave no blank gaps behind. A
template missing `{{draft}}`, or naming a placeholder that does not exist, is
refused at save time — with the reason — rather than quietly producing a
broken enhancement.

The same thing from the CLI, which is also the convenient way to keep your
prompt in version control:

```
bb prompt-enhancer-plus prompt              # the template in effect
bb prompt-enhancer-plus prompt --default    # the shipped one, for reference
bb prompt-enhancer-plus prompt-set my-prompt.txt
bb prompt-enhancer-plus prompt-reset
```

### An example

Shipped prompt too chatty for you? Replace the whole thing:

```
Rewrite this for a coding agent. Output one line, no preamble.

{{kindRule}}
{{customRule}}

Draft:
"""
{{draft}}
"""
```

Both surfaces write the same stored value, so a template saved in the UI shows
up in `bb prompt-enhancer-plus prompt` and vice versa.

## It picks the shape from the draft

The rewriter is not told "make it longer". It is told to read the draft and
choose: a simple ask stays roughly one line, and only genuinely multi-part
work earns a brief with a `Done when:` list.

That distinction is what keeps it usable on every message rather than only on
the first one.

| You type | You get |
| --- | --- |
| `fix the retry bug in payments. sometimes customers get charged twice. also add tests` | A brief with the goal restated precisely and a two-item `Done when:` list |
| `ok fix that in our code` | One sharpened line — still one line |

## Follow-ups know where they are

A draft written mid-conversation is a *follow-up*: the agent already holds the
context, so inflating it into a standalone spec re-litigates settled ground.
The plugin detects that case and tells the rewriter to keep it a follow-up.

It also passes the thread title and the tail of the last assistant message —
used **only** to resolve vague references. Here `that` becomes the actual N+1
problem the agent just described, and the result is still a single sentence:

![The thread above the composer, with a vague follow-up rewritten into a one-line instruction that names the N+1 query issue](assets/screenshots/follow-up.png)

## Your references survive

`@mentions`, file paths, identifiers, code spans, shell commands, URLs and
quoted strings are live references, not prose. The rewriter is told to carry
every one of them through untouched — here both paths and the link come out the
other side intact, while everything around them gets sharper:

```
fix the double charge bug in src/payments/retry.ts and src/payments/charge.ts,
follow https://stripe.com/docs/idempotency and add a test
```

```
Fix the double-charge bug in `src/payments/retry.ts` and `src/payments/charge.ts`
by implementing idempotent request handling per Stripe's idempotency key
guidance (https://stripe.com/docs/idempotency), so retried charge attempts do
not create duplicate charges. Add a test covering the retry-causes-duplicate-
charge scenario to confirm the fix.
```

Then the plugin **checks**, because "told to" is not "did". It re-extracts every
reference from your original and verifies each one survived — using the
composer's structured `@`-mentions as ground truth rather than guessing from the
text — and warns you before you send.

Below, a `Rewrite in at most 10 words.` custom instruction squeezed both file
paths and the link out of the rewrite. The guard named all three before anything
was sent:

![A warning toast reading "The rewrite may have dropped: https://stripe.com/docs/idempotency, src/payments/retry.ts, src/payments/charge.ts — check before sending."](assets/screenshots/references.png)

Attachments are counted and declared to the rewriter too, so it never invents
or drops a reference to a file it cannot see.

## Nothing is lost while it runs

While a rewrite is in flight the draft locks and shimmers — one highlight band
sweeping the whole draft, anchored to the viewport so it stays a single band no
matter how many spans the editor splits your text into. The spark becomes a
cancel button:

![The composer mid-rewrite: the draft shimmering and the spark replaced by a cancel button](assets/screenshots/running.png)

A run belongs to the **composer draft, not to the screen**. Leave the thread
mid-rewrite and it keeps going; come back and it is still there — still
shimmering if it is running, typing itself in if it finished while you were
away. The same holds across a window reload, a plugin reload, and a second
window, because the server looks a run up by composer scope instead of the tab
remembering it.

Nothing ends a run except you cancelling it or the server giving up. The
predicted duration only paces the animation — a rewrite that runs long is
waited out, not reaped. That prediction adapts per model from recent measured
completions rather than a flat 90-second ceiling, so a fast model fails fast
and a slow one is given room.

When the rewrite lands, the toast offers **Undo** to restore your original
draft. Hidden enhancement threads are stopped and deleted the moment they
resolve, so they never pile up in your thread list.

## Review before applying

Prefer to look before it touches your draft? Turn on **Review before applying**
and every rewrite arrives in an Apply/Discard preview showing both versions —
with the dropped-reference warning inline, if there is one.

![The Review enhanced prompt dialog showing the original and enhanced text with Discard and Apply buttons](assets/screenshots/review.png)

## Choose what rewrites your drafts

By default the rewrite runs on the provider of the thread you are drafting in
(or the project default on the new-thread composer), at that provider's default
model.

Pin something else under **Settings → Prompt Enhancer Plus**. Picking a model
reveals its reasoning levels in their own group — the same progressive
disclosure bb's own model picker uses. It lives in settings rather than beside
the draft because it is a set-once preference: the composer keeps a single
button.

![The Prompt Enhancer settings page: Review before applying, Custom rewrite instructions, and the Enhancer model picker with reasoning levels](assets/screenshots/settings.png)

**Custom rewrite instructions** appends a standing instruction to every rewrite
— `keep prompts under 100 words`, `always write in German`, whatever you keep
asking for. Unlike the template, this lands as a single `User preference:` rule
inside it, so it composes with any template rather than replacing it.

Both are also reachable from the CLI:

```
bb plugin config prompt-enhancer-plus
bb plugin config prompt-enhancer-plus set previewBeforeApply true
bb plugin config prompt-enhancer-plus set customInstructions "keep prompts under 100 words"
```

## Details

- **Motion** — every animation collapses to an instant text swap under
  `prefers-reduced-motion`.
- **Long drafts** — the draft is capped at 8000 characters in the rewrite
  prompt; custom instructions at 500, so they can't dominate it. The template
  itself is capped at 20,000 characters.
- **Language** — the rewrite stays in the language the draft was written in.
- **Enhance while busy** — you can enhance a draft while the agent is still
  running its previous turn.
- **Touch** — on a phone the composer action grows to the same 36x40 target
  BB's own composer buttons use, and the review step opens as a bottom sheet
  instead of a centred dialog.

## Development

```
npm install
npm test              # pure logic in lib/, on Node's built-in test runner
bb plugin build       # dist/server.js + dist/app.js
bb plugin install path:. --yes
bb plugin reload prompt-enhancer-plus
```

The interesting logic is pure and unit-tested in `lib/`: prompt construction
and template rendering, the dropped-reference guard, reveal pacing, adaptive
timeouts, composer-scope identity, and what an expired deadline means.
`server.ts` owns all I/O; `app.tsx` owns the composer UI and the two settings
sections.

### The default prompt is pinned to upstream

`tests/goldens/default-prompts.json` records `buildEnhancePrompt`'s output —
generated from the **pre-template upstream implementation** — for a matrix of
21 inputs covering both kinds, every context combination, attachments, custom
instructions, truncation boundaries, and quoting edge cases.
`tests/enhance-prompt-default.test.ts` replays that matrix through the
templated version and asserts the output is byte-identical.

That test is what makes the fork's central claim checkable: **if you never open
the setting, you get exactly upstream's behavior.** Turning the prompt into a
template is a refactor, not a behavior change, and the goldens are the proof.
Regenerate them only against a deliberately re-derived default.

`types/` holds the bundled bb plugin API declarations, mapped to
`@bb/plugin-sdk` by `tsconfig.json`. Refresh them from your bb with
`bb plugin types` (`--check` in CI).

## License

MIT — see [LICENSE](LICENSE). Original work copyright Vedran Burojevic; fork
modifications under the same license.

---

## More bb plugins

Upstream's other plugins: [**vburojevic/bb-plugins**](https://github.com/vburojevic/bb-plugins).
