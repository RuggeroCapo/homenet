// Coarse category for a registrable domain. Unknown domains fall back to "Altro".
const RULES: Array<[string, string[]]> = [
  ['Ricerca', ['google.com', 'google.it', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org', 'startpage.com']],
  ['Streaming', ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com', 'nflxso.net', 'youtube.com', 'googlevideo.com', 'ytimg.com', 'primevideo.com', 'aiv-cdn.net', 'disneyplus.com', 'dssott.com', 'bamgrid.com', 'spotify.com', 'scdn.co', 'twitch.tv', 'ttvnw.net', 'dazn.com', 'raiplay.it', 'mediaset.it', 'mediasetplay.it', 'nowtv.it', 'skyitalia.com', 'sky.it', 'plex.tv', 'tidal.com', 'deezer.com', 'crunchyroll.com', 'vimeo.com']],
  ['Social', ['facebook.com', 'fbcdn.net', 'instagram.com', 'cdninstagram.com', 'whatsapp.net', 'whatsapp.com', 'tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'byteoversea.com', 'ibytedtos.com', 'twitter.com', 'x.com', 'twimg.com', 'reddit.com', 'redd.it', 'linkedin.com', 'snapchat.com', 'pinterest.com', 'telegram.org', 'discord.com', 'discord.gg', 'discordapp.com', 'signal.org']],
  ['Cloud', ['amazonaws.com', 'cloudfront.net', 'azure.com', 'azureedge.net', 'windows.net', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'cloudflare.com', 'cloudflare-dns.com', 'akamaized.net', 'akamaiedge.net', 'akamai.net', 'edgekey.net', 'fastly.net', 'icloud.com', 'icloud-content.com', 'dropbox.com', 'onedrive.com', 'digitaloceanspaces.com', 'aliyuncs.com', 'alicdn.com', 'myqcloud.com']],
  ['Infrastruttura', ['microsoft.com', 'msftconnecttest.com', 'windowsupdate.com', 'live.com', 'office.com', 'office365.com', 'msn.com', 'apple.com', 'mzstatic.com', 'apple-dns.net', 'cdn-apple.com', 'aaplimg.com', 'ntp.org', 'pool.ntp.org', 'digicert.com', 'letsencrypt.org', 'lencr.org', 'sectigo.com', 'gvt1.com', 'gvt2.com', 'android.com', 'ubuntu.com', 'debian.org', 'mozilla.org', 'mozilla.net']],
  ['Sviluppo', ['github.com', 'githubusercontent.com', 'gitlab.com', 'npmjs.org', 'npmjs.com', 'docker.io', 'docker.com', 'pypi.org', 'pythonhosted.org', 'stackoverflow.com', 'anthropic.com', 'claude.ai', 'openai.com', 'vercel.app', 'jsdelivr.net', 'unpkg.com']],
  ['Gaming', ['playstation.com', 'playstation.net', 'sonyentertainmentnetwork.com', 'xboxlive.com', 'xbox.com', 'steampowered.com', 'steamcontent.com', 'steamstatic.com', 'epicgames.com', 'nintendo.net', 'nintendo.com', 'riotgames.com', 'ea.com', 'blizzard.com', 'battle.net', 'ubisoft.com']],
  ['Smart home', ['home-assistant.io', 'nabucasa.com', 'tuya.com', 'tuyaeu.com', 'tuyaus.com', 'tuyacn.com', 'smartlife.com', 'iot.mi.com', 'mi.com', 'xiaomi.com', 'roborock.com', 'ezvizlife.com', 'hik-connect.com', 'tplinkcloud.com', 'tapo.com', 'shelly.cloud', 'meross.com', 'ewelink.cc', 'coolkit.cc', 'imoulife.com', 'cloudlinks.cn', 'p2pcamweb.com', 'yi.technology', 'wyze.com', 'ring.com', 'nest.com', 'sonos.com', 'philips-hue.com', 'meethue.com', 'alexa.com', 'amazonalexa.com', 'echo.amazon.com']],
  ['Pubblicità / Tracking', ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com', 'googletagmanager.com', 'app-measurement.com', 'crashlytics.com', 'scorecardresearch.com', 'adnxs.com', 'criteo.com', 'taboola.com', 'outbrain.com', 'appsflyer.com', 'adjust.com', 'branch.io', 'amplitude.com', 'mixpanel.com', 'segment.io', 'hotjar.com', 'newrelic.com', 'sentry.io', 'samsungads.com', 'lgsmartad.com', 'unityads.unity3d.com', 'moatads.com', 'adsrvr.org']],
  ['Shopping', ['amazon.com', 'amazon.it', 'media-amazon.com', 'ssl-images-amazon.com', 'ebay.com', 'ebay.it', 'aliexpress.com', 'temu.com', 'shein.com', 'zalando.it', 'subito.it', 'vinted.it']],
];

const MAP = new Map<string, string>();
for (const [cat, list] of RULES) for (const d of list) MAP.set(d, cat);

export function categoryOf(base: string): string {
  return MAP.get(base) ?? (/(^|\.)(ads?|track|telemetry|metrics|analytics)[.-]/.test(base) ? 'Pubblicità / Tracking' : 'Altro');
}
