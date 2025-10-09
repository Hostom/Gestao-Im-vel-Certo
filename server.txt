const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');

// --- Configuração do Banco de Dados SQLite ---
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Chave secreta para JWT (em produção, use uma variável de ambiente)
const JWT_SECRET = 'sua_chave_secreta_muito_segura_aqui';

// Criar tabelas se não existirem
db.serialize(() => {
    // Tabela usuarios atualizada com suporte a múltiplas regiões
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
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
    )`);

    // Tabela demandas atualizada
    db.run(`CREATE TABLE IF NOT EXISTS demandas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo_demanda TEXT UNIQUE NOT NULL,
        consultor_locacao TEXT NOT NULL,
        cliente_interessado TEXT NOT NULL,
        contato TEXT NOT NULL,
        tipo_imovel TEXT NOT NULL,
        regiao_desejada TEXT NOT NULL,
        regiao_demanda TEXT DEFAULT 'Geral',
        faixa_aluguel TEXT NOT NULL,
        caracteristicas_desejadas TEXT,
        prazo_necessidade TEXT NOT NULL,
        observacoes TEXT,
        criado_por_id INTEGER REFERENCES usuarios(id),
        data_solicitacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela missoes atualizada
    db.run(`CREATE TABLE IF NOT EXISTS missoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        demanda_id INTEGER,
        codigo_demanda TEXT NOT NULL,
        captador_responsavel TEXT NOT NULL,
        captador_id INTEGER REFERENCES usuarios(id),
        consultor_solicitante TEXT NOT NULL,
        regiao_bairro TEXT NOT NULL,
        descricao_busca TEXT NOT NULL,
        status TEXT DEFAULT 'Em busca' CHECK (status IN ('Em busca', 'Encontrado', 'Locado')),
        data_missao DATETIME DEFAULT CURRENT_TIMESTAMP,
        data_retorno DATETIME,
        criado_por_id INTEGER REFERENCES usuarios(id),
        FOREIGN KEY (demanda_id) REFERENCES demandas (id)
    )`);

    // Tabela de interações
    db.run(`CREATE TABLE IF NOT EXISTS interacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        missao_id INTEGER NOT NULL,
        usuario_id INTEGER NOT NULL,
        usuario_nome TEXT NOT NULL,
        descricao TEXT NOT NULL,
        data_interacao DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (missao_id) REFERENCES missoes (id),
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    )`);

    // Nova tabela de relatórios
    db.run(`CREATE TABLE IF NOT EXISTS relatorios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('demandas', 'missoes', 'performance', 'geral')),
        filtros TEXT,
        gerado_por_id INTEGER REFERENCES usuarios(id),
        regiao TEXT,
        data_inicio DATE,
        data_fim DATE,
        dados TEXT,
        data_geracao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Nova tabela de configurações regionais
    db.run(`CREATE TABLE IF NOT EXISTS configuracoes_regionais (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        regiao TEXT NOT NULL UNIQUE,
        gerente_responsavel_id INTEGER REFERENCES usuarios(id),
        ativo BOOLEAN DEFAULT 1,
        configuracoes TEXT,
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Criar índices para performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_usuarios_regiao ON usuarios(regiao)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_usuarios_gerente ON usuarios(gerente_responsavel_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_demandas_regiao ON demandas(regiao_demanda)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_missoes_captador ON missoes(captador_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_relatorios_regiao ON relatorios(regiao)`);

    // Inserir usuários padrão se a tabela estiver vazia
    db.get("SELECT COUNT(*) as count FROM usuarios", async (err, row) => {
        if (err) {
            console.error(err);
            return;
        }
        
        if (row.count === 0) {
            console.log("Criando usuários padrão...");
            
            const senhaHash = await bcrypt.hash('Adim2025', 10);
            
            // Usuário admin
            db.run(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES (?, ?, ?, ?, ?)`, 
                   ['Administrador', 'admin@adimimoveis.com.br', senhaHash, 'admin', 'Geral']);
            
            // Gerente regional de Itapema
            db.run(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES (?, ?, ?, ?, ?)`, 
                   ['Gerente Itapema', 'pedro@adimimoveis.com.br', senhaHash, 'gerente_regional', 'Itapema']);
            
            // Gerente de Balneário Camboriú e Itajaí (Lidiane)
            db.run(`INSERT INTO usuarios (nome, email, senha, tipo, regiao, regioes_responsavel) VALUES (?, ?, ?, ?, ?, ?)`, 
                   ['Lidiane Silva', 'lidiane@adimimoveis.com.br', senhaHash, 'gerente_regional', 'Balneario_Camboriu', 'Balneario_Camboriu,Itajai']);
            
            // Usuários captadores de Itapema
            const captadoresItapema = [
                ['Jenifer de Souza', 'jenifer@adimimoveis.com.br', 'Itapema'],
            ];
            
            // Captadores de Balneário Camboriú e Itajaí
            const captadoresBC = [
                ['Michele Oliveira', 'michele@adimimoveis.com.br', 'Balneario_Camboriu'],
                ['Morgana Barreto', 'mrogana@adimimoveis.com.br', 'Balneario_Camboriu'],
                ['Bruna Spinello', 'brunaspinello@crimoveis.com.br', 'Balneario_Camboriu'],
                ['Michele Oliveira', 'michele@adimimoveis.com.br', 'Itajai'],
                ['Morgana Barreto', 'mrogana@adimimoveis.com.br', 'Itajai'],
                ['Bruna Spinello', 'brunaspinello@crimoveis.com.br', 'Itajai'],
            ];
            
            [...captadoresItapema, ...captadoresBC, ...captadorGeral].forEach(captador => {
                db.run(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES (?, ?, ?, ?, ?)`, 
                       [captador[0], captador[1], senhaHash, 'captador', captador[2]]);
            });
        }
    });

    // Inserir dados de exemplo se a tabela estiver vazia
    db.get("SELECT COUNT(*) as count FROM demandas", (err, row) => {
        if (err) {
            console.error(err);
            return;
        }
        
        if (row.count === 0) {
            console.log("Inserindo dados de exemplo...");
            
            // Inserir demandas de exemplo para todas as regiões
            const demandas = [
                // Itapema
                ['LOC-A1B2', 'Israel', 'João Silva', '4799257098', 'Apartamento', 'Centro', 'Itapema', 'De 8mil a 10mil', 'Frente mar', 'Urgente', 'Cliente preferencial'],
                ['LOC-C3D4', 'Matheus', 'Maria Santos', '4799123456', 'Apartamento', 'Meia Praia', 'Itapema', 'De 12mil a 15mil', '3 suítes, 2 vagas', 'Até 7 dias', 'Família com crianças'],
                
                // Balneário Camboriú
                ['BC-001', 'Lidiane', 'Maria Silva', '47999111222', 'Apartamento', 'Centro BC', 'Balneario_Camboriu', 'De 10mil a 12mil', 'Vista mar, 2 quartos', 'Até 15 dias', 'Cliente executivo'],
                ['BC-002', 'Lidiane', 'João Costa', '47999333444', 'Casa', 'Pioneiros', 'Balneario_Camboriu', 'De 15mil a 20mil', '3 quartos, garagem', 'Urgente', 'Família com pets'],
                
                // Itajaí
                ['ITJ-001', 'Lidiane', 'Pedro Santos', '47999555666', 'Apartamento', 'Centro Itajaí', 'Itajai', 'De 8mil a 10mil', '2 quartos, mobiliado', 'Até 7 dias', 'Jovem profissional'],
                ['ITJ-002', 'Lidiane', 'Ana Oliveira', '47999777888', 'Sala Comercial', 'Centro Itajaí', 'Itajai', 'De 5mil a 8mil', 'Boa localização', 'Até 15 dias', 'Novo negócio'],
                
                // Geral
                ['LOC-E5F6', 'Bruna K', 'Pedro Costa', '4799876543', 'Casa', 'Pioneiros', 'Geral', 'De 20mil a 25mil', 'Cobertura duplex', 'Até 15 dias', 'Executivo']
            ];

            demandas.forEach((demanda, index) => {
                db.run(`INSERT INTO demandas (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, regiao_demanda, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, demanda);
            });

            // Inserir missões de exemplo
            const missoes = [
                // Itapema
                [1, 'LOC-A1B2', 'Bruna Silva', 'Israel', 'Centro', 'Apartamento frente mar, 3 quartos', 'Em busca'],
                [2, 'LOC-C3D4', 'Michele Santos', 'Matheus', 'Meia Praia', '3 suítes, 2 vagas, área de lazer', 'Encontrado'],
                
                // Balneário Camboriú
                [3, 'BC-001', 'Carlos Santos', 'Lidiane', 'Centro BC', 'Apartamento vista mar, 2 quartos', 'Em busca'],
                [4, 'BC-002', 'Ana Costa', 'Lidiane', 'Pioneiros', 'Casa 3 quartos com garagem, aceita pets', 'Em busca'],
                
                // Itajaí
                [5, 'ITJ-001', 'Roberto Lima', 'Lidiane', 'Centro Itajaí', 'Apartamento mobiliado 2 quartos', 'Encontrado'],
                [6, 'ITJ-002', 'Fernanda Oliveira', 'Lidiane', 'Centro Itajaí', 'Sala comercial bem localizada', 'Em busca'],
                
                // Geral
                [7, 'LOC-E5F6', 'Morgana Costa', 'Bruna K', 'Pioneiros', 'Cobertura duplex com vista', 'Locado']
            ];

            missoes.forEach(missao => {
                db.run(`INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, consultor_solicitante, regiao_bairro, descricao_busca, status) 
                        VALUES (?, ?, ?, ?, ?, ?, ?)`, missao);
            });
        }
    });
});

// --- Configuração do Servidor Express ---
const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(session({
    secret: JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));
app.use(express.static(__dirname));

// --- Middleware de Autenticação ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de acesso requerido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
};

// Middleware para verificar se é admin
const requireAdmin = (req, res, next) => {
    if (req.user.tipo !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem acessar esta funcionalidade.' });
    }
    next();
};

// Middleware para verificar permissões regionais (atualizado para múltiplas regiões)
const verificarPermissaoRegional = (req, res, next) => {
    const user = req.user;
    
    // Admin tem acesso total
    if (user.tipo === 'admin') {
        return next();
    }
    
    // Gerente regional pode acessar suas regiões
    if (user.tipo === 'gerente_regional') {
        // Verificar se o gerente tem múltiplas regiões
        const regioes = user.regioes_responsavel ? user.regioes_responsavel.split(',') : [user.regiao];
        req.regioesPermitidas = regioes;
        return next();
    }
    
    // Captador só pode ver seus próprios dados
    if (user.tipo === 'captador') {
        req.captadorId = user.id;
        req.regiaoPermitida = user.regiao;
        return next();
    }
    
    return res.status(403).json({ error: 'Acesso negado' });
};

// --- Rotas de Autenticação ---

// POST /api/login - Fazer login
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    
    if (!email || !senha) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }
    
    db.get("SELECT * FROM usuarios WHERE email = ? AND ativo = 1", [email], async (err, user) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro interno do servidor' });
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        
        const senhaValida = await bcrypt.compare(senha, user.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        
        const token = jwt.sign(
            { 
                id: user.id, 
                nome: user.nome, 
                email: user.email, 
                tipo: user.tipo,
                regiao: user.regiao,
                regioes_responsavel: user.regioes_responsavel
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                tipo: user.tipo,
                regiao: user.regiao,
                regioes_responsavel: user.regioes_responsavel
            }
        });
    });
});

// POST /api/logout - Fazer logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logout realizado com sucesso' });
});

// --- Rotas da API (Endpoints) ---

// Rota principal para servir o frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/imovel_certo_app.html');
});

// GET /api/me - Obter dados do usuário logado
app.get('/api/me', authenticateToken, (req, res) => {
    res.json(req.user);
});

// GET /api/missoes - Retorna missões (filtradas por captador se não for gerente)
app.get('/api/missoes', authenticateToken, (req, res) => {
    let query = 'SELECT * FROM missoes ORDER BY data_missao DESC';
    let params = [];
    
    // Se for captador, mostrar apenas as missões do próprio captador
    if (req.user.tipo === 'captador') {
        query = 'SELECT * FROM missoes WHERE captador_responsavel = ? ORDER BY data_missao DESC';
        params = [req.user.nome];
    }
    // Se for gerente regional, mostrar apenas missões das suas regiões
    else if (req.user.tipo === 'gerente_regional') {
        const regioes = req.user.regioes_responsavel ? req.user.regioes_responsavel.split(',') : [req.user.regiao];
        const placeholders = regioes.map(() => '?').join(',');
        query = `SELECT m.* FROM missoes m 
                 LEFT JOIN demandas d ON m.codigo_demanda = d.codigo_demanda 
                 WHERE d.regiao_demanda IN (${placeholders}) OR d.regiao_demanda IS NULL
                 ORDER BY m.data_missao DESC`;
        params = regioes;
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro interno do servidor' });
        }
        res.json(rows);
    });
});

// GET /api/demandas - Retorna demandas
app.get('/api/demandas', authenticateToken, (req, res) => {
    let query = 'SELECT * FROM demandas ORDER BY data_solicitacao DESC';
    let params = [];
    
    // Se for gerente regional, mostrar apenas demandas das suas regiões
    if (req.user.tipo === 'gerente_regional') {
        const regioes = req.user.regioes_responsavel ? req.user.regioes_responsavel.split(',') : [req.user.regiao];
        const placeholders = regioes.map(() => '?').join(',');
        query = `SELECT * FROM demandas WHERE regiao_demanda IN (${placeholders}) ORDER BY data_solicitacao DESC`;
        params = regioes;
    }
    // Captadores não podem ver demandas
    else if (req.user.tipo === 'captador') {
        return res.status(403).json({ error: 'Captadores não têm acesso às demandas' });
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro interno do servidor' });
        }
        res.json(rows);
    });
});

// Rotas de relatórios (adaptadas para múltiplas regiões)
// GET /api/relatorios/dashboard - Dashboard com métricas gerais
app.get('/api/relatorios/dashboard', authenticateToken, verificarPermissaoRegional, (req, res) => {
    const user = req.user;
    let whereClause = '';
    let params = [];
    
    // Filtrar por regiões se for gerente regional
    if (user.tipo === 'gerente_regional') {
        const regioes = req.regioesPermitidas;
        const placeholders = regioes.map(() => '?').join(',');
        whereClause = `WHERE regiao_demanda IN (${placeholders})`;
        params = regioes;
    }
    
    // Query para métricas do dashboard
    const queries = {
        totalDemandas: `SELECT COUNT(*) as total FROM demandas ${whereClause}`,
        demandasMes: `SELECT COUNT(*) as total FROM demandas ${whereClause} ${whereClause ? 'AND' : 'WHERE'} DATE(data_solicitacao) >= DATE('now', '-30 days')`,
        totalMissoes: `SELECT COUNT(*) as total FROM missoes m LEFT JOIN demandas d ON m.codigo_demanda = d.codigo_demanda ${whereClause}`,
        missoesLocadas: `SELECT COUNT(*) as total FROM missoes m LEFT JOIN demandas d ON m.codigo_demanda = d.codigo_demanda ${whereClause} ${whereClause ? 'AND' : 'WHERE'} m.status = 'Locado'`
    };
    
    const resultados = {};
    let queryCount = 0;
    const totalQueries = Object.keys(queries).length;
    
    Object.entries(queries).forEach(([key, query]) => {
        db.get(query, params, (err, row) => {
            if (err) {
                console.error(`Erro na query ${key}:`, err);
                return res.status(500).json({ error: 'Erro interno do servidor' });
            }
            
            resultados[key] = row.total;
            queryCount++;
            
            if (queryCount === totalQueries) {
                // Calcular taxa de sucesso
                resultados.taxaSucesso = resultados.totalMissoes > 0 
                    ? ((resultados.missoesLocadas / resultados.totalMissoes) * 100).toFixed(2)
                    : 0;
                
                res.json(resultados);
            }
        });
    });
});

// GET /api/relatorios/performance-captadores - Performance dos captadores
app.get('/api/relatorios/performance-captadores', authenticateToken, verificarPermissaoRegional, (req, res) => {
    const user = req.user;
    let whereClause = '';
    let params = [];
    
    if (user.tipo === 'gerente_regional') {
        const regioes = req.regioesPermitidas;
        const placeholders = regioes.map(() => '?').join(',');
        whereClause = `WHERE u.regiao IN (${placeholders})`;
        params = regioes;
    } else if (user.tipo === 'captador') {
        whereClause = 'WHERE u.id = ?';
        params = [user.id];
    }
    
    const query = `
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
        ${whereClause}
        AND u.tipo = 'captador'
        GROUP BY u.id, u.nome, u.regiao
        ORDER BY missoes_locadas DESC, taxa_sucesso DESC
    `;
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Erro ao buscar performance dos captadores:', err);
            return res.status(500).json({ error: 'Erro interno do servidor' });
        }
        res.json(rows);
    });
});

// Outras rotas existentes do sistema original...
// [Aqui continuariam todas as outras rotas do sistema original]

// Inicia o servidor para ouvir requisições
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} com autenticação e relatórios multi-regionais`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Conexão com o banco de dados fechada.');
        process.exit(0);
    });
});
