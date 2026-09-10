// media_imports tracks the "Paste Video URL" flow from the moment a URL
// is pasted through provider detection, metadata preview, user
// confirmation, and download, right up to the point a real MediaAsset
// row exists. Deliberately a *separate* table/state-machine from
// processing_jobs, not an extension of it: everything before a
// MediaAsset exists (detecting the provider, fetching a preview,
// waiting on user confirmation, downloading) is pre-pipeline work with
// its own failure modes (bad URL, unsupported provider, private video,
// download too large) that have nothing to do with the transcription/
// AI/clip-rendering pipeline. Once a download succeeds and validates,
// it hands off into the existing media_assets -> processing_jobs
// pipeline exactly like an uploaded file does (see
// src/services/urlImport.service.js) — this table's job ends where
// upload's job already ended, it just took a different, longer road to
// get there.
const MEDIA_IMPORT_STATES = [
  'DETECTING_PROVIDER',
  'FETCHING_METADATA',
  'WAITING_CONFIRMATION',
  'DOWNLOADING',
  'VALIDATING_MEDIA',
  'COMPLETED',
  'FAILED',
];

exports.up = async function up(knex) {
  await knex.schema.createTable('media_imports', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('requested_by').notNullable().references('id').inTable('users');
    t.text('source_url').notNullable();
    // Open string, not a DB enum: the provider registry
    // (src/providers/ProviderResolver.js) is meant to be extended with
    // new providers without a migration — see docs/ARCHITECTURE.md on
    // the URL-ingestion provider system. Validated at the application
    // layer against the actual registered provider list instead.
    t.text('provider');
    t.enu('state', MEDIA_IMPORT_STATES).notNullable().defaultTo('DETECTING_PROVIDER');
    t.smallint('progress_percent').notNullable().defaultTo(0);
    t.text('title');
    t.text('thumbnail_url');
    t.decimal('duration_seconds', 10, 2);
    t.integer('width');
    t.integer('height');
    t.text('source_id');
    t.uuid('media_asset_id').references('id').inTable('media_assets').onDelete('SET NULL');
    t.text('failure_stage');
    t.text('error_message');
    t.timestamp('started_at');
    t.timestamp('completed_at');
    t.timestamps(true, true);
    t.index('project_id');
    t.index('requested_by');
    t.index('state');
    t.index('created_at');
  });

  await knex.schema.createTable('media_import_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('media_import_id').notNullable().references('id').inTable('media_imports').onDelete('CASCADE');
    t.text('from_state');
    t.text('to_state').notNullable();
    t.jsonb('metadata');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('media_import_id');
  });

  // media_assets gains source-tracking columns so a URL-imported asset
  // is indistinguishable from an uploaded one anywhere downstream
  // (transcription, AI analysis, clip rendering never look at these —
  // see MediaAsset shape in docs/ARCHITECTURE.md §4) while the UI can
  // still show "Imported from YouTube" etc. Nullable / defaulted so
  // every existing row and the plain-upload path are unaffected.
  await knex.schema.alterTable('media_assets', (t) => {
    t.enu('source_type', ['upload', 'url']).notNullable().defaultTo('upload');
    t.text('source_provider');
    t.text('source_url');
    t.text('source_id');
    t.text('title'); // display title for URL imports; upload flow keeps using original_filename
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('media_assets', (t) => {
    t.dropColumn('source_type');
    t.dropColumn('source_provider');
    t.dropColumn('source_url');
    t.dropColumn('source_id');
    t.dropColumn('title');
  });
  await knex.schema.dropTableIfExists('media_import_events');
  await knex.schema.dropTableIfExists('media_imports');
};
