import { useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Bell,
  CreditCard,
  DollarSign,
  FileClock,
  FileText,
  Filter,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
  Sun,
  Trash2,
  UserCircle2,
  UserRound,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import type { AuthState } from '../lib/firebaseAuth';
import {
  createDocument,
  deleteDocumentById,
  saveCommunication,
  upsertDocument,
  useAdminDataset,
  usePaginatedClients,
  type BeneficiaryDoc,
  type ClaimDoc,
  type ClientDoc,
  type ClientFilters,
  type ClientSearchField,
  type PaymentDoc,
  type PlanDoc,
} from '../lib/adminData';
import { cn } from '../lib/cn';

const adminMenuItems = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'clients', label: 'Clients', icon: Users },
  { key: 'plans', label: 'Funeral Plans', icon: FileText },
  { key: 'beneficiaries', label: 'Beneficiaries', icon: UserRound },
  { key: 'claims', label: 'Claims', icon: Shield },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'outstanding', label: 'Outstanding Payments', icon: DollarSign },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'communication', label: 'Communication', icon: MessageSquare },
  { key: 'documents', label: 'Documents', icon: FolderOpen },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'auditLogs', label: 'Audit Logs', icon: FileClock },
  { key: 'logout', label: 'Logout', icon: LogOut },
] as const;

type MenuKey = (typeof adminMenuItems)[number]['key'] | 'clientProfile';

type CrudEntity = 'plan' | 'beneficiary' | 'claim';

const communicationSchema = z.object({
  clientId: z.string().optional(),
  channel: z.enum(['email', 'sms']),
  subject: z.string().min(3),
  message: z.string().min(10),
});

type CommunicationFormInput = z.infer<typeof communicationSchema>;

const paymentSchema = z.object({
  amount: z.number().positive(),
  referenceNumber: z.string().min(3),
  paymentMethod: z.string().min(2),
});

type ManualPaymentInput = z.infer<typeof paymentSchema>;

const planSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  monthlyPremium: z.number().positive(),
  payoutAmount: z.number().positive(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

type PlanInput = z.infer<typeof planSchema>;

const beneficiarySchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1),
  fullName: z.string().min(2),
  relationship: z.string().min(2),
  gender: z.string().min(1),
  age: z.number().int().nonnegative(),
  idNumber: z.string().min(4),
  phoneNumber: z.string().min(6),
  status: z.enum(['alive', 'deceased']),
  dateAdded: z.string().min(4),
  dateOfBirth: z.string().optional(),
  address: z.string().optional(),
});

type BeneficiaryInput = z.infer<typeof beneficiarySchema>;

const claimSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1),
  beneficiaryId: z.string().min(1),
  claimDate: z.string().min(4),
  claimNumber: z.string().min(2),
  claimStatus: z.enum(['pending', 'approved', 'rejected']),
  claimAmount: z.number().positive(),
  approvedAmount: z.number().nonnegative(),
  adminNotes: z.string().optional(),
});

type ClaimInput = z.infer<typeof claimSchema>;

function monthBucket(isoDate: string) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString('en-ZA', { month: 'short', year: '2-digit' });
}

function toCurrency(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(value);
}

function exportCsv(fileName: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    toast.info('No data available for export.');
    return;
  }

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csvRows = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map((header) => {
      const value = row[header];
      const normalized = value === undefined || value === null ? '' : String(value).replaceAll('"', '""');
      return `"${normalized}"`;
    });
    csvRows.push(values.join(','));
  }

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportExcel(fileName: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    toast.info('No data available for Excel export.');
    return;
  }

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

function exportPdf(fileName: string, title: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    toast.info('No data available for PDF export.');
    return;
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(10);

  const firstRow = rows[0];
  const headers = firstRow ? Object.keys(firstRow) : [];
  let y = 70;
  doc.text(headers.join(' | '), 40, y);
  y += 16;

  for (const row of rows.slice(0, 35)) {
    const line = headers.map((header) => String(row[header] ?? '')).join(' | ');
    doc.text(line.slice(0, 170), 40, y);
    y += 14;
    if (y > 770) {
      doc.addPage();
      y = 40;
    }
  }

  doc.save(`${fileName}.pdf`);
}

function policyHealth(client: ClientDoc) {
  if (client.status === 'closed') {
    return { label: 'Claim Closed', color: 'bg-zinc-800 text-zinc-50' };
  }
  if (client.outstandingBalance <= 0) {
    return { label: 'Active', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' };
  }
  if (client.outstandingBalance <= client.monthlyPremium) {
    return { label: 'Grace Period', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' };
  }
  return { label: 'Suspended', color: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' };
}

function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  return (
    <button
      type="button"
      onClick={() => {
        const nextValue = !isDark;
        setIsDark(nextValue);
        document.documentElement.classList.toggle('dark', nextValue);
      }}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      aria-label="Toggle theme"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function AdminDashboard({ session }: { session: AuthState }) {
  const [activeMenu, setActiveMenu] = useState<MenuKey>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string | null>(null);
  const [paymentModalClient, setPaymentModalClient] = useState<ClientDoc | null>(null);
  const [crudEntity, setCrudEntity] = useState<CrudEntity>('plan');
  const [crudModalOpen, setCrudModalOpen] = useState(false);

  const [clientFilters, setClientFilters] = useState<ClientFilters>({
    searchField: 'fullName',
    searchTerm: '',
    status: 'all',
    paymentStatus: 'all',
    plan: 'all',
    outstandingOnly: false,
  });

  const data = useAdminDataset();
  const paginatedClients = usePaginatedClients(clientFilters, 12);

  const planForm = useForm<PlanInput>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: '',
      monthlyPremium: 500,
      payoutAmount: 20000,
      description: '',
      isActive: true,
    },
  });

  const beneficiaryForm = useForm<BeneficiaryInput>({
    resolver: zodResolver(beneficiarySchema),
    defaultValues: {
      clientId: '',
      fullName: '',
      relationship: '',
      gender: 'Female',
      age: 0,
      idNumber: '',
      phoneNumber: '',
      status: 'alive',
      dateAdded: new Date().toISOString().slice(0, 10),
      dateOfBirth: '',
      address: '',
    },
  });

  const claimForm = useForm<ClaimInput>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      clientId: '',
      beneficiaryId: '',
      claimDate: new Date().toISOString().slice(0, 10),
      claimNumber: '',
      claimStatus: 'pending',
      claimAmount: 0,
      approvedAmount: 0,
      adminNotes: '',
    },
  });

  const manualPaymentForm = useForm<ManualPaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: 0, paymentMethod: 'manual transfer', referenceNumber: '' },
  });

  const communicationForm = useForm<CommunicationFormInput>({
    resolver: zodResolver(communicationSchema),
    defaultValues: {
      channel: 'email',
      clientId: '',
      subject: '',
      message: '',
    },
  });

  const selectedClient = useMemo(() => {
    if (!selectedClientId) {
      return null;
    }
    const fallback = data.clients.find((client) => client.id === selectedClientId);
    return fallback ?? paginatedClients.rows.find((client) => client.id === selectedClientId) ?? null;
  }, [data.clients, paginatedClients.rows, selectedClientId]);

  const clientBeneficiaries = useMemo(() => {
    if (!selectedClient) {
      return [];
    }
    return data.beneficiaries.filter((beneficiary) => beneficiary.clientId === selectedClient.id);
  }, [data.beneficiaries, selectedClient]);

  const selectedBeneficiary = useMemo(() => {
    if (!selectedBeneficiaryId) {
      return null;
    }
    return clientBeneficiaries.find((beneficiary) => beneficiary.id === selectedBeneficiaryId) ?? null;
  }, [clientBeneficiaries, selectedBeneficiaryId]);

  const clientClaims = useMemo(() => {
    if (!selectedClient) {
      return [];
    }
    return data.claims.filter((claim) => claim.clientId === selectedClient.id);
  }, [data.claims, selectedClient]);

  const clientPayments = useMemo(() => {
    if (!selectedClient) {
      return [];
    }
    return data.payments.filter((payment) => payment.clientId === selectedClient.id);
  }, [data.payments, selectedClient]);

  const dashboardMetrics = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    const newClientsThisMonth = data.clients.filter((client) => {
      const date = new Date(client.registrationDate);
      return date.getMonth() === month && date.getFullYear() === year;
    }).length;

    const paidThisMonth = data.payments.filter((payment) => {
      const date = new Date(payment.paymentDate);
      return payment.status === 'paid' && date.getMonth() === month && date.getFullYear() === year;
    });

    const paidAmountThisMonth = paidThisMonth.reduce((sum, payment) => sum + payment.amount, 0);

    const outstandingClients = data.clients.filter((client) => client.outstandingBalance > 0);
    const outstandingBalance = outstandingClients.reduce((sum, client) => sum + client.outstandingBalance, 0);

    const claimsPending = data.claims.filter((claim) => claim.claimStatus === 'pending').length;
    const claimsApproved = data.claims.filter((claim) => claim.claimStatus === 'approved').length;
    const claimsRejected = data.claims.filter((claim) => claim.claimStatus === 'rejected').length;

    const activeBeneficiaries = data.beneficiaries.filter((beneficiary) => beneficiary.status === 'alive').length;
    const deceasedBeneficiaries = data.beneficiaries.filter((beneficiary) => beneficiary.status === 'deceased').length;

    return {
      totalClients: data.clients.length,
      newClientsThisMonth,
      activePolicies: data.clients.filter((client) => client.status === 'active').length,
      paidThisMonthCount: paidThisMonth.length,
      paidAmountThisMonth,
      outstandingClients: outstandingClients.length,
      outstandingBalance,
      totalClaims: data.claims.length,
      claimsPending,
      claimsApproved,
      claimsRejected,
      totalBeneficiaries: data.beneficiaries.length,
      activeBeneficiaries,
      deceasedBeneficiaries,
    };
  }, [data.beneficiaries, data.claims, data.clients, data.payments]);

  const monthlyRevenueData = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of data.payments) {
      if (payment.status !== 'paid') {
        continue;
      }
      const bucket = monthBucket(payment.paymentDate);
      map.set(bucket, (map.get(bucket) ?? 0) + payment.amount);
    }

    return Array.from(map.entries()).map(([month, revenue]) => ({ month, revenue }));
  }, [data.payments]);

  const outstandingByMonthData = useMemo(() => {
    const map = new Map<string, number>();
    for (const client of data.clients) {
      const bucket = monthBucket(client.registrationDate);
      map.set(bucket, (map.get(bucket) ?? 0) + client.outstandingBalance);
    }

    return Array.from(map.entries()).map(([month, outstanding]) => ({ month, outstanding }));
  }, [data.clients]);

  const claimsByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const claim of data.claims) {
      const bucket = monthBucket(claim.claimDate);
      map.set(bucket, (map.get(bucket) ?? 0) + 1);
    }

    return Array.from(map.entries()).map(([month, claims]) => ({ month, claims }));
  }, [data.claims]);

  const clientGrowthData = useMemo(() => {
    const map = new Map<string, number>();

    for (const client of data.clients) {
      const bucket = monthBucket(client.registrationDate);
      map.set(bucket, (map.get(bucket) ?? 0) + 1);
    }

    let rolling = 0;
    return Array.from(map.entries()).map(([month, joined]) => {
      rolling += joined;
      return { month, total: rolling };
    });
  }, [data.clients]);

  const planDistributionData = useMemo(() => {
    const map = new Map<string, number>();
    for (const client of data.clients) {
      map.set(client.funeralPlan, (map.get(client.funeralPlan) ?? 0) + 1);
    }

    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [data.clients]);

  const outstandingClients = useMemo(
    () => data.clients.filter((client) => client.outstandingBalance > 0),
    [data.clients],
  );

  const breadcrumbLabel = adminMenuItems.find((item) => item.key === activeMenu)?.label ?? 'Dashboard';

  const onLogout = async () => {
    await session.signOut();
    toast.success('Logged out.');
  };

  const handleManualPayment = manualPaymentForm.handleSubmit((values) => {
    if (!paymentModalClient) {
      return;
    }
    toast.success(`Manual payment recorded for ${paymentModalClient.fullName}: ${toCurrency(values.amount)}`);
    setPaymentModalClient(null);
    manualPaymentForm.reset();
  });

  const handleSendCommunication = communicationForm.handleSubmit(async (values) => {
    await saveCommunication(values);
    toast.success('Communication queued successfully.');
    communicationForm.reset({ channel: 'email', clientId: '', subject: '', message: '' });
  });

  const submitPlan = planForm.handleSubmit(async (values) => {
    const id = values.id ?? crypto.randomUUID();
    await upsertDocument('plans', id, {
      name: values.name,
      monthlyPremium: values.monthlyPremium,
      payoutAmount: values.payoutAmount,
      description: values.description ?? '',
      isActive: values.isActive ?? true,
    });
    toast.success('Plan saved');
    planForm.reset({ name: '', monthlyPremium: 500, payoutAmount: 20000, description: '', isActive: true });
    setCrudModalOpen(false);
  });

  const submitBeneficiary = beneficiaryForm.handleSubmit(async (values) => {
    const id = values.id ?? crypto.randomUUID();
    await upsertDocument('beneficiaries', id, values);
    toast.success('Beneficiary saved');
    beneficiaryForm.reset({
      clientId: '',
      fullName: '',
      relationship: '',
      gender: 'Female',
      age: 0,
      idNumber: '',
      phoneNumber: '',
      status: 'alive',
      dateAdded: new Date().toISOString().slice(0, 10),
      dateOfBirth: '',
      address: '',
    });
    setCrudModalOpen(false);
  });

  const submitClaim = claimForm.handleSubmit(async (values) => {
    const id = values.id ?? crypto.randomUUID();
    await upsertDocument('claims', id, values);
    toast.success('Claim saved');
    claimForm.reset({
      clientId: '',
      beneficiaryId: '',
      claimDate: new Date().toISOString().slice(0, 10),
      claimNumber: '',
      claimStatus: 'pending',
      claimAmount: 0,
      approvedAmount: 0,
      adminNotes: '',
    });
    setCrudModalOpen(false);
  });

  const openCrudModal = (entity: CrudEntity) => {
    setCrudEntity(entity);
    setCrudModalOpen(true);
  };

  if (session.profile?.role !== 'administrator') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
        <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-semibold">Administrator Access Required</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            This dashboard is restricted to users with administrator privileges.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'dashboard-scrollbar fixed inset-y-0 left-0 z-30 hidden overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-sm transition-all dark:border-slate-800 dark:bg-slate-900 lg:flex lg:flex-col',
            sidebarCollapsed ? 'w-20' : 'w-72',
          )}
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/90" />
            {!sidebarCollapsed ? (
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500">Company</p>
                <p className="text-base font-semibold">Funeral Parlor</p>
              </div>
            ) : null}
          </div>

          <nav className="flex-1 space-y-1">
            {adminMenuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => {
                    if (item.key === 'logout') {
                      void onLogout();
                      return;
                    }
                    setActiveMenu(item.key);
                    setMobileDrawerOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
                    activeMenu === item.key
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {!sidebarCollapsed ? <span>{item.label}</span> : null}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {sidebarCollapsed ? 'Expand' : 'Collapse'}
          </button>

          <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <UserCircle2 className="h-8 w-8 text-slate-500" />
              {!sidebarCollapsed ? (
                <div>
                  <p className="text-sm font-semibold">{session.profile.fullName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Administrator</p>
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <div className={cn('flex w-full flex-col', sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72')}>
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen((value) => !value)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-500">Admin / {breadcrumbLabel}</p>
                  <h1 className="text-base font-semibold lg:text-lg">Funeral Parlor Management</h1>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 md:flex">
                  <Bell className="h-4 w-4 text-slate-500" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">{data.notifications.length} new</span>
                </div>
                <ThemeToggle />
              </div>
            </div>
          </header>

          {mobileDrawerOpen ? (
            <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileDrawerOpen(false)}>
              <div
                className="dashboard-scrollbar h-full w-72 overflow-y-auto bg-white p-4 dark:bg-slate-900"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-5 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-500/90" />
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-500">Company</p>
                    <p className="font-semibold">Funeral Parlor</p>
                  </div>
                </div>
                <div className="space-y-1">
                  {adminMenuItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        type="button"
                        key={item.key}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                          activeMenu === item.key
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                        )}
                        onClick={() => {
                          if (item.key === 'logout') {
                            void onLogout();
                            setMobileDrawerOpen(false);
                            return;
                          }
                          setActiveMenu(item.key);
                          setMobileDrawerOpen(false);
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <main className="dashboard-scrollbar flex-1 overflow-y-auto p-4 lg:p-8">
            {data.errors.length > 0 ? (
              <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
                <div className="flex items-center gap-2 font-medium">
                  <AlertCircle className="h-4 w-4" />
                  Firestore query errors detected
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {data.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {renderMainSection({
              activeMenu,
              data,
              paginatedClients,
              dashboardMetrics,
              monthlyRevenueData,
              outstandingByMonthData,
              claimsByMonth,
              clientGrowthData,
              planDistributionData,
              setSelectedClientId,
              setActiveMenu,
              selectedClient,
              clientBeneficiaries,
              selectedBeneficiary,
              setSelectedBeneficiaryId,
              clientClaims,
              clientPayments,
              outstandingClients,
              clientFilters,
              setClientFilters,
              communicationForm,
              handleSendCommunication,
              setPaymentModalClient,
              openCrudModal,
            })}
          </main>
        </div>
      </div>

      <CrudModal
        open={crudModalOpen}
        entity={crudEntity}
        onClose={() => setCrudModalOpen(false)}
        planForm={planForm}
        beneficiaryForm={beneficiaryForm}
        claimForm={claimForm}
        clients={data.clients}
        beneficiaries={data.beneficiaries}
        onSubmitPlan={submitPlan}
        onSubmitBeneficiary={submitBeneficiary}
        onSubmitClaim={submitClaim}
      />

      <Modal
        open={Boolean(paymentModalClient)}
        title="Record Manual Payment"
        description={paymentModalClient ? `Record payment for ${paymentModalClient.fullName}` : ''}
        onClose={() => setPaymentModalClient(null)}
      >
        <form className="space-y-3" onSubmit={handleManualPayment}>
          <label className="block text-sm">
            Amount
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              {...manualPaymentForm.register('amount', { valueAsNumber: true })}
            />
          </label>
          <label className="block text-sm">
            Payment Method
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              {...manualPaymentForm.register('paymentMethod')}
            />
          </label>
          <label className="block text-sm">
            Reference Number
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              {...manualPaymentForm.register('referenceNumber')}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPaymentModalClient(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-700"
            >
              Cancel
            </button>
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
              Save
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function renderMainSection(args: {
  activeMenu: MenuKey;
  data: ReturnType<typeof useAdminDataset>;
  paginatedClients: ReturnType<typeof usePaginatedClients>;
  dashboardMetrics: {
    totalClients: number;
    newClientsThisMonth: number;
    activePolicies: number;
    paidThisMonthCount: number;
    paidAmountThisMonth: number;
    outstandingClients: number;
    outstandingBalance: number;
    totalClaims: number;
    claimsPending: number;
    claimsApproved: number;
    claimsRejected: number;
    totalBeneficiaries: number;
    activeBeneficiaries: number;
    deceasedBeneficiaries: number;
  };
  monthlyRevenueData: Array<{ month: string; revenue: number }>;
  outstandingByMonthData: Array<{ month: string; outstanding: number }>;
  claimsByMonth: Array<{ month: string; claims: number }>;
  clientGrowthData: Array<{ month: string; total: number }>;
  planDistributionData: Array<{ name: string; value: number }>;
  setSelectedClientId: (id: string) => void;
  setActiveMenu: (key: MenuKey) => void;
  selectedClient: ClientDoc | null;
  clientBeneficiaries: BeneficiaryDoc[];
  selectedBeneficiary: BeneficiaryDoc | null;
  setSelectedBeneficiaryId: (id: string) => void;
  clientClaims: ClaimDoc[];
  clientPayments: PaymentDoc[];
  outstandingClients: ClientDoc[];
  clientFilters: ClientFilters;
  setClientFilters: (value: ClientFilters | ((prev: ClientFilters) => ClientFilters)) => void;
  communicationForm: ReturnType<typeof useForm<CommunicationFormInput>>;
  handleSendCommunication: () => void;
  setPaymentModalClient: (client: ClientDoc) => void;
  openCrudModal: (entity: CrudEntity) => void;
}) {
  const {
    activeMenu,
    data,
    paginatedClients,
    dashboardMetrics,
    monthlyRevenueData,
    outstandingByMonthData,
    claimsByMonth,
    clientGrowthData,
    planDistributionData,
    setSelectedClientId,
    setActiveMenu,
    selectedClient,
    clientBeneficiaries,
    selectedBeneficiary,
    setSelectedBeneficiaryId,
    clientClaims,
    clientPayments,
    outstandingClients,
    clientFilters,
    setClientFilters,
    communicationForm,
    handleSendCommunication,
    setPaymentModalClient,
    openCrudModal,
  } = args;

  if (data.loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        ))}
      </div>
    );
  }

  if (activeMenu === 'dashboard') {
    return (
      <section className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard icon={Users} title="Total Clients" value={String(dashboardMetrics.totalClients)} detail={`${dashboardMetrics.newClientsThisMonth} new this month`} change="+8.4%" />
          <StatCard icon={Shield} title="Active Policies" value={String(dashboardMetrics.activePolicies)} detail="Total active policies" change="+2.1%" />
          <StatCard icon={CreditCard} title="Paid This Month" value={String(dashboardMetrics.paidThisMonthCount)} detail={toCurrency(dashboardMetrics.paidAmountThisMonth)} change="+5.9%" />
          <StatCard icon={DollarSign} title="Outstanding Payments" value={String(dashboardMetrics.outstandingClients)} detail={toCurrency(dashboardMetrics.outstandingBalance)} change="-1.8%" />
          <StatCard icon={FileClock} title="Claims" value={String(dashboardMetrics.totalClaims)} detail={`P:${dashboardMetrics.claimsPending} A:${dashboardMetrics.claimsApproved} R:${dashboardMetrics.claimsRejected}`} change="+4.2%" />
          <StatCard icon={UserRound} title="Beneficiaries" value={String(dashboardMetrics.totalBeneficiaries)} detail={`Alive ${dashboardMetrics.activeBeneficiaries} | Deceased ${dashboardMetrics.deceasedBeneficiaries}`} change="+3.2%" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Monthly Revenue">
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={monthlyRevenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => toCurrency(Number(value))} />
                <Area type="monotone" dataKey="revenue" stroke="#0f766e" fill="#14b8a6" fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Outstanding Payments">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={outstandingByMonthData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => toCurrency(Number(value))} />
                <Bar dataKey="outstanding" fill="#f97316" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Claims per Month">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={claimsByMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="claims" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Client Growth">
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={clientGrowthData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="total" stroke="#9333ea" fill="#a855f7" fillOpacity={0.24} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard title="Funeral Plan Distribution" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={planDistributionData} dataKey="value" nameKey="name" outerRadius={100} label>
                  {planDistributionData.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={['#0ea5e9', '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444'][index % 5]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold">Real-time Notifications</h3>
            <div className="mt-3 space-y-2">
              {data.notifications.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No notifications available.</p>
              ) : (
                data.notifications.map((notification) => (
                  <article key={notification.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                    <p className="text-xs font-medium">{notification.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{notification.message}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (activeMenu === 'clients') {
    return (
      <section className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="grid w-full gap-2 md:max-w-2xl md:grid-cols-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  value={clientFilters.searchTerm}
                  onChange={(event) =>
                    setClientFilters((prev) => ({
                      ...prev,
                      searchTerm: event.target.value,
                    }))
                  }
                  placeholder="Server-side search"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <select
                value={clientFilters.searchField}
                onChange={(event) =>
                  setClientFilters((prev) => ({
                    ...prev,
                    searchField: event.target.value as ClientSearchField,
                  }))
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="fullName">Name</option>
                <option value="customerNumber">Customer Number</option>
                <option value="phoneNumber">Phone Number</option>
                <option value="idNumber">ID Number</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-slate-500" />

              <select
                value={clientFilters.status}
                onChange={(event) =>
                  setClientFilters((prev) => ({
                    ...prev,
                    status: event.target.value as ClientFilters['status'],
                  }))
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="pending">Pending</option>
                <option value="closed">Closed</option>
              </select>

              <select
                value={clientFilters.paymentStatus}
                onChange={(event) =>
                  setClientFilters((prev) => ({
                    ...prev,
                    paymentStatus: event.target.value as ClientFilters['paymentStatus'],
                  }))
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="all">All Payments</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="outstanding">Outstanding</option>
              </select>

              <select
                value={clientFilters.plan}
                onChange={(event) =>
                  setClientFilters((prev) => ({
                    ...prev,
                    plan: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="all">All Plans</option>
                {Array.from(new Set(data.clients.map((client) => client.funeralPlan))).map((plan) => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
                <input
                  type="checkbox"
                  checked={clientFilters.outstandingOnly}
                  onChange={(event) =>
                    setClientFilters((prev) => ({
                      ...prev,
                      outstandingOnly: event.target.checked,
                    }))
                  }
                />
                Outstanding only
              </label>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Customer #</th>
                  <th className="px-3 py-2">Membership #</th>
                  <th className="px-3 py-2">Full Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Premium</th>
                  <th className="px-3 py-2">Payment Status</th>
                  <th className="px-3 py-2">Outstanding</th>
                  <th className="px-3 py-2">Beneficiaries</th>
                  <th className="px-3 py-2">Registered</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedClients.rows.map((client) => (
                  <tr
                    key={client.id}
                    className="cursor-pointer border-b border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                    onClick={() => {
                      setSelectedClientId(client.id);
                      setActiveMenu('clientProfile');
                    }}
                  >
                    <td className="px-3 py-2">{client.customerNumber}</td>
                    <td className="px-3 py-2">{client.membershipNumber}</td>
                    <td className="px-3 py-2 font-medium">{client.fullName}</td>
                    <td className="px-3 py-2">{client.phoneNumber}</td>
                    <td className="px-3 py-2">{client.email}</td>
                    <td className="px-3 py-2">{client.funeralPlan}</td>
                    <td className="px-3 py-2">{toCurrency(client.monthlyPremium)}</td>
                    <td className="px-3 py-2">{client.paymentStatus}</td>
                    <td className="px-3 py-2">{toCurrency(client.outstandingBalance)}</td>
                    <td className="px-3 py-2">{client.beneficiariesCount}</td>
                    <td className="px-3 py-2">{new Date(client.registrationDate).toLocaleDateString()}</td>
                    <td className="px-3 py-2">{client.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <p>
              Loaded {paginatedClients.rows.length} client{paginatedClients.rows.length === 1 ? '' : 's'}
            </p>
            <button
              type="button"
              onClick={() => void paginatedClients.fetchNextPage()}
              disabled={!paginatedClients.hasNextPage || paginatedClients.isFetchingNextPage}
              className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-50 dark:border-slate-700"
            >
              {paginatedClients.isFetchingNextPage ? 'Loading...' : paginatedClients.hasNextPage ? 'Load More' : 'No More Rows'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (activeMenu === 'plans') {
    return (
      <section className="space-y-4">
        <div className="flex justify-end">
          <button type="button" onClick={() => openCrudModal('plan')} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
            <Plus className="h-4 w-4" /> Add Plan
          </button>
        </div>
        <DataTableCard
          title="Funeral Plans"
          rows={data.plans}
          onDelete={async (id) => {
            await deleteDocumentById('plans', id);
            toast.success('Plan deleted');
          }}
        />
      </section>
    );
  }

  if (activeMenu === 'beneficiaries') {
    return (
      <section className="space-y-4">
        <div className="flex justify-end">
          <button type="button" onClick={() => openCrudModal('beneficiary')} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
            <Plus className="h-4 w-4" /> Add Beneficiary
          </button>
        </div>
        <DataTableCard
          title="Beneficiaries"
          rows={data.beneficiaries}
          onDelete={async (id) => {
            await deleteDocumentById('beneficiaries', id);
            toast.success('Beneficiary deleted');
          }}
        />
      </section>
    );
  }

  if (activeMenu === 'claims') {
    return (
      <section className="space-y-4">
        <div className="flex justify-end">
          <button type="button" onClick={() => openCrudModal('claim')} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
            <Plus className="h-4 w-4" /> Add Claim
          </button>
        </div>
        <DataTableCard
          title="Claims"
          rows={data.claims}
          onDelete={async (id) => {
            await deleteDocumentById('claims', id);
            toast.success('Claim deleted');
          }}
        />
      </section>
    );
  }

  if (activeMenu === 'clientProfile') {
    if (!selectedClient) {
      return (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Select a client from the Clients page to view the full profile.
        </div>
      );
    }

    const health = policyHealth(selectedClient);
    const totalClaimAmount = clientClaims.reduce((sum, claim) => sum + claim.claimAmount, 0);

    return (
      <section className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
            <h3 className="text-base font-semibold">Personal Information</h3>
            <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
              <InfoRow label="Customer Number" value={selectedClient.customerNumber} />
              <InfoRow label="Membership Number" value={selectedClient.membershipNumber} />
              <InfoRow label="Full Name" value={selectedClient.fullName} />
              <InfoRow label="South African ID" value={selectedClient.idNumber} />
              <InfoRow label="Phone Number" value={selectedClient.phoneNumber} />
              <InfoRow label="Email" value={selectedClient.email} />
              <InfoRow label="Date Joined" value={new Date(selectedClient.registrationDate).toLocaleDateString()} />
              <InfoRow label="Status" value={selectedClient.status} />
            </dl>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-base font-semibold">Policy Health</h3>
            <span className={cn('mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold', health.color)}>
              {health.label}
            </span>
            <dl className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <InfoRow label="Selected Plan" value={selectedClient.funeralPlan} />
              <InfoRow label="Monthly Premium" value={toCurrency(selectedClient.monthlyPremium)} />
              <InfoRow label="Outstanding Balance" value={toCurrency(selectedClient.outstandingBalance)} />
              <InfoRow label="Policy Status" value={selectedClient.status} />
            </dl>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-base font-semibold">Payment Summary</h3>
            <div className="mt-3 space-y-2 text-sm">
              <InfoRow label="Payments Made" value={String(clientPayments.length)} />
              <InfoRow label="Outstanding Balance" value={toCurrency(selectedClient.outstandingBalance)} />
              <InfoRow
                label="Last Payment Date"
                value={clientPayments[0] ? new Date(clientPayments[0].paymentDate).toLocaleDateString() : 'No payments'}
              />
              <InfoRow
                label="Next Payment Due"
                value={clientPayments[0] ? new Date(clientPayments[0].paymentDate).toLocaleDateString() : 'No due date'}
              />
            </div>

            <h4 className="mt-4 text-sm font-medium">Payment History</h4>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Invoice</th>
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Amount</th>
                    <th className="px-2 py-1">Method</th>
                    <th className="px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clientPayments.map((payment) => (
                    <tr key={payment.id} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="px-2 py-1">{payment.invoiceNumber}</td>
                      <td className="px-2 py-1">{new Date(payment.paymentDate).toLocaleDateString()}</td>
                      <td className="px-2 py-1">{toCurrency(payment.amount)}</td>
                      <td className="px-2 py-1">{payment.paymentMethod}</td>
                      <td className="px-2 py-1">{payment.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-base font-semibold">Beneficiaries</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Relationship</th>
                    <th className="px-2 py-1">Gender</th>
                    <th className="px-2 py-1">Age</th>
                    <th className="px-2 py-1">ID</th>
                    <th className="px-2 py-1">Phone</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Date Added</th>
                  </tr>
                </thead>
                <tbody>
                  {clientBeneficiaries.map((beneficiary) => (
                    <tr
                      key={beneficiary.id}
                      className="cursor-pointer border-t border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40"
                      onClick={() => setSelectedBeneficiaryId(beneficiary.id)}
                    >
                      <td className="px-2 py-1">{beneficiary.fullName}</td>
                      <td className="px-2 py-1">{beneficiary.relationship}</td>
                      <td className="px-2 py-1">{beneficiary.gender}</td>
                      <td className="px-2 py-1">{beneficiary.age}</td>
                      <td className="px-2 py-1">{beneficiary.idNumber}</td>
                      <td className="px-2 py-1">{beneficiary.phoneNumber}</td>
                      <td className="px-2 py-1">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            beneficiary.status === 'alive'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
                          )}
                        >
                          {beneficiary.status === 'alive' ? 'Alive' : 'Deceased'}
                        </span>
                      </td>
                      <td className="px-2 py-1">{new Date(beneficiary.dateAdded).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedBeneficiary ? (
              <div className="mt-4 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                <h4 className="font-semibold">Beneficiary Profile</h4>
                <dl className="mt-2 grid gap-1 md:grid-cols-2">
                  <InfoRow label="Full Name" value={selectedBeneficiary.fullName} />
                  <InfoRow label="Gender" value={selectedBeneficiary.gender} />
                  <InfoRow label="Age" value={String(selectedBeneficiary.age)} />
                  <InfoRow label="Relationship" value={selectedBeneficiary.relationship} />
                  <InfoRow label="Date of Birth" value={selectedBeneficiary.dateOfBirth || 'N/A'} />
                  <InfoRow label="ID Number" value={selectedBeneficiary.idNumber} />
                  <InfoRow label="Phone" value={selectedBeneficiary.phoneNumber} />
                  <InfoRow label="Address" value={selectedBeneficiary.address || 'N/A'} />
                </dl>
                <p className="mt-2 text-xs font-medium">Status: {selectedBeneficiary.status === 'alive' ? 'Alive' : 'Deceased'}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-semibold">Claims</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Total Claims: {clientClaims.length} | Total Claim Amount: {toCurrency(clientClaims.reduce((sum, claim) => sum + claim.claimAmount, 0))}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1">Claim Date</th>
                  <th className="px-2 py-1">Claim Number</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Claim Amount</th>
                  <th className="px-2 py-1">Approved Amount</th>
                  <th className="px-2 py-1">Documents</th>
                  <th className="px-2 py-1">Administrator Notes</th>
                </tr>
              </thead>
              <tbody>
                {clientClaims.map((claim) => (
                  <tr key={claim.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-2 py-1">{new Date(claim.claimDate).toLocaleDateString()}</td>
                    <td className="px-2 py-1">{claim.claimNumber}</td>
                    <td className="px-2 py-1">{claim.claimStatus}</td>
                    <td className="px-2 py-1">{toCurrency(claim.claimAmount)}</td>
                    <td className="px-2 py-1">{toCurrency(claim.approvedAmount)}</td>
                    <td className="px-2 py-1">{claim.claimDocuments?.length ?? 0} files</td>
                    <td className="px-2 py-1">{claim.adminNotes || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  if (activeMenu === 'outstanding') {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-base font-semibold">Outstanding Payments</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Clients with overdue payments and account action controls.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Customer Number</th>
                <th className="px-3 py-2">Client Name</th>
                <th className="px-3 py-2">Outstanding Months</th>
                <th className="px-3 py-2">Outstanding Amount</th>
                <th className="px-3 py-2">Last Payment</th>
                <th className="px-3 py-2">Due Date</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {outstandingClients.map((client) => {
                const clientPayments = data.payments
                  .filter((payment) => payment.clientId === client.id)
                  .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());
                const lastPayment = clientPayments[0];
                const outstandingMonths = Math.max(1, Math.ceil(client.outstandingBalance / Math.max(1, client.monthlyPremium)));

                return (
                  <tr key={client.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2">{client.customerNumber}</td>
                    <td className="px-3 py-2">{client.fullName}</td>
                    <td className="px-3 py-2">{outstandingMonths}</td>
                    <td className="px-3 py-2">{toCurrency(client.outstandingBalance)}</td>
                    <td className="px-3 py-2">{lastPayment ? new Date(lastPayment.paymentDate).toLocaleDateString() : 'N/A'}</td>
                    <td className="px-3 py-2">{new Date(client.registrationDate).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                          onClick={() => toast.success(`Reminder sent to ${client.fullName}`)}
                        >
                          Send Reminder
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                          onClick={() => toast.info(`Suspension notice prepared for ${client.fullName}`)}
                        >
                          Suspend Policy
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                          onClick={() => setPaymentModalClient(client)}
                        >
                          Record Manual Payment
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (activeMenu === 'communication') {
    return (
      <section className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={handleSendCommunication} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-semibold">Communication Center</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Send email notices and payment reminders.</p>

          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              Channel
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                {...communicationForm.register('channel')}
              >
                <option value="email">Email</option>
                <option value="sms">SMS (future)</option>
              </select>
            </label>

            <label className="block text-sm">
              Client ID (optional)
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                {...communicationForm.register('clientId')}
              />
            </label>

            <label className="block text-sm">
              Subject
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                {...communicationForm.register('subject')}
              />
            </label>

            <label className="block text-sm">
              Message
              <textarea
                rows={5}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                {...communicationForm.register('message')}
              />
            </label>
          </div>

          <button type="submit" className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
            Send Communication
          </button>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-base font-semibold">Communication History</h3>
          <div className="mt-3 space-y-2">
            {data.communications.map((comm) => (
              <article key={comm.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-medium">{comm.subject}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {comm.channel.toUpperCase()} · {comm.status} · {new Date(comm.createdAt).toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{comm.message}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (activeMenu === 'reports') {
    return (
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ReportCard title="Revenue Report" rows={data.payments as unknown as Record<string, unknown>[]} />
        <ReportCard title="Outstanding Accounts" rows={data.clients.filter((client) => client.outstandingBalance > 0) as unknown as Record<string, unknown>[]} />
        <ReportCard title="Payments" rows={data.payments as unknown as Record<string, unknown>[]} />
        <ReportCard title="Claims" rows={data.claims as unknown as Record<string, unknown>[]} />
        <ReportCard title="Beneficiaries" rows={data.beneficiaries as unknown as Record<string, unknown>[]} />
        <ReportCard title="Policies" rows={data.clients as unknown as Record<string, unknown>[]} />
      </section>
    );
  }

  if (activeMenu === 'payments') {
    return <DataTableCard title="Payments" rows={data.payments} />;
  }
  if (activeMenu === 'documents') {
    return <DataTableCard title="Documents" rows={data.documents} />;
  }
  if (activeMenu === 'auditLogs') {
    return <DataTableCard title="Audit Logs" rows={data.auditLogs} />;
  }
  if (activeMenu === 'settings') {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-base font-semibold">Settings</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Configure dashboard preferences, notification channels, and security defaults.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SettingRow label="Dark Mode" value="Enabled" />
          <SettingRow label="Notification Channel" value="Email" />
          <SettingRow label="Session Timeout" value="30 minutes" />
          <SettingRow label="Audit Log Retention" value="365 days" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">This section is ready for extension.</p>
    </section>
  );
}

function StatCard({
  icon: Icon,
  title,
  value,
  detail,
  change,
}: {
  icon: typeof Users;
  title: string;
  value: string;
  detail: string;
  change: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{detail}</p>
      <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">{change} vs last period</p>
    </article>
  );
}

function ChartCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <article className={cn('rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900', className)}>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}

function DataTableCard({
  title,
  rows,
  onDelete,
}: {
  title: string;
  rows: object[];
  onDelete?: (id: string) => Promise<void>;
}) {
  const first = rows[0] as Record<string, unknown> | undefined;
  const headers = first ? Object.keys(first).slice(0, 8) : [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-2 py-1">{header}</th>
              ))}
              {onDelete ? <th className="px-2 py-1">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row, index) => {
              const normalized = row as Record<string, unknown>;
              const id = String(normalized.id ?? index);

              return (
                <tr key={id} className="border-t border-slate-200 dark:border-slate-700">
                  {headers.map((header) => (
                    <td key={header} className="px-2 py-1">{String(normalized[header] ?? '')}</td>
                  ))}
                  {onDelete ? (
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700 dark:border-rose-700 dark:text-rose-300"
                        onClick={() => {
                          void onDelete(id).catch((error) => {
                            toast.error(error instanceof Error ? error.message : 'Delete failed');
                          });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportCard({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  const fileName = title.toLowerCase().replace(/\s+/g, '-');

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Generate exports in PDF, Excel, and CSV.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => exportPdf(fileName, title, rows)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
        >
          PDF
        </button>
        <button
          type="button"
          onClick={() => exportExcel(fileName, rows)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
        >
          Excel
        </button>
        <button
          type="button"
          onClick={() => exportCsv(fileName, rows)}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white dark:bg-slate-100 dark:text-slate-900"
        >
          CSV
        </button>
      </div>
    </article>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function CrudModal({
  open,
  entity,
  onClose,
  planForm,
  beneficiaryForm,
  claimForm,
  clients,
  beneficiaries,
  onSubmitPlan,
  onSubmitBeneficiary,
  onSubmitClaim,
}: {
  open: boolean;
  entity: CrudEntity;
  onClose: () => void;
  planForm: UseFormReturn<PlanInput>;
  beneficiaryForm: UseFormReturn<BeneficiaryInput>;
  claimForm: UseFormReturn<ClaimInput>;
  clients: ClientDoc[];
  beneficiaries: BeneficiaryDoc[];
  onSubmitPlan: () => void;
  onSubmitBeneficiary: () => void;
  onSubmitClaim: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={`Manage ${entity}`}
      description="Use this validated form to create or update Firestore records."
      onClose={onClose}
    >
      {entity === 'plan' ? (
        <form className="space-y-3" onSubmit={onSubmitPlan}>
          <label className="block text-sm">
            Plan Name
            <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...planForm.register('name')} />
          </label>
          <label className="block text-sm">
            Monthly Premium
            <input type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...planForm.register('monthlyPremium', { valueAsNumber: true })} />
          </label>
          <label className="block text-sm">
            Payout Amount
            <input type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...planForm.register('payoutAmount', { valueAsNumber: true })} />
          </label>
          <label className="block text-sm">
            Description
            <textarea rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...planForm.register('description')} />
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">Save Plan</button>
        </form>
      ) : null}

      {entity === 'beneficiary' ? (
        <form className="space-y-3" onSubmit={onSubmitBeneficiary}>
          <label className="block text-sm">
            Client
            <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...beneficiaryForm.register('clientId')}>
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.fullName}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Full Name
            <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...beneficiaryForm.register('fullName')} />
          </label>
          <label className="block text-sm">
            Relationship
            <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...beneficiaryForm.register('relationship')} />
          </label>
          <label className="block text-sm">
            Gender
            <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...beneficiaryForm.register('gender')} />
          </label>
          <label className="block text-sm">
            Age
            <input type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...beneficiaryForm.register('age', { valueAsNumber: true })} />
          </label>
          <label className="block text-sm">
            Status
            <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...beneficiaryForm.register('status')}>
              <option value="alive">Alive</option>
              <option value="deceased">Deceased</option>
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">Save Beneficiary</button>
        </form>
      ) : null}

      {entity === 'claim' ? (
        <form className="space-y-3" onSubmit={onSubmitClaim}>
          <label className="block text-sm">
            Client
            <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...claimForm.register('clientId')}>
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.fullName}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Beneficiary
            <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...claimForm.register('beneficiaryId')}>
              <option value="">Select beneficiary</option>
              {beneficiaries.map((beneficiary) => (
                <option key={beneficiary.id} value={beneficiary.id}>{beneficiary.fullName}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Claim Number
            <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...claimForm.register('claimNumber')} />
          </label>
          <label className="block text-sm">
            Claim Date
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...claimForm.register('claimDate')} />
          </label>
          <label className="block text-sm">
            Claim Status
            <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...claimForm.register('claimStatus')}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label className="block text-sm">
            Claim Amount
            <input type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...claimForm.register('claimAmount', { valueAsNumber: true })} />
          </label>
          <label className="block text-sm">
            Approved Amount
            <input type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" {...claimForm.register('approvedAmount', { valueAsNumber: true })} />
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">Save Claim</button>
        </form>
      ) : null}
    </Modal>
  );
}

function Modal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
