'use client';

import { useCallback, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import ProgressBar from '@/components/ui/ProgressBar';
import { uploadVideo } from '@/lib/api/media';
import { formatBytes } from '@/lib/format';

const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm'];
// Mirrors backend/src/validation/uploadSchemas.js ALLOWED_MIME_TYPES —
// this is a client-side first pass only; the server re-validates the
// actual file bytes regardless of what the browser reports here.
const ACCEPTED_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'];

function validateFile(file) {
  const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
  if (!ACCEPTED_EXTENSIONS.includes(ext) && !ACCEPTED_MIME_TYPES.includes(file.type)) {
    return `"${file.name}" isn't a supported video format. Use MP4, MOV, MKV, or WebM.`;
  }
  return null;
}

export default function UploadDropzone({ projectId, onUploaded }) {
  const [file, setFile] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('idle'); // idle | uploading | done
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);

  function pickFile(selected) {
    if (!selected) return;
    const error = validateFile(selected);
    setValidationError(error);
    setUploadError(null);
    setFile(error ? null : selected);
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    pickFile(dropped);
  }, []);

  async function startUpload() {
    if (!file) return;
    setStatus('uploading');
    setUploadError(null);
    setProgress(0);
    abortControllerRef.current = new AbortController();

    try {
      const result = await uploadVideo(projectId, file, {
        onProgress: setProgress,
        signal: abortControllerRef.current.signal,
      });
      setStatus('done');
      onUploaded(result);
    } catch (err) {
      setStatus('idle');
      if (err.code !== 'CANCELLED') {
        setUploadError(err.message);
      }
    }
  }

  function cancelUpload() {
    abortControllerRef.current?.abort();
  }

  function reset() {
    setFile(null);
    setValidationError(null);
    setUploadError(null);
    setProgress(0);
    setStatus('idle');
  }

  if (status === 'uploading') {
    return (
      <div className="rounded-lg border border-line-dark p-6">
        <p className="text-sm text-paper">{file.name}</p>
        <p className="mt-0.5 text-[12px] text-slate-dim">{formatBytes(file.size)}</p>
        <ProgressBar value={progress} showLabel label={`Uploading ${file.name}`} className="mt-4" />
        <Button variant="ghost" size="sm" onClick={cancelUpload} className="mt-4">
          Cancel upload
        </Button>
      </div>
    );
  }

  if (file && status === 'idle') {
    return (
      <div className="rounded-lg border border-line-dark p-6">
        <p className="text-sm text-paper">{file.name}</p>
        <p className="mt-0.5 text-[12px] text-slate-dim">{formatBytes(file.size)}</p>
        {uploadError && <p className="mt-3 text-[13px] text-tally">{uploadError}</p>}
        <div className="mt-4 flex gap-2">
          <Button onClick={startUpload}>{uploadError ? 'Retry upload' : 'Upload video'}</Button>
          <Button variant="ghost" onClick={reset}>
            Choose a different file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Choose a video file to upload, or drag and drop one here"
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed
          px-6 py-16 text-center transition-colors
          ${isDragging ? 'border-tally bg-tally/5' : 'border-line-dark hover:border-slate'}`}
      >
        <p className="text-sm font-medium text-paper">Drag and drop your video, or click to browse</p>
        <p className="text-[12px] text-slate-dim">MP4, MOV, MKV, or WebM · up to 500MB</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </div>
      {validationError && <p className="mt-3 text-[13px] text-tally">{validationError}</p>}
    </div>
  );
}
