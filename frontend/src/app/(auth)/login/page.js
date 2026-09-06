'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';
import { Input } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { ApiError } from '@/lib/api/client';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Link href="/" className="font-jakarta text-xl font-bold text-graphite">
        Contento
      </Link>
      <h1 className="mt-8 text-2xl font-semibold text-graphite">Log in</h1>
      <p className="mt-1 text-sm text-steel">Welcome back.</p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <Input
          surface="light"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Input
          surface="light"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        {error && <p role="alert" className="text-[13px] text-tally">{error}</p>}
        <Button variant="gradientPill" type="submit" loading={submitting} className="mt-2 w-full">
          Log in
        </Button>
      </form>

      <div className="mt-6 flex justify-between text-[13px] text-steel">
        <Link href="/forgot-password" className="hover:text-graphite">
          Forgot password?
        </Link>
        <Link href="/signup" className="hover:text-graphite">
          Create an account
        </Link>
      </div>
    </div>
  );
}
