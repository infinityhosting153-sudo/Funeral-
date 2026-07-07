import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFirebaseDb } from './firebase';
import type {
  AuditLogDoc,
  BeneficiaryDoc,
  ClaimDoc,
  ClientDoc,
  CommunicationDoc,
  DocumentDoc,
  PaymentDoc,
  PlanDoc,
} from './adminData';

export interface WalletTransactionDoc {
  id: string;
  clientId: string;
  amount: number;
  method: string;
  type: 'topup' | 'debit';
  createdAt: string;
}

function parseNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseDate(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return new Date().toISOString();
}

async function fetchByField<T>(collectionName: string, field: string, value: string) {
  const db = getFirebaseDb();
  if (!db) {
    return [] as T[];
  }

  const snapshot = await getDocs(query(collection(db, collectionName), where(field, '==', value)));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as T));
}

export function useClientDataset(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  const clientQuery = useQuery<ClientDoc | null>({
    queryKey: ['client-dashboard-client', normalizedEmail],
    queryFn: async () => {
      const db = getFirebaseDb();
      if (!db || !normalizedEmail) {
        return null;
      }

      const byEmail = await getDocs(
        query(collection(db, 'clients'), where('email', '==', normalizedEmail), limit(1)),
      );

      if (!byEmail.empty) {
        const docSnap = byEmail.docs[0];
        if (!docSnap) {
          return null;
        }
        const data = docSnap.data();
        return {
          id: docSnap.id,
          customerNumber: String(data.customerNumber ?? ''),
          membershipNumber: String(data.membershipNumber ?? ''),
          fullName: String(data.fullName ?? ''),
          idNumber: String(data.idNumber ?? ''),
          phoneNumber: String(data.phoneNumber ?? ''),
          email: String(data.email ?? normalizedEmail),
          funeralPlan: String(data.funeralPlan ?? ''),
          monthlyPremium: parseNumber(data.monthlyPremium),
          paymentStatus: (data.paymentStatus === 'paid' || data.paymentStatus === 'partial' ? data.paymentStatus : 'outstanding'),
          outstandingBalance: parseNumber(data.outstandingBalance),
          beneficiariesCount: parseNumber(data.beneficiariesCount),
          registrationDate: parseDate(data.registrationDate),
          status: (data.status === 'active' || data.status === 'suspended' || data.status === 'closed' ? data.status : 'pending'),
        } as ClientDoc;
      }

      return null;
    },
    enabled: Boolean(normalizedEmail),
    staleTime: 30_000,
  });

  const clientId = clientQuery.data?.id ?? '';

  const beneficiariesQuery = useQuery<BeneficiaryDoc[]>({
    queryKey: ['client-dashboard-beneficiaries', clientId],
    queryFn: () => fetchByField<BeneficiaryDoc>('beneficiaries', 'clientId', clientId),
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });

  const claimsQuery = useQuery<ClaimDoc[]>({
    queryKey: ['client-dashboard-claims', clientId],
    queryFn: () => fetchByField<ClaimDoc>('claims', 'clientId', clientId),
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });

  const paymentsQuery = useQuery<PaymentDoc[]>({
    queryKey: ['client-dashboard-payments', clientId],
    queryFn: () => fetchByField<PaymentDoc>('payments', 'clientId', clientId),
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });

  const communicationsQuery = useQuery<CommunicationDoc[]>({
    queryKey: ['client-dashboard-communications', clientId],
    queryFn: () => fetchByField<CommunicationDoc>('communications', 'clientId', clientId),
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });

  const documentsQuery = useQuery<DocumentDoc[]>({
    queryKey: ['client-dashboard-documents', clientId],
    queryFn: () => fetchByField<DocumentDoc>('documents', 'clientId', clientId),
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });

  const plansQuery = useQuery<PlanDoc[]>({
    queryKey: ['client-dashboard-plans'],
    queryFn: async () => {
      const db = getFirebaseDb();
      if (!db) {
        return [];
      }
      const snapshot = await getDocs(query(collection(db, 'plans'), orderBy('name', 'asc')));
      return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as PlanDoc));
    },
    staleTime: 60_000,
    enabled: true,
  });

  const auditLogsQuery = useQuery<AuditLogDoc[]>({
    queryKey: ['client-dashboard-audit', clientId],
    queryFn: () => fetchByField<AuditLogDoc>('auditLogs', 'entityId', clientId),
    enabled: Boolean(clientId),
    staleTime: 30_000,
  });

  const walletQuery = useQuery<{ balance: number } | null>({
    queryKey: ['client-dashboard-wallet', clientId],
    queryFn: async () => {
      const db = getFirebaseDb();
      if (!db || !clientId) {
        return null;
      }

      const snapshot = await getDocs(query(collection(db, 'wallets'), where('clientId', '==', clientId), limit(1)));
      if (snapshot.empty) {
        return { balance: 0 };
      }

      const first = snapshot.docs[0];
      if (!first) {
        return { balance: 0 };
      }
      return { balance: parseNumber(first.data().balance) };
    },
    enabled: Boolean(clientId),
    staleTime: 10_000,
  });

  const walletTransactionsQuery = useQuery<WalletTransactionDoc[]>({
    queryKey: ['client-dashboard-wallet-transactions', clientId],
    queryFn: async () => {
      const transactions = await fetchByField<WalletTransactionDoc>('walletTransactions', 'clientId', clientId);
      return transactions
        .map((transaction) => ({
          ...transaction,
          amount: parseNumber(transaction.amount),
          createdAt: parseDate(transaction.createdAt),
        }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    enabled: Boolean(clientId),
    staleTime: 10_000,
  });

  const selectedPlan = useMemo(() => {
    if (!clientQuery.data) {
      return null;
    }
    return plansQuery.data?.find((plan) => plan.name === clientQuery.data?.funeralPlan) ?? null;
  }, [clientQuery.data, plansQuery.data]);

  const loading =
    clientQuery.isLoading ||
    beneficiariesQuery.isLoading ||
    claimsQuery.isLoading ||
    paymentsQuery.isLoading;

  return {
    loading,
    client: clientQuery.data,
    selectedPlan,
    beneficiaries: beneficiariesQuery.data ?? [],
    claims: claimsQuery.data ?? [],
    payments: paymentsQuery.data ?? [],
    communications: communicationsQuery.data ?? [],
    documents: documentsQuery.data ?? [],
    auditLogs: auditLogsQuery.data ?? [],
    walletBalance: walletQuery.data?.balance ?? 0,
    walletTransactions: walletTransactionsQuery.data ?? [],
  };
}

export async function topUpClientWallet(input: {
  clientId: string;
  amount: number;
  method: string;
}) {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error('Firebase is not configured.');
  }

  await setDoc(
    doc(db, 'wallets', input.clientId),
    {
      clientId: input.clientId,
      balance: increment(input.amount),
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp(),
    },
    { merge: true },
  );

  await addDoc(collection(db, 'walletTransactions'), {
    clientId: input.clientId,
    amount: input.amount,
    method: input.method,
    type: 'topup',
    createdAt: new Date().toISOString(),
    createdAtServer: serverTimestamp(),
  });
}

export async function recordClientPayment(input: {
  clientId: string;
  month: string;
  amount: number;
  paymentMethod: string;
}) {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error('Firebase is not configured.');
  }

  await addDoc(collection(db, 'payments'), {
    clientId: input.clientId,
    invoiceNumber: `INV-${input.month.replace('-', '')}-${Math.floor(Math.random() * 9000 + 1000)}`,
    paymentDate: `${input.month}-01`,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    referenceNumber: `SELF-${Date.now()}`,
    status: 'paid',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function uploadClientDocument(input: {
  clientId: string;
  name: string;
  type: string;
  fileName: string;
  fileSize: number;
}) {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error('Firebase is not configured.');
  }

  await addDoc(collection(db, 'documents'), {
    clientId: input.clientId,
    name: input.name,
    type: input.type,
    url: `uploaded://${input.fileName}`,
    fileSize: input.fileSize,
    uploadedAt: new Date().toISOString(),
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });
}
