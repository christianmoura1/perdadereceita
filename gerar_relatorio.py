#!/usr/bin/env python3
"""
Gera um HTML autocontido com os blocos que o Christian manda no WhatsApp,
lendo data/dados.json e data/detalhe-mes.json. Não depende do site nem de login.

Uso:
    python gerar_relatorio.py                 # usa o último dia com dados
    python gerar_relatorio.py --dia 26        # força um dia
    python gerar_relatorio.py --saida x.html

Blocos, na ordem: Resumo MTD por Regional, Comentário do Dia,
Mudanças Importantes, Consolidado do dia (Brasil).
"""
import argparse
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MES_NOMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
LABEL = {"SP CENTRO LITORAL": "BK É FOGO CENTRO LITORAL"}

# Faixas iguais às do index.html (função badge). O corte de Atenção é 0,90,
# não os 0,99 que a legenda do site anuncia.
FAIXAS = [
    (0.74, "Dentro da Meta", "meta"),
    (0.90, "Atenção", "atencao"),
    (1.20, "Acima", "acima"),
    (float("inf"), "Muito Acima", "muito"),
]


def status(pct):
    for limite, nome, cls in FAIXAS:
        if pct <= limite:
            return nome, cls
    return FAIXAS[-1][1], FAIXAS[-1][2]


def brl(v, casas=2):
    s = f"{v:,.{casas}f}"
    return "R$ " + s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def num(v):
    return f"{v:,}".replace(",", ".")


def pct(v):
    return f"{v:.2f}".replace(".", ",") + "%"


def pct1(v):
    return f"{v:.1f}".replace(".", ",") + "%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dia", type=int)
    ap.add_argument("--saida", default="relatorio.html")
    args = ap.parse_args()

    dados = json.loads((ROOT / "data" / "dados.json").read_text(encoding="utf-8"))
    det = json.loads((ROOT / "data" / "detalhe-mes.json").read_text(encoding="utf-8"))

    m = dados["mesAtual"]
    dia = args.dia or m["ultimoDia"]
    ano, mes, dias_no_mes = m["ano"], m["mes"], m["diasNoMes"]
    iso = date(ano, mes, dia).isoformat()
    regs = list(m["extra"].keys())

    acum_total = round(sum(m["extra"][r]["acum"] for r in regs), 2)
    media_dia = acum_total / dia
    projecao = acum_total + media_dia * (dias_no_mes - dia)
    meta_dia = m["metaDiaBrasil"]
    perda_dia = round(sum(m["data"][r][dia - 1] or 0.0 for r in regs), 2)

    # ---- por regional, no dia ----
    linhas = []
    for r in regs:
        e = m["extra"][r]
        d_reg = m["data"][r][dia - 1] or 0.0
        nome, cls = status(e["pctMes"])
        linhas.append({
            "reg": LABEL.get(r, r), "interna": r, "rest": e["rest"],
            "projVenda": e["projVenda"], "objMes": e["objMes"], "objDia": e["objDia"],
            "dia": d_reg, "antes": round(e["acum"] - d_reg, 2), "acum": e["acum"],
            "lojaDia": e["perdaLoja"], "pct": e["pctMes"], "status": nome, "cls": cls,
        })
    linhas.sort(key=lambda x: -x["acum"])

    por_dia_desc = sorted(linhas, key=lambda x: -x["dia"])
    maiores = [l for l in por_dia_desc if l["dia"] > 0][:3]
    menores = [l for l in reversed(por_dia_desc) if l["dia"] > 0][:3]

    # ---- consolidado do dia ----
    horas, lojas, cats, ocs = {}, {}, {}, 0
    for r in regs:
        pd = det.get(r, {}).get("porDia", {}).get(iso)
        if not pd:
            continue
        ocs += pd["oc"]
        for h, v in pd["horas"].items():
            horas[int(h)] = horas.get(int(h), 0.0) + v
        for l in pd["lojas"]:
            k = l["nome"]
            lojas[k] = lojas.get(k, 0.0) + l["perda"]
        for c in pd["cats"]:
            cats[c["nome"]] = cats.get(c["nome"], 0.0) + c["perda"]

    hora_pico = max(horas, key=horas.get) if horas else None
    top_lojas = sorted(lojas.items(), key=lambda x: -x[1])[:10]
    top_cats = sorted(cats.items(), key=lambda x: -x[1])[:10]
    share_dia = (perda_dia / acum_total * 100) if acum_total else 0

    # ---- mudanças vs ciclo anterior ----
    ant = m.get("anterior") or {}
    ant_regs = ant.get("regionais") or {}
    mudancas = []
    for r in regs:
        a, b = ant_regs.get(r), m["extra"][r]["pctMes"]
        if a is None or a == b:
            continue
        mudancas.append((LABEL.get(r, r), pct1(a), pct1(b), "Subiu" if b > a else "Desceu"))
    if ant.get("pctTotal") is not None and ant["pctTotal"] != m["pctTotal"]:
        mudancas.append(("BRASIL", pct(ant["pctTotal"]), pct(m["pctTotal"]),
                         "Subiu" if m["pctTotal"] > ant["pctTotal"] else "Desceu"))
    if ant.get("projFechamento"):
        ap_, bp = ant["projFechamento"], projecao
        if round(ap_) != round(bp):
            mudancas.append(("Proj. Fechamento", brl(ap_ / 1e6, 2) + "M".replace("R$ ", ""),
                             brl(bp / 1e6, 2) + "M", "Subiu" if bp > ap_ else "Desceu"))

    def barras(itens, fmt=brl):
        if not itens:
            return "<p class='vazio'>sem dados</p>"
        mx = max(v for _, v in itens)
        out = []
        for k, v in itens:
            w = (v / mx * 100) if mx else 0
            out.append(
                f"<div class='bar'><span class='bl'>{k}</span>"
                f"<span class='bt'><i style='width:{w:.1f}%'></i></span>"
                f"<span class='bv'>{fmt(v)}</span></div>")
        return "".join(out)

    horas_itens = [(f"{h:02d}h", horas[h]) for h in sorted(horas)]

    bateu = perda_dia <= meta_dia
    comentario = (
        f"{dia:02d}/{MES_NOMES[mes-1]}/{ano}:\n"
        + ("✅ Meta diária atingida.\n" if bateu else "❌ Meta diária não atingida.\n")
        + f"\nA perda de {brl(perda_dia)} "
        + ("ficou dentro do" if bateu else "superou o")
        + f" objetivo de {brl(meta_dia)}.\n\n"
        + "Maiores perdas: " + ", ".join(f"{l['reg']} ({brl(l['dia'])})" for l in maiores) + ".\n\n"
        + "Menores perdas: " + ", ".join(f"{l['reg']} ({brl(l['dia'])})" for l in menores) + ".\n\n"
        + f"Acumulado {MES_NOMES[mes-1]}: {brl(acum_total)}\n"
        + f"Projeção fechamento: {brl(projecao)}"
    )

    trs = "".join(
        f"<tr><td class='reg'>{l['reg']}</td><td>{l['rest']}</td><td>{brl(l['projVenda'],0)}</td>"
        f"<td>{brl(l['objMes'],0)}</td><td>{brl(l['objDia'],0)}</td>"
        f"<td class='hl'>{brl(l['dia'])}</td><td>{brl(l['antes'])}</td>"
        f"<td class='b'>{brl(l['acum'])}</td><td>{brl(l['lojaDia'])}</td>"
        f"<td class='b'>{pct1(l['pct'])}</td>"
        f"<td><span class='tag {l['cls']}'>{l['status']}</span></td></tr>"
        for l in linhas)

    mud = "".join(
        f"<tr><td class='reg'>{a}</td><td class='dim'>{b}</td><td class='b'>{c}</td>"
        f"<td><span class='tag {'acima' if d=='Subiu' else 'meta'}'>{d}</span></td></tr>"
        for a, b, c, d in mudancas) or "<tr><td colspan='4' class='vazio'>nada mudou</td></tr>"

    html = f"""<meta charset="utf-8">
<title>Perda de Receita — {dia:02d}/{MES_NOMES[mes-1]}/{ano}</title>
<style>
:root{{--bg:#f4f5f7;--card:#fff;--ink:#111827;--dim:#6b7280;--line:#e5e7eb;--nav:#001166;--red:#d52200}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0f1115;--card:#171a21;--ink:#e8eaed;--dim:#9aa1ab;--line:#2a2f3a}}}}
*{{box-sizing:border-box}}
body{{margin:0;padding:18px;background:var(--bg);color:var(--ink);
font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}}
h1{{font-size:19px;margin:0 0 2px}}
.sub{{color:var(--dim);font-size:13px;margin-bottom:16px}}
section{{background:var(--card);border:1px solid var(--line);border-radius:12px;
padding:14px 16px;margin-bottom:14px}}
h2{{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:0 0 12px}}
.scroll{{overflow-x:auto}}
table{{border-collapse:collapse;width:100%;font-size:12.5px;min-width:900px}}
th,td{{padding:7px 9px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}}
th{{background:var(--nav);color:#fff;font-size:11px;text-transform:uppercase;
letter-spacing:.04em;position:sticky;top:0}}
th:first-child,td:first-child{{text-align:left}}
td.reg{{font-weight:600}} td.b{{font-weight:700}} td.dim{{color:var(--dim)}}
td.hl{{background:rgba(213,34,0,.07);font-weight:600}}
.tag{{padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap}}
.meta{{background:#dcfce7;color:#166534}} .atencao{{background:#fef9c3;color:#854d0e}}
.acima{{background:#fee2e2;color:#991b1b}} .muito{{background:#f3e8ff;color:#6b21a8}}
pre{{margin:0;white-space:pre-wrap;font:14px/1.65 inherit}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}}
.kpi{{border:1px solid var(--line);border-radius:10px;padding:10px 12px}}
.kpi b{{display:block;font-size:17px;margin-bottom:2px}}
.kpi span{{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.04em}}
.cols{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin-top:14px}}
.bar{{display:grid;grid-template-columns:1fr 90px auto;gap:8px;align-items:center;
font-size:12px;padding:2px 0}}
.bl{{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.bt{{background:var(--line);border-radius:4px;height:8px;overflow:hidden}}
.bt i{{display:block;height:100%;background:var(--red)}}
.bv{{font-variant-numeric:tabular-nums;font-weight:600}}
.vazio{{color:var(--dim);font-style:italic}}
</style>

<h1>Perda de Receita — Manutenção</h1>
<div class="sub">Zamp · {MES_NOMES[mes-1]}/{ano} (1–{dia}) · fechado no dia {dia}</div>

<section>
  <h2>1 · Resumo MTD por Regional</h2>
  <div class="scroll"><table>
    <thead><tr><th>Regional</th><th>Rest.</th><th>Proj. Venda</th><th>Obj. Mês</th>
    <th>Obj. Dia</th><th>{dia}/{MES_NOMES[mes-1]}</th><th>1–{dia-1}/{MES_NOMES[mes-1]}</th>
    <th>Acumulado</th><th>Loja/Dia</th><th>%</th><th>Status</th></tr></thead>
    <tbody>{trs}</tbody>
  </table></div>
</section>

<section>
  <h2>2 · Comentário do Dia</h2>
  <pre>{comentario}</pre>
</section>

<section>
  <h2>3 · Mudanças Importantes</h2>
  <div class="scroll"><table style="min-width:420px">
    <thead><tr><th>Indicador</th><th>Antes</th><th>Agora ({dia}/{MES_NOMES[mes-1]})</th>
    <th>Alerta</th></tr></thead>
    <tbody>{mud}</tbody>
  </table></div>
</section>

<section>
  <h2>4 · Consolidado Brasil — {dia:02d}/{MES_NOMES[mes-1]}</h2>
  <div class="kpis">
    <div class="kpi"><b>{brl(perda_dia)}</b><span>Perda do dia</span></div>
    <div class="kpi"><b>{brl(media_dia)}</b><span>Média/dia do mês</span></div>
    <div class="kpi"><b>{'+' if perda_dia>media_dia else '−'}{brl(abs(perda_dia-media_dia))}</b><span>vs média</span></div>
    <div class="kpi"><b>{num(ocs)}</b><span>Ocorrências no dia</span></div>
    <div class="kpi"><b>{pct(share_dia)}</b><span>do acumulado do mês</span></div>
    <div class="kpi"><b>{f'{hora_pico:02d}h' if hora_pico is not None else '—'}</b><span>Hora pico</span></div>
  </div>
  <div class="cols">
    <div><h2>Perda por hora</h2>{barras(horas_itens)}</div>
    <div><h2>Top 10 lojas do dia</h2>{barras(top_lojas)}</div>
    <div><h2>Top 10 categorias do dia</h2>{barras(top_cats)}</div>
  </div>
</section>
"""

    saida = ROOT / args.saida
    saida.write_text(html, encoding="utf-8")
    print(f"Dia {dia}/{mes:02d}/{ano}")
    print(f"  perda do dia .... {brl(perda_dia)}")
    print(f"  meta/dia ........ {brl(meta_dia)}")
    print(f"  acumulado ....... {brl(acum_total)}")
    print(f"  projecao ........ {brl(projecao)}")
    print(f"  ocorrencias ..... {num(ocs)}")
    print(f"  hora pico ....... {hora_pico}")
    print(f"  mudancas ........ {len(mudancas)}")
    print(f"Gravado: {saida}")


if __name__ == "__main__":
    main()
