const { AIProviderError } = require('./AIProvider');
const config = require('../config');
const usageService = require('../services/usage.service');
const logger = require('../logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a structured-output AI call with: retry + exponential backoff for
 * transient failures, zod schema validation of the parsed result (a
 * response that parses as JSON but doesn't match the expected shape is
 * treated the same as malformed output — retried, not silently trusted),
 * and usage tracking for every real call made (docs/COST.md, docs/AI.md §6).
 *
 * `zodSchema` validates the business shape; `jsonSchema` (optional) is
 * passed to the provider to constrain generation up front. Both exist
 * because provider-level schema hints reduce malformed output, but only
 * validating the actual parsed result is trustworthy.
 */
async function callStructured({
  provider,
  prompt,
  systemPrompt,
  jsonSchema,
  zodSchema,
  maxTokens,
  userId,
  processingJobId,
  maxAttempts = config.limits.aiRetryAttempts,
}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { data, usage } = await provider.generateStructuredOutput({
        prompt,
        systemPrompt,
        schema: jsonSchema,
        maxTokens,
      });

      if (userId) {
        await usageService.recordAiRequest({ userId, processingJobId });
      }

      const parsed = zodSchema.safeParse(data);
      if (!parsed.success) {
        throw new AIProviderError(
          `AI response did not match the expected schema: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
          { retryable: true, reason: 'schema_validation_failed' },
        );
      }

      return { data: parsed.data, usage };
    } catch (err) {
      lastError = err;
      const isProviderError = err instanceof AIProviderError;
      const retryable = isProviderError ? err.retryable : true;

      logger.warn(
        { attempt, maxAttempts, retryable, reason: isProviderError ? err.reason : 'unexpected_error', message: err.message },
        'AI structured call attempt failed',
      );

      if (!retryable || attempt === maxAttempts) {
        throw err;
      }

      await sleep(Math.min(500 * 2 ** (attempt - 1), 8000));
    }
  }

  throw lastError;
}

/**
 * Same retry/backoff/usage-tracking treatment for free-form text
 * generation (no schema to validate against, but the same reliability
 * concerns apply).
 */
async function callText({ provider, prompt, systemPrompt, maxTokens, userId, processingJobId, maxAttempts = config.limits.aiRetryAttempts }) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await provider.generateText({ prompt, systemPrompt, maxTokens });
      if (userId) {
        await usageService.recordAiRequest({ userId, processingJobId });
      }
      return result;
    } catch (err) {
      lastError = err;
      const isProviderError = err instanceof AIProviderError;
      const retryable = isProviderError ? err.retryable : true;

      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      await sleep(Math.min(500 * 2 ** (attempt - 1), 8000));
    }
  }

  throw lastError;
}

module.exports = { callStructured, callText };
