<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Gonzo Dashboard

This is a personal dashboard for Gmail, Google Calendar, weather data, and AI-generated mail summaries. The whole contraption runs through an Express server with Vite in middleware mode, which means frontend and backend stagger through the same smoke-filled corridor at `http://127.0.0.1:3000`.

If you want to get this beast running without being clubbed by `redirect_uri_mismatch`, broken session cookies, or counterfeit secrets, follow the steps below with discipline and a healthy fear of configuration drift.

## What You Need

- Node.js installed locally
- A Google Cloud project with an OAuth 2.0 Client ID
- A real Gemini API key from Google AI Studio
- A local `.env` file in the project root

## Install The Machine

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root. Use [`.env.example`](./.env.example) as the starting point.

3. Fill in these variables:

```env
GEMINI_API_KEY="your-real-gemini-key"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
SESSION_SECRET="a-long-random-secret-string"
```

## Google OAuth, Or How To Avoid Administrative Bloodshed

In Google Cloud Console, your OAuth client must be configured with the correct origins and redirect URIs. Get this wrong and Google will swat you down without ceremony.

Use these values for local development:

- Authorized JavaScript origins:
  - `http://127.0.0.1:3000`
- Authorized redirect URIs:
  - `http://127.0.0.1:3000/auth/callback`

If you also run the app in AI Studio or another hosted environment, add those origins and callback URLs too. Just do not confuse them with your local setup. Google is not interested in your excuses.

## Start The Server

Run:

```bash
npm run dev
```

That starts the Express server and Vite in development mode at:

`http://127.0.0.1:3000`

## What The App Does

- Authenticates with Google through OAuth
- Reads Gmail statistics
- Fetches upcoming calendar events
- Fetches weather data from Open-Meteo
- Sends mail snippets to Gemini for a short gonzo-style summary

## Common Failures

### `redirect_uri_mismatch`

Your redirect URI in Google Cloud Console does not exactly match the one the app is sending.

For local development, it must be:

`http://127.0.0.1:3000/auth/callback`

### `Authentication failed`

This usually means `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is wrong, or you are using credentials from the wrong OAuth client.

### `API_KEY_INVALID`

Your `GEMINI_API_KEY` is missing, invalid, or not a real Gemini API key.

### Nothing happens after Google login

Check that cookies and sessions are working locally and that you are actually using the same host you registered in Google Cloud Console. `127.0.0.1` and `localhost` are not always interchangeable in this circus.

## Type Check

To run the TypeScript check without building:

```bash
npm run lint
```

## Final Note

This is not a polite dashboard. It is a small command center for staring down your inbox, your calendar, and the weather gods while Gemini mutters out a field report from the front. Keep your secrets valid, your redirect URIs exact, and your nerves reasonably intact.
