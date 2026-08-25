# AI Architecture

## 1. Principle: AI proposes, code disposes

The AI layer is treated as an **untrusted, probabilistic input source** —
every AI output that affects business logic (clip timestamps, quota-
relevant counts, state transitions) is validated and clamped by
deterministic code before it's trusted. AI is used for the things it's
actually good at (semantic judgment, drafting text) and deterministic code
handles the things determinism is required for (timestamp math, limits,
scoring weights, retries, cost control). This split is enumerated
explicitly in §4.

## 2. `AIProvider` interface

Lives in `packages/ai/src/AIProvider.ts` (interface only — no
implementation yet, per current phase). Conceptual shape:

```ts
interface AIProvider {
  generateText(input: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; usage: TokenUsage }>;

  generateStructuredOutput<T>(input: {
    prompt: string;
    systemPrompt?: string;
    schema: JSONSchema;          // validated against the response
    maxTokens?: number;
  }): Promise<{ data: T; usage: TokenUsage }>;

  analyzeContent(input: {
    transcript: string;          // pre-chunked by caller if needed
  }): Promise<ContentAnalysisResult>;

  generateSocialContent(input: {
    contentType: 'blog' | 'linkedin' | 'x_twitter' | 'instagram_caption' | 'youtube_description';
    transcript: string;
    analysis: ContentAnalysisResult;
    brandVoice?: string;         // future: per-workspace voice settings
  }): Promise<GeneratedContentResult>;
}
```

Nothing outside `packages/ai` imports a Gemini (or any provider) SDK type.
Business logic (`packages/core`, `apps/worker` processors) depends only on
this interface, injected via a factory (`createAIProvider(config)`) chosen
by `AI_PROVIDER` env var — the seam ADR-006 is built around.

## 3. Gemini adapter

`packages/ai/src/providers/gemini/GeminiProvider.ts` implements
`AIProvider` against the Gemini API. Responsibilities specific to this
adapter, kept out of the interface/business logic:
- Translating the generic `schema` param into Gemini's structured-output /
  function-calling mechanism.
- Provider-specific retry classification (which Gemini error codes are
  transient vs terminal) — surfaced back through a normalized
  `AIProviderError` (`{ retryable: boolean, reason }`) shared across all
  providers, so `packages/queue` processors never branch on
  provider-specific error shapes.
- Token/cost accounting per call, recorded via `packages/core`'s
  `UsageService` (feeds `usage_records`, see `docs/DATABASE.md`).
- Prompt templates live here too (not in `packages/core`), versioned per
  provider since prompt engineering is often provider-specific — but the
  **output schemas** (`ContentAnalysisResult`, `ClipCandidate[]`,
  `GeneratedContentResult`) live in `packages/ai/src/schemas/`, shared
  across all provider adapters, so swapping providers can never change the
  shape business logic depends on.

## 4. Where AI is used vs where deterministic code is used

| Concern | AI or deterministic? | Why |
|---|---|---|
| Summarizing transcript, identifying themes | AI (`analyzeContent`) | Genuinely semantic task. |
| Proposing candidate clip timestamps + rationale | AI (`generateStructuredOutput`) | Requires understanding narrative/emotional peaks. |
| Clamping proposed timestamps to valid transcript bounds | **Deterministic** | Safety — AI can hallucinate out-of-range values. |
| Merging overlapping clip candidates | **Deterministic** | Simple interval logic; no ambiguity AI needs to resolve. |
| Enforcing `MAX_CLIPS_PER_VIDEO` | **Deterministic** | A hard business/cost rule, must never depend on model behavior. |
| Final clip ranking/score | **Deterministic core + optional AI signal as one weighted input** | Needs to be stable, explainable, and cheaply re-runnable without re-calling the LLM every time scoring weights change. |
| Drafting blog/social copy | AI (`generateSocialContent`) | Genuinely generative task. |
| Enforcing platform character limits (X/Twitter length, etc.) | **Deterministic** post-check, with AI prompted toward the limit but never trusted to hit it exactly | Prevents shipping content that literally won't post on the target platform. |
| Quota/usage enforcement | **Deterministic**, entirely outside the AI layer | Never let a probabilistic system gate spend. |
| Retry/backoff decisions | **Deterministic**, based on normalized error classification | Reliability concern, not a content concern. |
| FFmpeg cut points from approved clip candidates | **Deterministic** — takes AI-approved timestamps as input but the actual crop/encode command is 100% code-constructed | See `docs/SECURITY.md` §FFmpeg. |

## 5. Prompt/output governance

- Every `generateStructuredOutput` call declares a JSON Schema and the
  adapter **validates the response against it** before returning — a
  response that fails schema validation is treated as a retryable
  provider error, not silently passed through malformed.
- Prompts are versioned (e.g. `clip-detection.v1.prompt.ts`) so prompt
  changes are code-reviewable diffs, not hidden string edits, and so a
  regression can be bisected.
- No prompt ever interpolates raw user-supplied free text directly into a
  system-level instruction without delimiting it (basic prompt-injection
  hygiene) — transcript content is always passed as clearly delimited
  user-content, never concatenated into instructions.

## 6. Token/cost accounting

Every `AIProvider` call returns a `usage` object (input/output tokens or
provider-reported cost units). `packages/core`'s `UsageService` persists
this to `usage_records` (category `ai_requests`, and a future
`ai_tokens` category if finer-grained tracking is needed) synchronously
with the DB transaction that records the pipeline stage transition — so
usage accounting can never silently drift from actual calls made. This is
what powers both `docs/COST.md`'s quota enforcement and any future
billing.

## 7. Multi-provider readiness (not built in V1, but unblocked)

Adding a second provider (e.g. OpenAI, Anthropic) later means: implement
`AIProvider` in a new adapter file under `packages/ai/src/providers/`,
register it in the factory, done. No change to `packages/core`, `apps/api`,
`apps/worker`, or the database schema (`ai_provider` is already a free-text
column, not an enum tied to one vendor). A per-workspace or per-call
provider override is a config lookup away, not a redesign.
