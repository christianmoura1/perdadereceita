"""Converte o Excel da aba 13 (Tabela de Extracao) no resumo-AAAAMMDD.json.

POR QUE: o extrator antigo raspava visuais e clicava no slicer Regional 11x,
falhando de forma intermitente. A aba 13 exporta a tabela crua, com a coluna
"Perda de receita" e os filtros oficiais do BI ja aplicados. Aqui todo agregado
e' CALCULADO a partir da linha a linha -- nada depende de visual.

Produz o MESMO formato que o pbi_extract.js produzia, para o restante do
pipeline (pbi_to_dados.py, verifica.py, gerar_relatorio.py) seguir intacto.

Uso: python scripts/xlsx_para_resumo.py [caminho.xlsx]
     (sem argumento usa o mais recente em downloads/)
"""
import json
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(r"C:\projetos\perdadereceita")
DOWNLOADS = ROOT / "downloads"
PBI_RAW = ROOT / "pbi_raw"


def corrige_mojibake(texto):
    """O export vem com 'BK ? FOGO' (cp1252 lido como utf-8). Normaliza."""
    if not isinstance(texto, str):
        return texto
    t = texto.replace("\ufffd", "É").replace("Ã‰", "É").replace("Ã§", "ç").replace("Ãƒ", "Ã")
    return unicodedata.normalize("NFC", t).strip()


def dinheiro(v):
    return f"R$ {v:,.0f}".replace(",", "@").replace("@", ",")


def main():
    if len(sys.argv) > 1:
        xlsx = Path(sys.argv[1])
    else:
        cands = sorted(DOWNLOADS.glob("aba13-*.xlsx"), key=lambda p: p.stat().st_mtime)
        if not cands:
            raise SystemExit("nenhum aba13-*.xlsx em downloads/")
        xlsx = cands[-1]

    df = pd.read_excel(xlsx)
    col_valor = "Perda de receita"
    if col_valor not in df.columns:
        raise SystemExit(f"coluna '{col_valor}' ausente — export veio no layout errado")

    # A ultima linha do export do Power BI e' um rodape ("Total" / filtros aplicados).
    df = df[df["Marca"] == "BKB"].copy()
    df["Data"] = pd.to_datetime(df["Data"], errors="coerce")
    df = df.dropna(subset=["Data"])
    if df.empty:
        raise SystemExit("nenhuma linha BKB com data valida — export suspeito")

    df["Regional"] = df["Regional"].map(corrige_mojibake)

    # recorta o mes da data mais recente (o BI ja filtra, isto e' cinto e suspensorio)
    ultima = df["Data"].max()
    mes = df[(df["Data"].dt.year == ultima.year) & (df["Data"].dt.month == ultima.month)]

    por_data = mes.groupby(mes["Data"].dt.date)[col_valor].sum().sort_index()
    por_reg = mes.groupby("Regional")[col_valor].sum().sort_values(ascending=False)
    dia_ult = mes[mes["Data"] == ultima]
    por_reg_dia = dia_ult.groupby("Regional")[col_valor].sum()
    total = float(mes[col_valor].sum())

    DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
            "sexta-feira", "sábado", "domingo"]

    resumo = {
        "geradoEm": datetime.utcnow().isoformat() + "Z",
        "fonte": f"aba13 export ({xlsx.name})",
        "atualizadoEm": ultima.strftime("%m/%d/%Y"),
        "ultimoDia": int(ultima.day),
        "perdaPorData": [
            {
                "data": f"{d.month}/{d.day}/{d.year}",
                "diaSemana": DIAS[d.weekday()],
                "perda": dinheiro(v),
                "pct": "",
            }
            for d, v in por_data.items()
        ],
        "total": {"perdaTotal": dinheiro(total), "pctTotal": ""},
        "porRegional": [{"nome": r, "perda": dinheiro(v)} for r, v in por_reg.items()],
        "perdaPorRegional": {r: dinheiro(v) for r, v in por_reg.items()},
        "perdaDiariaPorRegional": {r: dinheiro(v) for r, v in por_reg_dia.items()},
        "pctPorRegional": {},
        "ocorrencias": int(len(mes)),
        "chamados": int(mes["Chamados"].nunique()) if "Chamados" in mes.columns else None,
    }

    PBI_RAW.mkdir(exist_ok=True)
    destino = PBI_RAW / f"resumo-{ultima.strftime('%Y%m%d')}.json"
    destino.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Fonte: {xlsx.name}  ({len(df):,} linhas BKB)")
    print(f"Mes: {ultima.strftime('%b/%Y')} — ultimo dia com dados: {ultima.day}")
    print(f"Total acumulado: R$ {total:,.2f}   ocorrencias: {len(mes):,}")
    print(f"Perda do dia {ultima.day}: R$ {float(dia_ult[col_valor].sum()):,.2f}")
    print("Por regional:")
    for r, v in por_reg.items():
        print(f"  {r[:32]:34s} R$ {v:>13,.2f}")
    print(f"\nGravado: {destino}")


if __name__ == "__main__":
    main()
