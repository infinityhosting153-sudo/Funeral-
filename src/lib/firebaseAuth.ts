import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { defaultAdminCredentials, defaultClientCredentials, defaultProfiles, type Role, type UserProfile } from './domain';
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
  createDefaultClient: () => Promise<void>;
  createDefaultAdmin: () => Promise<void>;
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

function getErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const value = (error as { code: unknown }).code;
    return typeof value === 'string' ? value : '';
  }

  return '';
}

export function useFirebaseSession(): AuthState {
  const auth = getFirebaseAuth();
  const db = getFirebaseDb();
  const configured = Boolean(auth && db);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  const upsertProfile = async (uid: string, fullName: string, email: string, role: Role) => {
    if (!db) {
      return;
    }

    await setDoc(
      doc(db, 'profiles', uid),
      {
        fullName,
        email,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  useEffect(() => {
    if (!auth || !db) {
      setLoading(false);
      setUser(null);
      setProfile(null);
      return;
    }

    setLoading(true);
    // Defensive timeout so UI never gets stuck in loading if network/auth callbacks stall.
    const loadingTimeout = window.setTimeout(() => {
      setLoading(false);
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setError(null);
        setLoading(false);
        return;
      }

      try {
        const profileSnap = await getDoc(doc(db, 'profiles', currentUser.uid));
        const profileData = profileSnap.exists() ? profileSnap.data() : undefined;
        setProfile(mapProfile(currentUser.uid, currentUser.email ?? '', profileData));
        setError(null);
      } catch (profileError) {
        // Keep user signed in even if profile doc is temporarily inaccessible.
        setProfile(mapProfile(currentUser.uid, currentUser.email ?? '', undefined));
        setError(
          profileError instanceof Error
            ? profileError.message
            : 'Could not load profile document. Using fallback profile.',
        );
      } finally {
        setLoading(false);
      }
    });

    return () => {
      window.clearTimeout(loadingTimeout);
      unsubscribe();
    };
  }, [auth, db]);

  const actions = useMemo(
    () => ({
      async signIn(email: string, password: string) {
        if (!auth || !db) {
          throw new Error('Firebase Auth is not configured.');
        }

        setError(null);
        const normalizedEmail = email.trim().toLowerCase();
        const isDemoCredentials =
          normalizedEmail === defaultClientCredentials.email &&
          password === defaultClientCredentials.password;

        try {
          const credential = await signInWithEmailAndPassword(auth, email, password);

          if (isDemoCredentials) {
            await upsertProfile(
              credential.user.uid,
              defaultClientCredentials.fullName,
              defaultClientCredentials.email,
              defaultClientCredentials.role,
            );
          }
        } catch (error) {
          const errorCode = getErrorCode(error);

          const isAdminCredentials =
            normalizedEmail === defaultAdminCredentials.email &&
            password === defaultAdminCredentials.password;

          const isRecoverableCredentialError =
            errorCode === 'auth/invalid-credential' ||
            errorCode === 'auth/user-not-found' ||
            errorCode === 'auth/wrong-password';

          if (isDemoCredentials && isRecoverableCredentialError) {
            try {
              const createdCredential = await createUserWithEmailAndPassword(
                auth,
                defaultClientCredentials.email,
                defaultClientCredentials.password,
              );

              await upsertProfile(
                createdCredential.user.uid,
                defaultClientCredentials.fullName,
                defaultClientCredentials.email,
                defaultClientCredentials.role,
              );

              return;
            } catch (createError) {
              const createErrorCode = getErrorCode(createError);

              if (createErrorCode === 'auth/email-already-in-use') {
                const signedInCredential = await signInWithEmailAndPassword(
                  auth,
                  defaultClientCredentials.email,
                  defaultClientCredentials.password,
                );

                await upsertProfile(
                  signedInCredential.user.uid,
                  defaultClientCredentials.fullName,
                  defaultClientCredentials.email,
                  defaultClientCredentials.role,
                );

                return;
              }

              throw createError;
            }
          }

          if (isAdminCredentials && isRecoverableCredentialError) {
            try {
              const createdCredential = await createUserWithEmailAndPassword(
                auth,
                defaultAdminCredentials.email,
                defaultAdminCredentials.password,
              );

              await upsertProfile(
                createdCredential.user.uid,
                defaultAdminCredentials.fullName,
                defaultAdminCredentials.email,
                defaultAdminCredentials.role,
              );
            } catch (createError) {
              const createErrorCode = getErrorCode(createError);

              if (createErrorCode === 'auth/email-already-in-use') {
                await signInWithEmailAndPassword(auth, defaultAdminCredentials.email, defaultAdminCredentials.password);
                const signedInUser = auth.currentUser;

                if (signedInUser) {
                  await upsertProfile(
                    signedInUser.uid,
                    defaultAdminCredentials.fullName,
                    defaultAdminCredentials.email,
                    defaultAdminCredentials.role,
                  );
                }

                return;
              }

              throw createError;
            }

            return;
          }

          throw error;
        }
      },
      async register(input: RegisterInput) {
        if (!auth || !db) {
          throw new Error('Firebase is not configured.');
        }

        setError(null);
        const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);

        await upsertProfile(credential.user.uid, input.fullName, input.email, input.role);
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
      async createDefaultClient() {
        if (!auth || !db) {
          throw new Error('Firebase is not configured.');
        }

        setError(null);

        try {
          const credential = await createUserWithEmailAndPassword(
            auth,
            defaultClientCredentials.email,
            defaultClientCredentials.password,
          );

          await upsertProfile(
            credential.user.uid,
            defaultClientCredentials.fullName,
            defaultClientCredentials.email,
            defaultClientCredentials.role,
          );
        } catch (error) {
          const errorCode = getErrorCode(error);

          if (errorCode === 'auth/email-already-in-use') {
            await signInWithEmailAndPassword(auth, defaultClientCredentials.email, defaultClientCredentials.password);
            const signedInUser = auth.currentUser;

            if (signedInUser) {
              await upsertProfile(
                signedInUser.uid,
                defaultClientCredentials.fullName,
                defaultClientCredentials.email,
                defaultClientCredentials.role,
              );
            }

            return;
          }

          throw error;
        }
      },
      async createDefaultAdmin() {
        if (!auth || !db) {
          throw new Error('Firebase is not configured.');
        }

        setError(null);

        try {
          const credential = await createUserWithEmailAndPassword(
            auth,
            defaultAdminCredentials.email,
            defaultAdminCredentials.password,
          );

          await upsertProfile(
            credential.user.uid,
            defaultAdminCredentials.fullName,
            defaultAdminCredentials.email,
            defaultAdminCredentials.role,
          );
        } catch (error) {
          const errorCode = getErrorCode(error);

          if (errorCode === 'auth/email-already-in-use') {
            await signInWithEmailAndPassword(auth, defaultAdminCredentials.email, defaultAdminCredentials.password);
            const signedInUser = auth.currentUser;

            if (signedInUser) {
              await upsertProfile(
                signedInUser.uid,
                defaultAdminCredentials.fullName,
                defaultAdminCredentials.email,
                defaultAdminCredentials.role,
              );
            }

            return;
          }

          throw error;
        }
      },
    }),
    [auth, db, upsertProfile],
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
    createDefaultClient: actions.createDefaultClient,
    createDefaultAdmin: actions.createDefaultAdmin,
  };
}