#!/usr/bin/env bash
# Stores Supabase CLI credentials OUTSIDE the repo, readable only by you,
# so the CLI never needs the macOS Keychain. Input is hidden and never echoed.
#
#   bash scripts/supabase-auth-setup.sh
#
# Creates ~/.config/signalforge/supabase.env (mode 600) with:
#   SUPABASE_ACCESS_TOKEN  personal access token (supabase.com/dashboard/account/tokens)
#   SUPABASE_DB_PASSWORD   the project's database password (optional; asked by `db push`)
set -euo pipefail

dir="$HOME/.config/signalforge"
file="$dir/supabase.env"
umask 077
mkdir -p "$dir"
chmod 700 "$dir"

# Pasting into a hidden prompt can add invisible characters: bracketed-paste
# markers (ESC[200~ … ESC[201~), carriage returns, spaces. Strip them.
clean() {
  local s="$1"
  s="${s//$'\e[200~'/}"
  s="${s//$'\e[201~'/}"
  s="${s//[[:space:]]/}"
  printf '%s' "$s" | LC_ALL=C tr -cd '[:print:]'
}

read -r -s -p "Supabase access token (input hidden): " raw; echo
token="$(clean "$raw")"
unset raw
if [[ ! "$token" =~ ^sbp_[A-Za-z0-9_]{20,}$ ]]; then
  # Describe the problem without revealing the value.
  echo "Not saved: expected a token starting with sbp_ (got ${#token} characters, starting with '${token:0:4}')." >&2
  exit 1
fi
read -r -s -p "Database password (input hidden; Enter to skip): " rawpw; echo
# Passwords may contain spaces, so only remove paste markers and line endings.
dbpw="${rawpw//$'\e[200~'/}"; dbpw="${dbpw//$'\e[201~'/}"; dbpw="${dbpw%$'\r'}"
unset rawpw

tmp="$(mktemp "$dir/.supabase.env.XXXXXX")"
{
  printf 'SUPABASE_ACCESS_TOKEN=%q\n' "$token"
  [[ -n "$dbpw" ]] && printf 'SUPABASE_DB_PASSWORD=%q\n' "$dbpw"
} > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$file"
unset token dbpw
echo "Saved to $file (only your user can read it)."
