"""Guarda de publicacao: confere data/dados.json e data/detalhe-mes.json.

Os valores esperados vem da leitura independente do BI e sao passados na linha
de comando, para o guard nunca validar contra si mesmo:

    python verifica.py --dia 28 --pct 0.98 --total 3754706.75
"""
import argparse
import json
import sys

p = argparse.ArgumentParser()
p.add_argument("--dia", type=int, required=True, help="ultimo dia com dados")
p.add_argument("--pct", type=float, required=True, help="% oficial do Brasil (2 casas)")
p.add_argument("--total", type=float, required=True, help="perda acumulada do Brasil")
p.add_argument("--tol", type=float, default=1.0, help="tolerancia em R$")
a = p.parse_args()

d = json.load(open("data/dados.json", encoding="utf-8"))
m = d["mesAtual"]
erros = []

if m["ultimoDia"] != a.dia:
    erros.append(f"ultimoDia={m['ultimoDia']} esperado {a.dia}")
if m["pctTotal"] != a.pct:
    erros.append(f"pctTotal={m['pctTotal']} esperado {a.pct}")

soma_brasil = round(sum(v for v in m["brasilVals"] if v is not None), 2)
soma_acum = round(sum(e["acum"] for e in m["extra"].values()), 2)
mensal = d["brasil2026"][m["mes"] - 1]

if abs(soma_brasil - soma_acum) > a.tol:
    erros.append(f"brasilVals {soma_brasil} != extra.acum {soma_acum}")
if abs(soma_acum - mensal) > a.tol:
    erros.append(f"extra.acum {soma_acum} != brasil2026 {mensal}")
if abs(soma_acum - a.total) > a.tol:
    erros.append(f"total {soma_acum} != esperado {a.total}")

dias = len([v for v in m["brasilVals"] if v is not None])
if dias != a.dia:
    erros.append(f"{dias} dias com dados, esperado {a.dia}")

det = json.load(open("data/detalhe-mes.json", encoding="utf-8"))
if len(det) != 11:
    erros.append(f"detalhe tem {len(det)} regionais, esperado 11")
soma_det = round(sum(v["totalPerda"] for v in det.values()), 2)
if abs(soma_det - a.total) > a.tol:
    erros.append(f"detalhe soma {soma_det} != esperado {a.total}")

print(f"ultimoDia={m['ultimoDia']} atualizadoEm={m['atualizadoEm']} pctTotal={m['pctTotal']}")
print(f"brasilVals={soma_brasil} extra.acum={soma_acum} mensal={mensal} "
      f"detalhe={soma_det} dias={dias}")

if erros:
    print("VALIDACAO FALHOU:")
    for e in erros:
        print("  -", e)
    sys.exit(1)

print("VALIDACAO OK")
