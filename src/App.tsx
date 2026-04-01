import React, { useState, useEffect } from 'react';
import { 
  Mail, 
  Calendar as CalendarIcon, 
  Cloud, 
  ArrowUpRight, 
  ArrowDownRight, 
  LogOut, 
  RefreshCw,
  Clock,
  MapPin,
  Sun,
  CloudRain,
  CloudLightning,
  Snowflake,
  Wind,
  Sparkles
} from 'lucide-react';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";

// Types
interface GmailStats {
  today: { sent: number; received: number };
  yesterday: { sent: number; received: number };
  averages: { sent: number; received: number };
  labels: { gtm: number; api: number };
  comparison: { 
    sent: number; 
    received: number;
    sentVsYesterday: number;
    receivedVsYesterday: number;
  };
  snippets?: string[];
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
}

interface WeatherData {
  current_weather: {
    temperature: number;
    weathercode: number;
    windspeed: number;
  };
  daily: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weathercode: number[];
  };
}

const WeatherIcon = ({ code, className, size }: { code: number; className?: string; size?: number }) => {
  if (code === 0) return <Sun className={className} size={size} />;
  if (code <= 3) return <Cloud className={className} size={size} />;
  if (code <= 48) return <Wind className={className} size={size} />;
  if (code <= 67) return <CloudRain className={className} size={size} />;
  if (code <= 77) return <Snowflake className={className} size={size} />;
  if (code <= 99) return <CloudLightning className={className} size={size} />;
  return <Cloud className={className} size={size} />;
};

const WeatherDescription = (code: number) => {
  if (code === 0) return "Klar himmel";
  if (code <= 3) return "Delvis molnigt";
  if (code <= 48) return "Dimmigt";
  if (code <= 67) return "Regnigt";
  if (code <= 77) return "Snöfall";
  if (code <= 99) return "Åska";
  return "Molnigt";
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [gmailStats, setGmailStats] = useState<GmailStats | null>(null);
  const [gmailSummary, setGmailSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);

  const getAuthHeaders = () => {
    const tokens = localStorage.getItem('dashboard_tokens');
    return tokens ? { 'x-goog-tokens': tokens } : {};
  };

  const checkAuth = async () => {
    try {
      const tokens = localStorage.getItem('dashboard_tokens');
      if (tokens) {
        setIsAuthenticated(true);
        setLoading(false);
        return;
      }
      const res = await fetch('/api/auth/status', { 
        headers: getAuthHeaders(),
        credentials: 'include' 
  });
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated);
    } catch (e) {
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    const res = await fetch('/api/auth/url', { credentials: 'include' });
    const { url } = await res.json();
    window.open(url, 'google_oauth', 'width=600,height=700');
  };

  const handleLogout = async () => {
    localStorage.removeItem('dashboard_tokens');
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setIsAuthenticated(false);
    setGmailStats(null);
    setEvents([]);
  };

  const fetchData = async () => {
    const tokens = localStorage.getItem('dashboard_tokens');
    if (!isAuthenticated && !tokens) return;
    
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      const [gmailRes, calRes] = await Promise.all([
        fetch('/api/gmail/stats', { headers, credentials: 'include' }),
        fetch('/api/calendar/events', { headers, credentials: 'include' })
      ]);
      
      if (gmailRes.status === 401 || calRes.status === 401) {
        localStorage.removeItem('dashboard_tokens');
        setIsAuthenticated(false);
        return;
      }

      if (gmailRes.ok) {
        const data = await gmailRes.json();
        setGmailStats(data);
        
        // Generate summary on client side
        if (data.snippets && data.snippets.length > 0) {
          generateSummary(data.snippets);
        } else {
          setGmailSummary("Inga nya mejl att summera idag.");
        }
      } else {
        console.error("Gmail API returned non-ok status", gmailRes.status);
      }

      if (calRes.ok) {
        const data = await calRes.json();
        setEvents(data);
      } else {
        console.error("Calendar API returned non-ok status", calRes.status);
      }
    } catch (e) {
      console.error("Error fetching data", e);
    } finally {
      setLoading(false);
    }
  };

  const generateSummary = async (snippets: string[]) => {
    setSummarizing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Här är utdrag från dagens inkomna mejl:
      ${snippets.join("\n---\n")}
      
      Skapa en kortfattad punktlista på svenska där du summerar dessa mejl i en renodlad Hunter S. Thompson / Gonzo-stil. 
      Tänk febrig paranoia, vilda metaforer och en känsla av att vara mitt i ett kaosartat äventyr, men det MÅSTE fortfarande vara helt tydligt vad mejlet faktiskt handlar om (t.ex. specifika möten, frågor, eller ärenden). 
      Håll det intensivt, personligt och lite galet, men ändå informativt.
      
      Inled ALLTID summeringen med meningen: "Här kommer en rapport från slagfältet..." följt av en radbrytning och sedan din punktlista.
      
      Använd formatet:
      • [Din Gonzo-inspirerade summering här]
      Max 4 punkter totalt.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      setGmailSummary(response.text || "Inga tydliga ärenden hittades.");
    } catch (e) {
      console.error("Error generating summary:", e);
      setGmailSummary("Ett fel uppstod vid generering av summering.");
    } finally {
      setSummarizing(false);
    }
  };

  const fetchWeather = async (lat: number, lon: number) => {
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`, { 
        headers: getAuthHeaders(),
        credentials: 'include' 
      });
      if (res.ok) setWeather(await res.json());
    } catch (e) {
      console.error("Error fetching weather", e);
    }
  };

  useEffect(() => {
    checkAuth();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        fetchWeather(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        // Fallback to Gothenburg
        const gbg = { lat: 57.7089, lon: 11.9746 };
        setLocation(gbg);
        fetchWeather(gbg.lat, gbg.lon);
      }
    );

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        if (event.data.tokens) {
          localStorage.setItem('dashboard_tokens', JSON.stringify(event.data.tokens));
        }
        setIsAuthenticated(true);
      }
    };
    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    let interval: any;
    if (isAuthenticated) {
      fetchData();
      // Auto-refresh every 5 minutes
      interval = setInterval(() => {
        fetchData();
      }, 5 * 60 * 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAuthenticated]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 10) return "God morgon.";
    if (hour >= 10 && hour < 12) return "God förmiddag.";
    if (hour >= 12 && hour < 18) return "God eftermiddag.";
    if (hour >= 18 && hour < 23) return "God kväll.";
    return "God natt.";
  };

  const quotes = [
    "Life should not be a journey to the grave with the intention of arriving safely in a pretty and well preserved body...",
    "Buy the ticket, take the ride.",
    "Too weird to live, too rare to die!",
    "When the going gets weird, the weird turn pro.",
    "Freedom is something that dies unless it's used.",
    "Yesterday's weirdness is tomorrow's reason why.",
    "He who makes a beast of himself gets rid of the pain of being a man."
  ];

  const [randomQuote] = useState(() => quotes[Math.floor(Math.random() * quotes.length)]);
  const [showFullQuote, setShowFullQuote] = useState(false);

  if (isAuthenticated === null) return null;

  return (
    <div className="min-h-screen bg-brand-neutral text-brand-dark font-mono p-6 md:p-12 selection:bg-brand-primary selection:text-brand-neutral">
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-8 border-b-4 border-brand-dark pb-8">
        <div>
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-8xl font-black tracking-tighter mb-4 uppercase"
          >
            {getGreeting()}
          </motion.h1>
          <div className="max-w-2xl border-l-4 border-brand-primary pl-4 py-2 bg-brand-primary/5">
            <p 
              className={`text-brand-dark text-sm md:text-base italic transition-all duration-300 ${showFullQuote ? '' : 'line-clamp-2'}`}
            >
              "{randomQuote}"
            </p>
            {randomQuote.length > 80 && (
              <button 
                onClick={() => setShowFullQuote(!showFullQuote)}
                className="text-[10px] uppercase tracking-widest font-bold text-brand-primary mt-2 hover:underline cursor-pointer"
              >
                {showFullQuote ? '[ COLLAPSE_DATA ]' : '[ EXPAND_DATA ]'}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-6">
          <div className="flex flex-col items-end gap-2">
            <span className="bg-brand-secondary text-white px-4 py-1 text-xs font-bold uppercase tracking-widest shadow-[2px_2px_0px_0px_rgba(45,45,45,1)]">
              SYSTEM_WEEK // {format(new Date(), 'w')}
            </span>
            <span className="bg-brand-primary text-white px-4 py-1 text-xs font-bold uppercase tracking-widest shadow-[2px_2px_0px_0px_rgba(45,45,45,1)]">
              UPLINK_DATE // {format(new Date(), 'yyyy.MM.dd')}
            </span>
          </div>
          <div className="flex gap-4">
            {isAuthenticated && (
              <>
                <button 
                  onClick={fetchData}
                  disabled={loading}
                  className="px-4 py-2 border-2 border-brand-dark bg-white text-[10px] uppercase tracking-widest font-bold hover:bg-brand-primary hover:text-white transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-[3px_3px_0px_0px_rgba(45,45,45,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                >
                  SYNC_DATA <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
                <button 
                  onClick={handleLogout}
                  className="px-4 py-2 border-2 border-brand-dark bg-white text-brand-primary text-[10px] uppercase tracking-widest font-bold hover:bg-brand-primary hover:text-white transition-all flex items-center gap-2 cursor-pointer shadow-[3px_3px_0px_0px_rgba(45,45,45,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                >
                  TERMINATE_SESSION <LogOut size={12} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Communications Card */}
        <section className="md:col-span-2 brutal-card group">
          <div className="absolute top-0 right-0 bg-brand-primary text-white px-4 py-1 text-[10px] font-bold uppercase tracking-widest border-l-2 border-b-2 border-brand-dark">
            COMMS_MODULE_v2.4
          </div>
          <div className="flex justify-between items-start mb-12">
            <h2 className="text-sm uppercase tracking-[0.3em] font-black text-brand-dark/70">COMMUNICATIONS_LOG</h2>
            <Mail className="text-brand-primary" size={24} />
          </div>

          {!isAuthenticated ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-brand-dark/30 bg-brand-neutral/20">
              <p className="mb-8 text-brand-dark/70 uppercase tracking-widest text-sm">AUTHENTICATION_REQUIRED_FOR_GMAIL_UPLINK</p>
              <button 
                onClick={handleConnect}
                className="bg-brand-primary text-white px-10 py-4 rounded-none hover:bg-brand-secondary transition-colors flex items-center gap-3 font-black uppercase tracking-widest text-sm brutal-border cursor-pointer"
              >
                ESTABLISH_CONNECTION
              </button>
            </div>
          ) : (
            <div className="space-y-12">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-4 p-4 border-2 border-brand-dark bg-brand-primary/5">
                  <p className="text-[10px] text-brand-dark/50 uppercase tracking-widest font-bold">TRANSMITTED_TODAY</p>
                  <div className="flex items-baseline gap-4">
                    <span className="text-8xl font-black tracking-tighter text-brand-primary">{gmailStats?.today.sent ?? 0}</span>
                    {gmailStats && (
                      <div className="flex flex-col">
                        <div className={`flex items-center text-sm font-bold ${gmailStats.comparison.sentVsYesterday >= 0 ? 'text-brand-primary' : 'text-brand-secondary'}`}>
                          {gmailStats.comparison.sentVsYesterday >= 0 ? '▲' : '▼'}
                          {Math.abs(gmailStats.comparison.sentVsYesterday)}%
                        </div>
                        <span className="text-[9px] text-brand-dark/40 uppercase tracking-tighter">PREV_CYCLE: {gmailStats.yesterday.sent}</span>
                      </div>
                    )}
                  </div>
                  <div className="h-2 w-full bg-brand-dark/10 border border-brand-dark">
                    <div 
                      className="h-full bg-brand-primary transition-all duration-1000" 
                      style={{ width: `${Math.min(100, ((gmailStats?.today.sent || 0) / (gmailStats?.averages.sent || 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-brand-dark/40 uppercase tracking-widest">
                    AVG_28_DAYS: {gmailStats?.averages.sent.toFixed(1)}
                  </p>
                </div>
                <div className="space-y-4 p-4 border-2 border-brand-dark bg-brand-secondary/5">
                  <p className="text-[10px] text-brand-dark/50 uppercase tracking-widest font-bold">RECEIVED_TODAY</p>
                  <div className="flex items-baseline gap-4">
                    <span className="text-8xl font-black tracking-tighter text-brand-secondary">{gmailStats?.today.received ?? 0}</span>
                    {gmailStats && (
                      <div className="flex flex-col">
                        <div className={`flex items-center text-sm font-bold ${gmailStats.comparison.receivedVsYesterday >= 0 ? 'text-brand-secondary' : 'text-brand-primary'}`}>
                          {gmailStats.comparison.receivedVsYesterday >= 0 ? '▲' : '▼'}
                          {Math.abs(gmailStats.comparison.receivedVsYesterday)}%
                        </div>
                        <span className="text-[9px] text-brand-dark/40 uppercase tracking-tighter">PREV_CYCLE: {gmailStats.yesterday.received}</span>
                      </div>
                    )}
                  </div>
                  <div className="h-2 w-full bg-brand-dark/10 border border-brand-dark">
                    <div 
                      className="h-full bg-brand-secondary transition-all duration-1000" 
                      style={{ width: `${Math.min(100, ((gmailStats?.today.received || 0) / (gmailStats?.averages.received || 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-brand-dark/40 uppercase tracking-widest">
                    AVG_28_DAYS: {gmailStats?.averages.received.toFixed(1)}
                  </p>
                </div>
              </div>

              {/* AI Summary */}
              {(gmailSummary || summarizing) && (
                <div className="bg-white border-2 border-brand-dark p-6 relative shadow-[4px_4px_0px_0px_rgba(45,45,45,1)]">
                  <div className="absolute -top-3 left-4 bg-brand-tertiary text-brand-dark px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border border-brand-dark">
                    GONZO_INTELLIGENCE_UPLINK
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-3 h-3 bg-brand-primary ${summarizing ? 'animate-ping' : 'animate-pulse'}`} />
                    <span className="text-[10px] uppercase tracking-[0.3em] font-black text-brand-dark flex items-center gap-2">
                      DECODING_TRANSMISSIONS {summarizing && <Sparkles size={12} className="animate-spin" />}
                    </span>
                  </div>
                  <div className="text-sm text-brand-dark leading-relaxed whitespace-pre-line font-mono bg-brand-neutral/10 p-4 border border-brand-dark/20">
                    {summarizing ? ">>> ACCESSING ENCRYPTED DATA...\n>>> BYPASSING FIREWALLS...\n>>> ANALYZING CHAOS..." : gmailSummary}
                  </div>
                </div>
              )}

              {/* Label Stats */}
              <div className="pt-8 border-t-2 border-brand-dark/10 grid grid-cols-2 gap-8">
                <div className="bg-white p-4 border-2 border-brand-dark flex justify-between items-center shadow-[3px_3px_0px_0px_rgba(45,45,45,1)]">
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-brand-dark/50 mb-1 font-bold">GTM_TRACKING</p>
                    <p className="text-3xl font-black">{gmailStats?.labels.gtm ?? 0} <span className="text-[10px] opacity-50 font-normal">UNITS</span></p>
                  </div>
                  <div className="w-12 h-12 border-2 border-brand-dark flex items-center justify-center text-brand-primary bg-brand-primary/10">
                    <ArrowUpRight size={20} />
                  </div>
                </div>
                <div className="bg-white p-4 border-2 border-brand-dark flex justify-between items-center shadow-[3px_3px_0px_0px_rgba(45,45,45,1)]">
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-brand-dark/50 mb-1 font-bold">API_UPLINKS</p>
                    <p className="text-3xl font-black text-brand-secondary">{gmailStats?.labels.api ?? 0} <span className="text-[10px] opacity-50 font-normal">UNITS</span></p>
                  </div>
                  <div className="w-12 h-12 border-2 border-brand-dark flex items-center justify-center text-brand-secondary bg-brand-secondary/10">
                    <ArrowUpRight size={20} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Sidebar Column */}
        <div className="space-y-8">
          {/* Weather Card */}
          <section className="bg-white brutal-border p-6 flex flex-col justify-start gap-6 h-fit relative">
            <div className="absolute top-0 right-0 bg-brand-secondary text-white px-3 py-0.5 text-[9px] font-bold uppercase tracking-widest border-l-2 border-b-2 border-brand-dark">
              ATMOSPHERE_SCAN
            </div>
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-black text-brand-dark">
                <MapPin size={14} /> GOTHENBURG_STATION
              </div>
              <WeatherIcon code={weather?.current_weather.weathercode ?? 0} className="text-brand-secondary" size={24} />
            </div>

            <div>
              <div className="text-7xl font-black mb-1 text-brand-dark">
                {Math.round(weather?.current_weather.temperature ?? 0)}°C
              </div>
              <p className="text-lg font-bold uppercase tracking-widest text-brand-dark/80">
                {WeatherDescription(weather?.current_weather.weathercode ?? 0)}
              </p>
            </div>

            <div className="space-y-4 pt-6 border-t-2 border-brand-dark/10">
              <div className="flex justify-between items-center text-[10px] uppercase font-bold">
                <span className="text-brand-dark/50">NIGHT_CYCLE</span>
                <div className="flex items-center gap-4">
                  <WeatherIcon code={weather?.daily.weathercode[0] ?? 0} size={16} />
                  <span className="text-brand-dark">{Math.round(weather?.daily.temperature_2m_min[0] ?? 0)}°</span>
                </div>
              </div>
              <div className="flex justify-between items-center text-[10px] uppercase font-bold">
                <span className="text-brand-dark/50">NEXT_CYCLE</span>
                <div className="flex items-center gap-4">
                  <WeatherIcon code={weather?.daily.weathercode[1] ?? 0} size={16} />
                  <span className="text-brand-dark">{Math.round(weather?.daily.temperature_2m_max[1] ?? 0)}°</span>
                </div>
              </div>
            </div>
          </section>

          {/* Schedule Card */}
          <section className="brutal-card p-6 bg-white">
            <div className="absolute top-0 right-0 bg-brand-tertiary text-brand-dark px-3 py-0.5 text-[9px] font-bold uppercase tracking-widest border-l-2 border-b-2 border-brand-dark">
              CHRONO_TRACKER
            </div>
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xs uppercase tracking-[0.3em] font-black text-brand-dark">SCHEDULE_DATA</h2>
              <CalendarIcon className="text-brand-dark" size={20} />
            </div>

            {!isAuthenticated ? (
              <div className="py-8 text-center text-brand-dark/50 text-[10px] uppercase tracking-widest border-2 border-dashed border-brand-dark/20">
                UPLINK_REQUIRED
              </div>
            ) : loading ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="animate-spin text-brand-dark" size={20} />
              </div>
            ) : (
              <div className="space-y-10">
                {/* Today */}
                <div>
                  <h3 className="text-[10px] font-black text-brand-primary uppercase tracking-[0.2em] mb-6 border-b-2 border-brand-primary/30 pb-2">CURRENT_CYCLE</h3>
                  <div className="space-y-6">
                    {events.filter(e => e.start.dateTime && isToday(parseISO(e.start.dateTime))).length > 0 ? (
                      events.filter(e => e.start.dateTime && isToday(parseISO(e.start.dateTime))).map(event => (
                        <div key={event.id} className="group cursor-pointer border-l-4 border-brand-primary pl-4 py-1 hover:bg-brand-primary/5 transition-colors">
                          <div>
                            <p className="text-sm font-black uppercase tracking-tight group-hover:text-brand-secondary transition-colors">{event.summary}</p>
                            <div className="flex flex-wrap items-center gap-4 text-[9px] text-brand-dark/50 mt-2 font-bold">
                              <span className="flex items-center gap-1 bg-brand-primary/10 px-2 py-0.5"><Clock size={10} /> {event.start.dateTime && format(parseISO(event.start.dateTime), 'HH:mm')}</span>
                              {event.location && <span className="flex items-center gap-1"><MapPin size={10} /> {event.location.split(',')[0].toUpperCase()}</span>}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-[9px] text-brand-dark/40 uppercase font-bold italic tracking-widest">NO_EVENTS_DETECTED</p>
                    )}
                  </div>
                </div>

                {/* Tomorrow */}
                <div>
                  <h3 className="text-[10px] font-black text-brand-secondary uppercase tracking-[0.2em] mb-6 border-b-2 border-brand-secondary/30 pb-2">NEXT_CYCLE</h3>
                  <div className="space-y-6">
                    {events.filter(e => e.start.dateTime && isTomorrow(parseISO(e.start.dateTime))).length > 0 ? (
                      events.filter(e => e.start.dateTime && isTomorrow(parseISO(e.start.dateTime))).map(event => (
                        <div key={event.id} className="group cursor-pointer border-l-4 border-brand-secondary pl-4 py-1 hover:bg-brand-secondary/5 transition-colors">
                          <div>
                            <p className="text-sm font-black uppercase tracking-tight group-hover:text-brand-primary transition-colors">{event.summary}</p>
                            <div className="flex flex-wrap items-center gap-4 text-[9px] text-brand-secondary/50 mt-2 font-bold">
                              <span className="flex items-center gap-1 bg-brand-secondary/10 px-2 py-0.5"><Clock size={10} /> {event.start.dateTime && format(parseISO(event.start.dateTime), 'HH:mm')}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-[9px] text-brand-secondary/40 uppercase font-bold italic tracking-widest">NO_EVENTS_DETECTED</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto mt-24 pt-8 border-t-4 border-brand-dark/30 flex flex-col md:flex-row justify-between items-center gap-4 text-[9px] uppercase tracking-[0.4em] font-black text-brand-dark/40">
        <p>TERMINAL_ID: AIS_DASHBOARD_v4.0.1</p>
        <div className="flex gap-8">
          <p>STATUS: OPERATIONAL</p>
          <p>UPLINK: SECURE</p>
        </div>
        <p>© 2026 PERSONAL_PRODUCTIVITY_NEXUS</p>
      </footer>
    </div>
  );
}
