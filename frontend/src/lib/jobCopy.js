// What an empty Clips / Content / Transcript tab says once a job has stopped
// without producing it. Without this a failed job claimed things like "no strong
// moments were found in this video", which is untrue: it never got that far.
export const STOPPED_COPY = {
  failed: {
    title: 'Not created: processing failed',
    description: 'This job stopped before reaching this step. Use Retry above to continue from where it stopped.',
  },
  cancelled: {
    title: 'Not created: processing was cancelled',
    description: 'This job was cancelled before reaching this step.',
  },
};
