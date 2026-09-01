const { AIProviderError } = require('./AIProvider');
const config = require('../config');
const usageService = require('../services/usage.service');
const logger = require('../logger');
const metrics = require('../metrics');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hard per-job ceiling on real AI calls (docs/COST.md §4 "never make
 * unlimited AI requests"). Checked against the usage ledger before every
 * call, not just at job start — so a job can't exceed the ceiling even
 * across retries/chunks/content types spread across multiple processors.
 */
async function assertWithinJobBudget(processingJobId) {
  if (!processingJobId) return;
  const used = await usageService.countAiRequestsForJob(processingJobId);
  if (used >= config.limits.maxAiCallsPerJob) {
    throw new AIProviderError(
      `This job has reached its limit of ${config.limits.maxAiCallsPerJob} AI calls and cannot make further requests.`,
      { retryable: false, reason: 'job_ai_budget_exceeded' },
    );
  }
}

/**
 * Per-user daily ceiling (MAX_AI_REQUESTS_PER_USER_PER_DAY). This value
 * was previously defined in config and shown to users on the usage page
 * (usageView.service.js) but never actually enforced anywhere — nothing
 * stopped a user from exceeding it by starting job after job throughout
 * a day, each burning up to maxAiCallsPerJob calls with no daily ceiling
 * checked at all. Mirrors assertWithinJobBudget's pattern: checked
 * before every call, not just at job start, for the same reason (a job
 * can span a day boundary or be one of several a user starts that day).
 */
async function assertWithinUserDailyBudget(userId) {
  if (!userId) return;
  const used = await usageService.countAiRequestsToday(userId);
  if (used >= config.limits.maxAiRequestsPerUserPerDay) {
    throw new AIProviderError(
      `You've reached your daily limit of ${config.limits.maxAiRequestsPerUserPerDay} AI requests. This resets tomorrow.`,
      { retryable: false, reason: 'user_daily_ai_budget_exceeded' },
    );
  }
}

/**
 * Optional account-wide ceiling across every user combined
 * (MAX_TOTAL_AI_REQUESTS_PER_DAY, default 0 = disabled). A cheap,
 * emergency-brake circuit breaker distinct from the per-user check above
 * — see the doc comment on the env var in src/config/index.js for when
 * this is (and isn't) appropriate to enable.
 */
async function assertWithinGlobalDailyBudget() {
  if (!config.limits.maxTotalAiRequestsPerDay) return; // 0/unset = disabled
  const used = await usageService.countAiRequestsGlobalToday();
  if (used >= config.limits.maxTotalAiRequestsPerDay) {
    throw new AIProviderError(
      'This environment has reached its configured daily AI request ceiling. Try again tomorrow, or ask an operator to raise MAX_TOTAL_AI_REQUESTS_PER_DAY.',
      { retryable: false, reason: 'global_daily_ai_budget_exceeded' },
    );
  }
}

async function assertWithinBudgets({ userId, processingJobId }) {
  await assertWithinJobBudget(processingJobId);
  await assertWithinUserDailyBudget(userId);
  await assertWithinGlobalDailyBudget();
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
      await assertWithinBudgets({ userId, processingJobId });

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
      metrics.increment('ai_provider_error', { reason: isProviderError ? err.reason : 'unexpected_error' });

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
      await assertWithinBudgets({ userId, processingJobId });

      const result = await provider.generateText({ prompt, systemPrompt, maxTokens });
      if (userId) {
        await usageService.recordAiRequest({ userId, processingJobId });
      }
      return result;
    } catch (err) {
      lastError = err;
      const isProviderError = err instanceof AIProviderError;
      const retryable = isProviderError ? err.retryable : true;

      metrics.increment('ai_provider_error', { reason: isProviderError ? err.reason : 'unexpected_error' });

      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      await sleep(Math.min(500 * 2 ** (attempt - 1), 8000));
    }
  }

  throw lastError;
}

module.exports = { callStructured, callText };
