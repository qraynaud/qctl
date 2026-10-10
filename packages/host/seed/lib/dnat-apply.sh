#!/usr/bin/env bash
# Baked at seed time (Nunjucks over provision networking.ports) → /usr/local/lib/rocky/dnat-apply.sh.
# Run by the `start-services` platform stage between permanent firewalld service rules and
# `firewall-cmd --reload`. PublishPort DNAT → 127.0.0.1 (rootless Podman publish).
set -euo pipefail
{% set dnats = secrets.networking.ports | selectattr('dnat') | list %}
{% if dnats | length %}
cat >/etc/sysctl.d/90-rocky-route-localnet.conf <<'EOF_SYSCTL'
# Rocky: firewalld DNAT → 127.0.0.1 (rootless PublishPort); from networking.ports at seed.
net.ipv4.conf.all.route_localnet=1
net.ipv4.conf.default.route_localnet=1
EOF_SYSCTL
sysctl -p /etc/sysctl.d/90-rocky-route-localnet.conf >/dev/null
{% for p in dnats %}
firewall-cmd --permanent --remove-forward-port="port={{ p.port }}:proto=tcp:toport={{ p.dnat }}" 2>/dev/null || true
firewall-cmd --permanent --remove-forward-port="port={{ p.port }}:proto=tcp:toport={{ p.dnat }}:toaddr=127.0.0.1" 2>/dev/null || true
firewall-cmd --permanent --add-forward-port="port={{ p.port }}:proto=tcp:toport={{ p.dnat }}:toaddr=127.0.0.1"
{% endfor %}
{% else %}
# no networking.ports with dnat — nothing to forward
true
{% endif %}
