-- Script de atualização do banco de dados para incluir sistema de relatórios e regiões
-- Incluindo Balneário Camboriú, Itajaí e gerente Lidiane
-- Autor: Sistema Manus
-- Data: Outubro 2025

-- 1. Adicionar coluna região aos usuários
ALTER TABLE usuarios ADD COLUMN regiao TEXT DEFAULT 'Geral';

-- 2. Adicionar coluna gerente_responsavel aos usuários captadores
ALTER TABLE usuarios ADD COLUMN gerente_responsavel_id INTEGER REFERENCES usuarios(id);

-- 3. Atualizar tipos de usuário para incluir gerente regional
-- Primeiro, vamos criar uma nova tabela temporária com a estrutura atualizada
CREATE TABLE usuarios_temp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('admin', 'gerente_regional', 'captador')),
    regiao TEXT DEFAULT 'Geral',
    regioes_responsavel TEXT, -- Para gerentes que cuidam de múltiplas regiões
    gerente_responsavel_id INTEGER REFERENCES usuarios(id),
    ativo BOOLEAN DEFAULT 1,
    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Copiar dados existentes, convertendo 'gerente' para 'admin'
INSERT INTO usuarios_temp (id, nome, email, senha, tipo, regiao, ativo, data_criacao)
SELECT id, nome, email, senha, 
       CASE WHEN tipo = 'gerente' THEN 'admin' ELSE tipo END,
       'Geral', ativo, data_criacao
FROM usuarios;

-- Substituir tabela original
DROP TABLE usuarios;
ALTER TABLE usuarios_temp RENAME TO usuarios;

-- 4. Adicionar colunas de auditoria às tabelas existentes
ALTER TABLE demandas ADD COLUMN criado_por_id INTEGER REFERENCES usuarios(id);
ALTER TABLE demandas ADD COLUMN regiao_demanda TEXT DEFAULT 'Geral';

ALTER TABLE missoes ADD COLUMN criado_por_id INTEGER REFERENCES usuarios(id);
ALTER TABLE missoes ADD COLUMN captador_id INTEGER REFERENCES usuarios(id);

-- 5. Criar tabela de relatórios
CREATE TABLE relatorios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('demandas', 'missoes', 'performance', 'geral')),
    filtros TEXT, -- JSON com filtros aplicados
    gerado_por_id INTEGER REFERENCES usuarios(id),
    regiao TEXT,
    data_inicio DATE,
    data_fim DATE,
    dados TEXT, -- JSON com dados do relatório
    data_geracao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Criar tabela de configurações regionais
CREATE TABLE configuracoes_regionais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    regiao TEXT NOT NULL UNIQUE,
    gerente_responsavel_id INTEGER REFERENCES usuarios(id),
    ativo BOOLEAN DEFAULT 1,
    configuracoes TEXT, -- JSON com configurações específicas da região
    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Inserir configurações regionais
INSERT INTO configuracoes_regionais (regiao, configuracoes) VALUES
('Itapema', '{"permissoes": ["gerenciar_captadores", "gerar_relatorios"], "restricoes": ["apenas_regiao_propria"]}'),
('Balneario_Camboriu', '{"permissoes": ["gerenciar_captadores", "gerar_relatorios"], "restricoes": ["multiplas_regioes"]}'),
('Itajai', '{"permissoes": ["gerenciar_captadores", "gerar_relatorios"], "restricoes": ["multiplas_regioes"]}'),
('Geral', '{"permissoes": ["acesso_total"], "restricoes": []}');

-- 8. Criar índices para performance
CREATE INDEX idx_usuarios_regiao ON usuarios(regiao);
CREATE INDEX idx_usuarios_gerente ON usuarios(gerente_responsavel_id);
CREATE INDEX idx_demandas_regiao ON demandas(regiao_demanda);
CREATE INDEX idx_missoes_captador ON missoes(captador_id);
CREATE INDEX idx_relatorios_regiao ON relatorios(regiao);
CREATE INDEX idx_relatorios_data ON relatorios(data_geracao);

-- 9. Criar views para relatórios
CREATE VIEW view_performance_captadores AS
SELECT 
    u.id,
    u.nome as captador_nome,
    u.regiao,
    COUNT(m.id) as total_missoes,
    COUNT(CASE WHEN m.status = 'Locado' THEN 1 END) as missoes_locadas,
    COUNT(CASE WHEN m.status = 'Encontrado' THEN 1 END) as missoes_encontradas,
    COUNT(CASE WHEN m.status = 'Em busca' THEN 1 END) as missoes_em_busca,
    ROUND(
        (COUNT(CASE WHEN m.status = 'Locado' THEN 1 END) * 100.0 / 
         NULLIF(COUNT(m.id), 0)), 2
    ) as taxa_sucesso
FROM usuarios u
LEFT JOIN missoes m ON u.nome = m.captador_responsavel
WHERE u.tipo = 'captador'
GROUP BY u.id, u.nome, u.regiao;

CREATE VIEW view_demandas_por_regiao AS
SELECT 
    regiao_demanda as regiao,
    COUNT(*) as total_demandas,
    COUNT(CASE WHEN DATE(data_solicitacao) >= DATE('now', '-30 days') THEN 1 END) as demandas_mes,
    COUNT(CASE WHEN DATE(data_solicitacao) >= DATE('now', '-7 days') THEN 1 END) as demandas_semana
FROM demandas
GROUP BY regiao_demanda;

-- 10. Inserir usuários regionais
-- Nota: As senhas serão hasheadas pelo sistema (123456 para todos)

-- Gerente de Itapema
INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES
('Gerente Itapema', 'gerente.itapema@imovelcerto.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'gerente_regional', 'Itapema');

-- Gerente de Balneário Camboriú e Itajaí (Lidiane)
INSERT INTO usuarios (nome, email, senha, tipo, regiao, regioes_responsavel) VALUES
('Lidiane Silva', 'lidiane@imovelcerto.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'gerente_regional', 'Balneario_Camboriu', 'Balneario_Camboriu,Itajai');

-- Captadores de Itapema
UPDATE usuarios SET regiao = 'Itapema' WHERE email IN ('bruna@imovelcerto.com', 'michele@imovelcerto.com');

-- Captadores de Balneário Camboriú e Itajaí
INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES
('Carlos Santos', 'carlos@imovelcerto.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'captador', 'Balneario_Camboriu'),
('Ana Costa', 'ana@imovelcerto.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'captador', 'Balneario_Camboriu'),
('Roberto Lima', 'roberto@imovelcerto.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'captador', 'Itajai'),
('Fernanda Oliveira', 'fernanda@imovelcerto.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'captador', 'Itajai');

-- 11. Inserir dados de exemplo para as novas regiões
INSERT INTO demandas (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, regiao_demanda, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes) VALUES
('BC-001', 'Lidiane', 'Maria Silva', '47999111222', 'Apartamento', 'Centro BC', 'Balneario_Camboriu', 'De 10mil a 12mil', 'Vista mar, 2 quartos', 'Até 15 dias', 'Cliente executivo'),
('BC-002', 'Lidiane', 'João Costa', '47999333444', 'Casa', 'Pioneiros', 'Balneario_Camboriu', 'De 15mil a 20mil', '3 quartos, garagem', 'Urgente', 'Família com pets'),
('ITJ-001', 'Lidiane', 'Pedro Santos', '47999555666', 'Apartamento', 'Centro Itajaí', 'Itajai', 'De 8mil a 10mil', '2 quartos, mobiliado', 'Até 7 dias', 'Jovem profissional'),
('ITJ-002', 'Lidiane', 'Ana Oliveira', '47999777888', 'Sala Comercial', 'Centro Itajaí', 'Itajai', 'De 5mil a 8mil', 'Boa localização', 'Até 15 dias', 'Novo negócio');

-- 12. Inserir missões de exemplo para as novas regiões
INSERT INTO missoes (codigo_demanda, captador_responsavel, consultor_solicitante, regiao_bairro, descricao_busca, status) VALUES
('BC-001', 'Carlos Santos', 'Lidiane', 'Centro BC', 'Apartamento vista mar, 2 quartos, até R$ 12mil', 'Em busca'),
('BC-002', 'Ana Costa', 'Lidiane', 'Pioneiros', 'Casa 3 quartos com garagem, aceita pets', 'Em busca'),
('ITJ-001', 'Roberto Lima', 'Lidiane', 'Centro Itajaí', 'Apartamento mobiliado 2 quartos', 'Encontrado'),
('ITJ-002', 'Fernanda Oliveira', 'Lidiane', 'Centro Itajaí', 'Sala comercial bem localizada', 'Em busca');

-- 13. Atualizar configurações de gerentes responsáveis
UPDATE configuracoes_regionais SET gerente_responsavel_id = (
    SELECT id FROM usuarios WHERE email = 'gerente.itapema@imovelcerto.com'
) WHERE regiao = 'Itapema';

UPDATE configuracoes_regionais SET gerente_responsavel_id = (
    SELECT id FROM usuarios WHERE email = 'lidiane@imovelcerto.com'
) WHERE regiao IN ('Balneario_Camboriu', 'Itajai');

-- 14. Criar função para verificar permissões multi-regionais
CREATE VIEW view_usuarios_regioes AS
SELECT 
    u.id,
    u.nome,
    u.email,
    u.tipo,
    u.regiao as regiao_principal,
    COALESCE(u.regioes_responsavel, u.regiao) as regioes_acesso
FROM usuarios u
WHERE u.ativo = 1;
