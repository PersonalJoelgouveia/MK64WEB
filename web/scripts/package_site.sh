#!/usr/bin/env bash
# Copia os artefatos do build para ./game (servidos pelo GitHub Pages junto com index.html).
# Não inclui ROM nem mk64.o2r (este é gerado no navegador do usuário).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-$HERE/web/.build}"
OUT="$HERE/game"; SK="$WORK/SpaghettiKart"
mkdir -p "$OUT"
cp "$WORK/build-game/spaghetti_web.js" "$WORK/build-game/spaghetti_web.wasm" "$OUT/"
cp "$WORK/build-torch/torch.js" "$WORK/build-torch/torch.wasm" "$OUT/"
python3 "$HERE/web/scripts/pack_spaghetti.py" "$SK/assets" "$OUT/spaghetti.o2r"
python3 - "$SK" "$OUT/torch-assets.json" <<'PY'
import json, os, sys
sk, out = sys.argv[1], sys.argv[2]
files = {}
def add(rel):
    files[rel] = open(os.path.join(sk, rel), encoding='utf-8').read()
for root, _, fs in os.walk(os.path.join(sk, 'yamls')):
    for f in fs: add(os.path.relpath(os.path.join(root, f), sk))
for rel in ('config.yml', 'include/defines.h', 'meta/mods.toml'): add(rel)
json.dump(files, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(out, os.path.getsize(out), 'bytes,', len(files), 'arquivos')
PY
ls -la "$OUT"
