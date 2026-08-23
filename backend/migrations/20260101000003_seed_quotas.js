exports.up = async function up(knex) {
  await knex('quotas').insert([
    {
      plan: 'free',
      max_upload_duration_seconds: 3600,
      max_upload_size_mb: 500,
      max_clips_per_video: 10,
      max_ai_requests_per_day: 50,
      max_concurrent_jobs: 2,
    },
    {
      plan: 'pro',
      max_upload_duration_seconds: 14400,
      max_upload_size_mb: 2000,
      max_clips_per_video: 25,
      max_ai_requests_per_day: 500,
      max_concurrent_jobs: 5,
    },
  ]);
};

exports.down = async function down(knex) {
  await knex('quotas').whereIn('plan', ['free', 'pro']).del();
};
