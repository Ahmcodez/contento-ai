'use client';

import { useState } from 'react';
import { CLIP_COUNT_PRESETS, MAX_CLIP_COUNT, parseClipCount } from '@/lib/clipCount';

/**
 * "How many clips do you want?" Presets for the common choices plus a number box for
 * anything else. Controlled: the parent owns the number so it can send it with the
 * upload or the import confirmation.
 */
export default function ClipCountPicker({ value, onChange, disabled = false }) {
  const isPreset = CLIP_COUNT_PRESETS.includes(value);
  const [notice, setNotice] = useState(null);

  function handleTyped(raw) {
    const n = Number(raw);
    if (raw !== '' && Number.isInteger(n) && n > MAX_CLIP_COUNT) {
      setNotice(`The most you can ask for is ${MAX_CLIP_COUNT} clips, so we set it to ${MAX_CLIP_COUNT}.`);
    } else if (raw !== '' && Number.isInteger(n) && n < 1) {
      setNotice('Ask for at least 1 clip.');
    } else {
      setNotice(null);
    }
    onChange(parseClipCount(raw));
  }

  return (
    <fieldset disabled={disabled} className="min-w-0 rounded-lg border border-mist bg-mist/20 p-4">
      <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-steel">Clip settings</legend>
      <p className="text-[14px] font-medium text-graphite">How many clips do you want?</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {CLIP_COUNT_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setNotice(null);
              onChange(n);
            }}
            aria-pressed={value === n}
            className={`h-9 min-w-9 rounded-full border px-3 text-[13px] font-medium transition-colors
              ${value === n ? 'border-graphite bg-graphite text-white' : 'border-mist bg-white text-graphite hover:border-steel'}
              disabled:opacity-50`}
          >
            {n}
          </button>
        ))}
        <label className="flex items-center gap-2 text-[13px] text-steel">
          <span className={isPreset ? '' : 'font-medium text-graphite'}>or type</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_CLIP_COUNT}
            value={value ?? ''}
            onChange={(e) => handleTyped(e.target.value)}
            aria-label={`Number of clips, 1 to ${MAX_CLIP_COUNT}`}
            aria-describedby="clip-count-help"
            className={`h-9 w-16 rounded-lg border bg-white px-2 text-center text-[13px] text-graphite outline-none focus:border-accent-violet
              ${isPreset ? 'border-mist' : 'border-graphite'}`}
          />
        </label>
      </div>
      {notice && (
        <p role="status" className="mt-2 text-[12px] font-medium text-graphite">
          {notice}
        </p>
      )}
      <p id="clip-count-help" className="mt-2 text-[12px] leading-relaxed text-steel">
        Choose 1 to {MAX_CLIP_COUNT}. Each clip starts at its hook and covers that topic, and they&apos;re spread across
        the whole video. You may get fewer if there aren&apos;t enough strong ones.
      </p>
    </fieldset>
  );
}
