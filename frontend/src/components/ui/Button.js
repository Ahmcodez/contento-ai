import { forwardRef } from 'react';

const VARIANTS = {
  primary: 'bg-tally text-paper hover:bg-tally-hover active:bg-tally-hover',
  secondary: 'bg-transparent text-paper border border-line-dark hover:border-slate hover:bg-white/5',
  ghost: 'bg-transparent text-slate hover:text-paper',
  danger: 'bg-transparent text-tally border border-tally/40 hover:bg-tally/10',
};

const SIZES = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
};

const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className = '', disabled, loading, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-medium tracking-[-0.01em]
        transition-colors duration-150 ease-out rounded-[3px]
        disabled:opacity-40 disabled:cursor-not-allowed
        ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
});

export default Button;
