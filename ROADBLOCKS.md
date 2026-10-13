# Open items that need you

Everything below is either outward-facing (needs your accounts), needs your real hardware, or is a decision only you can make. Everything else is implemented and tested (see "Verified" at the end).

## 1. Publishing (needs your GitHub account)

- [ ] Create a GitHub repo and push: `git remote add origin git@github.com:<you>/homenet.git && git push -u origin main`.
- [ ] Replace `OWNER` in `umbrel/ruggero-homenet/umbrel-app.yml` and `docker-compose.yml` with your GitHub user. The icon URL also points to the repo, so it only works once the repo is pushed.
- [ ] Tag a release (`git tag v0.1.0 && git push --tags`). `.github/workflows/docker.yml` builds `ghcr.io/<you>/homenet` for amd64 + arm64. Afterwards set the GHCR package visibility to **public**, otherwise Umbrel can't pull it.
- [ ] Put the `umbrel/` folder in its own repo (community app store) and add it in Umbrel → App Store → Community App Stores.
  - The store id is `ruggero` and the app id is `ruggero-homenet`. They must match the `<store>-<app>` naming. Rename both if you prefer.

## 2. Things only your real setup can confirm

- [ ] **Router plugin on your OpenWrt.** I tested install + all calls on OpenWrt 23.05.5 and 24.10.4 containers. A real router adds things a container can't have: the live conntrack table, Wi-Fi radios, the modem.
  - After `install.sh`, check the self-test output. It must say `conntrack ... ok`.
- [ ] **Modem method / AT port.** `MODEM_METHOD=auto` picks ModemManager → uqmi → sms_tool. If signal stays empty, set `MODEM_METHOD` and `AT_DEVICE` in `/etc/homenet.conf`.
  - Use the same port your SMS tool already uses.
  - Run `ubus call homenet modem` on the router and send me the output if the values look wrong.
  - Quectel SINR scaling differs between models (EC25 vs RM5xx). I auto-detect it, but it is unverified on your modem.
- [ ] **Your SMS tool.** I assumed it is `sms_tool` by obsy (`sms_tool -j recv`, format verified from its source). If it is a different tool, set `SMS_CMD` in `/etc/homenet.conf` to any command that prints `{"msg":[{"sender","timestamp","content"}]}`.
- [ ] **Flow offloading.** If *Network → Firewall → Software/Hardware flow offloading* is on, per-device byte counts may be too low. HomeNet shows a banner if it detects this. You decide whether to turn offloading off; on a Mac-mini-sized network it is usually not needed.
- [ ] **Per-device DNS.** Clients must use AdGuard directly (DHCP option `6,<umbrel-ip>` on the router). Otherwise every DNS query is attributed to the router.
- [ ] **AdGuard address from the container.** The default is `http://host.docker.internal:8095` (`extra_hosts: host-gateway` in the compose file). If *Verifica connessione* fails, try `http://umbrel.local:8095` or the Umbrel LAN IP.
- [ ] **umbrelOS widgets.** Implemented per Umbrel's manifest format (`server:3000/api/widget/status|usage`). Not yet seen on a real umbrelOS home screen. The `link` field semantics (`/#/monitor`) are my best guess.
- [ ] **Mac mini 2011 performance.** Benchmarked on a modern CPU (30–450 ms per page in a worst-case 15-day DB); on the Mac mini expect 2–3× slower. If anything feels slow, run `npm run bench` there and tell me.
- [ ] **Notifications / Home Assistant.** ntfy was tested against a local fake server. Telegram, HA notify and HA power-cycle use their documented APIs but were not tested against real accounts. Use the *Invia notifica di prova* button.

- [ ] **Access control on your router.** Re-run `install.sh` to get plugin v2 (self-test line `access ...... ok`). Then pause one device and check it really loses internet, especially with flow offloading on.
  - Phones with *private Wi-Fi address* set to "rotating" (Android 15 / iOS 18 option) would escape a pause; the default "fixed per network" is fine.
  - In "only these devices" mode, check that Umbrel is marked *essential* (it is when its hostname contains "umbrel").

## 3. Decisions I made for you (easy to change)

- UI language: **Italian**, to match your mockup (code/comments in English).
- Download/Upload colours: **blue / magenta**. Your mockup's blue/violet pair fails colour-blind separation (ΔE 1.9).
- Default watchlist: countries CN, RU, KP, IR, HK; networks matching alibaba, aliyun, tencent, huawei, baidu, chinanet, china telecom/unicom/mobile, bytedance; alert threshold 100 KB/day per device.
- Retention **15 days**; watchdog **off** by default (5 min → restart WAN, +5 min → reboot, max 2 reboots / 6 h).
- Router/AdGuard/HA passwords are stored in the app's SQLite file inside Umbrel's app data. They are never sent back to the browser. The router user can only call the HomeNet plugin.
- Umbrel app proxy authentication protects the UI. HomeNet has no login of its own.

## Verified tonight
- Access control: plugin loads its nftables table on OpenWrt 23.05.5 and 24.10.4 containers; in a namespace lab (bridge LAN, Ethernet WAN, fw4-like stateful chain) pause drops traffic and deletes the device's conntrack entries, "only these devices" keeps the allowed device's downloads working, timed entries expire on their own, and the table survives an fw4 table reload.

- OpenWrt 23.05.5 + 24.10.4 containers: installer, every plugin method over HTTP and HTTPS (self-signed + redirect), ACL denies other ubus calls, wrong password error, `restart_wan` action reaches `ifup`, uninstall.
- The full HomeNet container running against the OpenWrt container: all router collectors green.
- AdGuard Home v0.107.57 and v1.0.0-b.1 containers: status, query log, paging, blocked/answer parsing, auth errors.
- `sms_tool` JSON format checked against its source; multipart SMS merge.
- Events log page (filters, pagination) and CSV export of destinations.
- 14 unit/integration tests (`npm test`), load benchmark (`npm run bench`), Docker image build + run as uid 1000, desktop + 390 px mobile layouts.
