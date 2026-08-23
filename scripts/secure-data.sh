#!/usr/bin/env bash
#
# One-off migration: get the server's data directory out of the git checkout, rotate the
# secrets that were committed to this repository, and remove the account that came with them.
#
#   sudo ./scripts/secure-data.sh                    # do it
#   sudo ./scripts/secure-data.sh --dry-run          # say what it would do, change nothing
#   sudo ./scripts/secure-data.sh --admin <id>       # also grant that profile the admin panel
#   sudo ./scripts/secure-data.sh --keep-stray       # leave the imported account in place
#
# WHY THIS EXISTS
#
# The repository's first commit included data/ — db.json, secret and vapid.json. `secret`
# signs session cookies and the API only generates one when the file is absent, so every
# deployment cloned from here has been signing sessions with a value that is in a git
# repository. db.json brought the importing author's account and their registered passkey
# along with it, and that credential authenticates against any server whose db.json
# descends from the clone.
#
# WHAT IT DOES, IN ORDER
#
#   1. backs the whole data directory up to a tarball outside the checkout
#   2. stops the stack
#   3. moves data/ to DATA_DIR (default /var/lib/opengym) and points .env at it
#   4. pulls, which is what untracks data/ — a pull without step 3 aborts
#   5. deletes secret and vapid.json IF they still match the ones in git; the server
#      writes fresh ones on start
#   6. removes the imported account and its credential, unless --keep-stray
#   7. starts the stack and checks it came back
#
# Safe to run twice: every step tests for its own end state first. The tarball in step 1 is
# written every time regardless, and nothing is deleted before it exists.

set -euo pipefail

# SHA-256 of the three files as they are committed in 3efe375. Hashes, so this script can
# tell "still the leaked one" from "already rotated" without holding a secret itself, and
# without needing the git history to still be there.
LEAKED_SECRET=72bb661b20b167f89ff7bc4e6e5a08a27e8359dc48877a5843e9c05a64ba7534
LEAKED_VAPID=28fba8be9d3331795d944c747d9f0efa121033fe468122422882b725289cd7b3
STRAY_UID=piYdx5GveQarq8u9

DEFAULT_TARGET=/var/lib/opengym
DRY=0; KEEP_STRAY=0; ADMIN_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --keep-stray) KEEP_STRAY=1 ;;
    --admin) ADMIN_ID="${2:-}"; shift ;;
    --target) DEFAULT_TARGET="${2:-}"; shift ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "okänd flagga: $1" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
skip() { printf '  · %s\n' "$*"; }
warn() { printf '  ⚠ %s\n' "$*"; }
die()  { printf '\n✗ %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  [torrkörning] %s\n' "$*"; else eval "$@"; fi; }

# A failure halfway leaves the app stopped and the data moved. That is recoverable — every
# step tests for its own end state, so re-running picks up where this stopped — but nobody
# should have to work that out from a bare stack trace with their server down.
STAGE="uppstart"
on_err() {
  printf '\n\033[1m✗ Avbröts under: %s\033[0m\n' "$STAGE" >&2
  printf '  Ingenting är förlorat. Säkerhetskopian ligger kvar:\n    %s\n' "${TAR:-(hann inte skapas)}" >&2
  printf '  Åtgärda felet ovan och kör om skriptet — det hoppar över det som redan är gjort.\n' >&2
  printf '  Är appen nere och du vill ha upp den nu:  sudo docker compose up -d\n' >&2
}
trap on_err ERR

# The repo root is found from where you are standing, not from where this file is, because
# the file cannot be in the checkout yet: it arrives with the very pull that step 4 makes,
# and that pull is exactly what will not run until step 3 has moved data/ out of the way.
# So it is meant to be fetched to /tmp and run from inside the checkout. See the runbook.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$ROOT" ] || ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
[ -f docker-compose.yml ] || die "stå i openGym-checkouten när du kör det här (hittar ingen docker-compose.yml i $ROOT)"
[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || die "kör med sudo — filerna ägs av root"
command -v docker >/dev/null || die "docker saknas"

# Where the data lives now, and where it should end up.
TARGET=$(grep -E '^DATA_DIR=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
TARGET=${TARGET:-$DEFAULT_TARGET}
if [ -d "$ROOT/data" ]; then SRC="$ROOT/data"; else SRC="$TARGET"; fi
[ -d "$SRC" ] || die "hittar ingen datakatalog, varken $ROOT/data eller $TARGET"

# Where to read the files from when inspecting them: after the move that is TARGET, but a
# dry run has not moved anything, so it must look at SRC or it will report an empty server.
LIVE=$TARGET; [ "$DRY" = 1 ] && LIVE=$SRC

say "openGym · säkra datakatalogen"
say "  checkout : $ROOT"
say "  data nu  : $SRC"
say "  data sen : $TARGET"
if [ "$DRY" = 1 ]; then say "  läge     : TORRKÖRNING — ingenting ändras"; fi

# ------------------------------------------------------------- 0. preflight --
# Every reason this run could fail, checked while the app is still up and the data is still
# where it was. The first attempt at this script found out that the pull was impossible only
# after it had stopped the stack and moved the data — which is a fine state to recover from
# and a terrible one to discover.
STAGE="förkontroll"
step "0. Förkontroll"

DIRTY=$(git -C "$ROOT" status --porcelain | grep -v '^.. data/' || true)
if [ -n "$DIRTY" ]; then
  say "$DIRTY"
  die "checkouten har lokala ändringar utanför data/. Committa eller släng dem först — skriptet vill inte gissa vad de är."
fi
ok "inga lokala ändringar utanför data/"

BRANCH=$(git -C "$ROOT" symbolic-ref --short -q HEAD || true)
[ -n "$BRANCH" ] || die "checkouten står inte på någon gren (detached HEAD). Kör:  git checkout <gren>"
UPSTREAM=$(git -C "$ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
[ -n "$UPSTREAM" ] || die "grenen $BRANCH följer ingen fjärrgren. Kör:  git branch --set-upstream-to=origin/$BRANCH"
ok "på $BRANCH, följer $UPSTREAM"

if [ "$DRY" = 0 ]; then
  git -C "$ROOT" fetch --quiet "${UPSTREAM%%/*}" "${UPSTREAM#*/}" \
    || die "kunde inte nå fjärren. Kolla nätet och kör om — ingenting har rörts."
fi
ok "fjärren nås"

if ! git -C "$ROOT" merge-base --is-ancestor HEAD FETCH_HEAD 2>/dev/null; then
  warn "din gren ligger inte rakt bakom fjärren — pullen i steg 4 kan bli en merge"
else
  ok "pullen blir en ren framspolning"
fi

# ---------------------------------------------------------------- 1. backup --
STAGE="säkerhetskopian"
step "1. Säkerhetskopia"
TAR="$(cd "$ROOT/.." && pwd)/opengym-data-$(date +%F-%H%M).tar.gz"
run "tar czf '$TAR' -C '$(dirname "$SRC")' '$(basename "$SRC")'"
if [ "$DRY" = 0 ]; then
  [ -s "$TAR" ] || die "säkerhetskopian blev tom — avbryter innan något rörs"
  ok "$(du -h "$TAR" | cut -f1) → $TAR"
fi

# ------------------------------------------------------------------ 2. stop --
STAGE="att stoppa appen"
step "2. Stoppa appen"
run "docker compose down"
ok "stoppad"

# ------------------------------------------------------------------ 3. move --
STAGE="flytten av data"
step "3. Flytta data ut ur checkouten"
if [ "$SRC" = "$TARGET" ]; then
  skip "ligger redan på $TARGET"
else
  run "mkdir -p '$TARGET'"
  run "cp -a '$SRC/.' '$TARGET/'"
  if [ "$DRY" = 0 ]; then
    # Never delete the original until the copy is provably complete.
    A=$(find "$SRC" -type f | wc -l); B=$(find "$TARGET" -type f | wc -l)
    [ "$B" -ge "$A" ] || die "kopian har $B filer mot originalets $A — rör inte originalet"
    if [ -f "$SRC/db.json" ]; then
      cmp -s "$SRC/db.json" "$TARGET/db.json" || die "db.json skiljer sig efter kopiering — avbryter"
    fi
    ok "$A filer kopierade och verifierade"
  fi
  run "rm -rf '$SRC'"
  ok "data/ borta ur checkouten"
fi
if grep -qE '^DATA_DIR=' .env 2>/dev/null; then
  skip "DATA_DIR står redan i .env"
else
  run "printf 'DATA_DIR=%s\n' '$TARGET' >> '$ROOT/.env'"
  ok "DATA_DIR=$TARGET skrivet till .env"
fi

# ------------------------------------------------------------------ 4. pull --
STAGE="git pull"
step "4. Hämta ändringen som slutar spåra data/"
if git -C "$ROOT" ls-files --error-unmatch data/secret >/dev/null 2>&1; then
  run "git -C '$ROOT' merge --ff-only FETCH_HEAD"
  ok "hämtat"
else
  skip "data/ spåras inte längre"
fi

# ---------------------------------------------------------------- 5. rotate --
STAGE="rotationen"
step "5. Rotera hemligheterna"
rotate() {   # $1 = filename, $2 = the hash it has while still leaked
  local f="$LIVE/$1"
  if [ ! -f "$f" ]; then skip "$1 finns inte — servern skriver en ny"; return; fi
  local h; h=$(sha256sum "$f" | cut -d' ' -f1)
  if [ "$h" = "$2" ]; then
    run "rm -f '$f'"
    ok "$1 var den som låg i git — borttagen, servern skriver en ny vid start"
  else
    skip "$1 är redan en annan än den i git — lämnas"
  fi
}
rotate secret "$LEAKED_SECRET"
rotate vapid.json "$LEAKED_VAPID"

# ----------------------------------------------------------------- 6. stray --
STAGE="kontogenomgången"
step "6. Kontot som följde med repot"
DB="$LIVE/db.json"
if [ ! -f "$DB" ]; then
  skip "ingen db.json ännu"
else
  python3 - "$DB" "$STRAY_UID" "$KEEP_STRAY" "$DRY" <<'PY'
import json, shutil, sys
db, stray, keep, dry = sys.argv[1], sys.argv[2], sys.argv[3] == '1', sys.argv[4] == '1'
d = json.load(open(db))
users, creds = d.get('users', []), d.get('creds', [])
print('  konton på servern:')
for u in users:
    n = sum(1 for c in creds if c.get('userId') == u['id'])
    mark = '  ← följde med repot' if u['id'] == stray else ''
    print(f"    {u.get('name','?'):<16} {u['id']:<18} {n} nyckel/-lar{mark}")
if not any(u['id'] == stray for u in users):
    print('  · kontot från repot finns inte här — inget att göra')
    raise SystemExit
if keep:
    print('  ⚠ --keep-stray angivet — kontot lämnas kvar och dess passkey fungerar')
    raise SystemExit
if dry:
    print('  [torrkörning] hade tagit bort kontot och dess nyckel')
    raise SystemExit
shutil.copy(db, db + '.bak')
d['users'] = [u for u in users if u['id'] != stray]
d['creds'] = [c for c in creds if c.get('userId') != stray]
d['subs'] = [s for s in d.get('subs', []) if s.get('userId') != stray]
json.dump(d, open(db, 'w'), indent=2)
print(f'  ✓ borttaget. Kopia före ändringen: {db}.bak')
PY
  if [ "$DRY" = 0 ] && [ -f "$LIVE/state-$STRAY_UID.json" ]; then
    run "rm -f '$LIVE/state-$STRAY_UID.json'"
    ok "dess träningsdata borttagen"
  fi
fi

# ----------------------------------------------------------------- 7. admin --
STAGE="adminuppsättningen"
step "7. Adminpanelen"
if [ -n "$ADMIN_ID" ]; then
  if grep -qE '^ADMIN_UIDS=' .env 2>/dev/null; then
    skip "ADMIN_UIDS står redan i .env — ändra den för hand om du vill byta"
  else
    run "printf 'ADMIN_UIDS=%s\n' '$ADMIN_ID' >> '$ROOT/.env'"
    ok "ADMIN_UIDS=$ADMIN_ID skrivet till .env"
  fi
elif grep -qE '^ADMIN_UIDS=' .env 2>/dev/null; then
  skip "ADMIN_UIDS står redan i .env"
elif [ -f "$DB" ]; then
  # One account left is the ordinary case on a family instance, and asking someone to copy
  # their own id out of a list of one is a step that exists only to be skipped.
  #
  # Counted without the stray, which step 6 has already removed in a real run and would
  # have removed in a dry one — otherwise the dry run predicts an outcome the real run
  # will not produce, which is the one thing a dry run must never do.
  read -r N ID NAME <<EOF
$(python3 -c "
import json
d = json.load(open('$DB'))
us = [u for u in d.get('users', []) if $KEEP_STRAY or u['id'] != '$STRAY_UID']
print(len(us), us[0]['id'] if us else '-', (us[0].get('name') or '?') if us else '-')
" 2>/dev/null || echo "0 - -")
EOF
  if [ "$N" = 1 ]; then
    run "printf 'ADMIN_UIDS=%s\n' '$ID' >> '$ROOT/.env'"
    ok "ett konto på servern ($NAME) — det fick adminpanelen"
  else
    warn "$N konton på servern. Kör om med:  sudo $0 --admin <profil-id>"
    warn "Profil-id står i kontoraden högst upp i Inställningar, och kopieras när du trycker."
  fi
fi

# ------------------------------------------------------------------ 8. start --
STAGE="starten"
step "8. Starta"
run "docker compose up -d --build"
if [ "$DRY" = 0 ]; then
  sleep 4
  docker compose ps --format '  {{.Service}}: {{.Status}}' 2>/dev/null || true
  [ -s "$TARGET/secret" ] && ok "servern har skrivit en ny secret ($(stat -c '%a' "$TARGET/secret"))" \
    || warn "ingen ny secret ännu — kolla  docker compose logs api"
fi

step "Klart"
say "  · Du är utloggad. Logga in med din passkey igen — den fungerar, det var sessionen som bröts."
say "  · Adminpanelen ligger under ditt namn i Inställningar."
say "  · Säkerhetskopian: $TAR"
say "  · data/ ligger nu på $TARGET och kan aldrig mer röras av ett git pull."
