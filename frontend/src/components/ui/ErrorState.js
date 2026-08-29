import Button from './Button';

export default function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[4px] border border-tally/25 bg-tally/5 px-6 py-12 text-center">
      <p className="text-sm font-medium text-paper">{title}</p>
      {message && <p className="max-w-sm text-[13px] leading-relaxed text-slate">{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      )}
    </div>
  );
}
