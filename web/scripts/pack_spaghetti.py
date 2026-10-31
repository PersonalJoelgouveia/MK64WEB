#!/usr/bin/env python3
"""Gera spaghetti.o2r (zip com o conteúdo de assets/ do SpaghettiKart), equivalente a `torch pack assets spaghetti.o2r o2r`.
Uso: pack_spaghetti.py <SpaghettiKart/assets> <saida.o2r>"""
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src).replace(os.sep, "/"))
print(out, os.path.getsize(out), "bytes")
