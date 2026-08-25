import Link from 'next/link';

/**
 * There is no password-reset endpoint on the backend yet
 * (no POST /auth/forgot-password or similar exists in
 * backend/src/routes/auth.routes.js). Rather than fabricate a "check
 * your email" flow that silently does nothing, this page says so
 * directly and points to a real fallback.
 */
export default function ForgotPasswordPage() {
  return (
    <div>
      <Link href="/" className="font-display text-xl text-paper">
        Contento
      </Link>
      <h1 className="mt-8 text-2xl font-medium text-paper">Reset your password</h1>
      <p className="mt-4 text-sm leading-relaxed text-slate">
        Self-service password reset isn&apos;t available yet. If you&apos;re locked out of your
        account, please contact support and we&apos;ll help you get back in.
      </p>
      <Link href="/login" className="mt-6 inline-block text-[13px] text-paper hover:text-tally">
        ← Back to log in
      </Link>
    </div>
  );
}
