"""Converte o resumo-*.json (lido da tela do BI) no pct.json que o
gerar_dados.py consome.

Existe porque os % sao a UNICA coisa que precisa vir da tela: a REGRA
INVIOLAVEL do projeto e' que pctTotal e os % por regional venham do BI, nunca
recalculados. Todo o resto (R$, ocorrencias, hora, loja, chamado) vem do Excel
da aba 13, que e' a fonte crua.

Uso: python scripts/resumo_para_pct.py [resumo.json]
"""
import json
import sys
from pathlib import Path

ROOT = Path(r"C:\projetos\perdadereceita")


def main():
    if len(sys.argv) > 1:
        origem = Path(sys.argv[1])
    else:
        cands = sorted((ROOT / "pbi_raw").glob("resumo-*.json"), key=lambda p: p.stat().st_mtime)
        if not cands:
            raise SystemExit("nenhum resumo-*.json em pbi_raw/")
        origem = cands[-1]

    resumo = json.loads(origem.read_text(encoding="utf-8"))
    pct_reg = resumo.get("pctPorRegional") or {}
    if not pct_reg:
        raise SystemExit(f"{origem.name} sem pctPorRegional — o extrator nao leu o slicer")

    saida = {}
    for nome, valor in pct_reg.items():
        if valor in (None, ""):
            continue
        saida[nome] = float(str(valor).replace("%", "").replace(",", "."))

    total = resumo.get("total", {}).get("pctTotal")
    if total in (None, ""):
        raise SystemExit("resumo sem total.pctTotal — % do Brasil ausente")
    saida["BRASIL"] = float(str(total).replace("%", "").replace(",", "."))

    destino = ROOT / "pct.json"
    destino.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Fonte: {origem.name}")
    print(f"Gravado: {destino}  ({len(saida) - 1} regionais + BRASIL)")
    for k, v in saida.items():
        print(f"  {k:32s} {v}%")


if __name__ == "__main__":
    main()
