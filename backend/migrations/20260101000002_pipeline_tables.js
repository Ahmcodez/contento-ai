const PROCESSING_STATES = [
  'UPLOADING',
  'UPLOADED',
  'VALIDATING',
  'VALIDATED',
  'EXTRACTING_AUDIO',
  'AUDIO_EXTRACTED',
  'TRANSCRIBING',
  'TRANSCRIBED',
  'ANALYZING',
  'ANALYZED',
  'FINDING_CLIPS',
  'CLIPS_FOUND',
  'SCORING_CLIPS',
  'CLIPS_SCORED',
  'RENDERING_CLIPS',
  'CLIPS_RENDERED',
  'GENERATING_CONTENT',
  'CONTENT_GENERATED',
  'FINALIZING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

exports.up = async function up(knex) {
  await knex.schema.createTable('media_assets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('uploaded_by').notNullable().references('id').inTable('users');
    t.text('original_filename').notNullable();
    t.text('storage_key').notNullable();
    t.text('mime_type').notNullable();
    t.bigInteger('size_bytes').notNullable().checkPositive();
    t.decimal('duration_seconds', 10, 2);
    t.text('checksum_sha256').notNullable();
    t.enu('status', ['uploading', 'uploaded', 'validating', 'validated', 'rejected']).notNullable().defaultTo('uploading');
    t.text('rejection_reason');
    t.timestamps(true, true);
    t.index('project_id');
    t.unique(['project_id', 'checksum_sha256']);
  });

  await knex.schema.createTable('processing_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('media_asset_id').notNullable().references('id').inTable('media_assets').onDelete('CASCADE');
    t.enu('state', PROCESSING_STATES).notNullable().defaultTo('UPLOADING');
    t.text('failure_stage');
    t.text('error_message');
    t.smallint('progress_percent').notNullable().defaultTo(0);
    t.timestamp('started_at');
    t.timestamp('completed_at');
    t.timestamp('cancelled_at');
    t.timestamps(true, true);
    t.index('media_asset_id');
    t.index('state');
    t.index('created_at');
  });

  await knex.schema.createTable('processing_job_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('processing_job_id').notNullable().references('id').inTable('processing_jobs').onDelete('CASCADE');
    t.text('from_state');
    t.text('to_state').notNullable();
    t.jsonb('metadata');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('processing_job_id');
  });

  await knex.schema.createTable('processing_errors', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('processing_job_id').notNullable().references('id').inTable('processing_jobs').onDelete('CASCADE');
    t.text('stage').notNullable();
    t.text('message').notNullable();
    t.jsonb('detail');
    t.smallint('retry_count').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('processing_job_id');
  });

  await knex.schema.createTable('usage_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.enu('category', ['upload_minutes', 'ai_requests', 'transcription_minutes', 'clips_rendered']).notNullable();
    t.decimal('amount', 12, 4).notNullable();
    t.uuid('processing_job_id').references('id').inTable('processing_jobs');
    t.date('occurred_on').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'category', 'occurred_on']);
  });

  await knex.schema.createTable('quotas', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.enu('plan', ['free', 'pro']).notNullable().unique();
    t.integer('max_upload_duration_seconds').notNullable();
    t.integer('max_upload_size_mb').notNullable();
    t.integer('max_clips_per_video').notNullable();
    t.integer('max_ai_requests_per_day').notNullable();
    t.integer('max_concurrent_jobs').notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('quotas');
  await knex.schema.dropTableIfExists('usage_records');
  await knex.schema.dropTableIfExists('processing_errors');
  await knex.schema.dropTableIfExists('processing_job_events');
  await knex.schema.dropTableIfExists('processing_jobs');
  await knex.schema.dropTableIfExists('media_assets');
};
