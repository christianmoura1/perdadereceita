#!/usr/bin/env python3
"""
Gera os PNG da rodada, prontos para mandar no WhatsApp, lendo
data/dados.json e data/detalhe-mes.json. Não depende do site nem de login.

Uso:
    python gerar_imagens.py                # último dia com dados
    python gerar_imagens.py --dia 26
    python gerar_imagens.py --saida imagens

Saída, na ordem de envio:
    1-resumo-mtd.png       Resumo MTD por Regional
    2-comentario.png       Comentário do Dia
    3-mudancas.png         Mudanças Importantes
    4-consolidado.png      Consolidado Brasil do dia
"""
import argparse
import json
import subprocess
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
LABEL = {"SP CENTRO LITORAL": "BK É FOGO CENTRO LITORAL"}

S = 2  # escala de render
NAVY = (0, 17, 102)
RED = (213, 34, 0)
INK = (17, 24, 39)
DIM = (107, 114, 128)
LINE = (229, 231, 235)
ZEBRA = (248, 249, 251)
WHITE = (255, 255, 255)
HILITE = (253, 240, 237)

TAGS = {
    "Dentro da Meta": ((220, 252, 231), (22, 101, 52)),
    "Atenção": ((254, 249, 195), (133, 77, 14)),
    "Acima": ((254, 226, 226), (153, 27, 27)),
    "Muito Acima": ((243, 232, 255), (107, 33, 168)),
    "Subiu": ((254, 226, 226), (153, 27, 27)),
    "Desceu": ((220, 252, 231), (22, 101, 52)),
}

FONTS = {
    "r": r"C:\Windows\Fonts\segoeui.ttf",
    "sb": r"C:\Windows\Fonts\seguisb.ttf",
    "b": r"C:\Windows\Fonts\segoeuib.ttf",
}


def f(kind, size):
    return ImageFont.truetype(FONTS[kind], size * S)


def brl(v, casas=2):
    s = f"{v:,.{casas}f}"
    return "R$ " + s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def pct1(v):
    return f"{v:.1f}".replace(".", ",") + "%"


def pct2(v):
    return f"{v:.2f}".replace(".", ",") + "%"


def num(v):
    return f"{v:,}".replace(",", ".")


def status(p):
    """Faixas iguais às do index.html (função badge, linha ~1264).
    Atenção: o corte é 0,90, não os 0,99 que a legenda do site anuncia."""
    if p <= 0.74:
        return "Dentro da Meta"
    if p <= 0.90:
        return "Atenção"
    if p <= 1.20:
        return "Acima"
    return "Muito Acima"


# ------------------------------------------------------------------ dados
def coletar(dia=None):
    d = json.loads((ROOT / "data" / "dados.json").read_text(encoding="utf-8"))
    det = json.loads((ROOT / "data" / "detalhe-mes.json").read_text(encoding="utf-8"))
    m = d["mesAtual"]
    dia = dia or m["ultimoDia"]
    regs = list(m["extra"].keys())
    iso = date(m["ano"], m["mes"], dia).isoformat()

    acum = round(sum(m["extra"][r]["acum"] for r in regs), 2)
    media = acum / dia
    proj = acum + media * (m["diasNoMes"] - dia)
    perda_dia = round(sum(m["data"][r][dia - 1] or 0.0 for r in regs), 2)

    linhas = []
    for r in regs:
        e = m["extra"][r]
        dv = m["data"][r][dia - 1] or 0.0
        linhas.append({
            "reg": LABEL.get(r, r), "rest": e["rest"], "projVenda": e["projVenda"],
            "objMes": e["objMes"], "objDia": e["objDia"], "dia": dv,
            "antes": round(e["acum"] - dv, 2), "acum": e["acum"],
            "lojaDia": e["perdaLoja"], "pct": e["pctMes"], "st": status(e["pctMes"]),
        })
    # ordem natural do dados.json — é a que o Christian usa no relatório

    horas, lojas, cats, ocs = {}, {}, {}, 0
    for r in regs:
        pd = det.get(r, {}).get("porDia", {}).get(iso)
        if not pd:
            continue
        ocs += pd["oc"]
        for h, v in pd["horas"].items():
            horas[int(h)] = horas.get(int(h), 0.0) + v
        for l in pd["lojas"]:
            lojas[l["nome"]] = lojas.get(l["nome"], 0.0) + l["perda"]
        for c in pd["cats"]:
            cats[c["nome"]] = cats.get(c["nome"], 0.0) + c["perda"]

    ant = m.get("anterior") or {}
    ar = ant.get("regionais") or {}
    mud = []
    for r in regs:
        a, b = ar.get(r), m["extra"][r]["pctMes"]
        if a is not None and a != b:
            mud.append((LABEL.get(r, r), pct1(a), pct1(b), "Subiu" if b > a else "Desceu"))
    if ant.get("pctTotal") is not None and ant["pctTotal"] != m["pctTotal"]:
        mud.append(("BRASIL", pct2(ant["pctTotal"]), pct2(m["pctTotal"]),
                    "Subiu" if m["pctTotal"] > ant["pctTotal"] else "Desceu"))
    if ant.get("projFechamento") and round(ant["projFechamento"]) != round(proj):
        mud.append(("Proj. Fechamento",
                    brl(ant["projFechamento"] / 1e6, 2) + "M",
                    brl(proj / 1e6, 2) + "M",
                    "Subiu" if proj > ant["projFechamento"] else "Desceu"))

    por_dia = sorted(linhas, key=lambda x: -x["dia"])
    com_perda = [l for l in por_dia if l["dia"] > 0]

    total = {
        "reg": "BRASIL TOTAL",
        "rest": sum(l["rest"] for l in linhas),
        "projVenda": sum(l["projVenda"] for l in linhas),
        "objMes": sum(l["objMes"] for l in linhas),
        "objDia": m["metaDiaBrasil"],
        "dia": perda_dia,
        "antes": round(acum - perda_dia, 2),
        "acum": acum,
        "lojaDia": None,
        "pct": m["pctTotal"],
        "st": status(m["pctTotal"]),
    }

    return {
        "total": total,
        "ano": m["ano"], "mes": m["mes"], "dia": dia, "diasNoMes": m["diasNoMes"],
        "metaDia": m["metaDiaBrasil"], "pctTotal": m["pctTotal"],
        "acum": acum, "media": media, "proj": proj, "perdaDia": perda_dia,
        "linhas": linhas, "mud": mud, "ocs": ocs,
        # eixo contínuo 00–23: hora sem ocorrência é zero, não lacuna
        "horas": {h: round(horas.get(h, 0.0), 2) for h in range(24)},
        "topLojas": sorted(lojas.items(), key=lambda x: -x[1])[:10],
        "topCats": sorted(cats.items(), key=lambda x: -x[1])[:10],
        "maiores": com_perda[:3], "menores": list(reversed(com_perda))[:3],
    }


# ------------------------------------------------------------------ desenho
def novo(w, h):
    img = Image.new("RGB", (w, h), WHITE)
    return img, ImageDraw.Draw(img)


def tw(dr, s, fnt):
    return dr.textlength(s, font=fnt)


def cabecalho(dr, x, y, w, titulo, sub):
    ft, fs = f("b", 19), f("r", 13)
    dr.rectangle([x, y, x + w, y + 52 * S], fill=NAVY)
    dr.text((x + 16 * S, y + 12 * S), titulo, font=ft, fill=WHITE)
    if sub:
        dr.text((x + w - 16 * S - tw(dr, sub, fs), y + 18 * S), sub, font=fs, fill=(180, 190, 220))
    return y + 52 * S


def tag(dr, x, y, texto, fnt, h=None):
    bg, fg = TAGS.get(texto, (LINE, INK))
    pad = 9 * S
    larg = tw(dr, texto, fnt) + pad * 2
    alt = h or int(fnt.size * 1.75)
    dr.rounded_rectangle([x, y, x + larg, y + alt], radius=alt // 2, fill=bg)
    dr.text((x + pad, y + (alt - fnt.size) / 2 - 1 * S), texto, font=fnt, fill=fg)
    return larg


def tabela(caminho, titulo, sub, colunas, dados, destaque=None):
    """colunas: [(rotulo, alinhamento, tipo)] tipo em {'txt','tag'}"""
    fh, fc, fb, ftag = f("sb", 11), f("r", 12), f("b", 12), f("b", 10)
    _, medir = novo(10, 10)

    ncol = len(colunas)
    larguras = []
    for i, (rot, _al, tipo) in enumerate(colunas):
        maior = tw(medir, rot, fh)
        for linha in dados:
            v = str(linha[i])
            fnt = ftag if tipo == "tag" else (fb if i in (0,) else fc)
            extra = 20 * S if tipo == "tag" else 0
            maior = max(maior, tw(medir, v, fnt) + extra)
        larguras.append(int(maior) + 26 * S)

    w = sum(larguras) + 32 * S
    hl = 40 * S
    h = 52 * S + 46 * S + hl * len(dados) + 32 * S
    img, dr = novo(w, h)

    y = cabecalho(dr, 16 * S, 16 * S, w - 32 * S, titulo, sub)
    x0 = 16 * S

    dr.rectangle([x0, y, x0 + sum(larguras), y + 46 * S], fill=(232, 235, 245))
    cx = x0
    for i, (rot, al, _t) in enumerate(colunas):
        tx = cx + 13 * S if al == "l" else cx + larguras[i] - 13 * S - tw(dr, rot, fh)
        dr.text((tx, y + 15 * S), rot, font=fh, fill=NAVY)
        cx += larguras[i]
    y += 46 * S

    for r, linha in enumerate(dados):
        if r % 2:
            dr.rectangle([x0, y, x0 + sum(larguras), y + hl], fill=ZEBRA)
        cx = x0
        for i, (_rot, al, tipo) in enumerate(colunas):
            v = str(linha[i])
            if destaque is not None and i == destaque:
                dr.rectangle([cx, y, cx + larguras[i], y + hl], fill=HILITE)
            if tipo == "tag":
                tag(dr, cx + 13 * S, y + 9 * S, v, ftag)
            else:
                fnt = fb if (i == 0 or al == "r" and i >= ncol - 3) else fc
                if i == 0:
                    fnt = fb
                tx = cx + 13 * S if al == "l" else cx + larguras[i] - 13 * S - tw(dr, v, fnt)
                dr.text((tx, y + (hl - fnt.size) / 2 - 1 * S), v, font=fnt, fill=INK)
            cx += larguras[i]
        dr.line([x0, y + hl, x0 + sum(larguras), y + hl], fill=LINE, width=1)
        y += hl

    img.save(caminho)
    return caminho


def img_resumo(caminho, d):
    """Resumo MTD por Regional, no layout do dashboard: cabeçalho claro com
    barra azul, ordem natural das regionais e BRASIL TOTAL no rodapé."""
    mn = MES[d["mes"] - 1]
    ftit, fh = f("b", 15), f("sb", 10)
    fc, fb = f("r", 12), f("b", 12),
    ftag = f("b", 10)
    _, medir = novo(10, 10)

    ACENTO = (37, 99, 235)
    HDBG = (238, 240, 246)
    HDTX = (100, 108, 130)
    TOTBG = (238, 240, 251)
    FAIXA_DIA = [
        (1.00, (232, 248, 238), (22, 163, 74)),
        (1.20, (253, 234, 234), (220, 38, 38)),
        (float("inf"), (240, 234, 252), (124, 58, 237)),
    ]

    def cor_dia(valor, obj):
        r = (valor / obj) if obj else 0
        for lim, bg, fg in FAIXA_DIA:
            if r <= lim:
                return bg, fg
        return FAIXA_DIA[-1][1], FAIXA_DIA[-1][2]

    cols = [
        ("REGIONAL", "l"), ("REST.", "r"), ("PROJ. VENDA", "r"), ("OBJ. MÊS", "r"),
        ("OBJ. DIA", "r"), (f"{d['dia']}/{mn.upper()}", "r"),
        (f"1–{d['dia']-1}/{mn.upper()}", "r"), ("ACUMULADO", "r"),
        ("LOJA/DIA", "r"), ("%", "r"), ("STATUS", "l"),
    ]

    def celulas(l, brasil=False):
        return [
            l["reg"], str(l["rest"]), brl(l["projVenda"]), brl(l["objMes"]),
            brl(l["objDia"]), brl(l["dia"]), brl(l["antes"]), brl(l["acum"]),
            "—" if l["lojaDia"] is None else brl(l["lojaDia"]),
            (f"{l['pct']:.2f}" if brasil else f"{l['pct']:.1f}") + "%",
            l["st"],
        ]

    corpo = [celulas(l) for l in d["linhas"]] + [celulas(d["total"], brasil=True)]

    larg = []
    for i, (rot, _al) in enumerate(cols):
        maior = tw(medir, rot, fh)
        for linha in corpo:
            fnt = ftag if i == 10 else fb
            extra = 22 * S if i == 10 else 0
            maior = max(maior, tw(medir, linha[i], fnt) + extra)
        larg.append(int(maior) + 24 * S)

    tabw = sum(larg)
    W = tabw + 32 * S
    hh, hl = 34 * S, 36 * S
    H = 16 * S + 40 * S + hh + hl * len(corpo) + 18 * S
    img, dr = novo(W, H)

    # título com barra de acento
    dr.rounded_rectangle([16 * S, 18 * S, 21 * S, 38 * S], radius=2 * S, fill=ACENTO)
    dr.text((30 * S, 17 * S),
            f"Resumo MTD por Regional — {mn}/{d['ano']} (1–{d['dia']}/{mn})",
            font=ftit, fill=INK)

    y = 16 * S + 40 * S
    x0 = 16 * S
    dr.rectangle([x0, y, x0 + tabw, y + hh], fill=HDBG)
    cx = x0
    for i, (rot, al) in enumerate(cols):
        tx = cx + 12 * S if al == "l" else cx + larg[i] - 12 * S - tw(dr, rot, fh)
        dr.text((tx, y + (hh - fh.size) / 2 - 1 * S), rot, font=fh, fill=HDTX)
        cx += larg[i]
    y += hh

    for r, linha in enumerate(corpo):
        brasil = r == len(corpo) - 1
        if brasil:
            dr.rectangle([x0, y, x0 + tabw, y + hl], fill=TOTBG)
        elif r % 2:
            dr.rectangle([x0, y, x0 + tabw, y + hl], fill=(250, 250, 251))
        l = d["total"] if brasil else d["linhas"][r]
        cx = x0
        for i, (_rot, al) in enumerate(cols):
            v = linha[i]
            if i == 5:
                bg, fg = cor_dia(l["dia"], l["objDia"])
                dr.rectangle([cx, y, cx + larg[i], y + hl], fill=bg)
                fnt, cor = fb, fg
            elif i == 10:
                tag(dr, cx + 12 * S, y + 8 * S, v, ftag)
                cx += larg[i]
                continue
            else:
                negrito = brasil or i in (0, 7, 9)
                fnt = fb if negrito else fc
                cor = INK
            tx = cx + 12 * S if al == "l" else cx + larg[i] - 12 * S - tw(dr, v, fnt)
            dr.text((tx, y + (hl - fnt.size) / 2 - 1 * S), v, font=fnt, fill=cor)
            cx += larg[i]
        dr.line([x0, y + hl, x0 + tabw, y + hl], fill=LINE, width=1)
        y += hl

    img.save(caminho)
    return caminho


def img_comentario(caminho, d):
    bateu = d["perdaDia"] <= d["metaDia"]
    linhas = [
        (f("b", 17), f"{d['dia']:02d}/{MES[d['mes']-1]}/{d['ano']}", INK),
        (f("b", 15), ("Meta diária atingida." if bateu else "Meta diária não atingida."),
         (22, 101, 52) if bateu else RED),
        None,
        (f("r", 14), f"A perda de {brl(d['perdaDia'])} "
         + ("ficou dentro do" if bateu else "superou o"), INK),
        (f("r", 14), f"objetivo de {brl(d['metaDia'])}.", INK),
        None,
        (f("sb", 13), "Maiores perdas", DIM),
    ]
    for l in d["maiores"]:
        linhas.append((f("r", 14), f"{l['reg']} — {brl(l['dia'])}", INK))
    linhas.append(None)
    linhas.append((f("sb", 13), "Menores perdas", DIM))
    for l in d["menores"]:
        linhas.append((f("r", 14), f"{l['reg']} — {brl(l['dia'])}", INK))
    linhas.append(None)
    linhas.append((f("b", 15), f"Acumulado {MES[d['mes']-1]}: {brl(d['acum'])}", INK))
    linhas.append((f("r", 14), f"Projeção fechamento: {brl(d['proj'])}", INK))

    _, medir = novo(10, 10)
    w = int(max(tw(medir, t, fnt) for fnt, t, _c in [x for x in linhas if x])) + 64 * S
    w = max(w, 560 * S)
    h = 52 * S + 28 * S
    for x in linhas:
        h += (12 * S if x is None else int(x[0].size * 1.55))
    h += 28 * S

    img, dr = novo(w, h)
    y = cabecalho(dr, 16 * S, 16 * S, w - 32 * S, "Comentário do Dia",
                  f"{d['dia']:02d}/{MES[d['mes']-1]}")
    y += 22 * S
    for x in linhas:
        if x is None:
            y += 12 * S
            continue
        fnt, txt, cor = x
        dr.text((32 * S, y), txt, font=fnt, fill=cor)
        y += int(fnt.size * 1.55)
    img.save(caminho)
    return caminho


def img_consolidado(caminho, d):
    fk, fkl = f("b", 20), f("sb", 10)
    fs, fv, fbl = f("sb", 12), f("sb", 11), f("r", 11)
    _, medir = novo(10, 10)

    kpis = [
        (brl(d["perdaDia"]), "PERDA DO DIA"),
        (brl(d["media"]), "MÉDIA/DIA DO MÊS"),
        (("+" if d["perdaDia"] > d["metaDia"] else "−") + brl(abs(d["perdaDia"] - d["metaDia"])),
         "VS META/DIA"),
        (("+" if d["perdaDia"] > d["media"] else "−") + brl(abs(d["perdaDia"] - d["media"])),
         "VS MÉDIA"),
        (num(d["ocs"]), "OCORRÊNCIAS"),
        (pct2(d["perdaDia"] / d["acum"] * 100) if d["acum"] else "—", "DO ACUM. DO MÊS"),
    ]
    pico = max(d["horas"], key=d["horas"].get) if d["horas"] else None
    kpis.append((f"{pico:02d}h" if pico is not None else "—", "HORA PICO"))

    W = 1180 * S
    kw = (W - 32 * S - 6 * 10 * S) // 7
    hchart = 210 * S
    nbar = max(len(d["topLojas"]), len(d["topCats"]))
    h = (52 * S + 20 * S + 78 * S + 26 * S + 30 * S + hchart + 34 * S
         + 30 * S + nbar * 26 * S + 30 * S)
    img, dr = novo(W, h)

    y = cabecalho(dr, 16 * S, 16 * S, W - 32 * S,
                  f"Consolidado Brasil — {d['dia']:02d}/{MES[d['mes']-1]}/{d['ano']}",
                  f"{MES[d['mes']-1]} 1–{d['dia']} · acumulado {brl(d['acum'])} · {pct2(d['pctTotal'])}")
    y += 20 * S

    cx = 16 * S
    for val, rot in kpis:
        dr.rounded_rectangle([cx, y, cx + kw, y + 78 * S], radius=10 * S,
                             fill=(250, 251, 253), outline=LINE, width=1)
        vf = fk
        while tw(dr, val, vf) > kw - 20 * S and vf.size > 11 * S:
            vf = ImageFont.truetype(FONTS["b"], vf.size - 1 * S)
        dr.text((cx + 12 * S, y + 16 * S), val, font=vf, fill=INK)
        dr.text((cx + 12 * S, y + 52 * S), rot, font=fkl, fill=DIM)
        cx += kw + 10 * S
    y += 78 * S + 26 * S

    # perda por hora
    dr.text((16 * S, y), "PERDA POR HORA DO DIA", font=fs, fill=DIM)
    y += 30 * S
    if d["horas"]:
        mx = max(d["horas"].values())
        n = len(d["horas"])
        bw = min(40 * S, (W - 40 * S) // max(n, 1) - 6 * S)
        step = bw + 6 * S
        bx = 20 * S
        base = y + hchart - 22 * S
        for hh, v in d["horas"].items():
            bh = int((v / mx) * (hchart - 40 * S)) if mx else 0
            cor = RED if hh == pico else (150, 165, 205)
            dr.rounded_rectangle([bx, base - bh, bx + bw, base], radius=3 * S, fill=cor)
            rot = f"{hh:02d}"
            dr.text((bx + (bw - tw(dr, rot, fbl)) / 2, base + 6 * S), rot, font=fbl, fill=DIM)
            if hh == pico:
                lv = brl(v, 0)
                dr.text((max(0, bx + (bw - tw(dr, lv, fv)) / 2), base - bh - 20 * S),
                        lv, font=fv, fill=RED)
            bx += step
    y += hchart + 34 * S

    # duas colunas de barras
    colw = (W - 48 * S) // 2
    for ci, (titulo, itens) in enumerate([("TOP 10 LOJAS DO DIA", d["topLojas"]),
                                          ("TOP 10 CATEGORIAS DO DIA", d["topCats"])]):
        ox = 16 * S + ci * (colw + 16 * S)
        dr.text((ox, y), titulo, font=fs, fill=DIM)
        yy = y + 30 * S
        mx = max((v for _k, v in itens), default=0)
        for k, v in itens:
            rot = k if tw(dr, k, fbl) < colw * 0.44 else k[:int(len(k) * colw * 0.44 / max(tw(dr, k, fbl), 1))] + "…"
            dr.text((ox, yy + 4 * S), rot, font=fbl, fill=INK)
            bx0 = ox + int(colw * 0.46)
            bx1 = ox + colw - 92 * S
            dr.rounded_rectangle([bx0, yy + 8 * S, bx1, yy + 15 * S], radius=3 * S, fill=LINE)
            if mx:
                dr.rounded_rectangle([bx0, yy + 8 * S, bx0 + int((bx1 - bx0) * v / mx),
                                      yy + 15 * S], radius=3 * S, fill=RED)
            vv = brl(v, 0)
            dr.text((ox + colw - tw(dr, vv, fv), yy + 4 * S), vv, font=fv, fill=INK)
            yy += 26 * S
    img.save(caminho)
    return caminho


def dia_anterior_publicado(dia_atual):
    """Dia de fechamento da rodada publicada anterior.

    O bloco `anterior` do dados.json guarda os percentuais de comparacao mas nao
    guarda de que dia eles sao, e supor `dia_atual - 1` erra sempre que uma
    rodada e pulada. Em 31/07/2026 a comparacao era contra o dia 28, nao o 29,
    porque no dia 30 nao houve publicacao.

    Percorre o historico do arquivo e devolve o primeiro ultimoDia diferente do
    atual. Cai para `dia_atual - 1` se o git nao responder.
    """
    try:
        saida = subprocess.run(
            ["git", "log", "--format=%H", "-20", "--", "data/dados.json"],
            cwd=ROOT, capture_output=True, timeout=15,
        ).stdout.decode().split()
        for commit in saida:
            blob = subprocess.run(
                ["git", "show", f"{commit}:data/dados.json"],
                cwd=ROOT, capture_output=True, timeout=15,
            ).stdout.decode("utf-8-sig")
            anterior = json.loads(blob)["mesAtual"]["ultimoDia"]
            if anterior != dia_atual:
                return anterior
    except Exception:
        pass
    return dia_atual - 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dia", type=int)
    ap.add_argument("--saida", default="imagens")
    args = ap.parse_args()

    d = coletar(args.dia)

    out = ROOT / args.saida
    out.mkdir(parents=True, exist_ok=True)
    mn = MES[d["mes"] - 1]

    feitos = [
        img_resumo(out / "1-resumo-mtd.png", d),
        img_comentario(out / "2-comentario.png", d),
        tabela(out / "3-mudancas.png", "Mudanças Importantes",
               f"{dia_anterior_publicado(d['dia'])}/{mn} → {d['dia']}/{mn}",
               [("Indicador", "l", "txt"), ("Antes", "r", "txt"),
                ("Agora", "r", "txt"), ("Alerta", "l", "tag")],
               [list(m) for m in d["mud"]] or [["nada mudou", "—", "—", "Desceu"]]),
        img_consolidado(out / "4-consolidado.png", d),
    ]

    for p in feitos:
        im = Image.open(p)
        print(f"{Path(p).name:22s} {im.width}x{im.height}")
    print(f"\nDia {d['dia']:02d}/{d['mes']:02d}/{d['ano']} · pasta: {out}")


if __name__ == "__main__":
    main()
