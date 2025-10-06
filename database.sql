-- Este script SQL cria as tabelas necessárias para a aplicação no banco de dados PostgreSQL.
-- Você deve executar este script na aba "Data" do seu serviço PostgreSQL no Railway.

-- Tabela para armazenar as demandas de locação
CREATE TABLE demandas (
    id SERIAL PRIMARY KEY,
    codigo_demanda VARCHAR(20) UNIQUE,
    data_solicitacao TIMESTAMPTZ DEFAULT NOW(),
    consultor_locacao VARCHAR(100) NOT NULL,
    cliente_interessado VARCHAR(255) NOT NULL,
    contato VARCHAR(100),
    tipo_imovel VARCHAR(100),
    regiao_desejada VARCHAR(255),
    faixa_aluguel NUMERIC,
    caracteristicas_desejadas TEXT,
    prazo_necessidade VARCHAR(50),
    observacoes TEXT
);

-- Tabela para armazenar as missões de captação
CREATE TABLE missoes (
    id SERIAL PRIMARY KEY,
    demanda_id INTEGER REFERENCES demandas(id),
    codigo_demanda VARCHAR(20),
    data_missao TIMESTAMPTZ DEFAULT NOW(),
    captador_responsavel VARCHAR(100) NOT NULL,
    consultor_solicitante VARCHAR(100),
    regiao_bairro VARCHAR(255),
    descricao_busca TEXT,
    status VARCHAR(50) DEFAULT 'Em busca',
    data_retorno TIMESTAMPTZ
);

-- Inserir alguns dados de exemplo (opcional, para teste)
INSERT INTO demandas (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade) VALUES
('LOC-A1B2', 'Matheus', 'Thiago', '606060606', 'Apartamento', 'Centro', 8000, 'Frente mar', 'Urgente');

INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, consultor_solicitante, regiao_bairro, descricao_busca, status, data_retorno) VALUES
(1, 'LOC-A1B2', 'Bruna S', 'Matheus', 'Centro', 'Frente mar', 'Em busca', NULL),
(NULL, 'LOC-C3D4', 'Michele', 'Israel', 'Meia Praia', '3 suítes, 2 vagas', 'Encontrado', NOW() - INTERVAL '2 hours'),
(NULL, 'LOC-E5F6', 'Morgana', 'Bruna K', 'Pioneiros', 'Cobertura duplex', 'Locado', NOW() - INTERVAL '90 hours');
