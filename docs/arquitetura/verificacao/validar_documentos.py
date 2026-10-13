#!/usr/bin/env python3
"""Valida a consistência dos documentos de docs/arquitetura/ depois de editá-los.

Uso (na raiz do repositório):
    python docs/arquitetura/verificacao/validar_documentos.py
    PILOTO_INDEX_HTML=caminho/index.html python docs/arquitetura/verificacao/validar_documentos.py   # inclui o confronto com o motor do piloto

Verifica: colunas de cada tabela Markdown, cercas de código pareadas, referências §N do
documento principal, referências "Anexo X", perguntas Qn citadas que não têm linha na
tabela final, e se a contagem de verificações citada nos documentos é a que o script
verificar_numeros.py realmente imprime. Só lê arquivos.
"""
import io
import os
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
BASE = Path(__file__).resolve().parents[1]
NAMES = ("ARQUITETURA.md", "ANEXO_EVIDENCIAS.md")
docs = {n: io.open(BASE / n, encoding="utf-8").read().split("\n") for n in NAMES}
ok_all = True

for name, L in docs.items():
    bad = tables = i = 0
    while i < len(L):
        if L[i].startswith("|") and i + 1 < len(L) and re.match(r"^\|[\s:-]+\|", L[i + 1]):
            n, j = L[i].count("|"), i
            tables += 1
            while j < len(L) and L[j].startswith("|"):
                if L[j].count("|") != n:
                    bad += 1
                    print(f"  [tabela] {name} linha {j + 1}: {L[j].count('|')} separadores, esperado {n}")
                j += 1
            i = j
        else:
            i += 1
    fences = sum(1 for line in L if line.startswith("`" * 3))
    print(f"{name}: {len(L)} linhas, {tables} tabelas, {bad} divergentes, {fences} cercas (par={fences % 2 == 0})")
    ok_all &= bad == 0 and fences % 2 == 0

main, annex = "\n".join(docs[NAMES[0]]), "\n".join(docs[NAMES[1]])
secs = set(re.findall(r"^## (\d+)\.", main, flags=re.M)) | set(re.findall(r"^### (\d+\.\d+)", main, flags=re.M))
missing = sorted(r for r in set(re.findall(r"§(\d+(?:\.\d+)?)", main)) if r not in secs)
annex_secs = set(re.findall(r"^## ([A-Z])\.", annex, flags=re.M))
annex_refs = set(re.findall(r"Anexo ([A-Z])", main))
qs = set(re.findall(r"\bQ(\d+a?)\b", main))
table_qs = set(re.findall(r"^\| (Q\d+a?) \|", main, flags=re.M))
no_row = sorted(f"Q{q}" for q in qs if f"Q{q}" not in table_qs)
print("§ sem destino:", missing, "| anexo sem destino:", sorted(annex_refs - annex_secs), "| perguntas citadas sem linha na tabela:", no_row)
ok_all &= not missing and not (annex_refs - annex_secs) and not no_row


def run_script(env_extra=None):
    env = dict(os.environ)
    env.pop("PILOTO_INDEX_HTML", None)
    env.update(env_extra or {})
    out = subprocess.run([sys.executable, str(BASE / "verificacao" / "verificar_numeros.py")], capture_output=True, text=True, encoding="utf-8", env=env).stdout
    m = re.search(r"Resumo: (\d+) de (\d+)", out)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


without = run_script()
claim_main = re.search(r"\((\d+) verificações, (\d+) sem o piloto", main)
claim_annex = re.search(r"roda (\d+) verificações \((\d+) se receber", annex)
print("script sem o piloto:", without)
ok_all &= without[0] == without[1] and without[1] > 0
if claim_main and claim_annex:
    pilot_path = os.environ.get("PILOTO_INDEX_HTML")
    cm_with, cm_without = int(claim_main.group(1)), int(claim_main.group(2))
    ca_without, ca_with = int(claim_annex.group(1)), int(claim_annex.group(2))
    ok_all &= cm_without == without[1] and ca_without == without[1] and cm_with == ca_with
    if pilot_path and Path(pilot_path).exists():
        with_p = run_script({"PILOTO_INDEX_HTML": pilot_path})
        print("script com o piloto:", with_p)
        ok_all &= with_p[0] == with_p[1] and cm_with == with_p[1]
    else:
        print("  (contagem com o piloto não conferida: defina PILOTO_INDEX_HTML)")
    print(f"contagens citadas: principal {cm_with}/{cm_without}, anexo {ca_with}/{ca_without}")
else:
    print("  contagem de verificações não encontrada nos documentos")
    ok_all = False
print("OK" if ok_all else "REVISAR")
sys.exit(0 if ok_all else 1)
