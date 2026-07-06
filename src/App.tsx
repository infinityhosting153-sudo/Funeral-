import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { isFirebaseConfigured } from './lib/env';
import { type Role } from './lib/domain';
import { useFirebaseSession, type AuthState } from './lib/firebaseAuth';

const AdminDashboard = lazy(() => import('./admin/AdminDashboard').then((module) => ({ default: module.AdminDashboard })));

function dashboardPathForRole(role: Role) {
  if (role === 'administrator') {
    return '/admin';
  }
  if (role === 'financeOfficer') {
    return '/finance';
  }
  return '/client';
}

function ProtectedRoute({ session, children }: { session: AuthState; children: React.ReactNode }) {
  if (!session.configured) {
    return (
      <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        Firebase is not configured. Add your environment variables to enable the admin dashboard.
      </div>
    );
  }

  if (session.loading) {
    return <div className="p-8 text-sm text-slate-500">Loading session...</div>;
  }

  if (!session.user || !session.profile) {
    return <Navigate to="/login" replace />;
  }

  if (session.profile.role !== 'administrator') {
    return (
      <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-200">
        Only administrator accounts can access this dashboard.
      </div>
    );
  }

  return <>{children}</>;
}

function AuthPage({ mode, session }: { mode: 'login' | 'register'; session: AuthState }) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.profile) {
      navigate(dashboardPathForRole(session.profile.role), { replace: true });
    }
  }, [navigate, session.profile]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);

    const formData = new FormData(event.currentTarget);

    try {
      if (mode === 'login') {
        await session.signIn(String(formData.get('email') || ''), String(formData.get('password') || ''));
      } else {
        await session.register({
          fullName: String(formData.get('fullName') || ''),
          email: String(formData.get('email') || ''),
          password: String(formData.get('password') || ''),
          role: String(formData.get('role') || 'client') as Role,
        });
      }
      navigate('/admin', { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Administrator Portal</p>
      <h1 className="mt-2 text-2xl font-semibold">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        {mode === 'login'
          ? 'Use your administrator account to access the dashboard.'
          : 'Register a Firebase user. Assign administrator role in the profile document.'}
      </p>

      <form className="mt-6 space-y-3" onSubmit={submit}>
        {mode === 'register' ? (
          <label className="block text-sm">
            Full Name
            <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" name="fullName" required />
          </label>
        ) : null}

        <label className="block text-sm">
          Email
          <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" name="email" type="email" required />
        </label>

        <label className="block text-sm">
          Password
          <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" name="password" type="password" required />
        </label>

        {mode === 'register' ? (
          <label className="block text-sm">
            Role
            <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" name="role" defaultValue="client">
              <option value="administrator">administrator</option>
              <option value="financeOfficer">finance officer</option>
              <option value="client">client</option>
            </select>
          </label>
        ) : null}

        {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}

        <button type="submit" disabled={busy || !session.configured} className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900">
          {busy ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link to="/" className="text-slate-500 hover:underline dark:text-slate-400">
          Back home
        </Link>
        <button type="button" onClick={() => void session.createDefaultClient()} className="text-emerald-700 hover:underline dark:text-emerald-400">
          Create default client
        </button>
      </div>

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Demo client credentials: ava.johnson@example.com / Client123!
      </p>
    </div>
  );
}

function HomePage({ session }: { session: AuthState }) {
  const navigate = useNavigate();

  return (
    <main className="mx-auto mt-10 max-w-6xl p-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Funeral Parlor Management</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Enterprise Admin Dashboard</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          Responsive administrator workspace with client management, claims monitoring, beneficiaries, communication, reporting, and live Firestore analytics.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Open Admin Dashboard
          </button>
          <Link to="/login" className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
            Login
          </Link>
          <Link to="/register" className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
            Register
          </Link>
          {session.user ? (
            <button
              type="button"
              onClick={() => void session.signOut()}
              className="rounded-lg border border-rose-300 px-4 py-2 text-sm text-rose-700 dark:border-rose-700 dark:text-rose-300"
            >
              Logout
            </button>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          {isFirebaseConfigured()
            ? 'Firebase is configured and connected.'
            : 'Firebase environment variables are missing. Configure .env.local to unlock live Firestore data.'}
        </p>
      </div>
    </main>
  );
}

function App() {
  const location = useLocation();
  const session = useFirebaseSession();

  return (
    <Routes>
      <Route path="/" element={<HomePage session={session} />} />
      <Route path="/login" element={<AuthPage mode="login" session={session} />} />
      <Route path="/register" element={<AuthPage mode="register" session={session} />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute session={session}>
            <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading dashboard...</div>}>
              <AdminDashboard session={session} />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route path="/finance" element={<Navigate to="/admin" replace />} />
      <Route path="/client" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/" replace state={{ from: location.pathname }} />} />
    </Routes>
  );
}

export default App;
