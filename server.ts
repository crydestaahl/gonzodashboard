import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import dotenv from "dotenv";
import axios from "axios";
import { subDays, startOfDay, endOfDay, format } from "date-fns";
import { formatInTimeZone, toDate, toZonedTime } from "date-fns-tz";

dotenv.config();
const TIMEZONE = "Europe/Stockholm";

import session from "express-session";
import FileStoreFactory from "session-file-store";

const FileStore = FileStoreFactory(session);

const app = express();
const PORT = 3000;
const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "default-secret",
    resave: true,
    saveUninitialized: true,
    name: "dashboard.sid",
    proxy: true,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      httpOnly: true,
    },
  })
);

// Debug middleware to log session status
app.use((req: any, res, next) => {
  const hasTokens = !!(req.session && req.session.tokens);
  console.log(`[${req.method}] ${req.path} - SessionID: ${req.sessionID} - HasTokens: ${hasTokens}`);
  next();
});

const getRedirectUri = (req: any) => {
  if (process.env.APP_URL) return `${process.env.APP_URL}/auth/callback`;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProto === "string" && forwardedProto.length > 0
      ? forwardedProto.split(",")[0].trim()
      : req.protocol;
  const host = req.headers["host"];
  return `${protocol}://${host}/auth/callback`;
};

const getOAuthClient = (req?: any) => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    req ? getRedirectUri(req) : undefined
  );
};

const oauth2Client = getOAuthClient();

// Helper to get authenticated client and handle token refresh
const getAuthClient = async (req: any) => {
  // Try to get tokens from header first (for iframe stability)
  let tokens = null;
  const headerTokens = req.headers["x-goog-tokens"];
  
  if (headerTokens) {
    try {
      tokens = JSON.parse(headerTokens as string);
    } catch (e) {
      console.error("Error parsing tokens from header");
    }
  }

  // Fallback to session
  if (!tokens) {
    tokens = req.session?.tokens;
  }

  if (!tokens) return null;

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials(tokens);

  // Check if token is expired or about to expire
  const expiryDate = tokens.expiry_date;
  const isExpired = expiryDate ? Date.now() >= expiryDate - 60000 : true;

  if (isExpired && tokens.refresh_token) {
    try {
      const { credentials } = await client.refreshAccessToken();
      const newTokens = { ...tokens, ...credentials };
      if (req.session) req.session.tokens = newTokens;
      client.setCredentials(newTokens);
    } catch (error) {
      console.error("Error refreshing access token:", error);
      return null;
    }
  }

  return client;
};

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.profile",
];

// Auth Routes
app.get("/api/auth/url", (req, res) => {
  const client = getOAuthClient(req);
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
  res.json({ url });
});

app.get("/auth/callback", async (req: any, res) => {
  const { code } = req.query;
  try {
    const client = getOAuthClient(req);
    const { tokens } = await client.getToken(code as string);
    console.log("OAuth tokens received successfully");
    req.session.tokens = tokens;
    
    req.session.save((err: any) => {
      res.send(`
        <html>
          <body>
            <script>
              const tokens = ${JSON.stringify(tokens)};
              localStorage.setItem('dashboard_tokens', JSON.stringify(tokens));
              console.log("Tokens saved to localStorage");
              
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', tokens }, '*');
                setTimeout(() => window.close(), 500);
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    });
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown token exchange error";
    res.status(500).send(
      isProduction ? "Authentication failed" : `Authentication failed: ${errorMessage}`
    );
  }
});

app.get("/api/auth/status", (req: any, res) => {
  const hasSessionTokens = !!(req.session && req.session.tokens);
  const hasHeaderTokens = !!req.headers["x-goog-tokens"];
  res.json({ isAuthenticated: hasSessionTokens || hasHeaderTokens });
});

app.post("/api/auth/logout", (req: any, res) => {
  req.session.destroy((err: any) => {
    if (err) console.error("Logout error:", err);
    res.json({ success: true });
  });
});

// Gmail Stats API
app.get("/api/gmail/stats", async (req, res) => {
  const auth = await getAuthClient(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  try {
    const gmail = google.gmail({ version: "v1", auth });

    const now = new Date();
    // Use Sweden timezone for "today"
    const startOfToday = startOfDay(toZonedTime(now, TIMEZONE));
    const startOfYesterday = subDays(startOfToday, 1);
    const startOf28DaysAgo = subDays(startOfToday, 28);

    // Convert to Unix timestamps (seconds)
    const todayTs = Math.floor(startOfToday.getTime() / 1000);
    const yesterdayTs = Math.floor(startOfYesterday.getTime() / 1000);
    const last28Ts = Math.floor(startOf28DaysAgo.getTime() / 1000);

    console.log(`Fetching Gmail stats for ${startOfToday.toISOString()} (TS: ${todayTs})`);

    // Helper to count messages
    const countMessages = async (query: string) => {
      try {
        const response = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 500 });
        return response.data.messages?.length || 0;
      } catch (e) {
        console.error(`Error counting messages with query "${query}":`, e);
        return 0;
      }
    };

    // Helper to get label ID by name
    const getLabelId = async (labelName: string) => {
      try {
        const labelsRes = await gmail.users.labels.list({ userId: "me" });
        const label = labelsRes.data.labels?.find(l => l.name?.toLowerCase() === labelName.toLowerCase());
        return label?.id;
      } catch (e) {
        console.error(`Error getting label ID for "${labelName}":`, e);
        return null;
      }
    };

    const [
      sentToday, receivedToday,
      sentYesterday, receivedYesterday,
      sent28Days, received28Days,
      gtmLabelId, apiLabelId
    ] = await Promise.all([
      countMessages(`after:${todayTs} from:me`),
      countMessages(`after:${todayTs} -from:me`),
      countMessages(`after:${yesterdayTs} before:${todayTs} from:me`),
      countMessages(`after:${yesterdayTs} before:${todayTs} -from:me`),
      countMessages(`after:${last28Ts} from:me`),
      countMessages(`after:${last28Ts} -from:me`),
      getLabelId("GTM & Tracking"),
      getLabelId("API")
    ]);

    console.log(`Gmail Results - Sent Today: ${sentToday}, Received Today: ${receivedToday}`);

    // Fetch snippets for frontend summary
    let snippets: string[] = [];
    try {
      const listResponse = await gmail.users.messages.list({ 
        userId: "me", 
        q: `after:${todayTs} -from:me`, 
        maxResults: 10 
      });
      
      const messages = listResponse.data.messages || [];
      snippets = await Promise.all(
        messages.map(async (m) => {
          const msg = await gmail.users.messages.get({ userId: "me", id: m.id!, format: "minimal" });
          return msg.data.snippet || "";
        })
      );
    } catch (e) {
      console.error("Error fetching Gmail snippets:", e);
    }

    // Count messages for specific labels today
    // Note: Gmail search uses label:"Label Name"
    const [gtmToday, apiToday] = await Promise.all([
      countMessages(`after:${todayTs} label:"GTM & Tracking"`),
      countMessages(`after:${todayTs} label:"API"`)
    ]);

    const avgSent = sent28Days / 28;
    const avgReceived = received28Days / 28;

    res.json({
      today: { sent: sentToday, received: receivedToday },
      yesterday: { sent: sentYesterday, received: receivedYesterday },
      averages: { sent: avgSent, received: avgReceived },
      labels: {
        gtm: gtmToday,
        api: apiToday
      },
      comparison: {
        sent: avgSent === 0 ? 0 : Math.round(((sentToday - avgSent) / avgSent) * 100),
        received: avgReceived === 0 ? 0 : Math.round(((receivedToday - avgReceived) / avgReceived) * 100),
        sentVsYesterday: sentYesterday === 0 ? sentToday * 100 : Math.round(((sentToday - sentYesterday) / sentYesterday) * 100),
        receivedVsYesterday: receivedYesterday === 0 ? receivedToday * 100 : Math.round(((receivedToday - receivedYesterday) / receivedYesterday) * 100),
      },
      snippets
    });
  } catch (error) {
    console.error("Gmail API Error:", error);
    res.status(500).json({ error: "Failed to fetch Gmail stats" });
  }
});

// Calendar Events API
app.get("/api/calendar/events", async (req, res) => {
  const auth = await getAuthClient(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  try {
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const startOfTodayStr = formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd'T'00:00:00XXX");
    const endOfTomorrowStr = formatInTimeZone(subDays(now, -1), TIMEZONE, "yyyy-MM-dd'T'23:59:59XXX");

    console.log(`Fetching Calendar events from ${startOfTodayStr} to ${endOfTomorrowStr}`);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfTodayStr,
      timeMax: endOfTomorrowStr,
      singleEvents: true,
      orderBy: "startTime",
    });

    console.log(`Found ${response.data.items?.length || 0} calendar events`);
    res.json(response.data.items || []);
  } catch (error) {
    console.error("Calendar API Error:", error);
    res.status(500).json({ error: "Failed to fetch Calendar events" });
  }
});

// Weather API (Open-Meteo)
app.get("/api/weather", async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: "Location required" });

  try {
    const response = await axios.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`
    );
    res.json(response.data);
  } catch (error) {
    console.error("Weather API Error:", error);
    res.status(500).json({ error: "Failed to fetch weather" });
  }
});

async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
