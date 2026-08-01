# Perda de Receita — dashboard Burger King / ZAMP

Site estático (`index.html` + `assets/chart.umd.min.js`) que mostra a perda de
receita por regional, alimentado por `data/dados.json` e `data/detalhe-mes.json`.
Publicado via Vercel (`vercel.json`).

## Atualização diária

Os dados vêm de um Excel exportado do Power BI (aba "Export": Marca,
Diretoria, Regional, BKN, Loja, Data, Hora, Canal, Motivo, Subcategoria,
Chamados, Perda de receita) e dos percentuais oficiais lidos na tela do BI
para cada regional + Brasil Total.

Comando (mesmo mês):
```
python3 scripts/gerar_dados.py --excel arquivo.xlsx --pct pct.json
```

`pct.json` — percentuais oficiais da tela do BI. Aceita o nome exibido no BI
ou a chave interna da regional. `BRASIL` é obrigatório:
```json
{ "BK É FOGO NORTE": 0.8, "SUL": 0.9, "BRASIL": 0.88 }
```

Antes de rodar, sempre confirmar com o usuário os percentuais oficiais do dia
(eles são lidos manualmente na tela do BI, não vêm no Excel).

## Virada de mês

Quando o Excel traz um mês novo, o script arquiva o mês corrente em
`historico` e cria o novo mês. É preciso informar os objetivos do mês
(Proj. Venda / Obj. Mês / Obj. Dia / nº restaurantes por regional):
```
python3 scripts/gerar_dados.py --excel agosto.xlsx --pct pct.json --objetivos objetivos.json
```
ou, para repetir os objetivos do mês anterior:
```
python3 scripts/gerar_dados.py --excel agosto.xlsx --pct pct.json --manter-objetivos
```

`objetivos.json` (mesmo formato de chaves de regional):
```json
{ "RJ": {"rest": 93, "projVenda": 45379559, "objMes": 335809, "objDia": 10833} }
```

## O que o script faz

1. Usa o `data/dados.json` atual para montar `anterior` (snapshot do ciclo
   anterior, usado na seção "Mudanças Importantes").
2. Lê o Excel e agrega por Regional+Data (R$) e o detalhamento completo por
   ocorrência (loja/hora/canal/categoria/chamado).
3. Aplica os percentuais oficiais informados.
4. Atualiza a aba Mensal (`regionaisData[reg]['2026'][mes]` e `brasil2026[mes]`).
5. Valida consistência (soma de `extra.acum` por regional == soma de
   `brasilVals`) antes de gravar.
6. Grava `data/dados.json` e `data/detalhe-mes.json`.

Rodar com `--dry-run` primeiro quando o Excel parecer estranho (datas de mais
de um mês, percentual faltando) — o script valida e mostra o resumo sem
gravar nada.

## Depois de gerar os dados

Conferir o resumo impresso no terminal (total Brasil acumulado, % oficial,
acumulado por regional) contra o que está na tela do BI antes de commitar.

Mensagem de commit no padrão usado no histórico do repo:
```
Atualizar dados: <Mês>/<Ano> até dia <ultimoDia> com percentuais oficiais do BI
```
(ou "Corrigir percentuais: ..." quando for uma correção de um dia já
publicado).

## O que falta documentar aqui

Este arquivo cobre o que dá pra inferir do código (`scripts/gerar_dados.py`).
Ainda não tem o conteúdo do "prompt mestre" que era usado antes de o processo
virar script — se houver alguma regra de negócio ou passo de conferência que
só existe nesse prompt e não no código acima, complementar esta seção.
