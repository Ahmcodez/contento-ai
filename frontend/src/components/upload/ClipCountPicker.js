'use client';

import { CLIP_COUNT_PRESETS, MAX_CLIP_COUNT, parseClipCount } from '@/lib/clipCount';

/**
 * "How many clips do you want?" Presets for the common choices plus a number box for
 * anything else. Controlled: the parent owns the number so it can send it with the
 * upload or the import confirmation.
 */
export default function ClipCountPicker({ value, onChange, disabled = false }) {
  const isPreset = CLIP_COUNT_PRESETS.includes(value);

  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
      <legend className="text-[13px] font-medium text-graphite">How many clips do you want?</legend>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {CLIP_COUNT_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={`h-9 min-w-9 rounded-full border px-3 text-[13px] font-medium transition-colors
              ${value === n ? 'border-graphite bg-graphite text-white' : 'border-mist bg-white text-graphite hover:border-steel'}
              disabled:opacity-50`}
          >
            {n}
          </button>
        ))}
        <label className="flex items-center gap-2 text-[13px] text-steel">
          <span className={isPreset ? '' : 'font-medium text-graphite'}>or</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_CLIP_COUNT}
            value={value ?? ''}
            onChange={(e) => onChange(parseClipCount(e.target.value))}
            aria-label={`Number of clips, 1 to ${MAX_CLIP_COUNT}`}
            className={`h-9 w-16 rounded-lg border px-2 text-center text-[13px] text-graphite outline-none focus:border-accent-violet
              ${isPreset ? 'border-mist' : 'border-graphite'}`}
          />
        </label>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-steel">
        Each clip starts at its hook and covers that topic, and they&apos;re spread across the whole video. You may get
        fewer if there aren&apos;t enough strong ones.
      </p>
    </fieldset>
  );
}
