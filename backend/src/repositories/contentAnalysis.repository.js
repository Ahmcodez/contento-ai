const db = require('../db/client');

async function create({ processingJobId, analysis, aiProvider, rawAiResponse }) {
  const [row] = await db('content_analyses')
    .insert({
      processing_job_id: processingJobId,
      summary: analysis.summary,
      topics: JSON.stringify(analysis.topics || []),
      key_points: JSON.stringify(analysis.keyPoints || []),
      stories: JSON.stringify(analysis.stories || []),
      strong_opinions: JSON.stringify(analysis.strongOpinions || []),
      educational_moments: JSON.stringify(analysis.educationalMoments || []),
      surprising_statements: JSON.stringify(analysis.surprisingStatements || []),
      questions: JSON.stringify(analysis.questions || []),
      conclusions: JSON.stringify(analysis.conclusions || []),
      memorable_quotes: JSON.stringify(analysis.memorableQuotes || []),
      self_contained_ideas: JSON.stringify(analysis.selfContainedIdeas || []),
      raw_ai_response: rawAiResponse ? JSON.stringify(rawAiResponse) : null,
      ai_provider: aiProvider,
    })
    .returning('*');
  return row;
}

async function findByProcessingJobId(processingJobId) {
  return db('content_analyses').where({ processing_job_id: processingJobId }).first();
}

module.exports = { create, findByProcessingJobId };
