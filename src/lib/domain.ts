export type Role = 'administrator' | 'financeOfficer' | 'client';
export type Status = 'active' | 'pending' | 'suspended';

export interface ClientRecord {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  membershipNumber: string;
  idNumber: string;
  funeralPlan: string;
  status: Status;
  joinedAt: string;
}

export interface MembershipRecord {
  id: string;
  clientId: string;
  membershipNumber: string;
  plan: string;
  status: Status;
  nextPaymentDate: string;
  balanceDue: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  role: Role;
}

export const defaultClients: ClientRecord[] = [
  {
    id: 'client-1',
    fullName: 'Ava Johnson',
    email: 'ava.johnson@example.com',
    phone: '+1 (555) 010-1200',
    address: '24 Maple Street',
    membershipNumber: 'FP-1001',
    idNumber: 'ID-908122',
    funeralPlan: 'Standard Family Plan',
    status: 'active',
    joinedAt: '2026-05-11',
  },
  {
    id: 'client-2',
    fullName: 'Daniel Brooks',
    email: 'daniel.brooks@example.com',
    phone: '+1 (555) 010-4410',
    address: '118 Cedar Avenue',
    membershipNumber: 'FP-1002',
    idNumber: 'ID-443122',
    funeralPlan: 'Premium Memorial Plan',
    status: 'pending',
    joinedAt: '2026-06-02',
  },
];

export const defaultMemberships: MembershipRecord[] = [
  {
    id: 'client-1',
    clientId: 'client-1',
    membershipNumber: 'FP-1001',
    plan: 'Standard Family Plan',
    status: 'active',
    nextPaymentDate: '2026-08-01',
    balanceDue: '$0.00',
  },
  {
    id: 'client-2',
    clientId: 'client-2',
    membershipNumber: 'FP-1002',
    plan: 'Premium Memorial Plan',
    status: 'pending',
    nextPaymentDate: '2026-07-20',
    balanceDue: '$125.00',
  },
];

export const defaultProfiles: UserProfile[] = [
  {
    uid: 'admin-seed',
    email: 'admin@funeral.local',
    fullName: 'System Administrator',
    role: 'administrator',
  },
  {
    uid: 'finance-seed',
    email: 'finance@funeral.local',
    fullName: 'Finance Officer',
    role: 'financeOfficer',
  },
  {
    uid: 'client-seed',
    email: 'ava.johnson@example.com',
    fullName: 'Ava Johnson',
    role: 'client',
  },
];