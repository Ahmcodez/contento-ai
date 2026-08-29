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
      <Link href="/" className="font-display text-xl text-paper">
        Contento
      </Link>
      <h1 className="mt-8 text-2xl font-medium text-paper">Log in</h1>
      <p className="mt-1 text-sm text-slate">Welcome back.</p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        {error && <p className="text-[13px] text-tally">{error}</p>}
        <Button type="submit" loading={submitting} className="mt-2 w-full">
          Log in
        </Button>
      </form>

      <div className="mt-6 flex justify-between text-[13px] text-slate">
        <Link href="/forgot-password" className="hover:text-paper">
          Forgot password?
        </Link>
        <Link href="/signup" className="hover:text-paper">
          Create an account
        </Link>
      </div>
    </div>
  );
}
