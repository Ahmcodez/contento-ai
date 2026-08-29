import { AuthProvider } from '@/lib/auth/AuthContext';

export default function AuthLayout({ children }) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </AuthProvider>
  );
}
