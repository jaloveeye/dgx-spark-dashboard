#!/usr/bin/env bash
set -euo pipefail

umask 077
cert_dir="${TLS_CERT_DIR:-$PWD/data/tls}"
cert_file="$cert_dir/fullchain.pem"
key_file="$cert_dir/privkey.pem"
valid_days="${TLS_CERT_DAYS:-90}"
renew_before_days="${TLS_RENEW_BEFORE_DAYS:-30}"
renew_before_seconds=$((renew_before_days * 86400))

mkdir -p "$cert_dir"
if [[ -s "$cert_file" && -s "$key_file" ]] && openssl x509 -checkend "$renew_before_seconds" -noout -in "$cert_file" >/dev/null 2>&1; then
  echo "Self-signed certificate is still valid for more than ${renew_before_days} days."
  exit 0
fi

short_hostname="$(hostname)"
full_hostname="$(hostname -f 2>/dev/null || hostname)"
subject_alt_names="DNS:${short_hostname}"
if [[ "$full_hostname" != "$short_hostname" ]]; then
  subject_alt_names+=",DNS:${full_hostname}"
fi
subject_alt_names+=",DNS:${short_hostname}.local,IP:127.0.0.1"
for address in $(hostname -I 2>/dev/null); do
  subject_alt_names+=",IP:${address}"
done

temporary_dir="$(mktemp -d "$cert_dir/.renew.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT

openssl req -x509 -newkey rsa:3072 -sha256 -nodes   -days "$valid_days"   -subj "/CN=${short_hostname}"   -addext "subjectAltName=${subject_alt_names}"   -addext "keyUsage=critical,digitalSignature,keyEncipherment"   -addext "extendedKeyUsage=serverAuth"   -keyout "$temporary_dir/privkey.pem"   -out "$temporary_dir/fullchain.pem"

chmod 600 "$temporary_dir/privkey.pem"
chmod 644 "$temporary_dir/fullchain.pem"
mv "$temporary_dir/privkey.pem" "$key_file"
mv "$temporary_dir/fullchain.pem" "$cert_file"
echo "Renewed self-signed certificate for ${subject_alt_names}."

if [[ -n "${TLS_RESTART_SERVICE:-}" ]] && systemctl --user is-active --quiet "$TLS_RESTART_SERVICE"; then
  systemctl --user restart "$TLS_RESTART_SERVICE"
  echo "Restarted ${TLS_RESTART_SERVICE}."
fi
