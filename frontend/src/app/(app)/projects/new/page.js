'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Textarea } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import UploadDropzone from '@/components/upload/UploadDropzone';
import { createProject } from '@/lib/api/projects';
import { ApiError } from '@/lib/api/client';

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState('details'); // details | upload
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreateProject(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await createProject({ title, description: description || undefined });
      setProject(created);
      setStep('upload');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the project. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleUploaded(result) {
    router.push(`/projects/${project.id}/jobs/${result.processingJob.id}`);
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-2xl text-paper">New project</h1>

      {step === 'details' && (
        <form onSubmit={handleCreateProject} className="mt-8 flex flex-col gap-4">
          <Input
            label="Project title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Episode 42 — Building in public"
            required
          />
          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What's this video about?"
          />
          {error && <p role="alert" className="text-[13px] text-tally">{error}</p>}
          <Button type="submit" loading={submitting} className="mt-2 self-start">
            Continue to upload
          </Button>
        </form>
      )}

      {step === 'upload' && project && (
        <div className="mt-8">
          <p className="mb-4 text-sm text-slate">
            <span className="text-paper">{project.title}</span> — now upload the video to process.
          </p>
          <UploadDropzone projectId={project.id} onUploaded={handleUploaded} />
        </div>
      )}
    </div>
  );
}
