# Gerenciamento de Designer — Demandas

Sistema web para gestão de demandas de design com indicadores operacionais, funis de status e relatórios executivos. Foco em clareza, fluidez e controle, com microinterações leves e tema dark-first.

## Visão Geral
- Frontend em React + Vite.
- Persistência e autenticação via Firebase (Firestore + Auth).
- Painéis de indicadores: Executivo, Dashboard e Relatórios.
- Gestão de Demandas, Cadastros de apoio, Configurações de tema e Usuários.
- Deploy estático via GitHub Pages (pasta `docs`) ou Firebase Hosting.

## Estrutura de Navegação
- `Executivo`: visão consolidada de saúde da operação e capacidade.
- `Dashboard`: produtividade e scorecard por designer com comparativos de período.
- `Demandas`: listagem, edição e acompanhamento por status.
- `Relatórios`: análises por período, funis e rankings.
- `Configurações`: variáveis de tema (design tokens) e preferências.
- `Cadastros`: manutenção de listas de apoio (status, tipos, plataformas, origens).
- `Usuários`: administração de perfis, permissões e senhas.

## Princípios de Filtro de Período
- Todos os filtros de período se baseiam no campo `prazo` da demanda.
- O intervalo é definido pelos campos `cIni` e `cFim` (YYYY-MM-DD), com seletor de datas inline.
- Períodos rápidos: Hoje, Semana, Próxima Semana, Mês, Mês Passado e Personalizado.

## Painéis e Indicadores

### Executivo
Indicadores calculados sobre o período ativo (base `prazo`):
- Concluídas: quantidade de demandas concluídas dentro do período.
- SLA geral: percentual de entregas concluídas no prazo (`dataConclusao <= prazo` sobre o total com `prazo` e `dataConclusao`).
- Lead Time médio: média de dias entre criação/solicitação e conclusão.
- Backlog em risco: demandas não concluídas com `prazo` em até 2 dias.
- Funil de Status: Criadas, Em Produção, Em Revisão e Concluídas, com percentuais relativos ao total do período.
- Capacidade utilizada: `ativosTotal / (capacityPerDay * daysInPeriod * designersCount)`; `capacityPerDay` padrão 4.
- Destaques:
  - Top Atraso: designer com mais itens atrasados (prazo passado). 
  - Top Lead: designer com maior lead médio (apenas concluídas no período).
  - Top Retrabalho: média de revisões por demanda criada no período.

### Dashboard
Comparativos “período atual vs. período anterior” (sempre baseados em `prazo`):
- Produção (Concluídas): concluições no intervalo corrente vs. anterior.
- SLA, Lead e Retrabalho: métricas no intervalo corrente vs. anterior.
- Scorecard por designer: concluições, SLA, lead, retrabalho e uso de capacidade.

### Relatórios
Análises operacionais por período (base `prazo`), incluindo:
- Distribuição por Status, Designer e Tipo de Mídia (quantidade e %).
- Funil de Status do período e evolução de produção.
- Rankings:
  - Top Atraso Period: itens não concluídos com prazo vencido.
  - Top Lead Period: maiores lead times nas concluídas do período.
  - Top Revisões: itens com mais revisões.
- Produção por dia (14 dias) baseada em `dataConclusao` para série temporal.

## Página de Demandas
- Busca textual e filtros por designer, status, tipo, origem, campanha.
- Edição rápida: título, prazos, responsáveis, status e revisões.
- Estados visuais e microinterações para hover, clique e carregamento.

## Usuários e Permissões
- Perfis: `comum`, `gerente`, `admin`.
- Criação de usuários é restrita a `admin` (UI desabilita botão e função valida perfil).
- Permissões por páginas e ações (criar, excluir, visualizar), editáveis em “Usuários”.

## Design Tokens e Microinterações
- Tema dark-first com variáveis (`:root`) para cores, espaçamento, raios e timing.
- Transições rápidas (~200ms), skeleton loaders, `CountUp` para números e `BarFill` animado.
- Tokens aplicados em cards, botões e componentes para consistência visual.

## Desenvolvimento Local
- Instalar dependências: `npm install`
- Rodar em desenvolvimento: `npm run dev`
- Build de produção (gera `docs/`): `npm run build`

## Deploy

### GitHub Pages
1. Build: `npm run build` (gera `docs/` com assets relativos).
2. Publicar:
   - Branch `main` com `docs/` e Pages configurado como `main` + folder `/docs`, ou
   - Branch `gh-pages` com conteúdo de `docs/`.
3. URL: `https://SEU_USUARIO.github.io/SEU_REPO/`

### Firebase Hosting (opcional)
- `firebase.json` já aponta `public: "docs"` e reescrita para SPA.
- Para usar Hosting, execute `firebase deploy` com projeto configurado.

## Integrações
- Firebase Auth e Firestore habilitados; funções na região `us-central1` para criação/atualização de usuários.
- `VITE_API_BASE` (opcional) para endpoints REST se necessário.

## Modelos e Campos-Chave
- Demanda: `titulo`, `designer`, `status`, `prazo`, `dataCriacao`/`dataSolicitacao`, `dataConclusao`, `revisoes`, `tipoMidia`, `origem`, `campanha`.
- Cálculos e filtros: todos os indicadores de período usam `prazo` como referência temporal.

## Boas Práticas e Segurança
- Sem exposição de segredos; use variáveis de ambiente em `.env` quando necessário.
- Controle de acesso no frontend (UI) e no backend (Functions/Firestore) conforme regras.

## Observações
- Chunks grandes são avisados no build; podem ser reduzidos com code-splitting.
- Datas devem estar em ISO `YYYY-MM-DD` para que filtros funcionem corretamente.

