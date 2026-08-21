#!/usr/bin/env python3
"""Converte pbi_raw/resumo-AAAAMMDD.json (gerado por scripts/pbi_extract.js) em
data/dados.json, no mesmo formato que gerar_dados.py produz a partir do Excel.

REGRA INVIOLAVEL (exigencia do usuario): pctTotal e os % por regional vem
SEMPRE do BI (lidos da tela pelo extrator), NUNCA recalculados aqui.

Detalhe por WO (data/detalhe-mes.json): NAO e' gerado aqui. A tabela
"Perda de receita detalhada" do BI nao expoe colunas confiaveis no innerText
(sem Regional/Loja/BKN visiveis), entao o detalhe continua sendo alimentado
via Excel (gerar_dados.py --excel ...) quando necessario. verifica.py deve
rodar com --sem-detalhe neste fluxo.

Uso:
    python scripts/pbi_to_dados.py                      # usa o resumo mais recente
    python scripts/pbi_to_dados.py --resumo pbi_raw/resumo-20260818.json
    python scripts/pbi_to_dados.py --dry-run
"""
import argparse
import calendar
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MES_NOMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

# Nome exibido no BI -> chave interna do dados.json (mesmo mapa do gerar_dados)
REVERSE_LABEL = {"BK É FOGO CENTRO LITORAL": "SP CENTRO LITORAL"}
# Chave interna -> nome exibido no BI
LABEL_REG = {v: k for k, v in REVERSE_LABEL.items()}


def para_chave_interna(nome_bi):
    return REVERSE_LABEL.get(nome_bi, nome_bi)


def para_nome_bi(chave_interna):
    return LABEL_REG.get(chave_interna, chave_interna)


def parse_dinheiro(txt):
    """'R$ 3,030,852' -> 3030852.0 (formato US do BI: virgula=milhar)."""
    s = str(txt).replace("R$", "").strip()
    if "," in s and "." in s:
        s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", "")
    return float(s)


def parse_data(txt):
    """'8/17/2026' -> date(2026, 8, 17) (M/D/YYYY do BI)."""
    m, d, a = str(txt).strip().split("/")
    return date(int(a), int(m), int(d))


def snapshot_anterior(mes_atual, reg_names):
    dias_no_mes = mes_atual["diasNoMes"]
    total_acum = sum(mes_atual["extra"][r]["acum"] for r in reg_names)
    dias_com_dados = len([v for v in mes_atual["brasilVals"] if v is not None])
    proj = total_acum + (total_acum / dias_com_dados) * (dias_no_mes - dias_com_dados) if dias_com_dados else 0
    return {
        "pctTotal": mes_atual["pctTotal"],
        "regionais": {r: mes_atual["extra"][r]["pctMes"] for r in reg_names},
        "projFechamento": proj,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--resumo", help="caminho do resumo-*.json (default: mais recente em pbi_raw)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dados_path = ROOT / "data" / "dados.json"

    if args.resumo:
        resumo_path = Path(args.resumo)
    else:
        candidatos = sorted((ROOT / "pbi_raw").glob("resumo-*.json"))
        if not candidatos:
            sys.exit("Nenhum pbi_raw/resumo-*.json encontrado")
        resumo_path = candidatos[-1]
    print(f"Resumo: {resumo_path}")

    with open(resumo_path, encoding="utf-8") as f:
        resumo = json.load(f)
    with open(dados_path, encoding="utf-8") as f:
        dados = json.load(f)

    # --- validacoes basicas do resumo ---
    for campo in ("perdaPorData", "total", "pctPorRegional", "perdaDiariaPorRegional"):
        if campo not in resumo or not resumo[campo]:
            sys.exit(f"resumo sem '{campo}' — rode o pbi_extract.js completo primeiro")
    if not resumo["total"].get("perdaTotal") or resumo["total"].get("pctTotal") is None:
        sys.exit("resumo.total incompleto")

    mes_atual = dados["mesAtual"]
    reg_names = list(mes_atual["extra"].keys())

    # --- mes/ano a partir das datas do resumo ---
    datas = [parse_data(r["data"]) for r in resumo["perdaPorData"]]
    ano, mes = datas[-1].year, datas[-1].month
    if any((d.year, d.month) != (ano, mes) for d in datas):
        sys.exit("resumo.perdaPorData mistura mais de um mês")
    ultimo_dia = datas[-1].day
    dias_no_mes = calendar.monthrange(ano, mes)[1]

    if (ano, mes) != (mes_atual["ano"], mes_atual["mes"]):
        sys.exit(
            f"O resumo traz {MES_NOMES[mes-1]}/{ano}, mas o mês corrente é "
            f"{mes_atual['nome']}/{mes_atual['ano']} — virada de mês NAO é automatizada "
            "(rodar gerar_dados.py --excel com --objetivos/--manter-objetivos)."
        )

    # --- % oficiais: SEMPRE do BI, nunca recalculados ---
    pct_bi = {para_chave_interna(k): v for k, v in resumo["pctPorRegional"].items()}
    faltantes = [r for r in reg_names if r not in pct_bi or pct_bi[r] is None]
    if faltantes:
        sys.exit(f"resumo.pctPorRegional sem as regionais: {faltantes}")
    pct_brasil = float(str(resumo["total"]["pctTotal"]).replace("%", ""))

    diaria_bi = {para_chave_interna(k): v for k, v in resumo["perdaDiariaPorRegional"].items()}

    # --- monta novo mesAtual ---
    novo_data, novo_extra = {}, {}
    for reg in reg_names:
        linhas = diaria_bi.get(reg)
        if not linhas:
            sys.exit(f"resumo.perdaDiariaPorRegional sem a regional: {reg} ({para_nome_bi(reg)})")
        por_dia = {parse_data(l["data"]).day: parse_dinheiro(l["perda"]) for l in linhas}
        arr = [round(por_dia.get(dia, 0.0), 2) if dia <= ultimo_dia else None
               for dia in range(1, dias_no_mes + 1)]
        novo_data[reg] = arr

        acum = round(sum(v for v in arr if v is not None), 2)
        dia_ult = arr[ultimo_dia - 1] or 0.0
        obj = mes_atual["extra"][reg]  # objetivos preservados
        novo_extra[reg] = {
            "rest": obj["rest"],
            "projVenda": obj["projVenda"],
            "objMes": obj["objMes"],
            "objDia": obj["objDia"],
            "diaUlt": round(dia_ult, 2),
            "acumAntes": round(acum - dia_ult, 2),
            "acum": acum,
            "perdaLoja": round(acum / obj["rest"], 2) if obj["rest"] else 0,
            "pctMes": pct_bi[reg],
        }

    # brasilVals = soma das regionais (consistencia interna, como gerar_dados.py)
    brasil_vals = [
        round(sum((novo_data[reg][dia - 1] or 0.0) for reg in reg_names), 2) if dia <= ultimo_dia else None
        for dia in range(1, dias_no_mes + 1)
    ]

    soma_acum = round(sum(novo_extra[r]["acum"] for r in reg_names), 2)
    soma_brasil = round(sum(v for v in brasil_vals if v is not None), 2)
    if abs(soma_acum - soma_brasil) > 1:
        sys.exit(f"Inconsistência: soma extra.acum ({soma_acum}) != soma brasilVals ({soma_brasil})")

    total_bi = parse_dinheiro(resumo["total"]["perdaTotal"])
    drift = round(soma_acum - total_bi, 2)
    if abs(drift) > 20:
        print(f"AVISO: soma das regionais ({soma_acum}) difere do Total do BI ({total_bi}) em R$ {drift} "
              "(arredondamento de exibicao do BI ou tabela incompleta)")

    anterior = snapshot_anterior(mes_atual, reg_names)

    mes_idx = mes - 1
    for reg in reg_names:
        dados["regionaisData"][reg]["2026"][mes_idx] = novo_extra[reg]["acum"]
    dados["brasil2026"][mes_idx] = soma_acum

    dados["mesAtual"] = {
        "ano": ano,
        "mes": mes,
        "nome": MES_NOMES[mes - 1],
        "diasNoMes": dias_no_mes,
        "metaDiaBrasil": mes_atual["metaDiaBrasil"],
        "pctTotal": pct_brasil,
        "ultimoDia": ultimo_dia,
        "atualizadoEm": datas[-1].isoformat(),
        "data": novo_data,
        "extra": novo_extra,
        "brasilVals": brasil_vals,
        "anterior": anterior,
    }

    print(f"Mês: {MES_NOMES[mes-1]}/{ano} — último dia com dados: {ultimo_dia}")
    print(f"Total Brasil acumulado (soma regionais): R$ {soma_acum:,.2f} | BI: R$ {total_bi:,.2f}")
    print(f"% oficial Brasil (do BI): {pct_brasil}%")
    for reg in reg_names:
        e = novo_extra[reg]
        print(f"  {reg:22s} acum=R$ {e['acum']:>12,.2f}  pct={e['pctMes']}%  diaUlt=R$ {e['diaUlt']:>10,.2f}")

    if args.dry_run:
        print("\n--dry-run: nada foi gravado.")
        return

    with open(dados_path, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nGravado: {dados_path}")
    print("NOTA: data/detalhe-mes.json NAO foi atualizado (detalhe por WO segue via Excel — "
          "gerar_dados.py --excel). Use verifica.py com --sem-detalhe.")


if __name__ == "__main__":
    main()
