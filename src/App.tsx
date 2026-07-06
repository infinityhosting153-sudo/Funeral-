import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { isFirebaseConfigured } from './lib/env';
import { defaultClients, type ClientRecord, type Role, type Status } from './lib/domain';
import { useFirebaseSession, type AuthState } from './lib/firebaseAuth';
import { useRegistry, type RegistryState } from './lib/firebaseRegistry';

const featureCards = [
  {
    title: 'Memberships',
    description: 'Track plans, membership numbers, join dates, and current status in one place.',
  },
  {
    title: 'Client Records',
    description: 'Store contact details, identity information, and service history with role-based access.',
  },
  {
    title: 'Protected Operations',
    description: 'Separate admin and client views for safer workflows and clearer accountability.',
  },
];

const rolePanels: Record<Role, { title: string; summary: string; items: string[] }> = {
  administrator: {
    title: 'Administrator dashboard',
    summary: 'Manage users, memberships, and the overall funeral parlor workflow.',
    items: ['Approve registrations', 'Audit records', 'Monitor system status'],
  },
  financeOfficer: {
    title: 'Finance dashboard',
    summary: 'Review payment status, reconcile memberships, and keep financial records aligned.',
    items: ['Track payments', 'Review balances', 'Export reports'],
  },
  client: {
    title: 'Client dashboard',
    summary: 'View membership progress, service history, and available support actions.',
    items: ['Check membership', 'View documents', 'Contact support'],
  },
};

function dashboardPathForRole(role: Role) {
  if (role === 'administrator') {
    return '/admin';
  }

  if (role === 'financeOfficer') {
    return '/finance';
  }

  return '/client';
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useFirebaseSession();
  const registry = useRegistry();

  useEffect(() => {
    if (!session.configured || session.loading || !session.user || !session.profile) {
      return;
    }

    const nextPath = dashboardPathForRole(session.profile.role);

    if (location.pathname === '/login' || location.pathname === '/register') {
      navigate(nextPath, { replace: true });
    }
  }, [location.pathname, navigate, session.configured, session.loading, session.profile, session.user]);

  return (
    <Routes>
      <Route path="/" element={<LandingPage session={session} />} />
      <Route path="/login" element={<AuthPage mode="login" session={session} />} />
      <Route path="/register" element={<AuthPage mode="register" session={session} />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRole="administrator" session={session}>
            <DashboardPage role="administrator" session={session} registry={registry} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance"
        element={
          <ProtectedRoute allowedRole="financeOfficer" session={session}>
            <DashboardPage role="financeOfficer" session={session} registry={registry} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/client"
        element={
          <ProtectedRoute allowedRole="client" session={session}>
            <DashboardPage role="client" session={session} registry={registry} />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace state={{ from: location.pathname }} />} />
    </Routes>
  );
}

function ProtectedRoute({
  allowedRole,
  session,
  children,
}: {
  allowedRole: Role;
  session: AuthState;
  children: ReactElement;
}) {
  if (!session.configured) {
    return children;
  }

  if (session.loading) {
    return <ShellMessage title="Loading session" description="Connecting to Firebase Auth and Firestore..." />;
  }

  if (!session.user) {
    return <Navigate to="/login" replace />;
  }

  if (session.profile && session.profile.role !== allowedRole) {
    return <Navigate to={dashboardPathForRole(session.profile.role)} replace />;
  }

  return children;
}

function LandingPage({ session }: { session: AuthState }) {
  const destination = session.profile ? dashboardPathForRole(session.profile.role) : '/login';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Funeral Parlor</p>
          <h1>Funeral Parlor Management System</h1>
        </div>
        <nav className="nav-links">
          <Link to="/login">Login</Link>
          <Link to="/register" className="nav-button">
            Register
          </Link>
        </nav>
      </header>

      <main className="hero-grid">
        <section className="hero-card">
          <p className="status-pill">Firebase-backed administration</p>
          <h2>Memberships, client records, and protected operations.</h2>
          <p className="lede">
            A role-aware funeral management app with dedicated admin and client views, now wired to
            Firebase Auth and Firestore when the environment variables are present.
          </p>
          <div className="cta-row">
            <Link to={destination} className="primary-button">
              Continue
            </Link>
            <Link to="/admin" className="secondary-button">
              Open admin view
            </Link>
          </div>
          <p className="env-note">
            {isFirebaseConfigured()
              ? 'Firebase environment variables are configured.'
              : 'Firebase environment variables are not configured yet. The interface will build, but authentication and Firestore data will stay in offline demo mode until the client environment file is populated.'}
          </p>
        </section>

        <aside className="panel-stack">
          {featureCards.map((card) => (
            <article className="info-card" key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </article>
          ))}
        </aside>
      </main>
    </div>
  );
}

function AuthPage({ mode, session }: { mode: 'login' | 'register'; session: AuthState }) {
  const navigate = useNavigate();
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session.configured || !session.profile) {
      return;
    }

    navigate(dashboardPathForRole(session.profile.role), { replace: true });
  }, [navigate, session.configured, session.profile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError('');

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

      const nextRole = session.profile?.role ?? (String(formData.get('role') || 'client') as Role);
      navigate(dashboardPathForRole(nextRole), { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell centered">
      <section className="auth-card">
        <p className="eyebrow">Funeral Parlor</p>
        <h1>{mode === 'login' ? 'Login' : 'Register'}</h1>
        <p className="lede">
          {mode === 'login'
            ? 'Sign in to continue to the protected dashboards.'
            : 'Create a new Firebase-backed account for an administrator, finance officer, or client workflow.'}
        </p>

        {!session.configured ? (
          <ShellMessage
            title="Offline mode"
            description="Firebase is not configured yet, so the form stays present but cannot authenticate against the backend."
          />
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' ? (
            <label>
              Full name
              <input name="fullName" autoComplete="name" required />
            </label>
          ) : null}

          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>

          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </label>

          {mode === 'register' ? (
            <label>
              Role
              <select name="role" defaultValue="client">
                <option value="administrator">administrator</option>
                <option value="financeOfficer">finance officer</option>
                <option value="client">client</option>
              </select>
            </label>
          ) : null}

          {formError ? <p className="error-text">{formError}</p> : null}

          <button type="submit" className="primary-button" disabled={submitting || !session.configured}>
            {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <Link to="/" className="text-link">
          Back to home
        </Link>
      </section>
    </div>
  );
}

function DashboardPage({
  role,
  session,
  registry,
}: {
  role: Role;
  session: AuthState;
  registry: RegistryState;
}) {
  const panel = rolePanels[role];
  const canEdit = role === 'administrator';
  const [selectedClientId, setSelectedClientId] = useState<string | null>(registry.clients[0]?.id ?? null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (role === 'client' && session.profile) {
      const matchedClient = registry.clients.find((client) => client.email === session.profile?.email);
      setSelectedClientId(matchedClient?.id ?? registry.clients[0]?.id ?? null);
    }
  }, [registry.clients, role, session.profile]);

  useEffect(() => {
    if (!selectedClientId && registry.clients[0]) {
      setSelectedClientId(registry.clients[0].id);
    }
  }, [registry.clients, selectedClientId]);

  const visibleClients = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const baseClients =
      role === 'client' && session.profile
        ? registry.clients.filter((client) => client.email === session.profile?.email)
        : registry.clients;

    if (!query) {
      return baseClients;
    }

    return baseClients.filter((client) => {
      return [client.fullName, client.email, client.membershipNumber, client.funeralPlan, client.status]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [registry.clients, role, searchTerm, session.profile]);

  const selectedClient =
    selectedClientId ? visibleClients.find((client) => client.id === selectedClientId) ?? visibleClients[0] ?? null : visibleClients[0] ?? null;
  const selectedMembership = selectedClient ? registry.memberships.find((membership) => membership.clientId === selectedClient.id) ?? null : null;

  async function handleClientSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextId = selectedClient?.id || crypto.randomUUID();

    await registry.saveClient({
      id: nextId,
      fullName: String(formData.get('fullName') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
      address: String(formData.get('address') || '').trim(),
      membershipNumber: String(formData.get('membershipNumber') || '').trim(),
      idNumber: String(formData.get('idNumber') || '').trim(),
      funeralPlan: String(formData.get('funeralPlan') || '').trim(),
      status: String(formData.get('status') || 'pending') as Status,
      joinedAt: String(formData.get('joinedAt') || new Date().toISOString().slice(0, 10)),
    });

    setSelectedClientId(nextId);
    event.currentTarget.reset();
  }

  async function handleDeleteClient(clientId: string) {
    await registry.deleteClient(clientId);

    const remainingClients = visibleClients.filter((client) => client.id !== clientId);
    setSelectedClientId(remainingClients[0]?.id ?? null);
  }

  const managementPanel = canEdit ? (
    <section className="management-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Membership and client registry</h2>
        </div>
        <div className="action-row">
          <button type="button" className="secondary-button" onClick={() => setSelectedClientId(null)}>
            New client
          </button>
          <button type="button" className="secondary-button" onClick={() => void registry.resetSamples()}>
            Reset sample data
          </button>
        </div>
      </div>

      <div className="management-layout">
        <form className="record-form" onSubmit={handleClientSubmit} key={selectedClient?.id ?? 'new-client'}>
          <h3>{selectedClient ? 'Edit client' : 'Add client'}</h3>
          <label>
            Full name
            <input name="fullName" defaultValue={selectedClient?.fullName ?? ''} required />
          </label>
          <label>
            Email
            <input name="email" type="email" defaultValue={selectedClient?.email ?? ''} required />
          </label>
          <label>
            Phone
            <input name="phone" defaultValue={selectedClient?.phone ?? ''} required />
          </label>
          <label>
            Address
            <input name="address" defaultValue={selectedClient?.address ?? ''} required />
          </label>
          <label>
            Membership number
            <input name="membershipNumber" defaultValue={selectedClient?.membershipNumber ?? ''} required />
          </label>
          <label>
            ID number
            <input name="idNumber" defaultValue={selectedClient?.idNumber ?? ''} required />
          </label>
          <label>
            Funeral plan
            <input name="funeralPlan" defaultValue={selectedClient?.funeralPlan ?? ''} required />
          </label>
          <label>
            Status
            <select name="status" defaultValue={selectedClient?.status ?? 'pending'}>
              <option value="active">active</option>
              <option value="pending">pending</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          <label>
            Joined date
            <input name="joinedAt" type="date" defaultValue={selectedClient?.joinedAt ?? ''} required />
          </label>
          <button type="submit" className="primary-button">
            Save client record
          </button>
          {selectedClient ? (
            <button type="button" className="secondary-button" onClick={() => void handleDeleteClient(selectedClient.id)}>
              Delete client
            </button>
          ) : null}
        </form>

        <div className="table-card">
          <div className="table-toolbar">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search memberships or clients"
            />
            <p>{visibleClients.length} records</p>
          </div>

          <div className="table-grid">
            {visibleClients.map((client) => {
              const membership = registry.memberships.find((item) => item.clientId === client.id);

              return (
                <div key={client.id} className={`table-row ${selectedClient?.id === client.id ? 'is-selected' : ''}`}>
                  <button type="button" className="row-select" onClick={() => setSelectedClientId(client.id)}>
                    <strong>{client.fullName}</strong>
                    <span>{client.membershipNumber}</span>
                    <span>{client.status}</span>
                    <span>{membership?.balanceDue ?? '$0.00'}</span>
                  </button>
                  <button type="button" className="row-delete" onClick={() => void handleDeleteClient(client.id)}>
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  ) : null;

  const visibleMemberships =
    role === 'client' && selectedClient
      ? registry.memberships.filter((membership) => membership.clientId === selectedClient.id)
      : registry.memberships;

  const totalBalance = visibleMemberships.reduce((sum, membership) => {
    const balanceValue = Number(membership.balanceDue.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(balanceValue) ? sum + balanceValue : sum;
  }, 0);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Protected area</p>
          <h1>{panel.title}</h1>
          <p className="topline-meta">{session.profile ? `${session.profile.fullName} · ${session.profile.role}` : 'Offline demo mode'}</p>
        </div>
        <nav className="nav-links">
          <Link to="/">Home</Link>
          <button type="button" className="secondary-button" onClick={() => void session.signOut()}>
            Sign out
          </button>
        </nav>
      </header>

      {registry.error ? <ShellMessage title="Firestore warning" description={registry.error} /> : null}
      {registry.loading ? <ShellMessage title="Loading records" description="Syncing clients and memberships from Firestore..." /> : null}

      <main className="dashboard-grid">
        <section className="hero-card">
          <h2>{panel.summary}</h2>
          <ul className="bullet-list">
            {panel.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          {selectedClient ? (
            <article className="inline-summary">
              <h3>Selected client</h3>
              <p>{selectedClient.fullName}</p>
              <p>{selectedClient.email}</p>
              <p>{selectedClient.funeralPlan}</p>
              <p>Status: {selectedClient.status}</p>
              <p>Next payment: {selectedMembership?.nextPaymentDate ?? 'n/a'}</p>
            </article>
          ) : (
            <article className="inline-summary muted-box">
              <h3>No client selected</h3>
              <p>Create or select a record to inspect the membership details.</p>
            </article>
          )}

          <article className="info-card compact-card">
            <h3>Operational snapshot</h3>
            <p>{visibleClients.length} clients visible</p>
            <p>{visibleMemberships.length} memberships loaded</p>
            <p>Balance total: ${totalBalance.toFixed(2)}</p>
          </article>
        </section>

        <aside className="panel-stack">
          <article className="info-card">
            <h3>Access model</h3>
            <p>Roles supported in the live bundle include administrator, finance officer, and client.</p>
          </article>
          <article className="info-card">
            <h3>Data model</h3>
            <p>
              Membership number, ID number, photo URL, joined date, status, and funeral plan are all
              part of the recovered schema.
            </p>
          </article>
          <article className="info-card">
            <h3>Data source</h3>
            <p>
              The app now reads and writes client and membership data from Firestore when Firebase is configured, with an offline seed fallback when it is not.
            </p>
          </article>
        </aside>
      </main>

      {managementPanel}
    </div>
  );
}

function ShellMessage({ title, description }: { title: string; description: string }) {
  return (
    <section className="status-card">
      <h3>{title}</h3>
      <p>{description}</p>
    </section>
  );
}

export default App;