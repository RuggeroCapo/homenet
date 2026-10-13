#!/bin/sh
# HomeNet router setup for OpenWrt.
# Usage (from your computer):
#   scp -O router/* root@192.168.1.1:/tmp/
#   ssh root@192.168.1.1 sh /tmp/install.sh 'choose-a-password'
set -e
PASS="$1"
[ -n "$PASS" ] || { echo "usage: sh install.sh <password-for-the-homenet-rpc-user>"; exit 1; }
DIR=$(cd "$(dirname "$0")" && pwd)

if command -v apk >/dev/null 2>&1; then UPD="apk update"; ADD="apk add"; else UPD="opkg update"; ADD="opkg install"; fi
need=""
[ -e /usr/lib/uhttpd_ubus.so ] || need="$need uhttpd-mod-ubus"
command -v jsonfilter >/dev/null 2>&1 || need="$need jsonfilter"
# conntrack CLI: reads flows on kernels without /proc/net/nf_conntrack, and cuts the open
# connections of a paused device (offloaded connections skip the firewall otherwise)
command -v conntrack >/dev/null 2>&1 || need="$need conntrack"
if [ -n "$need" ]; then
	echo "Installing:$need"
	$UPD >/dev/null 2>&1 || true
	$ADD $need || echo "WARNING: could not install$need (no internet on the router?). Install them manually and re-run."
fi

mkdir -p /usr/libexec/rpcd /usr/share/rpcd/acl.d /etc/sysctl.d
cp "$DIR/homenet" /usr/libexec/rpcd/homenet
chmod 0755 /usr/libexec/rpcd/homenet
cp "$DIR/homenet.acl.json" /usr/share/rpcd/acl.d/homenet.json
[ -f /etc/homenet.conf ] || cp "$DIR/homenet.conf" /etc/homenet.conf
grep -q '^/etc/homenet.conf$' /etc/sysupgrade.conf 2>/dev/null || echo /etc/homenet.conf >> /etc/sysupgrade.conf

# Byte counters on conntrack entries (needed for per-device / per-destination traffic)
echo 'net.netfilter.nf_conntrack_acct=1' > /etc/sysctl.d/90-homenet.conf
sysctl -w net.netfilter.nf_conntrack_acct=1 >/dev/null 2>&1 || echo "WARNING: could not enable conntrack byte accounting now (applied at next boot)"

# Dedicated RPC login, limited to the "homenet" ubus object
uci -q delete rpcd.homenet || true
uci set rpcd.homenet=login
uci set rpcd.homenet.username=homenet
uci set rpcd.homenet.password="$(uhttpd -m "$PASS")"
uci add_list rpcd.homenet.read=homenet
uci add_list rpcd.homenet.write=homenet
uci commit rpcd

uci -q get uhttpd.main.ubus_prefix >/dev/null || { uci set uhttpd.main.ubus_prefix=/ubus; uci commit uhttpd; }

/etc/init.d/rpcd restart
sleep 1
/etc/init.d/uhttpd restart

echo
echo "HomeNet plugin installed. Self-test:"
ubus call homenet info >/dev/null && echo "  info ........ ok"
if ubus call homenet conntrack | grep -q '"error"'; then
	echo "  conntrack ... NOT AVAILABLE (install the 'conntrack' package): per-device traffic will be missing"
else
	echo "  conntrack ... ok"
fi
if ! command -v nft >/dev/null 2>&1; then
	echo "  access ...... NOT AVAILABLE (needs OpenWrt 22.03+ with fw4/nftables): pause and data caps will not work"
elif echo '{"block":"","allow":"","lock":"0","wan":""}' | /usr/libexec/rpcd/homenet call access | grep -q '"ok":true'; then
	echo "  access ...... ok"
else
	echo "  access ...... FAILED: $(echo '{}' | /usr/libexec/rpcd/homenet call access)"
fi
echo "  modem method: $(ubus call homenet modem | jsonfilter -e '@.method')"
if [ "$(uci -q get firewall.@defaults[0].flow_offloading)" = 1 ]; then
	echo
	echo "WARNING: firewall flow offloading is enabled. Offloaded connections may stop"
	echo "updating their byte counters, so per-device traffic can be under-reported."
fi
echo
echo "In HomeNet settings use: URL http://<router-ip>  user: homenet  password: <the one you chose>"
