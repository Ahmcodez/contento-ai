import { AuthProvider } from '@/lib/auth/AuthContext';

export default function AuthLayout({ children }) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen items-center justify-center bg-ice-hero px-6">
        <div className="w-full max-w-sm rounded-2xl border border-mist bg-white p-8 shadow-xl shadow-slate-900/5">
          {children}
        </div>
      </div>
    </AuthProvider>
  );
}
