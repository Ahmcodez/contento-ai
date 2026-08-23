exports.up = async function up(knex) {
  await knex.schema.createTable('transcripts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('media_asset_id').notNullable().unique().references('id').inTable('media_assets').onDelete('CASCADE');
    t.text('full_text').notNullable();
    t.text('language');
    t.text('provider').notNullable();
    t.jsonb('raw_provider_response');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('transcript_segments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('transcript_id').notNullable().references('id').inTable('transcripts').onDelete('CASCADE');
    t.integer('sequence').notNullable();
    t.integer('start_ms').notNullable();
    t.integer('end_ms').notNullable();
    t.text('text').notNullable();
    t.text('speaker_label');
    t.jsonb('word_timestamps');
    t.index(['transcript_id', 'sequence']);
    t.index(['transcript_id', 'start_ms']);
  });

  await knex.schema.createTable('content_analyses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('processing_job_id').notNullable().unique().references('id').inTable('processing_jobs').onDelete('CASCADE');
    t.text('summary').notNullable();
    t.jsonb('topics').notNullable();
    t.jsonb('key_points').notNullable();
    t.jsonb('stories').notNullable();
    t.jsonb('strong_opinions').notNullable();
    t.jsonb('educational_moments').notNullable();
    t.jsonb('surprising_statements').notNullable();
    t.jsonb('questions').notNullable();
    t.jsonb('conclusions').notNullable();
    t.jsonb('memorable_quotes').notNullable();
    t.jsonb('self_contained_ideas').notNullable();
    t.jsonb('raw_ai_response');
    t.text('ai_provider').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('clip_candidates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('processing_job_id').notNullable().references('id').inTable('processing_jobs').onDelete('CASCADE');
    t.integer('start_ms').notNullable();
    t.integer('end_ms').notNullable();
    t.text('title').notNullable();
    t.text('hook');
    t.text('summary');
    t.text('reason');
    t.text('topic');
    t.decimal('ai_score', 5, 2);
    t.jsonb('score_breakdown');
    t.decimal('final_score', 5, 2).notNullable();
    t.smallint('rank').notNullable();
    t.enu('status', ['candidate', 'approved_for_render', 'rejected']).notNullable().defaultTo('candidate');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['processing_job_id', 'rank']);
    t.check('end_ms > start_ms');
  });

  await knex.schema.createTable('generated_clips', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clip_candidate_id').notNullable().unique().references('id').inTable('clip_candidates').onDelete('CASCADE');
    t.text('storage_key');
    t.text('thumbnail_storage_key');
    t.text('subtitle_storage_key');
    t.decimal('duration_seconds', 10, 2);
    t.enu('render_status', ['pending', 'rendering', 'rendered', 'failed']).notNullable().defaultTo('pending');
    t.text('render_error');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('generated_content', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('processing_job_id').notNullable().references('id').inTable('processing_jobs').onDelete('CASCADE');
    t.enu('content_type', ['blog', 'linkedin', 'x_twitter', 'instagram_caption', 'youtube_description']).notNullable();
    t.text('body').notNullable();
    t.jsonb('metadata');
    t.text('ai_provider').notNullable();
    t.enu('status', ['generated', 'edited', 'exported']).notNullable().defaultTo('generated');
    t.timestamps(true, true);
    t.unique(['processing_job_id', 'content_type']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('generated_content');
  await knex.schema.dropTableIfExists('generated_clips');
  await knex.schema.dropTableIfExists('clip_candidates');
  await knex.schema.dropTableIfExists('content_analyses');
  await knex.schema.dropTableIfExists('transcript_segments');
  await knex.schema.dropTableIfExists('transcripts');
};
