# Sistema de Gestão de Captação - Imóvel Certo

Sistema web para gestão de demandas de locação e missões de captação de imóveis.

## Funcionalidades

- **Gestão de Demandas**: Criação e acompanhamento de demandas de locação
- **Sistema de Missões**: Atribuição automática de missões para captadores
- **Dashboard Executivo**: KPIs e métricas de performance
- **Quadro Kanban**: Visualização e gestão de missões por status
- **Relatórios**: Análise de performance e relatórios detalhados
- **Controle de Acesso**: Sistema de permissões por tipo de usuário e região

## Tipos de Usuário

- **Administrador**: Acesso total ao sistema
- **Diretor**: Acesso a todas as regiões
- **Gerente Regional**: Gestão de captadores em suas regiões
- **Captador**: Visualização e gestão de suas missões

## Tecnologias

- **Backend**: Node.js + Express
- **Frontend**: React (CDN)
- **Banco de Dados**: PostgreSQL
- **Deploy**: Railway

## Deploy

O sistema está configurado para deploy automático no Railway através do GitHub.

## Estrutura do Projeto

```
├── server.js              # Servidor principal
├── imovel_certo_app.html  # Frontend React
├── package.json           # Dependências
├── railway.json           # Configuração Railway
└── database.sql          # Scripts de banco
```

