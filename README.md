# HomeNet

Self-hosted network watchdog and traffic analytics for Umbrel + OpenWrt + AdGuard Home.

- **Watchdog**: internet reachability and latency, WAN status (LTE / Wi-Fi / Ethernet), LTE signal (RSRP / RSRQ / SINR), Wi-Fi clients, router SMS. Manual or automatic recovery: restart WAN → reset modem → reboot router → (optional) power-cycle through a Home Assistant smart plug.
- **Traffic analytics**: bytes per device and per destination (from router conntrack), domains per device (from AdGuard Home), country and network owner (ASN) of every destination, a world map, and alerts when a device sends data to watch-listed countries or networks (default: CN, RU, KP, IR, HK, plus Alibaba / Tencent / Huawei / … networks anywhere).

## How it works

```
 OpenWrt router                          Umbrel (Mac mini)
 ┌──────────────────────────┐   ubus    ┌───────────────────────────────┐
 │ rpcd plugin "homenet"    │◄──HTTP────┤ HomeNet (Node, 1 container)   │
 │  · conntrack byte deltas │           │  · collectors every 10–60 s   │
 │  · hosts, Wi-Fi, WAN     │           │  · SQLite (WAL, hourly rollup)│
 │  · modem signal, SMS     │           │  · DB-IP lite GeoIP/ASN       │
 │  · reboot / ifup actions │           │  · React UI via app_proxy     │
 └──────────────────────────┘           └──────────────┬────────────────┘
                                         AdGuard Home ─┘ /control/querylog
```

- The router does almost nothing: the plugin reads `/proc/net/nf_conntrack` and emits only the **byte deltas** of flows that changed since the last poll (state kept in RAM under `/tmp`).
- HomeNet maps flows to devices (DHCP leases + neighbour table), resolves destination IPs to the domain the device just asked AdGuard for, and looks up country/ASN offline.
- Storage is pre-aggregated: 5-minute counters per device, hourly rows per device × destination, hourly DNS counts, one sample per minute for connectivity. Data older than the retention window (default **15 days**, configurable 3–30) is deleted every 6 hours and the space is returned with `incremental_vacuum`.
- Measured in demo mode: ~90 MB RAM, ~0% idle CPU, a few MB of database per week for 10 devices.

## 1. Router setup (OpenWrt)

From the project folder on your computer:

```sh
scp -O router/* root@192.168.1.1:/tmp/
ssh root@192.168.1.1 sh /tmp/install.sh 'choose-a-password'
```

The script installs `uhttpd-mod-ubus`/`jsonfilter` if missing, copies the plugin to `/usr/libexec/rpcd/homenet`, enables conntrack byte accounting, and creates an RPC user `homenet` that can only call the `homenet` object.

LTE signal and SMS: edit `/etc/homenet.conf` on the router. `MODEM_METHOD=auto` tries ModemManager, then `uqmi`, then AT commands through `sms_tool` (`AT_DEVICE=/dev/ttyUSB2`). SMS are read with `sms_tool -j recv`.

> If **flow offloading** is enabled in the firewall, offloaded connections may stop updating conntrack counters and per-device traffic will be under-reported. HomeNet shows a warning when it detects this.

## 2. AdGuard Home

Per-device DNS stats need clients to query AdGuard directly: in OpenWrt set *Network → Interfaces → LAN → DHCP Server → Advanced → DHCP-Options* to `6,<umbrel-ip>`. If instead the router forwards DNS to AdGuard, every query appears to come from the router.

On Umbrel AdGuard runs on the host network, so the default URL `http://host.docker.internal:8095` works from the HomeNet container.

## 3. Install on Umbrel

1. Push this repo to GitHub, tag a release (`git tag v0.1.0 && git push --tags`): the workflow builds `ghcr.io/<you>/homenet` for amd64 and arm64. Make the package public.
2. Replace `OWNER` in `umbrel/ruggero-homenet/*.yml` with your GitHub user, and put the `umbrel/` folder in a repo of its own (a community app store).
3. In Umbrel: *App Store → ⋯ → Community App Stores →* add the store repo URL, install **HomeNet**.
4. Open HomeNet → **Impostazioni**: router URL, user `homenet` and the password you chose, AdGuard credentials. Use *Verifica connessione* for both.

Quick test without the store: `docker build -t homenet .` then
`docker run -d -p 3000:3000 -v homenet-data:/data --add-host host.docker.internal:host-gateway homenet`.

## Development

```sh
cd server && npm install && npm run dev     # DEMO=1: simulated router + AdGuard + 7 days of history
cd web && npm install && npm run dev         # http://localhost:5173 (proxies /api to :3000)
cd server && npm test                        # parser tests
```

`DEMO=1` back-fills a week of synthetic traffic (including a camera uploading to Alibaba Cloud in China) so every screen can be developed offline.

## Notes & limits

- Country = where the **server** is, not the company: a Chinese camera may upload to Alibaba Cloud in Frankfurt. That is why the watchlist also matches ASN names.
- Flows that start and finish between two polls (15 s) lose their last delta; long-lived uploads (cameras, backups) are captured accurately.
- The watchdog is **off by default** and capped by *max reboots per 6 hours*. If the router itself freezes it cannot reboot itself: enable the Home Assistant smart-plug option for that case.

IP geolocation by [DB-IP](https://db-ip.com) (CC BY 4.0).
