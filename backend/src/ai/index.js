const config = require('../config');
const { AIProviderError } = require('./AIProvider');
const GeminiProvider = require('./GeminiProvider');

/**
 * When AI_PROVIDER is unset/'none' or the required key is missing, we do
 * NOT fabricate fake AI output. Instead, every method throws a clear,
 * non-retryable error explaining what's missing — a real, honest
 * "not configured" behavior rather than fake production behavior.
 */
class NotConfiguredAIProvider {
  /* eslint-disable class-methods-use-this */
  #fail() {
    throw new AIProviderError(
      'No AI provider is configured. Set AI_PROVIDER=gemini and GEMINI_API_KEY to enable AI features.',
      { retryable: false, reason: 'not_configured' },
    );
  }

  async generateText() { this.#fail(); }
  async generateStructuredOutput() { this.#fail(); }
  async analyzeContent() { this.#fail(); }
  async generateSocialContent() { this.#fail(); }
  /* eslint-enable class-methods-use-this */
}

let instance;

function getAIProvider() {
  if (instance) return instance;

  if (config.ai.provider === 'gemini' && config.ai.geminiApiKey) {
    instance = new GeminiProvider(config.ai.geminiApiKey);
  } else {
    instance = new NotConfiguredAIProvider();
  }
  return instance;
}

module.exports = { getAIProvider, NotConfiguredAIProvider };
