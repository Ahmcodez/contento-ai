import { forwardRef } from 'react';

export const Input = forwardRef(function Input({ label, error, className = '', id, ...props }, ref) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[13px] font-medium text-slate">{label}</span>}
      <input
        ref={ref}
        id={id}
        className={`h-10 w-full rounded-[3px] border bg-transparent px-3 text-sm text-paper
          placeholder:text-slate-dim outline-none transition-colors
          ${error ? 'border-tally' : 'border-line-dark focus:border-slate'} ${className}`}
        {...props}
      />
      {error && <span className="mt-1 block text-[12px] text-tally">{error}</span>}
    </label>
  );
});

export const Textarea = forwardRef(function Textarea({ label, error, className = '', ...props }, ref) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[13px] font-medium text-slate">{label}</span>}
      <textarea
        ref={ref}
        className={`w-full rounded-[3px] border bg-transparent px-3 py-2 text-sm text-paper leading-relaxed
          placeholder:text-slate-dim outline-none transition-colors
          ${error ? 'border-tally' : 'border-line-dark focus:border-slate'} ${className}`}
        {...props}
      />
      {error && <span className="mt-1 block text-[12px] text-tally">{error}</span>}
    </label>
  );
});
