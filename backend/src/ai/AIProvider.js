/**
 * AIProvider — abstraction over the LLM used for content analysis, clip
 * detection, and social/blog content generation. See docs/AI.md.
 *
 * Business logic (services, worker processors) depends only on this
 * interface, never on a specific vendor SDK.
 */
class AIProvider {
  /* eslint-disable class-methods-use-this, no-unused-vars */
  async generateText({ prompt, systemPrompt, maxTokens, temperature }) {
    throw new Error('AIProvider.generateText not implemented');
  }

  async generateStructuredOutput({ prompt, systemPrompt, schema, maxTokens }) {
    throw new Error('AIProvider.generateStructuredOutput not implemented');
  }

  async analyzeContent({ transcript }) {
    throw new Error('AIProvider.analyzeContent not implemented');
  }

  async generateSocialContent({ contentType, transcript, analysis, brandVoice }) {
    throw new Error('AIProvider.generateSocialContent not implemented');
  }
  /* eslint-enable class-methods-use-this, no-unused-vars */
}

/**
 * Normalized error shape every adapter must throw so callers (queue
 * processors) never branch on a provider-specific error type.
 */
class AIProviderError extends Error {
  constructor(message, { retryable = true, reason = 'unknown', retryAfterMs = null, triggersModelFallback = false } = {}) {
    super(message);
    this.name = 'AIProviderError';
    this.retryable = retryable;
    this.reason = reason;
    // Some providers (Gemini's RESOURCE_EXHAUSTED) tell us exactly how
    // long to wait before retrying. When present, reliableCall.js honors
    // this instead of its own generic backoff — retrying sooner than a
    // quota's own reset window just burns another attempt for nothing.
    this.retryAfterMs = retryAfterMs;
    // Set by providers that support a same-call fallback to a sibling
    // model (see GeminiProvider's GEMINI_FALLBACK_MODEL handling) for
    // failures specific to one model (exhausted quota, that model
    // overloaded) rather than the account/request in general.
    this.triggersModelFallback = triggersModelFallback;
  }
}

module.exports = { AIProvider, AIProviderError };
