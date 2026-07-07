import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getFirebaseDb } from './firebase';

export interface PlanDoc {
  id: string;
  name: string;
  monthlyPremium: number;
  payoutAmount?: number;
  isActive?: boolean;
  description?: string;
}

export interface ClientDoc {
  id: string;
  customerNumber: string;
  membershipNumber: string;
  policyNumber?: string;
  fullName: string;
  idNumber: string;
  phoneNumber: string;
  email: string;
  funeralPlan: string;
  monthlyPremium: number;
  paymentStatus: 'paid' | 'outstanding' | 'partial';
  outstandingBalance: number;
  beneficiariesCount: number;
  registrationDate: string;
  status: 'active' | 'suspended' | 'pending' | 'closed';
}

export interface BeneficiaryDoc {
  id: string;
  clientId: string;
  policyNumber?: string;
  membershipNumber?: string;
  fullName: string;
  relationship: string;
  gender: string;
  age: number;
  idNumber: string;
  phoneNumber: string;
  status: 'alive' | 'deceased';
  dateAdded: string;
  dateOfBirth?: string;
  address?: string;
  profilePicture?: string;
}

export interface PaymentDoc {
  id: string;
  clientId: string;
  invoiceNumber: string;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  referenceNumber: string;
  status: 'paid' | 'failed' | 'pending';
}

export interface ClaimDoc {
  id: string;
  clientId: string;
  beneficiaryId: string;
  claimDate: string;
  claimNumber: string;
  claimStatus: 'pending' | 'approved' | 'rejected';
  claimAmount: number;
  approvedAmount: number;
  claimDocuments?: string[];
  adminNotes?: string;
}

export interface CommunicationDoc {
  id: string;
  clientId?: string;
  channel: 'email' | 'sms';
  subject: string;
  message: string;
  status: 'queued' | 'sent' | 'failed';
  createdAt: string;
}

export interface NotificationDoc {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  isRead?: boolean;
}

export interface DocumentDoc {
  id: string;
  clientId?: string;
  beneficiaryId?: string;
  name: string;
  type: string;
  url: string;
  uploadedAt: string;
  fileSize?: number;
}

export interface AuditLogDoc {
  id: string;
  action: string;
  actorName: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export type CollectionRow =
  | ClientDoc
  | BeneficiaryDoc
  | PaymentDoc
  | ClaimDoc
  | CommunicationDoc
  | NotificationDoc
  | DocumentDoc
  | AuditLogDoc
  | PlanDoc;

export type ClientSearchField = 'fullName' | 'customerNumber' | 'phoneNumber' | 'idNumber';

export interface ClientFilters {
  searchTerm: string;
  searchField: ClientSearchField;
  status: 'all' | ClientDoc['status'];
  paymentStatus: 'all' | ClientDoc['paymentStatus'];
  plan: string;
  outstandingOnly: boolean;
}

interface PaginatedClientsPage {
  rows: ClientDoc[];
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
}

const parseNumber = (value: unknown, fallback = 0) => {
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
};

const parseDate = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return new Date().toISOString();
};

function normalizeClient(docId: string, data: Record<string, unknown>): ClientDoc {
  return {
    id: docId,
    customerNumber: String(data.customerNumber ?? ''),
    membershipNumber: String(data.membershipNumber ?? ''),
    fullName: String(data.fullName ?? ''),
    idNumber: String(data.idNumber ?? ''),
    phoneNumber: String(data.phoneNumber ?? ''),
    email: String(data.email ?? ''),
    funeralPlan: String(data.funeralPlan ?? ''),
    monthlyPremium: parseNumber(data.monthlyPremium),
    paymentStatus: (data.paymentStatus === 'paid' || data.paymentStatus === 'partial' ? data.paymentStatus : 'outstanding'),
    outstandingBalance: parseNumber(data.outstandingBalance),
    beneficiariesCount: parseNumber(data.beneficiariesCount),
    registrationDate: parseDate(data.registrationDate),
    status: (data.status === 'active' || data.status === 'suspended' || data.status === 'closed' ? data.status : 'pending'),
  };
}

function buildClientQueryConstraints(filters: ClientFilters, pageSize: number): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  const trimmedSearch = filters.searchTerm.trim();

  if (filters.status !== 'all') {
    constraints.push(where('status', '==', filters.status));
  }

  if (filters.paymentStatus !== 'all') {
    constraints.push(where('paymentStatus', '==', filters.paymentStatus));
  }

  if (filters.plan && filters.plan !== 'all') {
    constraints.push(where('funeralPlan', '==', filters.plan));
  }

  if (filters.outstandingOnly) {
    constraints.push(where('outstandingBalance', '>', 0));
    constraints.push(orderBy('outstandingBalance', 'desc'));
    constraints.push(orderBy('fullName', 'asc'));
  } else if (trimmedSearch && filters.searchField === 'fullName') {
    constraints.push(orderBy('fullName', 'asc'));
    constraints.push(where('fullName', '>=', trimmedSearch));
    constraints.push(where('fullName', '<=', `${trimmedSearch}\uf8ff`));
  } else if (trimmedSearch) {
    constraints.push(where(filters.searchField, '==', trimmedSearch));
    constraints.push(orderBy('fullName', 'asc'));
  } else {
    constraints.push(orderBy('fullName', 'asc'));
  }

  constraints.push(limit(pageSize + 1));

  return constraints;
}

export function useFirestoreCollection<T extends CollectionRow>(collectionName: string, enabled = true) {
  const db = getFirebaseDb();

  return useQuery<T[]>({
    queryKey: ['collection', collectionName],
    queryFn: async () => {
      if (!db) {
        return [];
      }

      const snapshot = await getDocs(collection(db, collectionName));
      return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as T));
    },
    staleTime: 60_000,
    enabled: Boolean(db) && enabled,
  });
}

export function usePaginatedClients(filters: ClientFilters, pageSize = 12, enabled = true) {
  const db = getFirebaseDb();

  const queryResult = useInfiniteQuery<PaginatedClientsPage>({
    queryKey: ['clients-paginated', filters, pageSize],
    initialPageParam: null as QueryDocumentSnapshot<DocumentData> | null,
    queryFn: async ({ pageParam }) => {
      if (!db) {
        return { rows: [], nextCursor: null };
      }

      const constraints = buildClientQueryConstraints(filters, pageSize);
      if (pageParam) {
        constraints.push(startAfter(pageParam));
      }

      const q = query(collection(db, 'clients'), ...constraints);
      const snapshot = await getDocs(q);
      const docs = snapshot.docs;
      const hasMore = docs.length > pageSize;
      const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;

      return {
        rows: pageDocs.map((docSnap) => normalizeClient(docSnap.id, docSnap.data())),
        nextCursor: hasMore ? pageDocs[pageDocs.length - 1] ?? null : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(db) && enabled,
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    return queryResult.data?.pages.flatMap((page) => page.rows) ?? [];
  }, [queryResult.data]);

  return {
    ...queryResult,
    rows,
  };
}

export function useNotificationsRealtime(limitCount = 8, enabled = true) {
  const db = getFirebaseDb();
  const [rows, setRows] = useState<NotificationDoc[]>([]);

  useEffect(() => {
    if (!db || !enabled) {
      setRows([]);
      return;
    }

    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const next = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as NotificationDoc))
        .slice(0, limitCount);
      setRows(next);
    });

    return unsubscribe;
  }, [db, enabled, limitCount]);

  return rows;
}

export function useAdminDataset(activeMenu = 'dashboard') {
  const loadDashboard = activeMenu === 'dashboard';
  const loadClientHeavy =
    loadDashboard ||
    activeMenu === 'clients' ||
    activeMenu === 'clientProfile' ||
    activeMenu === 'outstanding' ||
    activeMenu === 'reports' ||
    activeMenu === 'plans' ||
    activeMenu === 'beneficiaries' ||
    activeMenu === 'claims' ||
    activeMenu === 'payments';

  const clientsQuery = useFirestoreCollection<ClientDoc>('clients', loadClientHeavy);
  const plansQuery = useFirestoreCollection<PlanDoc>('plans', loadDashboard || activeMenu === 'plans');
  const beneficiariesQuery = useFirestoreCollection<BeneficiaryDoc>(
    'beneficiaries',
    loadDashboard || activeMenu === 'beneficiaries' || activeMenu === 'clientProfile' || activeMenu === 'claims',
  );
  const claimsQuery = useFirestoreCollection<ClaimDoc>(
    'claims',
    loadDashboard || activeMenu === 'claims' || activeMenu === 'clientProfile' || activeMenu === 'reports',
  );
  const paymentsQuery = useFirestoreCollection<PaymentDoc>(
    'payments',
    loadDashboard || activeMenu === 'payments' || activeMenu === 'outstanding' || activeMenu === 'clientProfile' || activeMenu === 'reports',
  );
  const communicationsQuery = useFirestoreCollection<CommunicationDoc>('communications', activeMenu === 'communication');
  const documentsQuery = useFirestoreCollection<DocumentDoc>('documents', activeMenu === 'documents');
  const auditLogsQuery = useFirestoreCollection<AuditLogDoc>('auditLogs', activeMenu === 'auditLogs');
  const notifications = useNotificationsRealtime(8, loadDashboard);

  const loading =
    clientsQuery.isLoading ||
    plansQuery.isLoading ||
    beneficiariesQuery.isLoading ||
    claimsQuery.isLoading ||
    paymentsQuery.isLoading;

  const errors = [
    clientsQuery.error,
    plansQuery.error,
    beneficiariesQuery.error,
    claimsQuery.error,
    paymentsQuery.error,
    communicationsQuery.error,
    documentsQuery.error,
    auditLogsQuery.error,
  ]
    .filter(Boolean)
    .map((error) => (error instanceof Error ? error.message : String(error)));

  const clients = useMemo(() => {
    return (clientsQuery.data ?? []).map((client) => ({
      ...client,
      monthlyPremium: parseNumber(client.monthlyPremium),
      outstandingBalance: parseNumber(client.outstandingBalance),
      beneficiariesCount: parseNumber(client.beneficiariesCount),
      registrationDate: parseDate(client.registrationDate),
    }));
  }, [clientsQuery.data]);

  const payments = useMemo(() => {
    return (paymentsQuery.data ?? []).map((payment) => ({
      ...payment,
      amount: parseNumber(payment.amount),
      paymentDate: parseDate(payment.paymentDate),
    }));
  }, [paymentsQuery.data]);

  const claims = useMemo(() => {
    return (claimsQuery.data ?? []).map((claim) => ({
      ...claim,
      claimAmount: parseNumber(claim.claimAmount),
      approvedAmount: parseNumber(claim.approvedAmount),
      claimDate: parseDate(claim.claimDate),
    }));
  }, [claimsQuery.data]);

  const beneficiaries = useMemo(() => {
    return (beneficiariesQuery.data ?? []).map((beneficiary) => ({
      ...beneficiary,
      age: parseNumber(beneficiary.age),
      dateAdded: parseDate(beneficiary.dateAdded),
      dateOfBirth: beneficiary.dateOfBirth ? parseDate(beneficiary.dateOfBirth) : undefined,
    }));
  }, [beneficiariesQuery.data]);

  const plans = useMemo(() => {
    return (plansQuery.data ?? []).map((plan) => ({
      ...plan,
      monthlyPremium: parseNumber(plan.monthlyPremium),
      payoutAmount: parseNumber(plan.payoutAmount),
    }));
  }, [plansQuery.data]);

  return {
    loading,
    errors,
    clients,
    plans,
    beneficiaries,
    claims,
    payments,
    communications: communicationsQuery.data ?? [],
    notifications,
    documents: documentsQuery.data ?? [],
    auditLogs: auditLogsQuery.data ?? [],
  };
}

export async function upsertDocument(
  collectionName: string,
  id: string,
  payload: Record<string, unknown>,
) {
  const db = getFirebaseDb();

  if (!db) {
    throw new Error('Firebase is not configured.');
  }

  await setDoc(
    doc(db, collectionName, id),
    {
      ...payload,
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp(),
      createdAt: payload.createdAt ?? new Date().toISOString(),
      createdAtServer: payload.createdAtServer ?? serverTimestamp(),
    },
    { merge: true },
  );
}

export async function createDocument(collectionName: string, payload: Record<string, unknown>) {
  const db = getFirebaseDb();

  if (!db) {
    throw new Error('Firebase is not configured.');
  }

  await addDoc(collection(db, collectionName), {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdAtServer: serverTimestamp(),
    updatedAtServer: serverTimestamp(),
  });
}

export async function deleteDocumentById(collectionName: string, id: string) {
  const db = getFirebaseDb();

  if (!db) {
    throw new Error('Firebase is not configured.');
  }

  await deleteDoc(doc(db, collectionName, id));
}

export async function saveCommunication(input: {
  clientId?: string;
  channel: 'email' | 'sms';
  subject: string;
  message: string;
}) {
  await createDocument('communications', {
    clientId: input.clientId ?? null,
    channel: input.channel,
    subject: input.subject,
    message: input.message,
    status: 'queued',
  });
}

export async function fetchClientClaims(clientId: string) {
  const db = getFirebaseDb();
  if (!db) {
    return [] as ClaimDoc[];
  }

  const snapshot = await getDocs(query(collection(db, 'claims'), where('clientId', '==', clientId)));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as ClaimDoc));
}

export async function ensureCollectionIndexes(_db: Firestore) {
  return;
}
