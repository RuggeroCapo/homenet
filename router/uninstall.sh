#!/bin/sh
# Removes the HomeNet plugin, its RPC login and settings from OpenWrt.
rm -f /usr/libexec/rpcd/homenet /usr/share/rpcd/acl.d/homenet.json /etc/sysctl.d/90-homenet.conf
rm -rf /tmp/homenet
uci -q delete rpcd.homenet && uci commit rpcd
sed -i '\#^/etc/homenet.conf$#d' /etc/sysupgrade.conf 2>/dev/null
echo "Keep /etc/homenet.conf? It is left in place; delete it manually if you want."
/etc/init.d/rpcd restart
echo "HomeNet plugin removed."
