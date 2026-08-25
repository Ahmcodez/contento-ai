const db = require('../db/client');

async function upsert({ processingJobId, contentType, body, metadata, aiProvider }) {
  const existing = await db('generated_content')
    .where({ processing_job_id: processingJobId, content_type: contentType })
    .first();

  const fields = {
    body,
    metadata: metadata ? JSON.stringify(metadata) : null,
    ai_provider: aiProvider,
    status: 'generated',
    updated_at: db.fn.now(),
  };

  if (existing) {
    const [row] = await db('generated_content').where({ id: existing.id }).update(fields).returning('*');
    return row;
  }

  const [row] = await db('generated_content')
    .insert({ processing_job_id: processingJobId, content_type: contentType, ...fields })
    .returning('*');
  return row;
}

async function listByProcessingJobId(processingJobId) {
  return db('generated_content').where({ processing_job_id: processingJobId });
}

module.exports = { upsert, listByProcessingJobId };
