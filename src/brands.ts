import { ICONS } from './brandIcons';

export interface Brand {
  id: string;
  label: string;
  hex: string;       // brand colour without '#'
  path?: string;     // simple-icons SVG path (24x24), when a logo is bundled
}

// [pattern tested against the lowercased name, icon key, display label, fallback hex when there is no bundled icon]
const RULES: [RegExp, string, string, string?][] = [
  [/netflix/, 'netflix', 'Netflix'],
  [/spotify/, 'spotify', 'Spotify'],
  [/hulu/, 'hulu', 'Hulu', '1CE783'],
  [/disney/, 'disney', 'Disney+', '113CCF'],
  [/\bhbo\b/, 'hbo', 'HBO'],
  [/\bmax\b/, 'max', 'Max'],
  [/paramount/, 'paramountplus', 'Paramount+'],
  [/peacock/, 'peacock', 'Peacock', '111111'],
  [/prime|amazon/, 'amazonprime', 'Amazon Prime', '00A8E1'],
  [/apple\s*tv/, 'appletv', 'Apple TV+'],
  [/apple\s*music/, 'applemusic', 'Apple Music'],
  [/apple\s*arcade/, 'applearcade', 'Apple Arcade'],
  [/icloud/, 'icloud', 'iCloud'],
  [/apple/, 'apple', 'Apple'],
  [/youtube\s*music/, 'youtubemusic', 'YouTube Music'],
  [/youtube/, 'youtube', 'YouTube'],
  [/dropbox/, 'dropbox', 'Dropbox'],
  [/adobe/, 'adobe', 'Adobe', 'FA0F00'],
  [/microsoft|office\s*365|m365/, 'microsoft', 'Microsoft', '00A4EF'],
  [/onedrive/, 'onedrive', 'OneDrive', '0078D4'],
  [/google\s*one/, 'googleone', 'Google One', '4285F4'],
  [/google\s*drive/, 'googledrive', 'Google Drive'],
  [/google\s*play/, 'googleplay', 'Google Play'],
  [/google/, 'google', 'Google'],
  [/github/, 'github', 'GitHub'],
  [/notion/, 'notion', 'Notion'],
  [/figma/, 'figma', 'Figma'],
  [/canva/, 'canva', 'Canva', '00C4CC'],
  [/chatgpt|openai/, 'openai', 'ChatGPT', '10A37F'],
  [/claude|anthropic/, 'claude', 'Claude'],
  [/slack/, 'slack', 'Slack', '4A154B'],
  [/zoom/, 'zoom', 'Zoom'],
  [/linkedin/, 'linkedin', 'LinkedIn', '0A66C2'],
  [/twitch/, 'twitch', 'Twitch'],
  [/playstation|\bpsn\b/, 'playstation', 'PlayStation'],
  [/xbox/, 'xbox', 'Xbox', '107C10'],
  [/steam/, 'steam', 'Steam'],
  [/nintendo/, 'nintendo', 'Nintendo', 'E60012'],
  [/peloton/, 'peloton', 'Peloton'],
  [/strava/, 'strava', 'Strava'],
  [/headspace/, 'headspace', 'Headspace'],
  [/audible/, 'audible', 'Audible'],
  [/kindle/, 'kindle', 'Kindle', 'FF9900'],
  [/medium/, 'medium', 'Medium'],
  [/substack/, 'substack', 'Substack'],
  [/nytimes|new york times/, 'nytimes', 'The New York Times', '111111'],
  [/tidal/, 'tidal', 'Tidal'],
  [/pandora/, 'pandora', 'Pandora'],
  [/hotstar/, 'hotstar', 'JioHotstar', '1F80E0'],
  [/jio/, 'jio', 'Jio'],
  [/swiggy/, 'swiggy', 'Swiggy'],
  [/zomato/, 'zomato', 'Zomato'],
  [/planet\s*fitness|^planet$/, 'planetfitness', 'Planet Fitness', '6F2C91'],
  [/duolingo/, 'duolingo', 'Duolingo'],
  [/evernote/, 'evernote', 'Evernote'],
  [/lastpass/, 'lastpass', 'LastPass'],
  [/nordvpn/, 'nordvpn', 'NordVPN'],
  [/expressvpn/, 'expressvpn', 'ExpressVPN'],
  [/grammarly/, 'grammarly', 'Grammarly'],
  [/discord/, 'discord', 'Discord'],
  [/patreon/, 'patreon', 'Patreon'],
  [/crunchyroll/, 'crunchyroll', 'Crunchyroll'],
  [/vercel/, 'vercel', 'Vercel'],
  [/cloudflare/, 'cloudflare', 'Cloudflare'],
  [/digitalocean/, 'digitalocean', 'DigitalOcean'],
  [/mailchimp/, 'mailchimp', 'Mailchimp'],
  [/shopify/, 'shopify', 'Shopify'],
  [/squarespace/, 'squarespace', 'Squarespace'],
  [/\bwix\b/, 'wix', 'Wix'],
  [/costco/, 'costco', 'Costco', 'E31837'],
  [/walmart/, 'walmart', 'Walmart', '0071CE'],
];

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** Identify a service by name. Unknown names get a stable colour derived from the name itself. */
export function brandFor(name: string): Brand {
  const n = name.toLowerCase();
  for (const [re, id, label, fallbackHex] of RULES) {
    if (!re.test(n)) continue;
    const icon = ICONS[id];
    if (icon) return { id, label, hex: icon.hex, path: icon.path };
    return { id, label, hex: fallbackHex ?? '444444' };
  }
  return { id: 'unknown', label: name, hex: hslToHex(hash(n) % 360, 55, 42) };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return f(0) + f(8) + f(4);
}

/** True when white text/icon reads better than black on this background. */
export function prefersLightInk(hex: string): boolean {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

export const initialOf = (name: string) => (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
