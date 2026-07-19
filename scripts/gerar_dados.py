#!/usr/bin/env python3
"""
Gera data/dados.json e data/detalhe-jul.json a partir do Excel exportado do BI
(Power BI -> Export data, aba "Export": Marca, Diretoria, Regional, BKN, Loja,
Data, Hora, Canal, Motivo, Subcategoria, Chamados, Perda de receita) e dos
percentuais oficiais (%) lidos na tela do BI para cada regional + Brasil Total.

Uso:
    python3 scripts/gerar_dados.py --excel caminho/arquivo.xlsx --pct pct.json

pct.json tem o formato:
    {
      "BK É FOGO NORTE": 0.8,
      "BK É FOGO LESTE": 0.8,
      "SP CENTRO LITORAL": 1.4,
      "SP SUL": 1.8,
      "SP INTERIOR NORTE": 0.6,
      "SP INTERIOR SUL": 0.6,
      "CENTRO OESTE": 1.0,
      "MINAS BAHIA": 0.7,
      "NE": 0.7,
      "RJ": 0.8,
      "SUL": 0.9,
      "BRASIL": 0.88
    }

O script:
  1. Lê o data/dados.json atual (ciclo anterior) e usa os valores de julExtraData/
     pctTotalJul dele para montar automaticamente `julAnterior` (equivalente à
     antiga "Fase 0" manual do prompt mestre).
  2. Lê o Excel e agrega por Regional+Data (valores em R$) e por Regional+Data+
     Hora+Loja+Subcategoria+Chamados (detalhamento).
  3. Aplica os percentuais oficiais informados.
  4. Atualiza a aba Mensal (regionaisData[reg]['2026'][mes] e brasil2026[mes]).
  5. Valida consistência (somas batendo) antes de gravar.
  6. Grava data/dados.json e data/detalhe-jul.json.
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DADOS_PATH = ROOT / "data" / "dados.json"
DETALHE_PATH = ROOT / "data" / "detalhe-jul.json"

MES_ATUAL = "Jul"
MES_IDX = 6  # Jul = índice 6 (Jan=0)
DIAS_NO_MES = 31

LABEL_REG = {"SP CENTRO LITORAL": "BK É FOGO CENTRO LITORAL"}
REVERSE_LABEL = {v: k for k, v in LABEL_REG.items()}


def normaliza_regional(nome):
    """Aceita tanto a chave interna (SP CENTRO LITORAL) quanto o nome exibido
    no BI (BK É FOGO CENTRO LITORAL)."""
    return REVERSE_LABEL.get(nome, nome)


def ler_excel(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True)
    ws = wb["Export"]
    linhas = []
    for r in range(2, ws.max_row + 1):
        regional = ws.cell(row=r, column=3).value
        bkn = ws.cell(row=r, column=4).value
        loja = ws.cell(row=r, column=5).value
        data = ws.cell(row=r, column=6).value
        hora = ws.cell(row=r, column=7).value
        canal = ws.cell(row=r, column=8).value
        subcat = ws.cell(row=r, column=10).value
        chamados = ws.cell(row=r, column=11).value
        perda = ws.cell(row=r, column=12).value
        if regional is None or data is None:
            continue
        linhas.append({
            "regional": normaliza_regional(regional),
            "bkn": str(bkn) if bkn is not None else "",
            "loja": loja or "",
            "data": data.date(),
            "hora": int(hora) if hora is not None else None,
            "canal": canal or "",
            "cat": subcat or "",
            "chamado": chamados or "",
            "perda": float(perda) if perda is not None else 0.0,
        })
    return linhas


def build_lojas(linhas):
    agg = {}
    for l in linhas:
        k = (l["bkn"], l["loja"])
        if k not in agg:
            agg[k] = {"bkn": l["bkn"], "nome": l["loja"], "perda": 0.0, "oc": 0}
        agg[k]["perda"] += l["perda"]
        agg[k]["oc"] += 1
    out = list(agg.values())
    out.sort(key=lambda x: -x["perda"])
    return out


def build_cats(linhas):
    agg = {}
    for l in linhas:
        k = l["cat"] or "Outros"
        if k not in agg:
            agg[k] = {"nome": k, "perda": 0.0, "oc": 0}
        agg[k]["perda"] += l["perda"]
        agg[k]["oc"] += 1
    out = list(agg.values())
    out.sort(key=lambda x: -x["perda"])
    return out


def build_horas(linhas):
    agg = defaultdict(float)
    for l in linhas:
        if l["hora"] is not None:
            agg[str(l["hora"])] += l["perda"]
    return dict(agg)


def build_ocs(linhas):
    ocs = []
    for l in linhas:
        ocs.append({
            "hora": l["hora"],
            "loja": l["loja"],
            "cat": l["cat"],
            "chamado": l["chamado"],
            "perda": round(l["perda"], 2),
        })
    return ocs


def build_det_agg(linhas):
    por_regional = defaultdict(list)
    for l in linhas:
        por_regional[l["regional"]].append(l)

    det = {}
    for reg, itens in por_regional.items():
        total_perda = sum(i["perda"] for i in itens)
        datas = sorted(set(i["data"] for i in itens))
        por_dia = {}
        for d in datas:
            do_dia = [i for i in itens if i["data"] == d]
            por_dia[d.isoformat()] = {
                "total": round(sum(i["perda"] for i in do_dia), 2),
                "oc": len(do_dia),
                "cats": build_cats(do_dia),
                "lojas": build_lojas(do_dia),
                "horas": build_horas(do_dia),
                "ocs": build_ocs(do_dia),
            }
        det[reg] = {
            "totalPerda": round(total_perda, 2),
            "oc": len(itens),
            "lojas": build_lojas(itens),
            "cats": build_cats(itens),
            "porDia": por_dia,
            "periodo": {"min": datas[0].isoformat(), "max": datas[-1].isoformat()},
        }
    return det


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--excel", required=True)
    ap.add_argument("--pct", required=True, help="Caminho para JSON com os % oficiais")
    ap.add_argument("--dry-run", action="store_true", help="Não grava arquivos, só valida e mostra o resumo")
    args = ap.parse_args()

    with open(DADOS_PATH) as f:
        dados = json.load(f)
    with open(args.pct) as f:
        pct_raw = json.load(f)

    pct = {normaliza_regional(k): v for k, v in pct_raw.items() if k != "BRASIL"}
    pct_brasil = pct_raw["BRASIL"]

    linhas = ler_excel(args.excel)
    if not linhas:
        sys.exit("Excel sem linhas válidas")

    reg_names = list(dados["julExtraData"].keys())
    for r in reg_names:
        if r not in pct:
            sys.exit(f"Falta % oficial para regional: {r}")

    # ---- Fase 0 automática: snapshot do ciclo anterior ----
    jul_anterior = {
        "pctTotal": dados["pctTotalJul"],
        "regionais": {r: dados["julExtraData"][r]["pctMes"] for r in reg_names},
        "projFechamento": None,  # calculado abaixo com os dados ANTIGOS antes de sobrescrever
    }
    old_total_acum = sum(dados["julExtraData"][r]["acum"] for r in reg_names)
    old_dias_com_dados = len([v for v in dados["brasilJulVals"] if v is not None])
    if old_dias_com_dados > 0:
        media_antiga = old_total_acum / old_dias_com_dados
        jul_anterior["projFechamento"] = old_total_acum + media_antiga * (DIAS_NO_MES - old_dias_com_dados)
    else:
        jul_anterior["projFechamento"] = 0

    # ---- Agregação por Regional + Data ----
    por_regional_data = defaultdict(dict)
    for l in linhas:
        por_regional_data[l["regional"]].setdefault(l["data"], 0.0)
        por_regional_data[l["regional"]][l["data"]] += l["perda"]

    datas_presentes = sorted(set(l["data"] for l in linhas))
    ultimo_dia = datas_presentes[-1].day
    ano, mes = datas_presentes[-1].year, datas_presentes[-1].month
    for d in datas_presentes:
        if (d.year, d.month) != (ano, mes):
            sys.exit(f"Excel contém datas fora do mês corrente: {d}")

    # ---- julData / julExtraData ----
    jul_data = {}
    jul_extra = {}
    for reg in reg_names:
        valores_dia = por_regional_data.get(reg, {})
        arr = []
        for dia in range(1, DIAS_NO_MES + 1):
            try:
                data_dia = date(ano, mes, dia)
            except ValueError:
                arr.append(None)  # mês tem menos de 31 dias
                continue
            if dia <= ultimo_dia:
                arr.append(round(valores_dia.get(data_dia, 0.0), 2))
            else:
                arr.append(None)
        jul_data[reg] = arr

        acum = round(sum(v for v in arr if v is not None), 2)
        dia_ult = arr[ultimo_dia - 1] or 0.0
        acum_antes = round(acum - dia_ult, 2)
        old_extra = dados["julExtraData"][reg]
        rest = old_extra["rest"]
        jul_extra[reg] = {
            "rest": rest,
            "projVenda": old_extra["projVenda"],
            "objMes": old_extra["objMes"],
            "objDia": old_extra["objDia"],
            "diaUlt": round(dia_ult, 2),
            "acumAntes": acum_antes,
            "acum": acum,
            "perdaLoja": round(acum / rest, 2) if rest else 0,
            "pctMes": pct[reg],
        }

    brasil_jul_vals = []
    for dia in range(1, DIAS_NO_MES + 1):
        if dia <= ultimo_dia:
            total_dia = sum((jul_data[reg][dia - 1] or 0.0) for reg in reg_names)
            brasil_jul_vals.append(round(total_dia, 2))
        else:
            brasil_jul_vals.append(None)

    # ---- Validações (equivalente ao checklist do prompt mestre) ----
    soma_acum = round(sum(jul_extra[r]["acum"] for r in reg_names), 2)
    soma_brasil_vals = round(sum(v for v in brasil_jul_vals if v is not None), 2)
    if abs(soma_acum - soma_brasil_vals) > 1:
        sys.exit(f"Inconsistência: soma julExtraData.acum ({soma_acum}) != soma brasilJulVals ({soma_brasil_vals})")

    # ---- Atualiza aba Mensal ----
    regionais_data = dados["regionaisData"]
    for reg in reg_names:
        regionais_data[reg]["2026"][MES_IDX] = jul_extra[reg]["acum"]
    brasil2026 = dados["brasil2026"]
    brasil2026[MES_IDX] = soma_acum

    # ---- Monta dados.json final ----
    dados["julData"] = jul_data
    dados["julExtraData"] = jul_extra
    dados["julDias"] = list(range(1, DIAS_NO_MES + 1))
    dados["brasilJulVals"] = brasil_jul_vals
    dados["julAnterior"] = jul_anterior
    dados["pctTotalJul"] = pct_brasil
    dados["regionaisData"] = regionais_data
    dados["brasil2026"] = brasil2026
    dados["LABEL_REG"] = LABEL_REG
    dados["_meta"] = {
        "ultimoDiaJul": ultimo_dia,
        "atualizadoEm": datas_presentes[-1].isoformat(),
    }

    det_agg = build_det_agg(linhas)

    print(f"Último dia com dados: {ultimo_dia}/Jul")
    print(f"Total Brasil acumulado: R$ {soma_acum:,.2f}")
    print(f"% oficial Brasil: {pct_brasil}%")
    for reg in reg_names:
        print(f"  {reg:22s} acum=R$ {jul_extra[reg]['acum']:>12,.2f}  pct={jul_extra[reg]['pctMes']}%  diaUlt=R$ {jul_extra[reg]['diaUlt']:>10,.2f}")

    if args.dry_run:
        print("\n--dry-run: nada foi gravado.")
        return

    DADOS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DADOS_PATH, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))
    with open(DETALHE_PATH, "w", encoding="utf-8") as f:
        json.dump(det_agg, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nGravado: {DADOS_PATH}")
    print(f"Gravado: {DETALHE_PATH}")


if __name__ == "__main__":
    main()
