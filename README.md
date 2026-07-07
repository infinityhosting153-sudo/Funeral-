# Funeral-

Funeral Parlor Management System scaffolded as a Vite + React app.

Routes currently include `/`, `/login`, `/register`, `/admin`, and `/client`.

Copy `.env.example` to `.env.local` and populate the Firebase variables before wiring the live backend.

Firebase setup quickstart:
- Firebase Console -> Project settings -> Your apps -> SDK setup and configuration
- Copy the web config values into `.env.local`
- Restart the dev server after editing env values

For Vercel production, add the same keys to project env vars:
- `npx vercel env add VITE_FIREBASE_API_KEY production`
- `npx vercel env add VITE_FIREBASE_AUTH_DOMAIN production`
- `npx vercel env add VITE_FIREBASE_PROJECT_ID production`
- `npx vercel env add VITE_FIREBASE_STORAGE_BUCKET production`
- `npx vercel env add VITE_FIREBASE_MESSAGING_SENDER_ID production`
- `npx vercel env add VITE_FIREBASE_APP_ID production`
- `npx vercel env add VITE_FIREBASE_MEASUREMENT_ID production`

See [firebase/firestore.rules](firebase/firestore.rules) and [firebase/schema.md](firebase/schema.md) for the Firestore security model and document shapes.

Demo client credentials:
- Email: `ava.johnson@example.com`
- Password: `Client123!`