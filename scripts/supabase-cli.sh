#!/usr/bin/env bash
# Runs the Supabase CLI with credentials from ~/.config/signalforge/supabase.env
# (see supabase-auth-setup.sh) instead of the macOS Keychain, after checking the
# linked project is the one this app's .env.local points at.
#
#   bash scripts/supabase-cli.sh db push --dry-run
#   bash scripts/supabase-cli.sh db push
#
# Credentials are passed only as environment variables to the CLI process;
# nothing is printed or written to the repo.
set -euo pipefail
cd "$(dirname "$0")/.."

file="$HOME/.config/signalforge/supabase.env"
if [[ ! -f "$file" ]]; then
  echo "No credentials file. Run: bash scripts/supabase-auth-setup.sh" >&2
  exit 1
fi
perm="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file")"
if [[ "$perm" != "600" ]]; then
  echo "$file must be readable only by you (chmod 600 \"$file\")." >&2
  exit 1
fi

linked="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
app="$(sed -nE 's#^NEXT_PUBLIC_SUPABASE_URL=.*https://([a-z0-9]+)\.supabase\.co.*#\1#p' .env.local 2>/dev/null | head -1)"
if [[ -z "$linked" || -z "$app" || "$linked" != "$app" ]]; then
  echo "Refusing to run: linked project '${linked:-none}' is not the app's project '${app:-unknown}' from .env.local." >&2
  exit 1
fi
echo "Linked project: $linked (matches .env.local)"

set -a
# shellcheck disable=SC1090
source "$file"
set +a
exec npx --yes supabase@2.121.0 "$@"
