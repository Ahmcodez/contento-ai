const { AIProvider, AIProviderError } = require('./AIProvider');
const { CONTENT_ANALYSIS_JSON_SCHEMA } = require('./schemas');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT, delimitTranscript } = require('./promptSafety');
const config = require('../config');
const logger = require('../logger');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Real incident: Gemini's 429 RESOURCE_EXHAUSTED body includes a
 * google.rpc.RetryInfo detail with the exact wait time it wants
 * (e.g. `"retryDelay": "44s"`) — retrying sooner than this is guaranteed
 * to hit the same per-minute quota window again. Parses that out of the
 * raw error body text; returns null (falls back to generic backoff) for
 * any error shape without it, so this never throws on unexpected bodies.
 */
function parseRetryDelayMs(errorBodyText) {
  try {
    const parsed = JSON.parse(errorBodyText);
    const details = parsed?.error?.details || [];
    const retryInfo = details.find((d) => d['@type']?.includes('RetryInfo'));
    const match = /^(\d+(?:\.\d+)?)s$/.exec(retryInfo?.retryDelay || '');
    return match ? Math.ceil(parseFloat(match[1]) * 1000) : null;
  } catch {
    return null;
  }
}

/**
 * Real incident: a RESOURCE_EXHAUSTED body can report either a per-MINUTE
 * quota (waiting the given retryDelay genuinely helps — see
 * parseRetryDelayMs) or a per-DAY quota (quotaId ends in "PerDay..."),
 * where Gemini still includes a short retryDelay (e.g. 58s) that cannot
 * possibly be correct — a daily cap doesn't reset in under a minute.
 * Retrying a daily-quota failure just burns the remaining attempts on a
 * guaranteed-identical rejection and usually surfaces a confusing,
 * unrelated secondary error (a 503 "high demand") once attempts run out,
 * masking the real cause. This is detected so the caller can fail fast
 * with an honest, actionable message instead.
 */
function isDailyQuotaExceeded(errorBodyText) {
  try {
    const parsed = JSON.parse(errorBodyText);
    const details = parsed?.error?.details || [];
    return details.some((d) =>
      (d['@type']?.includes('QuotaFailure') ? d.violations : []).some((v) => v.quotaId?.includes('PerDay')),
    );
  } catch {
    return false;
  }
}

/**
 * Real incident, distinct from the daily-quota one above: Gemini can
 * return a 503 with `"status": "UNAVAILABLE"` and a message like "This
 * model is currently experiencing high demand" — the model itself is
 * overloaded on Google's end, nothing to do with this project's quota.
 * From this app's perspective this is the same practical situation as a
 * daily-quota exhaustion (this specific model is unusable right now, but
 * a sibling model likely isn't affected), so it's eligible for the same
 * one-hop GEMINI_FALLBACK_MODEL retry in callGenerateContent. Kept
 * retryable at the per-call level (unlike daily quota) since a transient
 * overload can plausibly clear up on its own if fallback is disabled or
 * also unavailable — this only adds a fallback attempt, it doesn't
 * change the existing retry/backoff behavior for this error type.
 */
function isModelOverloaded(errorBodyText) {
  try {
    return JSON.parse(errorBodyText)?.error?.status === 'UNAVAILABLE';
  } catch {
    return false;
  }
}

/**
 * Models occasionally wrap JSON in a markdown code fence even when asked
 * for raw JSON. Stripping this is a mechanical, safe recovery step —
 * distinct from "guessing" at malformed content — before we give up and
 * classify the response as unparseable.
 */
function stripMarkdownFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

/**
 * Real Gemini implementation of AIProvider, using the plain HTTP API
 * (no vendor SDK dependency, keeps this adapter self-contained). Requires
 * GEMINI_API_KEY — the factory (./index.js) only constructs this class
 * when AI_PROVIDER=gemini and a key is present.
 */
class GeminiProvider extends AIProvider {
  constructor(apiKey, { model = config.ai.geminiModel } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Issues one request against a specific model. Separated from
   * callGenerateContent (which decides WHICH model(s) to try) purely so
   * the daily-quota fallback below can call this twice with different
   * models without duplicating the request/parsing logic.
   */
  async #requestOnce(model, contents, { systemPrompt, maxTokens, temperature, responseSchema } = {}) {
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [{ role: 'user', parts: [{ text: contents }] }],
      generationConfig: {
        maxOutputTokens: maxTokens || 2048,
        temperature: temperature ?? 0.7,
        ...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}),
      },
    };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AIProviderError(`Network error calling Gemini: ${err.message}`, {
        retryable: true,
        reason: 'network_error',
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 429 && isDailyQuotaExceeded(text)) {
        throw new AIProviderError(
          `Gemini's free-tier daily request limit has been reached for ${model} on this project. This resets after a day — try again later, or enable billing on your Google AI Studio / Cloud project to raise the limit.`,
          { retryable: false, reason: 'daily_quota_exceeded', triggersModelFallback: true },
        );
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new AIProviderError(`Gemini API error (${response.status}): ${text}`, {
        retryable,
        reason: response.status === 429 ? 'rate_limited' : 'provider_error',
        retryAfterMs: parseRetryDelayMs(text),
        // Drives callGenerateContent's one-hop model fallback below.
        // Daily-quota errors set this via their own throw above (and are
        // also non-retryable there); a 503 UNAVAILABLE sets it here while
        // staying retryable, since it's a separate, narrower decision
        // (try a sibling model) from "should BullMQ retry this at all".
        triggersModelFallback: response.status === 503 && isModelOverloaded(text),
      });
    }

    const json = await response.json();
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const usage = {
      inputTokens: json.usageMetadata?.promptTokenCount || 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount || 0,
    };
    return { text, usage };
  }

  /**
   * Two real incidents, same fix: (1) the primary model's free-tier daily
   * quota (as low as 20 requests/day, varies per-project) ran out
   * mid-testing, failing every job until the next day; (2) separately,
   * gemini-3.6-flash returned a persistent 503 UNAVAILABLE ("experiencing
   * high demand") across multiple job attempts — a capacity problem on
   * Google's end, not this project's quota, so retrying the SAME model
   * with backoff kept hitting the same wall. Both leave `this.model`
   * unusable right now while a sibling model likely isn't affected, so
   * both are marked `triggersModelFallback` by #requestOnce (see
   * isDailyQuotaExceeded / isModelOverloaded above) and handled
   * identically here: retry the SAME request once against
   * GEMINI_FALLBACK_MODEL (Flash-Lite by default) instead of failing the
   * job outright. The per-minute quota (429 rate_limited) deliberately
   * does NOT trigger this — the AI queue's rate limiter and
   * retryAfterMs backoff already handle that correctly by waiting, which
   * genuinely resolves it, unlike these two failure modes. Bounded to
   * exactly one fallback hop: if the fallback call also fails, that
   * error propagates as-is — this never chains into a second fallback.
   */
  async callGenerateContent(contents, options = {}) {
    try {
      return await this.#requestOnce(this.model, contents, options);
    } catch (err) {
      const canFallBack = config.ai.geminiFallbackModel && config.ai.geminiFallbackModel !== this.model;
      if (err instanceof AIProviderError && err.triggersModelFallback && canFallBack) {
        logger.warn(
          { primaryModel: this.model, fallbackModel: config.ai.geminiFallbackModel, reason: err.reason },
          'primary model unusable right now (quota or overloaded); falling back to GEMINI_FALLBACK_MODEL for this call',
        );
        return this.#requestOnce(config.ai.geminiFallbackModel, contents, options);
      }
      throw err;
    }
  }

  async generateText({ prompt, systemPrompt, maxTokens, temperature }) {
    const { text, usage } = await this.callGenerateContent(prompt, { systemPrompt, maxTokens, temperature });
    return { text, usage };
  }

  async generateStructuredOutput({ prompt, systemPrompt, schema, maxTokens }) {
    const { text, usage } = await this.callGenerateContent(prompt, {
      systemPrompt,
      maxTokens,
      responseSchema: schema,
    });

    let data;
    try {
      data = JSON.parse(stripMarkdownFences(text));
    } catch {
      // A response that fails schema/JSON validation is treated as a
      // retryable provider error, not silently passed through malformed
      // (see docs/AI.md §5).
      throw new AIProviderError('Gemini returned a response that could not be parsed as JSON', {
        retryable: true,
        reason: 'invalid_structured_output',
      });
    }
    return { data, usage };
  }

  async analyzeContent({ transcript }) {
    const prompt = `Analyze the following video transcript in depth. Identify: an overall summary, key topics, key points, stories told, strong opinions expressed, educational moments, surprising statements, questions raised, conclusions reached, memorable quotes, and self-contained ideas that could stand alone. Include approximate startMs/endMs timestamps where the transcript text suggests them.\n\nTranscript:\n${delimitTranscript(transcript)}`;
    const { data, usage } = await this.generateStructuredOutput({
      prompt,
      systemPrompt: UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT,
      schema: CONTENT_ANALYSIS_JSON_SCHEMA,
      maxTokens: 4096,
    });
    return { ...data, usage };
  }

  async generateSocialContent({ contentType, transcript, analysis }) {
    const prompts = {
      blog: 'Write a blog post (600-900 words) based on this video content.',
      linkedin: 'Write a LinkedIn post (150-250 words) based on this video content.',
      x_twitter: 'Write a single X/Twitter post (under 280 characters) based on this video content.',
      instagram_caption: 'Write an Instagram caption (under 200 words, with relevant hashtags) based on this video content.',
      youtube_description: 'Write a YouTube video description (150-300 words) based on this video content.',
    };
    const instruction = prompts[contentType];
    if (!instruction) {
      throw new AIProviderError(`Unsupported content type: ${contentType}`, { retryable: false, reason: 'invalid_input' });
    }

    const prompt = `${instruction}\n\nVideo summary: ${analysis?.summary || ''}\nKey topics: ${(analysis?.topics || []).join(', ')}\n\nFull transcript for reference:\n${delimitTranscript(transcript)}`;
    const { text, usage } = await this.generateText({
      prompt,
      systemPrompt: UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT,
      maxTokens: 1500,
    });
    return { body: text, usage };
  }
}

module.exports = GeminiProvider;
