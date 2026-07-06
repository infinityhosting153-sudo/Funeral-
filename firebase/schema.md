# Firestore Shape Notes

## `profiles`

Used for Firebase Auth session metadata and role routing.

Fields:
- `fullName`: display name for the signed-in user
- `email`: Firebase Auth email
- `role`: `administrator`, `financeOfficer`, or `client`
- `createdAt`: server timestamp
- `updatedAt`: server timestamp

## `clients`

Used by the registry and dashboard views.

Fields:
- `fullName`
- `email`
- `phone`
- `address`
- `membershipNumber`
- `idNumber`
- `funeralPlan`
- `status`
- `joinedAt`
- `createdAt`
- `updatedAt`

## `memberships`

Used for payment and plan tracking.

Fields:
- `clientId`
- `membershipNumber`
- `plan`
- `status`
- `nextPaymentDate`
- `balanceDue`
- `createdAt`
- `updatedAt`

## Ownership note

Current client access is email-based because the existing app data model already keys client records by email. For stricter security, add an explicit `ownerUid` field to `clients` and `memberships`, then update the rules to check that field instead of email.