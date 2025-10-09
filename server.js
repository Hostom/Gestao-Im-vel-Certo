const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const session = require("express-session");
const path = require("path");

// --- Configuração do Banco de Dados PostgreSQL ---
const DATABASE_URL = process.env.DATABASE_URL; // Railway fornece DATABASE_URL
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Chave secreta para JWT (em produção, use uma variável de ambiente)
const JWT_SECRET = process.env.JWT_SECRET || "sua_chave_secreta_muito_segura_aqui";

async function initializeDb() {
    let client; // Declare client here to ensure it\\\\'s always defined
    try {
        client = await pool.connect();
        console.log("Conectado ao PostgreSQL!");

        // Criar/Atualizar tabelas (adaptado para PostgreSQL com ALTER TABLE)
        await client.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL,
                tipo TEXT NOT NULL CHECK (tipo IN ('admin', 'gerente_regional', 'captador')),
                regiao TEXT DEFAULT 'Geral',
                regioes_responsavel TEXT,
                gerente_responsavel_id INTEGER REFERENCES usuarios(id),
                ativo BOOLEAN DEFAULT TRUE,
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Adicionar colunas se não existirem
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='regioes_responsavel') THEN
                    ALTER TABLE usuarios ADD COLUMN regioes_responsavel TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='gerente_responsavel_id') THEN
                    ALTER TABLE usuarios ADD COLUMN gerente_responsavel_id INTEGER REFERENCES usuarios(id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='ativo') THEN
                    ALTER TABLE usuarios ADD COLUMN ativo BOOLEAN DEFAULT TRUE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='data_criacao') THEN
                    ALTER TABLE usuarios ADD COLUMN data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END
            $$;

            CREATE TABLE IF NOT EXISTS demandas (
                id SERIAL PRIMARY KEY,
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
                data_solicitacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demandas' AND column_name='regiao_demanda') THEN
                    ALTER TABLE demandas ADD COLUMN regiao_demanda TEXT DEFAULT 'Geral';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demandas' AND column_name='criado_por_id') THEN
                    ALTER TABLE demandas ADD COLUMN criado_por_id INTEGER REFERENCES usuarios(id);
                END IF;
            END
            $$;

            CREATE TABLE IF NOT EXISTS missoes (
                id SERIAL PRIMARY KEY,
                demanda_id INTEGER REFERENCES demandas(id),
                codigo_demanda TEXT NOT NULL,
                captador_responsavel TEXT NOT NULL,
                captador_id INTEGER REFERENCES usuarios(id),
                consultor_solicitante TEXT NOT NULL,
                regiao_bairro TEXT NOT NULL,
                descricao_busca TEXT NOT NULL,
                status TEXT DEFAULT 'Em busca' CHECK (status IN ('Em busca', 'Encontrado', 'Locado')),
                data_missao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                data_retorno TIMESTAMP,
                criado_por_id INTEGER REFERENCES usuarios(id)
            );

            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='missoes' AND column_name='captador_id') THEN
                    ALTER TABLE missoes ADD COLUMN captador_id INTEGER REFERENCES usuarios(id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='missoes' AND column_name='criado_por_id') THEN
                    ALTER TABLE missoes ADD COLUMN criado_por_id INTEGER REFERENCES usuarios(id);
                END IF;
            END
            $$;

            CREATE TABLE IF NOT EXISTS interacoes (
                id SERIAL PRIMARY KEY,
                missao_id INTEGER NOT NULL REFERENCES missoes(id),
                usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
                usuario_nome TEXT NOT NULL,
                descricao TEXT NOT NULL,
                data_interacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS relatorios (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                tipo TEXT NOT NULL CHECK (tipo IN ('demandas', 'missoes', 'performance', 'geral')),
                filtros TEXT,
                gerado_por_id INTEGER REFERENCES usuarios(id),
                regiao TEXT,
                data_inicio DATE,
                data_fim DATE,
                dados TEXT,
                data_geracao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS configuracoes_regionais (
                id SERIAL PRIMARY KEY,
                regiao TEXT NOT NULL UNIQUE,
                gerente_responsavel_id INTEGER REFERENCES usuarios(id),
                ativo BOOLEAN DEFAULT TRUE,
                configuracoes TEXT,
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_usuarios_regiao ON usuarios(regiao);
            CREATE INDEX IF NOT EXISTS idx_usuarios_gerente ON usuarios(gerente_responsavel_id);
            CREATE INDEX IF NOT EXISTS idx_demandas_regiao ON demandas(regiao_demanda);
            CREATE INDEX IF NOT EXISTS idx_missoes_captador ON missoes(captador_id);
            CREATE INDEX IF NOT EXISTS idx_relatorios_regiao ON relatorios(regiao);
        `);
        console.log("Tabelas verificadas/criadas/atualizadas no PostgreSQL.");

        // Inserir usuários padrão se a tabela estiver vazia
        const { rows: userCount } = await client.query("SELECT COUNT(*) as count FROM usuarios");
        if (parseInt(userCount[0].count) === 0) {
            console.log("Criando usuários padrão no PostgreSQL...");
            const senhaHash = await bcrypt.hash("Adim2025", 10);

            await client.query(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES ($1, $2, $3, $4, $5)`, 
                   ["Administrador", "admin@adimimoveis.com.br", senhaHash, "admin", "Geral"]);
            
            await client.query(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES ($1, $2, $3, $4, $5)`, 
                   ["Gerente Itapema", "pedro@adimimoveis.com.br", senhaHash, "gerente_regional", "Itapema"]);
            
            await client.query(`INSERT INTO usuarios (nome, email, senha, tipo, regiao, regioes_responsavel) VALUES ($1, $2, $3, $4, $5, $6)`, 
                   ["Lidiane Silva", "lidiane@adimimoveis.com.br", senhaHash, "gerente_regional", "Balneario_Camboriu", "Balneario_Camboriu,Itajai"]);
            
            const captadoresItapema = [
                ["Jenifer de Souza", "jenifer@adimimoveis.com.br", "Itapema"],
            ];
            
            const captadoresBalnearioCamboriu = [
                ["Carlos Santos", "carlos@adimimoveis.com.br", "Balneario_Camboriu"],
                ["Ana Costa", "ana@adimimoveis.com.br", "Balneario_Camboriu"],
            ];

            const captadoresItajai = [
                ["Roberto Lima", "roberto@adimimoveis.com.br", "Itajai"],
                ["Fernanda Oliveira", "fernanda@adimimoveis.com.br", "Itajai"],
            ];
            
            const todosCaptadores = [...captadoresItapema, ...captadoresBalnearioCamboriu, ...captadoresItajai];

            for (const captador of todosCaptadores) {
                await client.query(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES ($1, $2, $3, $4, $5)`, 
                                 [captador[0], captador[1], senhaHash, "captador", captador[2]]);
            }
            console.log("Usuários padrão inseridos no PostgreSQL.");
        }

        // Inserir dados de exemplo se a tabela estiver vazia
        const { rows: demandaCount } = await client.query("SELECT COUNT(*) as count FROM demandas");
        if (parseInt(demandaCount[0].count) === 0) {
            console.log("Inserindo dados de exemplo no PostgreSQL...");
            const demandas = [
                ["LOC-A1B2", "Israel", "João Silva", "4799257098", "Apartamento", "Centro", "Itapema", "De 8mil a 10mil", "Frente mar", "Urgente", "Cliente preferencial"],
                ["LOC-C3D4", "Matheus", "Maria Santos", "4799123456", "Apartamento", "Meia Praia", "Itapema", "De 12mil a 15mil", "3 suítes, 2 vagas", "Até 7 dias", "Família com crianças"],
                ["BC-001", "Lidiane", "Maria Silva", "47999111222", "Apartamento", "Centro BC", "Balneario_Camboriu", "De 10mil a 12mil", "Vista mar, 2 quartos", "Até 15 dias", "Cliente executivo"],
                ["BC-002", "Lidiane", "João Costa", "47999333444", "Casa", "Pioneiros", "Balneario_Camboriu", "De 15mil a 20mil", "3 quartos, garagem", "Urgente", "Família com pets"],
                ["ITJ-001", "Lidiane", "Pedro Santos", "47999555666", "Apartamento", "Centro Itajaí", "Itajai", "De 8mil a 10mil", "2 quartos, mobiliado", "Até 7 dias", "Jovem profissional"],
                ["ITJ-002", "Lidiane", "Ana Oliveira", "47999777888", "Sala Comercial", "Centro Itajaí", "Itajai", "De 5mil a 8mil", "Boa localização", "Até 15 dias", "Novo negócio"],
                ["LOC-E5F6", "Bruna K", "Pedro Costa", "4799876543", "Casa", "Pioneiros", "Geral", "De 20mil a 25mil", "Cobertura duplex", "Até 15 dias", "Executivo"]
            ];

            for (const demanda of demandas) {
                await client.query(`INSERT INTO demandas (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, regiao_demanda, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes) 
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, demanda);
            }

            const missoes = [
                [1, "LOC-A1B2", "Bruna Silva", "Israel", "Centro", "Apartamento frente mar, 3 quartos", "Em busca"],
                [2, "LOC-C3D4", "Michele Santos", "Matheus", "Meia Praia", "3 suítes, 2 vagas, área de lazer", "Encontrado"],
                [3, "BC-001", "Carlos Santos", "Lidiane", "Centro BC", "Apartamento vista mar, 2 quartos", "Em busca"],
                [4, "BC-002", "Ana Costa", "Lidiane", "Pioneiros", "Casa 3 quartos com garagem, aceita pets", "Em busca"],
                [5, "ITJ-001", "Roberto Lima", "Lidiane", "Centro Itajaí", "Apartamento mobiliado 2 quartos", "Encontrado"],
                [6, "ITJ-002", "Fernanda Oliveira", "Lidiane", "Centro Itajaí", "Sala comercial bem localizada", "Em busca"],
                [7, "LOC-E5F6", "Morgana Costa", "Bruna K", "Pioneiros", "Cobertura duplex com vista", "Locado"]
            ];

            for (const missao of missoes) {
                await client.query(`INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, consultor_solicitante, regiao_bairro, descricao_busca, status) 
                                 VALUES ($1, $2, $3, $4, $5, $6, $7)`, missao);
            }
            console.log("Dados de exemplo inseridos no PostgreSQL.");
        }
    } catch (err) {
        console.error("Erro na inicialização do banco de dados PostgreSQL:", err);
    } finally {
        if (client) {
            client.release(); // Libera o cliente de volta para o pool apenas se estiver definido
        }
    }
}

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

// Serve arquivos estáticos (se houver um frontend)
// Serve arquivos estáticos (se houver um frontend)
// app.use(express.static(path.join(__dirname)));

// Rota para servir o arquivo HTML principal para todas as outras requisições
// app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, 'imovel_certo_app.html'));
// });

// --- Middleware de Autenticação ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Token de acesso requerido" });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Token inválido" });
        }
        req.user = user;
        next();
    });
};

// Middleware para verificar se é admin
const requireAdmin = (req, res, next) => {
    if (req.user.tipo !== "admin") {
        return res.status(403).json({ error: "Acesso negado. Apenas administradores podem acessar esta funcionalidade." });
    }
    next();
};

// Middleware para verificar permissões regionais (atualizado para múltiplas regiões)
const verificarPermissaoRegional = (req, res, next) => {
    const user = req.user;
    
    // Admin tem acesso total
    if (user.tipo === "admin") {
        return next();
    }
    
    // Gerente regional pode acessar suas regiões
    if (user.tipo === "gerente_regional") {
        const regioes = user.regioes_responsavel ? user.regioes_responsavel.split(",") : [user.regiao];
        req.regioesPermitidas = regioes;
        return next();
    }
    
    // Captador só pode ver seus próprios dados
    if (user.tipo === "captador") {
        req.captadorId = user.id;
        req.regiaoPermitida = user.regiao;
        return next();
    }
    
    return res.status(403).json({ error: "Acesso negado" });
};

// --- Rotas de Autenticação ---

// POST /api/login - Fazer login
app.post("/api/login", async (req, res) => {
    const { email, senha } = req.body;
    
    if (!email || !senha) {
        return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }
    
    try {
        const client = await pool.connect();
        const { rows } = await client.query("SELECT * FROM usuarios WHERE email = $1 AND ativo = TRUE", [email]);
        const user = rows[0];
        client.release();

        if (!user) {
            return res.status(401).json({ error: "Credenciais inválidas" });
        }
        
        const senhaValida = await bcrypt.compare(senha, user.senha);
        if (!senhaValida) {
            return res.status(401).json({ error: "Credenciais inválidas" });
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
            { expiresIn: "24h" }
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
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// POST /api/logout - Fazer logout
app.post("/api/logout", (req, res) => {
    req.session.destroy();
    res.json({ message: "Logout realizado com sucesso" });
});

// --- Rotas da API (Endpoints) ---

// Rota principal para servir o frontend
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/imovel_certo_app.html");
});

// GET /api/me - Obter dados do usuário logado
app.get("/api/me", authenticateToken, (req, res) => {
    res.json(req.user);
});

// GET /api/missoes - Retorna missões (filtradas por captador se não for gerente)
app.get("/api/missoes", authenticateToken, async (req, res) => {
    let query = `SELECT * FROM missoes ORDER BY data_missao DESC`;
    let params = [];
    
    // Se for captador, mostrar apenas as missões do próprio captador
    if (req.user.tipo === "captador") {
        query = `SELECT * FROM missoes WHERE captador_id = $1 ORDER BY data_missao DESC`;
        params = [req.user.id];
    }
    // Se for gerente regional, mostrar apenas missões das suas regiões
    else if (req.user.tipo === "gerente_regional") {
        const regioes = req.user.regioes_responsavel ? req.user.regioes_responsavel.split(",") : [req.user.regiao];
        const placeholders = regioes.map((_, i) => `$${i + 1}`).join(",");
        query = `SELECT m.* FROM missoes m 
                 LEFT JOIN demandas d ON m.codigo_demanda = d.codigo_demanda 
                 WHERE d.regiao_demanda IN (${placeholders}) OR d.regiao_demanda IS NULL
                 ORDER BY m.data_missao DESC`;
        params = regioes;
    }
    
    try {
        const client = await pool.connect();
        const { rows } = await client.query(query, params);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// GET /api/demandas - Retorna demandas
app.get("/api/demandas", authenticateToken, async (req, res) => {
    let query = `SELECT * FROM demandas ORDER BY data_solicitacao DESC`;
    let params = [];
    
    // Se for gerente regional, mostrar apenas demandas das suas regiões
    if (req.user.tipo === "gerente_regional") {
        const regioes = req.user.regioes_responsavel ? req.user.regioes_responsavel.split(",") : [req.user.regiao];
        const placeholders = regioes.map((_, i) => `$${i + 1}`).join(",");
        query = `SELECT * FROM demandas WHERE regiao_demanda IN (${placeholders}) ORDER BY data_solicitacao DESC`;
        params = regioes;
    }
    
    try {
        const client = await pool.connect();
        const { rows } = await client.query(query, params);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// GET /api/usuarios - Retorna todos os usuários (apenas para admin)
app.get("/api/usuarios", authenticateToken, requireAdmin, async (req, res) => {
    try {
        const client = await pool.connect();
        const { rows } = await client.query(`SELECT id, nome, email, tipo, regiao, regioes_responsavel, ativo FROM usuarios ORDER BY nome`);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// GET /api/usuarios/captadores - Retorna apenas captadores (para gerentes regionais)
app.get("/api/usuarios/captadores", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    let query = `SELECT id, nome, email, regiao FROM usuarios WHERE tipo = 'captador' ORDER BY nome`;
    let params = [];

    if (req.user.tipo === "gerente_regional") {
        const placeholders = req.regioesPermitidas.map((_, i) => `$${i + 1}`).join(",");
        query = `SELECT id, nome, email, regiao FROM usuarios WHERE tipo = 'captador' AND regiao IN (${placeholders}) ORDER BY nome`;
        params = req.regioesPermitidas;
    }

    try {
        const client = await pool.connect();
        const { rows } = await client.query(query, params);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// POST /api/demandas - Adicionar nova demanda
app.post("/api/demandas", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    let { codigoDemanda, consultorLocacao, clienteInteressado, contato, tipoImovel, regiaoDesejada, faixaAluguel, caracteristicasDesejadas, prazoNecessidade, observacoes, regiaoDemanda } = req.body;

    // Mapear nomes de campos do frontend (camelCase) para o backend (snake_case)
    const mappedBody = {
        codigo_demanda: codigoDemanda,
        consultor_locacao: consultorLocacao,
        cliente_interessado: clienteInteressado,
        contato: contato,
        tipo_imovel: tipoImovel,
        regiao_desejada: regiaoDesejada,
        faixa_aluguel: faixaAluguel,
        caracteristicas_desejadas: caracteristicasDesejadas,
        prazo_necessidade: prazoNecessidade,
        observacoes: observacoes,
        regiao_demanda: regiaoDemanda
    };

    // Gerar codigo_demanda se não for fornecido
    if (!mappedBody.codigo_demanda) {
        mappedBody.codigo_demanda = `DEM-${Date.now()}`;
    }

    // Validar campos obrigatórios (usando os nomes mapeados)
    if (!mappedBody.codigo_demanda || !mappedBody.consultor_locacao || !mappedBody.cliente_interessado || !mappedBody.contato || !mappedBody.tipo_imovel || !mappedBody.regiao_desejada || !mappedBody.faixa_aluguel || !mappedBody.prazo_necessidade) {
        return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });
    }

text = ""


    // Validar permissão regional para a demanda
    if (req.user.tipo === "gerente_regional" && !req.regioesPermitidas.includes(regiao_demanda)) {
        return res.status(403).json({ error: "Acesso negado. Você não tem permissão para adicionar demandas nesta região." });
    }

    // Validar permissão regional para a demanda
    if (req.user.tipo === "gerente_regional" && !req.regioesPermitidas.includes(regiao_demanda)) {
        return res.status(403).json({ error: "Acesso negado. Você não tem permissão para adicionar demandas nesta região." });
    }

    try {
        const client = await pool.connect();
        const { rows } = await client.query(
            `INSERT INTO demandas (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, regiao_demanda, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes, criado_por_id)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'Geral'), $8, $9, $10, $11, $12) RETURNING *`,
            [codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, regiao_demanda, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes, req.user.id]
        );
        client.release();
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor ao adicionar demanda." });
    }
});

// POST /api/missoes - Adicionar nova missão
app.post("/api/missoes", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    const { demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status } = req.body;

    if (!demanda_id || !codigo_demanda || !captador_responsavel || !captador_id || !consultor_solicitante || !regiao_bairro || !descricao_busca) {
        return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });
    }

    try {
        const client = await pool.connect();
        // Verificar a região da demanda associada para permissão
        const { rows: demandaRows } = await client.query("SELECT regiao_demanda FROM demandas WHERE id = $1", [demanda_id]);
        if (demandaRows.length === 0) {
            client.release();
            return res.status(404).json({ error: "Demanda não encontrada." });
        }
        const regiaoDemanda = demandaRows[0].regiao_demanda;

        if (req.user.tipo === "gerente_regional" && !req.regioesPermitidas.includes(regiaoDemanda)) {
            client.release();
            return res.status(403).json({ error: "Acesso negado. Você não tem permissão para adicionar missões para demandas nesta região." });
        }

        const { rows } = await client.query(
            `INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status, criado_por_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status || "Em busca", req.user.id]
        );
        client.release();
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor ao adicionar missão." });
    }
});

// PUT /api/missoes/:id - Atualizar missão
app.put("/api/missoes/:id", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    const { id } = req.params;
    const { demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status, data_retorno } = req.body;

    if (!demanda_id || !codigo_demanda || !captador_responsavel || !captador_id || !consultor_solicitante || !regiao_bairro || !descricao_busca || !status) {
        return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });
    }

    try {
        const client = await pool.connect();
        // Verificar a região da demanda associada para permissão
        const { rows: demandaRows } = await client.query("SELECT regiao_demanda FROM demandas WHERE id = $1", [demanda_id]);
        if (demandaRows.length === 0) {
            client.release();
            return res.status(404).json({ error: "Demanda não encontrada." });
        }
        const regiaoDemanda = demandaRows[0].regiao_demanda;

        if (req.user.tipo === "gerente_regional" && !req.regioesPermitidas.includes(regiaoDemanda)) {
            client.release();
            return res.status(403).json({ error: "Acesso negado. Você não tem permissão para atualizar missões para demandas nesta região." });
        } else if (req.user.tipo === "captador") {
            const { rows: missaoCaptadorRows } = await client.query("SELECT captador_id FROM missoes WHERE id = $1", [id]);
            if (missaoCaptadorRows.length === 0 || missaoCaptadorRows[0].captador_id !== req.user.id) {
                client.release();
                return res.status(403).json({ error: "Acesso negado. Você não é o captador responsável por esta missão." });
            }
        }

        const { rows } = await client.query(
            `UPDATE missoes SET demanda_id = $1, codigo_demanda = $2, captador_responsavel = $3, captador_id = $4, consultor_solicitante = $5, regiao_bairro = $6, descricao_busca = $7, status = $8, data_retorno = $9 WHERE id = $10 RETURNING *`,
            [demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status, data_retorno, id]
        );
        client.release();

        if (rows.length === 0) {
            return res.status(404).json({ error: "Missão não encontrada." });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor ao atualizar missão." });
    }
});

// DELETE /api/missoes/:id - Excluir missão
app.delete("/api/missoes/:id", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    const { id } = req.params;

    try {
        const client = await pool.connect();
        // Antes de excluir, verificar a região da demanda associada para permissão
        const { rows: missaoRows } = await client.query("SELECT demanda_id FROM missoes WHERE id = $1", [id]);
        if (missaoRows.length === 0) {
            client.release();
            return res.status(404).json({ error: "Missão não encontrada." });
        }
        const demandaId = missaoRows[0].demanda_id;

        const { rows: demandaRows } = await client.query("SELECT regiao_demanda FROM demandas WHERE id = $1", [demandaId]);
        if (demandaRows.length === 0) {
            client.release();
            return res.status(404).json({ error: "Demanda associada não encontrada." });
        }
        const regiaoDemanda = demandaRows[0].regiao_demanda;

        if (req.user.tipo === "gerente_regional" && !req.regioesPermitidas.includes(regiaoDemanda)) {
            client.release();
            return res.status(403).json({ error: "Acesso negado. Você não tem permissão para excluir missões para demandas nesta região." });
        }

        await client.query("DELETE FROM interacoes WHERE missao_id = $1", [id]); // Excluir interações primeiro
        const { rowCount } = await client.query("DELETE FROM missoes WHERE id = $1", [id]);
        client.release();

        if (rowCount === 0) {
            return res.status(404).json({ error: "Missão não encontrada." });
        }
        res.status(204).send();
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor ao excluir missão." });
    }
});

// POST /api/interacoes - Adicionar nova interação
app.post("/api/interacoes", authenticateToken, async (req, res) => {
    const { missao_id, descricao } = req.body;

    if (!missao_id || !descricao) {
        return res.status(400).json({ error: "Missão ID e descrição são obrigatórios." });
    }

    try {
        const client = await pool.connect();
        const { rows } = await client.query(
            `INSERT INTO interacoes (missao_id, usuario_id, usuario_nome, descricao) VALUES ($1, $2, $3, $4) RETURNING *`,
            [missao_id, req.user.id, req.user.nome, descricao]
        );
        client.release();
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor ao adicionar interação." });
    }
});

// GET /api/interacoes/:missao_id - Obter interações de uma missão
app.get("/api/interacoes/:missao_id", authenticateToken, async (req, res) => {
    const { missao_id } = req.params;

    if (!missao_id) {
        return res.status(400).json({ error: "Missão ID é obrigatório." });
    }

    try {
        const client = await pool.connect();
        const { rows } = await client.query("SELECT * FROM interacoes WHERE missao_id = $1 ORDER BY data_interacao DESC", [missao_id]);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// Inicia a conexão com o DB e o servidor Express
initializeDb().then(() => {
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT} com autenticação e relatórios multi-regionais`);
    });
}).catch(err => {
    console.error("Falha ao iniciar o servidor:", err);
    process.exit(1);
});



// PUT /api/missoes/:id/status - Atualizar status da missão
app.put("/api/missoes/:id/status", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ error: "O novo status é obrigatório." });
    }

    try {
        const client = await pool.connect();
        const { rows: missaoRows } = await client.query("SELECT demanda_id FROM missoes WHERE id = $1", [id]);
        if (missaoRows.length === 0) {
            client.release();
            return res.status(404).json({ error: "Missão não encontrada." });
        }
        const demandaId = missaoRows[0].demanda_id;

        const { rows: demandaRows } = await client.query("SELECT regiao_demanda FROM demandas WHERE id = $1", [demandaId]);
        if (demandaRows.length === 0) {
            client.release();
            return res.status(404).json({ error: "Demanda associada não encontrada." });
        }
        const regiaoDemanda = demandaRows[0].regiao_demanda;

        if (req.user.tipo === "gerente_regional" && !req.regioesPermitidas.includes(regiaoDemanda)) {
            client.release();
            return res.status(403).json({ error: "Acesso negado. Você não tem permissão para atualizar missões para demandas nesta região." });
        } else if (req.user.tipo === "captador") {
            const { rows: missaoCaptadorRows } = await client.query("SELECT captador_id FROM missoes WHERE id = $1", [id]);
            if (missaoCaptadorRows.length === 0 || missaoCaptadorRows[0].captador_id !== req.user.id) {
                client.release();
                return res.status(403).json({ error: "Acesso negado. Você não é o captador responsável por esta missão." });
            }
        }

        const { rows } = await client.query(
            `UPDATE missoes SET status = $1 WHERE id = $2 RETURNING *`,
            [status, id]
        );
        client.release();

        if (rows.length === 0) {
            return res.status(404).json({ error: "Missão não encontrada." });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error("Erro ao atualizar status da missão:", err);
        console.error("Detalhes do erro na rota PUT /api/missoes/:id/status:", { id, status, user: req.user });
        res.status(500).json({ error: "Erro interno do servidor ao atualizar status da missão." });
    }
});

// GET /api/missoes/:missao_id/interacoes - Obter interações de uma missão
app.get("/api/missoes/:missao_id/interacoes", authenticateToken, async (req, res) => {
    const { missao_id } = req.params;

    if (!missao_id) {
        return res.status(400).json({ error: "Missão ID é obrigatório." });
    }

    try {
        const client = await pool.connect();
        const { rows } = await client.query("SELECT * FROM interacoes WHERE missao_id = $1 ORDER BY data_interacao DESC", [missao_id]);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro ao obter interações da missão:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// GET /api/relatorios/performance-captadores/:id - Rota de placeholder
app.get("/api/relatorios/performance-captadores/:id", authenticateToken, (req, res) => {
    res.status(200).json({ message: "Rota de performance de captadores em desenvolvimento." });
});

// GET /api/relatorios/dashboard/:id - Rota de placeholder
app.get("/api/relatorios/dashboard/:id", authenticateToken, (req, res) => {
    res.status(200).json({ message: "Rota de dashboard em desenvolvimento." });
});

// GET /api/demandas/:id - Obter uma demanda específica
app.get("/api/demandas/:id", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    const { id } = req.params;

    try {
        const client = await pool.connect();
        const { rows } = await client.query("SELECT * FROM demandas WHERE id = $1", [id]);
        const demanda = rows[0];
        client.release();

        if (!demanda) {
            return res.status(404).json({ error: "Demanda não encontrada." });
        }

        if (req.user.tipo === "gerente_regional" && !req.regioesPermitidas.includes(demanda.regiao_demanda)) {
            return res.status(403).json({ error: "Acesso negado. Você não tem permissão para ver demandas desta região." });
        }

        res.json(demanda);
    } catch (err) {
        console.error("Erro ao adicionar demanda:", err);
        console.error("Detalhes do erro na rota POST /api/demandas:", { body: req.body, user: req.user });
        res.status(500).json({ error: "Erro interno do servidor ao adicionar demanda." });
    }
});



// Serve arquivos estáticos (se houver um frontend)
app.use(express.static(path.join(__dirname)));

// Rota para servir o arquivo HTML principal para todas as outras requisições (DEVE SER A ÚLTIMA ROTA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'imovel_certo_app.html'));
});
