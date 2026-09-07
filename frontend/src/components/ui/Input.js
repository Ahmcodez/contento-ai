import { forwardRef } from 'react';

export const Input = forwardRef(function Input({ label, error, surface = 'light', className = '', id, ...props }, ref) {
  const light = surface !== 'dark';
  return (
    <label className="block">
      {label && (
        <span className={`mb-1.5 block text-[13px] font-medium ${light ? 'text-steel' : 'text-slate'}`}>{label}</span>
      )}
      <input
        ref={ref}
        id={id}
        className={`h-11 w-full rounded-lg border px-3.5 text-sm outline-none transition-colors
          ${light ? 'bg-white text-graphite placeholder:text-steel/60' : 'bg-transparent text-paper placeholder:text-slate-dim'}
          ${error ? 'border-tally' : light ? 'border-mist focus:border-accent-violet' : 'border-line-dark focus:border-slate'}
          ${className}`}
        {...props}
      />
      {error && <span className="mt-1 block text-[12px] text-tally">{error}</span>}
    </label>
  );
});

export const Textarea = forwardRef(function Textarea({ label, error, surface = 'light', className = '', ...props }, ref) {
  const light = surface !== 'dark';
  return (
    <label className="block">
      {label && (
        <span className={`mb-1.5 block text-[13px] font-medium ${light ? 'text-steel' : 'text-slate'}`}>{label}</span>
      )}
      <textarea
        ref={ref}
        className={`w-full rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed outline-none transition-colors
          ${light ? 'bg-white text-graphite placeholder:text-steel/60' : 'bg-transparent text-paper placeholder:text-slate-dim'}
          ${error ? 'border-tally' : light ? 'border-mist focus:border-accent-violet' : 'border-line-dark focus:border-slate'}
          ${className}`}
        {...props}
      />
      {error && <span className="mt-1 block text-[12px] text-tally">{error}</span>}
    </label>
  );
});
