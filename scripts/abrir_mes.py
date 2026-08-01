#!/usr/bin/env python3
"""Abre um mes novo no dashboard so com as metas, antes do primeiro lancamento.

Arquiva o mes corrente no historico e cria o novo com objetivos preenchidos e
resultados zerados: `ultimoDia` = 0, todos os dias em null, `acum` = 0.

Produz exatamente a mesma estrutura que scripts/gerar_dados.py produziria, de
modo que a primeira rodada real do mes seja tratada como um dia comum e nao
como virada — os objetivos ja estarao em mesAtual.extra.

Uso:
    python scripts/abrir_mes.py --ano 2026 --mes 8 --objetivos objetivos_agosto.json
    python scripts/abrir_mes.py --ano 2026 --mes 8 --objetivos ... --dry-run
"""
import argparse
import calendar
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MES_NOMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
             "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def normaliza_regional(nome):
    """Mesmo mapeamento de exibicao -> interno usado por gerar_dados.py."""
    n = (nome or "").strip().upper()
    return {"BK É FOGO CENTRO LITORAL": "SP CENTRO LITORAL"}.get(n, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, required=True)
    ap.add_argument("--mes", type=int, required=True)
    ap.add_argument("--objetivos", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    caminho = ROOT / "data" / "dados.json"
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    mes_atual = dados["mesAtual"]
    reg_names = list(mes_atual["extra"].keys())

    if (args.ano, args.mes) <= (mes_atual["ano"], mes_atual["mes"]):
        sys.exit(f"{MES_NOMES[args.mes-1]}/{args.ano} nao e posterior ao mes corrente "
                 f"({mes_atual['nome']}/{mes_atual['ano']})")

    if mes_atual["ultimoDia"] < mes_atual["diasNoMes"]:
        print(f"AVISO: {mes_atual['nome']}/{mes_atual['ano']} sera arquivado com "
              f"{mes_atual['ultimoDia']} de {mes_atual['diasNoMes']} dias.")

    obj_raw = json.loads(Path(args.objetivos).read_text(encoding="utf-8"))
    objetivos = {normaliza_regional(k): v for k, v in obj_raw.items()}
    for r in reg_names:
        if r not in objetivos:
            sys.exit(f"objetivos sem a regional: {r}")
        for campo in ("rest", "projVenda", "objMes", "objDia"):
            if campo not in objetivos[r] or objetivos[r][campo] is None:
                sys.exit(f"objetivos: falta '{campo}' em {r}")

    dias_no_mes = calendar.monthrange(args.ano, args.mes)[1]

    # arquiva o mes corrente, igual ao gerar_dados.py
    arquivado = {k: v for k, v in mes_atual.items() if k != "anterior"}
    dados["historico"].insert(0, arquivado)
    anterior = {
        "pctTotal": mes_atual["pctTotal"],
        "regionais": {r: mes_atual["extra"][r]["pctMes"] for r in reg_names},
        "projFechamento": sum(mes_atual["extra"][r]["acum"] for r in reg_names),
    }

    novo_data, novo_extra = {}, {}
    for r in reg_names:
        novo_data[r] = [None] * dias_no_mes
        o = objetivos[r]
        novo_extra[r] = {
            "rest": o["rest"], "projVenda": o["projVenda"],
            "objMes": o["objMes"], "objDia": o["objDia"],
            "diaUlt": 0.0, "acumAntes": 0.0, "acum": 0.0,
            "perdaLoja": 0.0, "pctMes": 0.0,
        }

    dados["mesAtual"] = {
        "ano": args.ano,
        "mes": args.mes,
        "nome": MES_NOMES[args.mes - 1],
        "diasNoMes": dias_no_mes,
        "metaDiaBrasil": sum(objetivos[r]["objDia"] for r in reg_names),
        "pctTotal": 0.0,
        "ultimoDia": 0,
        # sem dia lancado nao existe data de atualizacao: o site trata null
        "atualizadoEm": None,
        "data": novo_data,
        "extra": novo_extra,
        "brasilVals": [None] * dias_no_mes,
        "anterior": anterior,
    }

    # a serie anual fica em null, nao em zero: zero leria como "perda zero"
    idx = args.mes - 1
    chave = str(args.ano)
    for r in reg_names:
        if chave in dados["regionaisData"].get(r, {}):
            dados["regionaisData"][r][chave][idx] = None
    if f"brasil{args.ano}" in dados:
        dados[f"brasil{args.ano}"][idx] = None

    nome = MES_NOMES[args.mes - 1]
    print(f"Arquivado: {mes_atual['nome']}/{mes_atual['ano']} "
          f"({mes_atual['ultimoDia']} dias, R$ {sum(mes_atual['extra'][r]['acum'] for r in reg_names):,.2f})")
    print(f"Aberto   : {nome}/{args.ano} — {dias_no_mes} dias, sem lancamento")
    print(f"Meta/dia Brasil: R$ {dados['mesAtual']['metaDiaBrasil']:,.2f}")
    print(f"Objetivo do mes: R$ {sum(objetivos[r]['objMes'] for r in reg_names):,.2f}")
    print(f"Proj. de venda : R$ {sum(objetivos[r]['projVenda'] for r in reg_names):,.2f}")

    if args.dry_run:
        print("\n--dry-run: nada foi gravado.")
        return

    caminho.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nGravado: {caminho}")

    # detalhe-mes.json passa a ser do mes novo, e comeca vazio
    det = ROOT / "data" / "detalhe-mes.json"
    det.write_text(json.dumps({}, ensure_ascii=False), encoding="utf-8")
    print(f"Gravado: {det} (vazio)")


if __name__ == "__main__":
    main()
