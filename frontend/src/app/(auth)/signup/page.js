'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';
import { Input } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { ApiError } from '@/lib/api/client';

export default function SignupPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ name, email, password });
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
      <h1 className="mt-8 text-2xl font-medium text-paper">Create your account</h1>
      <p className="mt-1 text-sm text-slate">Start turning long videos into clips and posts.</p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
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
          autoComplete="new-password"
        />
        <p className="text-[12px] text-slate-dim">At least 10 characters, with a letter and a number.</p>
        {error && <p role="alert" className="text-[13px] text-tally">{error}</p>}
        <Button type="submit" loading={submitting} className="mt-2 w-full">
          Create account
        </Button>
      </form>

      <div className="mt-6 text-[13px] text-slate">
        Already have an account?{' '}
        <Link href="/login" className="text-paper hover:text-tally">
          Log in
        </Link>
      </div>
    </div>
  );
}
