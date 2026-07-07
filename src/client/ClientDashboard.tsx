import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CreditCard,
  FileClock,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Shield,
  Upload,
  UserRound,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { AuthState } from '../lib/firebaseAuth';
import { cn } from '../lib/cn';
import {
  addClientBeneficiary,
  deleteClientDocument,
  recordClientPayment,
  topUpClientWallet,
  uploadClientDocument,
  useClientDataset,
} from '../lib/clientData';

type ClientMenuKey =
  | 'dashboard'
  | 'clients'
  | 'plans'
  | 'beneficiaries'
  | 'claims'
  | 'payments'
  | 'communication'
  | 'documents'
  | 'settings'
  | 'auditLogs';

const clientMenuPathMap: Record<ClientMenuKey, string> = {
  dashboard: '/client',
  clients: '/client/clients',
  plans: '/client/plans',
  beneficiaries: '/client/beneficiaries',
  claims: '/client/claims',
  payments: '/client/payments',
  communication: '/client/communication',
  documents: '/client/documents',
  settings: '/client/settings',
  auditLogs: '/client/audit-logs',
};

const menu: Array<{ key: ClientMenuKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'clients', label: 'Clients (main account holder)', icon: Users },
  { key: 'plans', label: 'Funeral Plans', icon: FileText },
  { key: 'beneficiaries', label: 'Beneficiaries', icon: UserRound },
  { key: 'claims', label: 'Claims', icon: Shield },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'communication', label: 'Communication', icon: MessageSquare },
  { key: 'documents', label: 'Documents', icon: FolderOpen },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'auditLogs', label: 'Audit Logs', icon: FileClock },
];

function toCurrency(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(value);
}

function monthKey(dateText: string) {
  const date = new Date(dateText);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function buildInvoiceDownload(fileName: string, lines: string[]) {
  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ClientDashboard({
  session,
  initialMenu = 'dashboard',
}: {
  session: AuthState;
  initialMenu?: ClientMenuKey;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeMenu, setActiveMenu] = useState<ClientMenuKey>(initialMenu);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [topUpAmount, setTopUpAmount] = useState(0);
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryRelationship, setBeneficiaryRelationship] = useState('');
  const [beneficiaryGender, setBeneficiaryGender] = useState('Female');
  const [beneficiaryAge, setBeneficiaryAge] = useState(0);
  const [beneficiaryIdNumber, setBeneficiaryIdNumber] = useState('');
  const [beneficiaryPhoneNumber, setBeneficiaryPhoneNumber] = useState('');
  const [beneficiaryAddress, setBeneficiaryAddress] = useState('');
  const [beneficiaryDateOfBirth, setBeneficiaryDateOfBirth] = useState('');
  const [beneficiaryDocs, setBeneficiaryDocs] = useState<File[]>([]);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState('all');
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState('identity');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  useEffect(() => {
    setActiveMenu(initialMenu);
  }, [initialMenu]);

  const data = useClientDataset(session.profile?.email ?? '');

  const paidMonths = useMemo(() => {
    return new Set(data.payments.filter((payment) => payment.status === 'paid').map((payment) => monthKey(payment.paymentDate)));
  }, [data.payments]);

  const dueMonths = useMemo(() => {
    const client = data.client;
    if (!client) {
      return [] as string[];
    }

    const start = new Date(client.registrationDate);
    const end = new Date();
    const months: string[] = [];

    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      months.push(key);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
  }, [data.client]);

  const unpaidMonths = dueMonths.filter((month) => !paidMonths.has(month));

  const beneficiaryDocuments = useMemo(() => {
    return data.documents.filter((document) => {
      if (!document.type.includes('beneficiary')) {
        return false;
      }

      if (selectedBeneficiaryId === 'all') {
        return true;
      }

      return document.beneficiaryId === selectedBeneficiaryId;
    });
  }, [data.documents, selectedBeneficiaryId]);

  if (session.profile?.role !== 'client' && session.profile?.role !== 'financeOfficer') {
    return (
      <div className="p-8 text-sm text-slate-600 dark:text-slate-300">
        Client dashboard is available for client users.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[280px_1fr] lg:p-8">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-widest text-slate-500">Client Portal</p>
            <h2 className="text-lg font-semibold">{session.profile.fullName}</h2>
          </div>
          <nav className="space-y-1">
            {menu.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => {
                    setActiveMenu(item.key);
                    navigate(clientMenuPathMap[item.key]);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
                    activeMenu === item.key
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => void session.signOut()}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 dark:border-rose-700 dark:text-rose-300"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </aside>

        <section className="space-y-4">
          {data.loading ? (
            <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ) : null}

          {activeMenu === 'dashboard' ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat title="Beneficiaries" value={String(data.beneficiaries.length)} />
              <Stat title="Claims" value={String(data.claims.length)} />
              <Stat title="Paid Months" value={String(paidMonths.size)} />
              <Stat title="eWallet Balance" value={toCurrency(data.walletBalance)} />
            </div>
          ) : null}

          {activeMenu === 'clients' ? (
            <Card title="Clients (main account holder)">
              {data.client ? (
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <Item label="Name" value={data.client.fullName} />
                  <Item label="Email" value={data.client.email} />
                  <Item label="ID Number" value={data.client.idNumber} />
                  <Item label="Phone" value={data.client.phoneNumber} />
                  <Item label="Membership Number" value={data.client.membershipNumber} />
                  <Item label="Policy Number" value={data.client.policyNumber || 'Generating...'} />
                  <Item label="Status" value={data.client.status} />
                </div>
              ) : (
                <p className="text-sm text-slate-500">No client account record found for this login yet.</p>
              )}
            </Card>
          ) : null}

          {activeMenu === 'plans' ? (
            <Card title="Funeral Plans">
              {data.client ? (
                <div className="space-y-2 text-sm">
                  <Item label="Selected Plan" value={data.client.funeralPlan || 'Not assigned'} />
                  <Item label="Monthly Premium" value={toCurrency(data.client.monthlyPremium)} />
                  <Item label="Coverage" value={toCurrency(data.selectedPlan?.payoutAmount ?? 0)} />
                </div>
              ) : (
                <p className="text-sm text-slate-500">Plan details unavailable.</p>
              )}
            </Card>
          ) : null}

          {activeMenu === 'beneficiaries' ? (
            <Card title="Beneficiaries">
              <div className="mb-2 text-sm">Total beneficiaries: {data.beneficiaries.length}</div>

              <div className="mb-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-medium">Add Beneficiary + Upload Necessary Documents</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <input
                    value={beneficiaryName}
                    onChange={(event) => setBeneficiaryName(event.target.value)}
                    placeholder="Full name"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <input
                    value={beneficiaryRelationship}
                    onChange={(event) => setBeneficiaryRelationship(event.target.value)}
                    placeholder="Relationship"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <input
                    value={beneficiaryIdNumber}
                    onChange={(event) => setBeneficiaryIdNumber(event.target.value)}
                    placeholder="ID Number"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <input
                    value={beneficiaryPhoneNumber}
                    onChange={(event) => setBeneficiaryPhoneNumber(event.target.value)}
                    placeholder="Phone Number"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <select
                    value={beneficiaryGender}
                    onChange={(event) => setBeneficiaryGender(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={beneficiaryAge}
                    onChange={(event) => setBeneficiaryAge(Number(event.target.value || 0))}
                    placeholder="Age"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <input
                    type="date"
                    value={beneficiaryDateOfBirth}
                    onChange={(event) => setBeneficiaryDateOfBirth(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <input
                    value={beneficiaryAddress}
                    onChange={(event) => setBeneficiaryAddress(event.target.value)}
                    placeholder="Physical Address"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>

                <input
                  type="file"
                  multiple
                  onChange={(event) => setBeneficiaryDocs(Array.from(event.target.files ?? []))}
                  className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                />

                <button
                  type="button"
                  disabled={
                    !data.client ||
                    !beneficiaryName.trim() ||
                    !beneficiaryRelationship.trim() ||
                    !beneficiaryIdNumber.trim() ||
                    !beneficiaryPhoneNumber.trim()
                  }
                  onClick={() => {
                    if (!data.client) {
                      return;
                    }
                    const clientId = data.client.id;

                    void addClientBeneficiary({
                      clientId,
                      fullName: beneficiaryName,
                      relationship: beneficiaryRelationship,
                      gender: beneficiaryGender,
                      age: beneficiaryAge,
                      idNumber: beneficiaryIdNumber,
                      phoneNumber: beneficiaryPhoneNumber,
                      address: beneficiaryAddress,
                      dateOfBirth: beneficiaryDateOfBirth,
                    })
                      .then(async (created) => {
                        for (const file of beneficiaryDocs) {
                          await uploadClientDocument({
                            clientId,
                            beneficiaryId: created.id,
                            name: `${beneficiaryName} - ${file.name}`,
                            type: 'beneficiary-document',
                            fileName: file.name,
                            fileSize: file.size,
                          });
                        }

                        await Promise.all([
                          queryClient.invalidateQueries({ queryKey: ['client-dashboard-beneficiaries', clientId] }),
                          queryClient.invalidateQueries({ queryKey: ['client-dashboard-documents', clientId] }),
                        ]);

                        setBeneficiaryName('');
                        setBeneficiaryRelationship('');
                        setBeneficiaryGender('Female');
                        setBeneficiaryAge(0);
                        setBeneficiaryIdNumber('');
                        setBeneficiaryPhoneNumber('');
                        setBeneficiaryAddress('');
                        setBeneficiaryDateOfBirth('');
                        setBeneficiaryDocs([]);

                        toast.success(`Beneficiary added with member number ${created.membershipNumber}`);
                      })
                      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not add beneficiary'));
                  }}
                  className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  Add Beneficiary
                </button>
              </div>

              <Table
                headers={['Date Registered', 'Name', 'Member #', 'ID Number', 'Physical Address', 'Covered For']}
                rows={data.beneficiaries.map((b) => [
                  new Date(b.dateAdded).toLocaleDateString(),
                  b.fullName,
                  b.membershipNumber || 'Generating...',
                  b.idNumber,
                  b.address || 'N/A',
                  toCurrency(data.selectedPlan?.payoutAmount ?? 0),
                ])}
              />

              <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-medium">Beneficiary Documents (grouped and filtered)</p>
                <div className="mt-2">
                  <select
                    value={selectedBeneficiaryId}
                    onChange={(event) => setSelectedBeneficiaryId(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="all">All beneficiaries</option>
                    {data.beneficiaries.map((beneficiary) => (
                      <option key={beneficiary.id} value={beneficiary.id}>{beneficiary.fullName}</option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-2 py-1">Uploaded At</th>
                        <th className="px-2 py-1">Beneficiary</th>
                        <th className="px-2 py-1">Document Name</th>
                        <th className="px-2 py-1">Type</th>
                        <th className="px-2 py-1">Stored As</th>
                        <th className="px-2 py-1">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {beneficiaryDocuments.length === 0 ? (
                        <tr>
                          <td className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400" colSpan={6}>
                            No beneficiary documents found.
                          </td>
                        </tr>
                      ) : (
                        beneficiaryDocuments.map((document) => {
                          const beneficiary = data.beneficiaries.find((row) => row.id === document.beneficiaryId);
                          return (
                            <tr key={document.id} className="border-t border-slate-200 dark:border-slate-700">
                              <td className="px-2 py-2">{new Date(document.uploadedAt).toLocaleString()}</td>
                              <td className="px-2 py-2">{beneficiary?.fullName || 'Unknown'}</td>
                              <td className="px-2 py-2">{document.name}</td>
                              <td className="px-2 py-2">{document.type}</td>
                              <td className="px-2 py-2">{document.url}</td>
                              <td className="px-2 py-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                                    onClick={() => {
                                      if (document.url.startsWith('uploaded://')) {
                                        toast.info('Preview is unavailable for placeholder uploaded:// files.');
                                        return;
                                      }
                                      window.open(document.url, '_blank', 'noopener,noreferrer');
                                    }}
                                  >
                                    View
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700 dark:border-rose-700 dark:text-rose-300"
                                    onClick={() => {
                                      const clientId = data.client?.id;
                                      if (!clientId) {
                                        return;
                                      }
                                      void deleteClientDocument(document.id)
                                        .then(async () => {
                                          await queryClient.invalidateQueries({ queryKey: ['client-dashboard-documents', clientId] });
                                          toast.success('Document deleted');
                                        })
                                        .catch((error) => toast.error(error instanceof Error ? error.message : 'Delete failed'));
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          ) : null}

          {activeMenu === 'claims' ? (
            <Card title="Claims">
              <div className="mb-2 text-sm">Number of claims: {data.claims.length}</div>
              <Table
                headers={['Deceased Date', 'Name', 'Amount Claimed', 'Status']}
                rows={data.claims.map((claim) => {
                  const beneficiary = data.beneficiaries.find((b) => b.id === claim.beneficiaryId);
                  return [
                    new Date(claim.claimDate).toLocaleDateString(),
                    beneficiary?.fullName || claim.beneficiaryId,
                    toCurrency(claim.claimAmount),
                    claim.claimStatus,
                  ];
                })}
              />
            </Card>
          ) : null}

          {activeMenu === 'payments' ? (
            <Card title="Payments">
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <Item label="Months paid" value={String(paidMonths.size)} />
                <Item label="Months unpaid" value={String(unpaidMonths.length)} />
                <Item label="eWallet Balance" value={toCurrency(data.walletBalance)} />
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-medium">Top up eWallet</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={topUpAmount}
                    onChange={(event) => setTopUpAmount(Number(event.target.value || 0))}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Top-up amount"
                  />
                  <button
                    type="button"
                    disabled={!data.client || topUpAmount <= 0}
                    onClick={() => {
                      if (!data.client || topUpAmount <= 0) {
                        return;
                      }
                      void topUpClientWallet({
                        clientId: data.client.id,
                        amount: topUpAmount,
                        method: 'card',
                      })
                        .then(async () => {
                          setTopUpAmount(0);
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ['client-dashboard-wallet', data.client?.id ?? ''] }),
                            queryClient.invalidateQueries({ queryKey: ['client-dashboard-wallet-transactions', data.client?.id ?? ''] }),
                          ]);
                          toast.success('eWallet top-up completed');
                        })
                        .catch((error) => toast.error(error instanceof Error ? error.message : 'Top-up failed'));
                    }}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    Top Up
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-medium">Pay unpaid month</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    value={selectedMonth}
                    onChange={(event) => setSelectedMonth(event.target.value)}
                  >
                    {unpaidMonths.length === 0 ? <option value="">No unpaid months</option> : null}
                    {unpaidMonths.map((month) => (
                      <option key={month} value={month}>{month}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!data.client || !selectedMonth || unpaidMonths.length === 0}
                    onClick={() => {
                      if (!data.client || !selectedMonth) {
                        return;
                      }
                      void recordClientPayment({
                        clientId: data.client.id,
                        month: selectedMonth,
                        amount: data.client.monthlyPremium,
                        paymentMethod: 'self-service',
                      })
                        .then(() => toast.success(`Payment captured for ${selectedMonth}`))
                        .catch((error) => toast.error(error instanceof Error ? error.message : 'Payment failed'));
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                  >
                    Pay Month
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <p className="mb-2 text-sm font-medium">Paid invoices</p>
                <Table
                  headers={['Month', 'Amount', 'Status', 'Invoice']}
                  rows={data.payments
                    .filter((payment) => payment.status === 'paid')
                    .map((payment) => [
                      monthKey(payment.paymentDate),
                      toCurrency(payment.amount),
                      payment.status,
                      'Download',
                    ])}
                  actionColumn={{
                    label: 'Download',
                    onClick: (index) => {
                      const payment = data.payments.filter((p) => p.status === 'paid')[index];
                      if (!payment) {
                        return;
                      }
                      buildInvoiceDownload(payment.invoiceNumber, [
                        'Funeral Parlor Invoice',
                        `Invoice Number: ${payment.invoiceNumber}`,
                        `Client: ${data.client?.fullName || ''}`,
                        `Month: ${monthKey(payment.paymentDate)}`,
                        `Amount: ${toCurrency(payment.amount)}`,
                        `Status: ${payment.status}`,
                        `Reference: ${payment.referenceNumber}`,
                      ]);
                    },
                  }}
                />
              </div>

              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">eWallet transactions</p>
                <Table
                  headers={['Date', 'Type', 'Method', 'Amount']}
                  rows={data.walletTransactions.map((tx) => [
                    new Date(tx.createdAt).toLocaleString(),
                    tx.type,
                    tx.method,
                    toCurrency(tx.amount),
                  ])}
                />
              </div>
            </Card>
          ) : null}

          {activeMenu === 'communication' ? (
            <Card title="Communication">
              <div className="mb-2 inline-flex items-center gap-2 text-sm">
                <Bell className="h-4 w-4" /> Messages and notices from admin.
              </div>
              <Table
                headers={['Date', 'Channel', 'Subject', 'Status']}
                rows={data.communications.map((communication) => [
                  new Date(communication.createdAt).toLocaleString(),
                  communication.channel,
                  communication.subject,
                  communication.status,
                ])}
              />
            </Card>
          ) : null}

          {activeMenu === 'documents' ? (
            <Card title="Documents to be uploaded onto the system">
              <div className="grid gap-2 md:grid-cols-3">
                <input
                  value={uploadName}
                  onChange={(event) => setUploadName(event.target.value)}
                  placeholder="Document name"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
                <select
                  value={uploadType}
                  onChange={(event) => setUploadType(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="identity">Identity Document</option>
                  <option value="proof-of-residence">Proof of Residence</option>
                  <option value="claim-support">Claim Supporting Doc</option>
                </select>
                <input
                  type="file"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <button
                type="button"
                disabled={!data.client || !uploadName || !uploadFile}
                onClick={() => {
                  if (!data.client || !uploadFile) {
                    return;
                  }
                  void uploadClientDocument({
                    clientId: data.client.id,
                    name: uploadName,
                    type: uploadType,
                    fileName: uploadFile.name,
                    fileSize: uploadFile.size,
                  })
                    .then(() => {
                      toast.success('Document uploaded');
                      setUploadName('');
                      setUploadFile(null);
                    })
                    .catch((error) => toast.error(error instanceof Error ? error.message : 'Upload failed'));
                }}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                <Upload className="h-4 w-4" /> Upload Document
              </button>

              <div className="mt-3">
                <Table
                  headers={['Uploaded At', 'Name', 'Type', 'Stored As']}
                  rows={data.documents.map((doc) => [
                    new Date(doc.uploadedAt).toLocaleString(),
                    doc.name,
                    doc.type,
                    doc.url,
                  ])}
                />
              </div>
            </Card>
          ) : null}

          {activeMenu === 'settings' ? (
            <Card title="Settings">
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <Item label="Account Email" value={session.profile.email} />
                <Item label="Display Name" value={session.profile.fullName} />
                <Item label="Role" value={session.profile.role} />
              </div>
            </Card>
          ) : null}

          {activeMenu === 'auditLogs' ? (
            <Card title="Audit Logs">
              <Table
                headers={['Date', 'Action', 'Entity', 'Entity ID']}
                rows={data.auditLogs.map((log) => [
                  new Date(log.createdAt).toLocaleString(),
                  log.action,
                  log.entityType,
                  log.entityId,
                ])}
              />
            </Card>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Table({
  headers,
  rows,
  actionColumn,
}: {
  headers: string[];
  rows: string[][];
  actionColumn?: { label: string; onClick: (index: number) => void };
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-2 py-1">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400" colSpan={headers.length}>No records found.</td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.join('-')}`} className="border-t border-slate-200 dark:border-slate-700">
                {row.map((cell, cellIndex) => {
                  const isAction = actionColumn && cell === actionColumn.label;
                  return (
                    <td key={`${rowIndex}-${cellIndex}`} className="px-2 py-2">
                      {isAction ? (
                        <button
                          type="button"
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                          onClick={() => actionColumn.onClick(rowIndex)}
                        >
                          {cell}
                        </button>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
