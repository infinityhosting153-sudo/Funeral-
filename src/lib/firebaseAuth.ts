import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { defaultProfiles, type Role, type UserProfile } from './domain';
import { getFirebaseAuth, getFirebaseDb } from './firebase';

interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  role: Role;
}

export interface AuthState {
  configured: boolean;
  loading: boolean;
  user: User | null;
  profile: UserProfile | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  seedProfiles: () => Promise<void>;
}

function mapProfile(uid: string, email: string, data: Record<string, unknown> | undefined): UserProfile {
  const seededProfile = defaultProfiles.find((profile) => profile.email === email);

  return {
    uid,
    email,
    fullName: typeof data?.fullName === 'string' ? data.fullName : seededProfile?.fullName ?? email,
    role: (typeof data?.role === 'string' ? data.role : seededProfile?.role ?? 'client') as Role,
  };
}

export function useFirebaseSession(): AuthState {
  const auth = getFirebaseAuth();
  const db = getFirebaseDb();
  const configured = Boolean(auth && db);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth || !db) {
      setLoading(false);
      setUser(null);
      setProfile(null);
      return;
    }

    setLoading(true);
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const profileSnap = await getDoc(doc(db, 'profiles', currentUser.uid));
      const profileData = profileSnap.exists() ? profileSnap.data() : undefined;
      setProfile(mapProfile(currentUser.uid, currentUser.email ?? '', profileData));
      setLoading(false);
    });

    return unsubscribe;
  }, [auth, db]);

  const actions = useMemo(
    () => ({
      async signIn(email: string, password: string) {
        if (!auth) {
          throw new Error('Firebase Auth is not configured.');
        }

        setError(null);
        await signInWithEmailAndPassword(auth, email, password);
      },
      async register(input: RegisterInput) {
        if (!auth || !db) {
          throw new Error('Firebase is not configured.');
        }

        setError(null);
        const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);

        await setDoc(doc(db, 'profiles', credential.user.uid), {
          fullName: input.fullName,
          email: input.email,
          role: input.role,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      },
      async signOutCurrent() {
        if (!auth) {
          return;
        }

        setError(null);
        await signOut(auth);
      },
      async seedProfiles() {
        if (!db) {
          return;
        }

        for (const profileRecord of defaultProfiles) {
          await setDoc(
            doc(db, 'profiles', profileRecord.uid),
            {
              fullName: profileRecord.fullName,
              email: profileRecord.email,
              role: profileRecord.role,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      },
    }),
    [auth, db],
  );

  return {
    configured,
    loading,
    user,
    profile,
    error,
    signIn: actions.signIn,
    register: actions.register,
    signOut: actions.signOutCurrent,
    seedProfiles: actions.seedProfiles,
  };
}