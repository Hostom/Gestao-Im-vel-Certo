// Importa as bibliotecas necessárias
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
    // Tabela usuarios
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('gerente', 'captador')),
        ativo BOOLEAN DEFAULT 1,
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela demandas
    db.run(`CREATE TABLE IF NOT EXISTS demandas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo_demanda TEXT UNIQUE NOT NULL,
        consultor_locacao TEXT NOT NULL,
        cliente_interessado TEXT NOT NULL,
        contato TEXT NOT NULL,
        tipo_imovel TEXT NOT NULL,
        regiao_desejada TEXT NOT NULL,
        faixa_aluguel TEXT NOT NULL,
        caracteristicas_desejadas TEXT,
        prazo_necessidade TEXT NOT NULL,
        observacoes TEXT,
        data_solicitacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela missoes
    db.run(`CREATE TABLE IF NOT EXISTS missoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        demanda_id INTEGER,
        codigo_demanda TEXT NOT NULL,
        captador_responsavel TEXT NOT NULL,
        consultor_solicitante TEXT NOT NULL,
        regiao_bairro TEXT NOT NULL,
        descricao_busca TEXT NOT NULL,
        status TEXT DEFAULT 'Em busca',
        data_missao DATETIME DEFAULT CURRENT_TIMESTAMP,
        data_retorno DATETIME,
        FOREIGN KEY (demanda_id) REFERENCES demandas (id)
    )`);

    // Tabela interacoes
    db.run(`CREATE TABLE IF NOT EXISTS interacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        missao_id INTEGER NOT NULL,
        usuario_id INTEGER NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('comentario', 'status_update', 'contato_cliente')),
        descricao TEXT NOT NULL,
        data_interacao DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (missao_id) REFERENCES missoes (id),
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    )`);

    // Inserir usuários padrão se não existirem
    db.get("SELECT COUNT(*) as count FROM usuarios", async (err, row) => {
        if (err) {
            console.error(err);
            return;
        }
        
        if (row.count === 0) {
            console.log("Criando usuários padrão...");
            
            const senhaHash = await bcrypt.hash('Adim2025', 10);
            
            // Usuário gerente
            db.run(`INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)`, 
                   ['Administrador', 'admin@imovelcerto.com', senhaHash, 'gerente']);
            
            // Usuários captadores
            const captadores = [
                ['Bruna Spinello', 'brunaspinello@crimoveis.com.br'],
                ['Michele Oliveira', 'michele@adimimoveis.com.br'],
                ['Morgana Barreto', 'morgana@adimimoveis.com.br']
            ];
            
            captadores.forEach(captador => {
                db.run(`INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)`, 
                       [captador[0], captador[1], senhaHash, 'captador']);
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
            
            // Inserir demandas de exemplo
            const demandas = [
                ['LOC-A1B2', 'Israel', 'João Silva', '4799257098', 'Apartamento', 'Centro', 'De 8mil a 10mil', 'Frente mar', 'Urgente', 'Cliente preferencial'],
                ['LOC-C3D4', 'Matheus', 'Maria Santos', '4799123456', 'Apartamento', 'Meia Praia', 'De 12mil a 15mil', '3 suítes, 2 vagas', 'Até 7 dias', 'Família com crianças'],
                ['LOC-E5F6', 'Bruna K', 'Pedro Costa', '4799876543', 'Casa', 'Pioneiros', 'De 20mil a 25mil', 'Cobertura duplex', 'Até 15 dias', 'Executivo']
            ];

            demandas.forEach((demanda, index) => {
                db.run(`INSERT INTO demandas (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, demanda, function(err) {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    
                    // Inserir missão correspondente
                    const captadores = ["Bruna Speinello", "Michele Oliveira", "Morgana Barreto"];
                    const status = ['Em busca', 'Encontrado', 'Locado'];
                    
                    db.run(`INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, consultor_solicitante, regiao_bairro, descricao_busca, status) 
                            VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                            [this.lastID, demanda[0], captadores[index], demanda[1], demanda[4], demanda[7], status[index]]);
                });
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

// Middleware para verificar se é gerente
const requireGerente = (req, res, next) => {
    if (req.user.tipo !== 'gerente') {
        return res.status(403).json({ error: 'Acesso negado. Apenas gerentes podem acessar esta funcionalidade.' });
    }
    next();
};

// --- Rotas de Autenticação ---

// POST /api/login - Fazer login
app.post('/api/login', (req, res) => {
    const { email, senha } = req.body;
    
    db.get('SELECT * FROM usuarios WHERE email = ? AND ativo = 1', [email], async (err, user) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro no servidor' });
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        
        const senhaValida = await bcrypt.compare(senha, user.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        
        const token = jwt.sign(
            { id: user.id, nome: user.nome, email: user.email, tipo: user.tipo },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                tipo: user.tipo
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
    
    // Se não for gerente, mostrar apenas as missões do próprio captador
    if (req.user.tipo === 'captador') {
        query = 'SELECT * FROM missoes WHERE captador_responsavel = ? ORDER BY data_missao DESC';
        params = [req.user.nome];
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }
        res.json(rows);
    });
});

// GET /api/demandas - Retorna todas as demandas (apenas gerentes)
app.get('/api/demandas', authenticateToken, requireGerente, (req, res) => {
    db.all('SELECT * FROM demandas ORDER BY data_solicitacao DESC', (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }
        res.json(rows);
    });
});

// GET /api/captadores - Retorna todos os captadores (apenas gerentes)
app.get('/api/captadores', authenticateToken, requireGerente, (req, res) => {
    db.all('SELECT id, nome, email, ativo, data_criacao FROM usuarios WHERE tipo = "captador"', (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }
        res.json(rows);
    });
});

// POST /api/captadores - Criar novo captador (apenas gerentes)
app.post('/api/captadores', authenticateToken, requireGerente, async (req, res) => {
    const { nome, email, senha } = req.body;
    
    try {
        const senhaHash = await bcrypt.hash(senha, 10);
        
        db.run('INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)', 
               [nome, email, senhaHash, 'captador'], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Email já está em uso' });
                }
                console.error(err.message);
                return res.status(500).send('Erro no servidor');
            }
            
            res.status(201).json({ 
                message: 'Captador criado com sucesso',
                id: this.lastID 
            });
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Erro no servidor');
    }
});

// PATCH /api/captadores/:id/status - Ativar/Inativar captador (apenas gerentes)
app.patch('/api/captadores/:id/status', authenticateToken, requireGerente, (req, res) => {
    const { id } = req.params;
    const { ativo } = req.body;
    
    db.run('UPDATE usuarios SET ativo = ? WHERE id = ? AND tipo = "captador"', [ativo, id], function(err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }
        
        if (this.changes === 0) {
            return res.status(404).send('Captador não encontrado.');
        }
        
        res.json({ message: 'Status do captador atualizado com sucesso' });
    });
});

// POST /api/demandas - Cria uma nova demanda (apenas gerentes)
app.post('/api/demandas', authenticateToken, requireGerente, (req, res) => {
    const { consultorLocacao, clienteInteressado, contato, tipoImovel, regiaoDesejada, faixaAluguel, caracteristicasDesejadas, prazoNecessidade, observacoes } = req.body;
    
    // Buscar captadores ativos
    db.all('SELECT nome FROM usuarios WHERE tipo = "captador" AND ativo = 1', (err, captadores) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }
        
        if (captadores.length === 0) {
            return res.status(400).json({ error: 'Nenhum captador ativo disponível' });
        }
        
        // Lógica da Roleta para definir o próximo captador
        db.get('SELECT captador_responsavel FROM missoes ORDER BY data_missao DESC LIMIT 1', (err, row) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Erro no servidor');
                return;
            }
            
            let proximoCaptador;
            const nomesCaptadores = captadores.map(c => c.nome);
            
            if (!row) {
                proximoCaptador = nomesCaptadores[0];
            } else {
                const ultimoCaptador = row.captador_responsavel;
                const ultimoIndex = nomesCaptadores.indexOf(ultimoCaptador);
                proximoCaptador = nomesCaptadores[(ultimoIndex + 1) % nomesCaptadores.length];
            }

            // Inserir nova demanda
            const codigoDemanda = `LOC-${Date.now().toString().slice(-6)}`;
            
            db.run(`INSERT INTO demandas (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                    [codigoDemanda, consultorLocacao, clienteInteressado, contato, tipoImovel, regiaoDesejada, faixaAluguel, caracteristicasDesejadas, prazoNecessidade, observacoes], 
                    function(err) {
                        if (err) {
                            console.error(err.message);
                            res.status(500).send('Erro no servidor');
                            return;
                        }
                        
                        const novaDemandaId = this.lastID;
                        
                        // Criar missão associada
                        db.run(`INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, consultor_solicitante, regiao_bairro, descricao_busca, status) 
                                VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                                [novaDemandaId, codigoDemanda, proximoCaptador, consultorLocacao, regiaoDesejada, caracteristicasDesejadas || 'Nova missão de captação', 'Em busca'], 
                                function(err) {
                                    if (err) {
                                        console.error(err.message);
                                        res.status(500).send('Erro no servidor');
                                        return;
                                    }
                                    
                                    res.status(201).json({ message: 'Demanda e missão criadas com sucesso!' });
                                });
                    });
        });
    });
});

// PATCH /api/missoes/:id/status - Atualiza o status de uma missão
app.patch('/api/missoes/:id/status', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    // Verificar se o captador pode atualizar esta missão
    let whereClause = 'WHERE id = ?';
    let params = [status, id];
    
    if (req.user.tipo === 'captador') {
        whereClause = 'WHERE id = ? AND captador_responsavel = ?';
        params = [status, id, req.user.nome];
    }
    
    let query;
    if (status === 'Encontrado' || status === 'Locado') {
        query = `UPDATE missoes SET status = ?, data_retorno = CURRENT_TIMESTAMP ${whereClause}`;
    } else {
        query = `UPDATE missoes SET status = ? ${whereClause}`;
    }

    db.run(query, params, function(err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }

        if (this.changes === 0) {
            return res.status(404).send('Missão não encontrada ou sem permissão para atualizar.');
        }

        // Registrar interação
        db.run('INSERT INTO interacoes (missao_id, usuario_id, tipo, descricao) VALUES (?, ?, ?, ?)',
               [id, req.user.id, 'status_update', `Status alterado para: ${status}`]);

        res.status(200).json({ message: 'Status da missão atualizado com sucesso.' });
    });
});

// POST /api/missoes/:id/interacoes - Adicionar interação a uma missão
app.post('/api/missoes/:id/interacoes', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { tipo, descricao } = req.body;
    
    // Verificar se a missão existe e se o captador tem acesso
    let query = 'SELECT id FROM missoes WHERE id = ?';
    let params = [id];
    
    if (req.user.tipo === 'captador') {
        query = 'SELECT id FROM missoes WHERE id = ? AND captador_responsavel = ?';
        params = [id, req.user.nome];
    }
    
    db.get(query, params, (err, missao) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }
        
        if (!missao) {
            return res.status(404).send('Missão não encontrada ou sem permissão para adicionar interação.');
        }
        
        db.run('INSERT INTO interacoes (missao_id, usuario_id, tipo, descricao) VALUES (?, ?, ?, ?)',
               [id, req.user.id, tipo, descricao], function(err) {
            if (err) {
                console.error(err.message);
                res.status(500).send('Erro no servidor');
                return;
            }
            
            res.status(201).json({ 
                message: 'Interação adicionada com sucesso',
                id: this.lastID 
            });
        });
    });
});

// GET /api/missoes/:id/interacoes - Obter interações de uma missão
app.get('/api/missoes/:id/interacoes', authenticateToken, (req, res) => {
    const { id } = req.params;
    
    // Verificar se a missão existe e se o usuário tem acesso
    let missaoQuery = 'SELECT id FROM missoes WHERE id = ?';
    let missaoParams = [id];
    
    if (req.user.tipo === 'captador') {
        missaoQuery = 'SELECT id FROM missoes WHERE id = ? AND captador_responsavel = ?';
        missaoParams = [id, req.user.nome];
    }
    
    db.get(missaoQuery, missaoParams, (err, missao) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }
        
        if (!missao) {
            return res.status(404).send('Missão não encontrada ou sem permissão para visualizar interações.');
        }
        
        db.all(`SELECT i.*, u.nome as usuario_nome 
                FROM interacoes i 
                JOIN usuarios u ON i.usuario_id = u.id 
                WHERE i.missao_id = ? 
                ORDER BY i.data_interacao DESC`, [id], (err, rows) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Erro no servidor');
                return;
            }
            res.json(rows);
        });
    });
});

// GET /api/relatorios/performance - Relatório de performance (apenas gerentes)
app.get('/api/relatorios/performance', authenticateToken, requireGerente, (req, res) => {
    const query = `
        SELECT 
            u.nome as captador,
            COUNT(m.id) as total_missoes,
            COUNT(CASE WHEN m.status = 'Encontrado' OR m.status = 'Locado' THEN 1 END) as encontrados,
            COUNT(CASE WHEN m.status = 'Locado' THEN 1 END) as locados,
            ROUND(
                (COUNT(CASE WHEN m.status = 'Locado' THEN 1 END) * 100.0 / COUNT(m.id)), 2
            ) as taxa_conversao,
            AVG(
                CASE 
                    WHEN m.data_retorno IS NOT NULL 
                    THEN (julianday(m.data_retorno) - julianday(m.data_missao)) * 24 
                END
            ) as tempo_medio_horas
        FROM usuarios u
        LEFT JOIN missoes m ON u.nome = m.captador_responsavel
        WHERE u.tipo = 'captador' AND u.ativo = 1
        GROUP BY u.id, u.nome
        ORDER BY locados DESC, tempo_medio_horas ASC
    `;
    
    db.all(query, (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro no servidor');
            return;
        }
        res.json(rows);
    });
});

// Inicia o servidor para ouvir requisições
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} com autenticação`);
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
