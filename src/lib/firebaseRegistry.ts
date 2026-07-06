import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { defaultClients, defaultMemberships, type ClientRecord, type MembershipRecord } from './domain';
import { getFirebaseDb } from './firebase';

export interface RegistryState {
  configured: boolean;
  loading: boolean;
  error: string | null;
  clients: ClientRecord[];
  memberships: MembershipRecord[];
  saveClient: (record: ClientRecord) => Promise<void>;
  deleteClient: (clientId: string) => Promise<void>;
  resetSamples: () => Promise<void>;
}

function mapClientSnapshot(docId: string, data: Record<string, unknown>): ClientRecord {
  return {
    id: docId,
    fullName: typeof data.fullName === 'string' ? data.fullName : '',
    email: typeof data.email === 'string' ? data.email : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    address: typeof data.address === 'string' ? data.address : '',
    membershipNumber: typeof data.membershipNumber === 'string' ? data.membershipNumber : '',
    idNumber: typeof data.idNumber === 'string' ? data.idNumber : '',
    funeralPlan: typeof data.funeralPlan === 'string' ? data.funeralPlan : '',
    status: data.status === 'active' || data.status === 'pending' || data.status === 'suspended' ? data.status : 'pending',
    joinedAt: typeof data.joinedAt === 'string' ? data.joinedAt : new Date().toISOString().slice(0, 10),
  };
}

function mapMembershipSnapshot(docId: string, data: Record<string, unknown>): MembershipRecord {
  return {
    id: docId,
    clientId: typeof data.clientId === 'string' ? data.clientId : docId,
    membershipNumber: typeof data.membershipNumber === 'string' ? data.membershipNumber : '',
    plan: typeof data.plan === 'string' ? data.plan : '',
    status: data.status === 'active' || data.status === 'pending' || data.status === 'suspended' ? data.status : 'pending',
    nextPaymentDate: typeof data.nextPaymentDate === 'string' ? data.nextPaymentDate : new Date().toISOString().slice(0, 10),
    balanceDue: typeof data.balanceDue === 'string' ? data.balanceDue : '$0.00',
  };
}

async function seedFirestore(db: Firestore) {
  const batch = writeBatch(db);

  for (const client of defaultClients) {
    batch.set(doc(db, 'clients', client.id), {
      ...client,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const membership of defaultMemberships) {
    batch.set(doc(db, 'memberships', membership.id), {
      ...membership,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

export function useRegistry(): RegistryState {
  const db = getFirebaseDb();
  const configured = Boolean(db);
  const [clients, setClients] = useState<ClientRecord[]>(defaultClients);
  const [memberships, setMemberships] = useState<MembershipRecord[]>(defaultMemberships);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const clientsQuery = query(collection(db, 'clients'), orderBy('joinedAt', 'desc'));
    const membershipsQuery = query(collection(db, 'memberships'), orderBy('nextPaymentDate', 'asc'));

    const unsubscribeClients = onSnapshot(
      clientsQuery,
      (snapshot) => {
        setClients(snapshot.docs.map((snapshotDoc) => mapClientSnapshot(snapshotDoc.id, snapshotDoc.data())));
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    );

    const unsubscribeMemberships = onSnapshot(
      membershipsQuery,
      (snapshot) => {
        setMemberships(snapshot.docs.map((snapshotDoc) => mapMembershipSnapshot(snapshotDoc.id, snapshotDoc.data())));
      },
      (snapshotError) => {
        setError(snapshotError.message);
      },
    );

    void (async () => {
      const [clientSnapshot, membershipSnapshot] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'memberships')),
      ]);

      if (clientSnapshot.empty && membershipSnapshot.empty) {
        await seedFirestore(db);
      }
    })();

    return () => {
      unsubscribeClients();
      unsubscribeMemberships();
    };
  }, [db]);

  const actions = useMemo(
    () => ({
      async saveClient(record: ClientRecord) {
        setError(null);

        if (!db) {
          setClients((current) => {
            const exists = current.some((client) => client.id === record.id);
            return exists ? current.map((client) => (client.id === record.id ? record : client)) : [record, ...current];
          });

          setMemberships((current) => {
            const existingMembership = current.find((membership) => membership.clientId === record.id);
            const nextMembership: MembershipRecord = {
              id: record.id,
              clientId: record.id,
              membershipNumber: record.membershipNumber,
              plan: record.funeralPlan,
              status: record.status,
              nextPaymentDate: existingMembership?.nextPaymentDate ?? record.joinedAt,
              balanceDue: existingMembership?.balanceDue ?? '$0.00',
            };

            return existingMembership
              ? current.map((membership) => (membership.clientId === record.id ? nextMembership : membership))
              : [nextMembership, ...current];
          });

          return;
        }

        const existingMembership = memberships.find((membership) => membership.clientId === record.id);
        const batch = writeBatch(db);

        batch.set(
          doc(db, 'clients', record.id),
          {
            ...record,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true },
        );

        batch.set(
          doc(db, 'memberships', record.id),
          {
            id: record.id,
            clientId: record.id,
            membershipNumber: record.membershipNumber,
            plan: record.funeralPlan,
            status: record.status,
            nextPaymentDate: existingMembership?.nextPaymentDate ?? record.joinedAt,
            balanceDue: existingMembership?.balanceDue ?? '$0.00',
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          { merge: true },
        );

        await batch.commit();
      },
      async deleteClient(clientId: string) {
        setError(null);

        if (!db) {
          setClients((current) => current.filter((client) => client.id !== clientId));
          setMemberships((current) => current.filter((membership) => membership.clientId !== clientId));
          return;
        }

        await Promise.all([
          deleteDoc(doc(db, 'clients', clientId)),
          deleteDoc(doc(db, 'memberships', clientId)),
        ]);
      },
      async resetSamples() {
        setError(null);

        if (!db) {
          setClients(defaultClients);
          setMemberships(defaultMemberships);
          return;
        }

        const batch = writeBatch(db);

        for (const client of clients) {
          batch.delete(doc(db, 'clients', client.id));
        }

        for (const membership of memberships) {
          batch.delete(doc(db, 'memberships', membership.id));
        }

        await batch.commit();
        await seedFirestore(db);
      },
    }),
    [clients, db, memberships],
  );

  return {
    configured,
    loading,
    error,
    clients,
    memberships,
    saveClient: actions.saveClient,
    deleteClient: actions.deleteClient,
    resetSamples: actions.resetSamples,
  };
}