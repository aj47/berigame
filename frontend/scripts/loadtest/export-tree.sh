#!/usr/bin/env bash
# Export a git revision into a scratch directory so it can be load-tested in
# isolation from a working tree that other people are editing:
#   - the module (spacetimedb/, shared/) and the matching client bindings,
#   - this harness copied in (plus shared/sim/interest.ts and src/spacetime/playerView.ts if the revision predates them),
#   - node_modules symlinked from this checkout,
#   - optionally MAX_ONLINE_PLAYERS raised so the admission cap is not what you measure.
#
# usage: scripts/loadtest/export-tree.sh <rev> <dir> [max_online]
# then:  (cd <dir>/spacetimedb && spacetime publish <db> --server local --yes)
#        (cd <dir>/frontend && npx tsx scripts/loadtest/run.ts --db <db> --n 250)
set -euo pipefail
rev=${1:?rev}; dir=${2:?dir}; cap=${3:-}
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
rm -rf "$dir"; mkdir -p "$dir"
git -C "$root" archive "$rev" spacetimedb shared frontend/src/module_bindings frontend/package.json | tar -x -C "$dir"
ln -s "$root/frontend/node_modules" "$dir/frontend/node_modules"
ln -s "$root/spacetimedb/node_modules" "$dir/spacetimedb/node_modules"
mkdir -p "$dir/frontend/scripts/loadtest"
cp "$root"/frontend/scripts/loadtest/*.ts "$dir/frontend/scripts/loadtest/"
[ -f "$dir/shared/sim/interest.ts" ] || cp "$root/shared/sim/interest.ts" "$dir/shared/sim/interest.ts"
mkdir -p "$dir/frontend/src/spacetime"
[ -f "$dir/frontend/src/spacetime/playerView.ts" ] || cp "$root/frontend/src/spacetime/playerView.ts" "$dir/frontend/src/spacetime/playerView.ts"
if [ -n "$cap" ]; then
  sed -i.bak -E "s/MAX_ONLINE_PLAYERS = [0-9_]+/MAX_ONLINE_PLAYERS = $cap/" "$dir/shared/sim/admission.ts" && rm "$dir/shared/sim/admission.ts.bak"
fi
echo "exported $(git -C "$root" rev-parse --short "$rev") to $dir$( [ -n "$cap" ] && echo " (MAX_ONLINE_PLAYERS=$cap)")"
