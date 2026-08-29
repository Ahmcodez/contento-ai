'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import { updateContent } from '@/lib/api/content';
import { regenerateContent } from '@/lib/api/jobs';

export default function ContentEditor({ jobId, content, onChange }) {
  const [body, setBody] = useState(content.body);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateContent(content.id, body);
      onChange(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const updated = await regenerateContent(jobId, content.contentType);
      setBody(updated.body);
      onChange(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {content.status === 'edited' && <Badge tone="neutral">Edited</Badge>}
          {content.metadata?.truncated && <Badge tone="warning">Trimmed to fit</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {!editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={handleRegenerate} loading={regenerating}>
            Regenerate
          </Button>
        </div>
      </div>

      {editing ? (
        <>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="font-sans" />
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleSave} loading={saving}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBody(content.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="whitespace-pre-wrap rounded-[3px] border border-line-dark p-4 text-[14px] leading-relaxed text-paper/90">
          {body}
        </div>
      )}

      {error && <p className="mt-2 text-[13px] text-tally">{error}</p>}

      {/* No export-as-file endpoint exists yet (GET /content/:id/export) —
          copy-to-clipboard above is the real, working substitute rather
          than a fabricated download button. */}
    </div>
  );
}
