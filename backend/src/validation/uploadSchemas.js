const { z } = require('zod');

const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
]);

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm']);

const mediaIdParam = z.object({ params: z.object({ mediaAssetId: z.string().uuid() }) });

module.exports = { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, mediaIdParam };
