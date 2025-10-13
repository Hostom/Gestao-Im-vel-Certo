const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const session = require("express-session");
const path = require("path");

// --- Configurações via ENV (substitua pelos valores do Railway quando for rodar em produção) ---
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:fYZxeVNPdHvLVLGSLeVtusXSUGbyjDbi@postgres.railway.internal:5432/railway";
const JWT_SECRET = process.env.JWT_SECRET || "54b6e598690caa0049c1b61f8b527a91c97eca53b7558fe7";

// --- Pool PostgreSQL ---
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});


async function corrigirSenhas() {
  try {
    const senhaHash = await bcrypt.hash("Adim2025", 10);
    await pool.query("UPDATE usuarios SET senha = $1", [senhaHash]);
    console.log("✅ Todas as senhas foram atualizadas com sucesso!");
  } catch (err) {
    console.error("Erro ao corrigir senhas:", err);
  }
}

corrigirSenhas();

// Função para inicializar e garantir estrutura do DB
async function initializeDb() {
    let client;
    try {
        client = await pool.connect();
        console.log("Conectado ao PostgreSQL!");

        // Criar/Atualizar tabelas com suporte ao tipo 'diretor'
        await client.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL,
                tipo TEXT NOT NULL CHECK (tipo IN ('admin', 'diretor', 'gerente_regional', 'captador')),
                regiao TEXT DEFAULT 'Geral',
                regioes_responsavel TEXT,
                gerente_responsavel_id INTEGER REFERENCES usuarios(id),
                ativo BOOLEAN DEFAULT TRUE,
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

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
                data_encontrado TIMESTAMP,
                data_locado TIMESTAMP,
                data_retorno TIMESTAMP,
                criado_por_id INTEGER REFERENCES usuarios(id)
            );

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

        // Seed: criar usuários padrão se tabela vazia
        const { rows: userCountRows } = await client.query("SELECT COUNT(*) as count FROM usuarios");
        const userCount = parseInt(userCountRows[0].count, 10);
        if (userCount === 0) {
            console.log("Inserindo usuários padrão (seed)...");
            const senhaHash = await bcrypt.hash("Adim2025", 10);

            const inserts = [
                ["Administrador", "adim@adimimoveis.com.br", senhaHash, "admin", "Geral", null],
                ["Diretor Geral", "diretor@adimimoveis.com.br", senhaHash, "diretor", "Geral", null],
                ["Lidiane Kolodi", "lidiane@adimimoveis.com.br", senhaHash, "gerente_regional", "Balneario_Camboriu", "Balneario_Camboriu,Itajai"],
                ["Pedro (Gerente Itapema)", "pedro@adimimoveis.com.br", senhaHash, "gerente_regional", "Itapema", "Itapema"],
                ["Jenifer de Souza", "jenifer@adimimoveis.com.br", senhaHash, "captador", "Itapema", null],
                ["Michele Oliveira", "michele@adimimoveis.com.br", senhaHash, "captador", "Balneario_Camboriu", null],
                ["Morgana Barreto", "morgana@adimimoveis.com.br", senhaHash, "captador", "Balneario_Camboriu", null],
                ["Bruna Spinello", "brunaspinello@crimoveis.com.br", senhaHash, "captador", "Itajai", null]
            ];

            for (const row of inserts) {
                await client.query(
                    `INSERT INTO usuarios (nome, email, senha, tipo, regiao, regioes_responsavel)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                     row
                );
            }
            console.log("Seed de usuários concluído.");
        }

        // Inserir configurações regionais (se tabela vazia)
        const { rows: cfgCountRows } = await client.query("SELECT COUNT(*) as count FROM configuracoes_regionais");
        const cfgCount = parseInt(cfgCountRows[0].count, 10);
        if (cfgCount === 0) {
            await client.query(
                `INSERT INTO configuracoes_regionais (regiao, configuracoes, gerente_responsavel_id)
                 VALUES
                    ('Itapema', '{"permissoes":["gerenciar_captadores","gerar_relatorios"], "restricoes":["apenas_regiao_propria"]}', NULL),
                    ('Balneario_Camboriu', '{"permissoes":["gerenciar_captadores","gerar_relatorios"], "restricoes":["multiplas_regioes"]}', NULL),
                    ('Itajai', '{"permissoes":["gerenciar_captadores","gerar_relatorios"], "restricoes":["multiplas_regioes"]}', NULL),
                    ('Geral', '{"permissoes":["acesso_total"], "restricoes": []}', NULL)
                `
            );
        }

        console.log("Inicialização do banco finalizada.");
    } catch (err) {
        console.error("Erro na inicialização do banco de dados:", err);
        throw err;
    } finally {
        if (client) client.release();
    }
}

// --- Express ---
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(session({
    secret: JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Serve frontend (opcional)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "imovel_certo_app.html"));
});

// --- Auth middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Token de acesso requerido" });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Token inválido" });
        req.user = user;
        next();
    });
};

// Novo middleware de permissão regional (suporta 'diretor')
const verificarPermissaoRegional = (req, res, next) => {
    const user = req.user;

    // Diretor e Admin têm acesso total
    if (user.tipo === "diretor" || user.tipo === "admin") {
        // Poderíamos carregar dinamicamente as regiões do DB; por simplicidade, deixamos o 'Geral' e regiões conhecidas.
        req.regioesPermitidas = ["Geral", "Itapema", "Balneario_Camboriu", "Itajai"];
        return next();
    }

    // Gerente regional: acesso às regiões sob sua responsabilidade
    if (user.tipo === "gerente_regional") {
        const regioes = user.regioes_responsavel ? user.regioes_responsavel.split(",") : [user.regiao];
        req.regioesPermitidas = regioes.map(r => r.trim());
        return next();
    }

    // Captador: acesso somente à própria região
    if (user.tipo === "captador") {
        req.regioesPermitidas = [user.regiao];
        return next();
    }

    return res.status(403).json({ error: "Acesso negado." });
};

// Middleware para checar que o usuário é diretor
const requireDiretor = (req, res, next) => {
    if (req.user && (req.user.tipo === "diretor" || req.user.tipo === "admin")) return next();
    return res.status(403).json({ error: "Acesso restrito: Diretor/Admin apenas." });
};

// --- Rotas de autenticação ---
app.post("/api/demandas", authenticateToken, async (req, res) => {
    const { codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes } = req.body;
    const criado_por_id = req.user.id;

    // Determinar regiao_demanda com base em regiao_desejada
    let regiao_demanda = 'Geral';
    if (regiao_desejada.includes('Itapema')) {
        regiao_demanda = 'Itapema';
    } else if (regiao_desejada.includes('Balneario_Camboriu') || regiao_desejada.includes('Balneário Camboriú')) {
        regiao_demanda = 'Balneario_Camboriu';
    } else if (regiao_desejada.includes('Itajai') || regiao_desejada.includes('Itajaí')) {
        regiao_demanda = 'Itajai';
    }

    try {
        // Inserir na tabela demandas
        const demandaResult = await pool.query(
            `INSERT INTO demandas (
                codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes, criado_por_id, regiao_demanda
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes, criado_por_id, regiao_demanda]
        );
        const demanda_id = demandaResult.rows[0].id;

        // Criar uma missão associada
        // Assumindo que o captador_responsavel é o consultor_locacao e que o consultor_solicitante é o usuário logado
        // Você pode precisar de uma lógica mais sofisticada para encontrar o captador_id
        const captadorResult = await pool.query("SELECT id FROM usuarios WHERE nome = $1 AND tipo = 'captador'", [consultor_locacao]);
        const captador_id = captadorResult.rows.length > 0 ? captadorResult.rows[0].id : null;

        await pool.query(
            `INSERT INTO missoes (
                demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, criado_por_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [demanda_id, codigo_demanda, consultor_locacao, captador_id, req.user.nome, regiao_desejada, caracteristicas_desejadas, criado_por_id]
        );

        res.status(201).json({ message: "Demanda e missão criadas com sucesso!" });
    } catch (error) {
        console.error("Erro ao criar demanda e missão:", error);
        res.status(500).json({ error: "Erro interno do servidor ao criar demanda e missão." });
    }
});

app.post("/api/login", async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: "Email e senha são obrigatórios" });

    try {
        const client = await pool.connect();
        const { rows } = await client.query("SELECT * FROM usuarios WHERE email = $1 AND ativo = TRUE", [email]);
        client.release();

        const user = rows[0];
        if (!user) return res.status(401).json({ error: "Credenciais inválidas" });

        const senhaValida = await bcrypt.compare(senha, user.senha);
        if (!senhaValida) return res.status(401).json({ error: "Credenciais inválidas" });

      const token = jwt.sign(
  {
    id: user.id,
    email: user.email,
    nome: user.nome,
    cargo: user.tipo,
    regiao: user.regiao,
    regioes_responsavel: user.regioes_responsavel
  },
  JWT_SECRET
);

res.json({
  token,
  user: {
    id: user.id,
    nome: user.nome,
    email: user.email,
    cargo: user.tipo,
    regiao: user.regiao,
    regioes_responsavel: user.regioes_responsavel
  }
});

    } catch (err) {
        console.error("Erro na rota de login:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

app.post("/api/logout", (req, res) => {
    req.session.destroy();
    res.json({ message: "Logout realizado com sucesso" });
});

// --- API ---

// GET /api/me
app.get("/api/me", authenticateToken, (req, res) => {
    res.json(req.user);
});

// GET /api/missoes
app.get("/api/missoes", authenticateToken, async (req, res) => {
    let query = `
        SELECT 
            m.*, 
            d.cliente_interessado, 
            d.contato, 
            d.tipo_imovel, 
            d.regiao_desejada, 
            d.faixa_aluguel,
            d.prazo_necessidade,
            d.consultor_locacao
        FROM missoes m
        LEFT JOIN demandas d ON m.codigo_demanda = d.codigo_demanda
    `;
    let whereClauses = [];
    let params = [];

    if (req.user.tipo === "captador") {
        whereClauses.push(`m.captador_id = $${params.length + 1}`);
        params.push(req.user.id);
    } else if (req.user.tipo === "gerente_regional") {
        const regioes = req.user.regioes_responsavel ? req.user.regioes_responsavel.split(",").map(r => r.trim()) : [req.user.regiao];
        const placeholders = regioes.map((_, i) => `$${params.length + i + 1}`).join(",");
        whereClauses.push(`d.regiao_demanda IN (${placeholders})`);
        params = params.concat(regioes);
    }

    if (whereClauses.length > 0) {
        query += " WHERE " + whereClauses.join(" AND ");
    }

    query += " ORDER BY m.data_missao DESC";

    try {
        const client = await pool.connect();
        const { rows } = await client.query(query, params);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar missões:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});


// GET /api/demandas
app.put("/api/missoes/:id/status", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const user = req.user;

    if (!status || !["Em busca", "Encontrado", "Locado"].includes(status)) {
        return res.status(400).json({ error: "Status inválido." });
    }

    try {
        let updateQuery = `UPDATE missoes SET status = $1`;
        const queryParams = [status, id];
        let paramIndex = 2;

        if (status === "Encontrado") {
            updateQuery += `, data_encontrado = CURRENT_TIMESTAMP`;
        } else if (status === "Locado") {
            updateQuery += `, data_locado = CURRENT_TIMESTAMP`;
        }

        // Adicionar lógica de permissão para atualização de status
        // Captadores só podem atualizar suas próprias missões
        // Gerentes regionais podem atualizar missões em suas regiões
        // Diretores/Admin podem atualizar qualquer missão
        let permissionClause = ``;
        if (user.tipo === "captador") {
            permissionClause = ` AND captador_id = $${paramIndex++}`;
            queryParams.push(user.id);
        } else if (user.tipo === "gerente_regional") {
            // Precisa verificar a região da missão
            const missionRegionResult = await pool.query(
                `SELECT d.regiao_demanda FROM missoes m JOIN demandas d ON m.demanda_id = d.id WHERE m.id = $1`,
                [id]
            );
            if (missionRegionResult.rows.length === 0) {
                return res.status(404).json({ error: "Missão não encontrada." });
            }
            const missionRegion = missionRegionResult.rows[0].regiao_demanda;
            const userRegions = user.regioes_responsavel ? user.regioes_responsavel.split(",").map(r => r.trim()) : [user.regiao];

            if (!userRegions.includes(missionRegion)) {
                return res.status(403).json({ error: "Acesso negado. Gerente regional só pode atualizar missões em suas regiões." });
            }
        }

        updateQuery += ` WHERE id = $${paramIndex++}${permissionClause} RETURNING *`;

        const { rows } = await pool.query(updateQuery, queryParams);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Missão não encontrada ou sem permissão para atualizar." });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error("Erro ao atualizar status da missão:", error);
        res.status(500).json({ error: "Erro interno do servidor ao atualizar status da missão." });
    }
});

app.get("/api/relatorios/performance", authenticateToken, async (req, res) => {
    const user = req.user;
    const { regiao, data_inicio, data_fim } = req.query;

    let query = `
        SELECT
            m.id,
            m.codigo_demanda,
            m.status,
            m.data_missao,
            m.data_encontrado,
            m.data_locado,
            d.regiao_demanda,
            d.consultor_locacao,
            EXTRACT(EPOCH FROM (m.data_encontrado - m.data_missao)) / 3600 AS tempo_em_busca_horas,
            EXTRACT(EPOCH FROM (m.data_locado - m.data_encontrado)) / 3600 AS tempo_encontrado_locado_horas
        FROM missoes m
        JOIN demandas d ON m.demanda_id = d.id
    `;
    let whereClauses = [];
    let params = [];
    let paramIndex = 1;

    // Lógica de permissão
    if (user.tipo === "captador") {
        whereClauses.push(`m.captador_id = $${paramIndex++}`);
        params.push(user.id);
    } else if (user.tipo === "gerente_regional") {
        const userRegions = user.regioes_responsavel ? user.regioes_responsavel.split(",").map(r => r.trim()) : [user.regiao];
        const placeholders = userRegions.map((_, i) => `$${paramIndex + i}`).join(",");
        whereClauses.push(`d.regiao_demanda IN (${placeholders})`);
        params = params.concat(userRegions);
        paramIndex += userRegions.length;
    }

    // Filtros adicionais
    if (regiao) {
        whereClauses.push(`d.regiao_demanda = $${paramIndex++}`);
        params.push(regiao);
    }
    if (data_inicio) {
        whereClauses.push(`m.data_missao >= $${paramIndex++}`);
        params.push(data_inicio);
    }
    if (data_fim) {
        whereClauses.push(`m.data_missao <= $${paramIndex++}`);
        params.push(data_fim);
    }

    if (whereClauses.length > 0) {
        query += " WHERE " + whereClauses.join(" AND ");
    }

    query += " ORDER BY m.data_missao DESC";

    try {
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error("Erro ao gerar relatório de performance:", error);
        res.status(500).json({ error: "Erro interno do servidor ao gerar relatório de performance." });
    }
});

app.get("/api/demandas", authenticateToken, async (req, res) => {
    let query = `SELECT * FROM demandas ORDER BY data_solicitacao DESC`;
    let params = [];
    if (req.user.tipo === "gerente_regional") {
        const regioes = req.user.regioes_responsavel ? req.user.regioes_responsavel.split(",").map(r => r.trim()) : [req.user.regiao];
        const placeholders = regioes.map((_, i) => `$${i + 1}`).join(",");
        query = `SELECT * FROM demandas WHERE regiao_demanda IN (${placeholders}) ORDER BY data_solicitacao DESC`;
        params = regioes;
    }
    // diretor/admin/captador handled by default query or captador filtering on frontend
    try {
        const client = await pool.connect();
        const { rows } = await client.query(query, params);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar demandas:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// GET /api/usuarios (admin)
app.get("/api/usuarios", authenticateToken, async (req, res) => {
    if (!(req.user.tipo === "admin" || req.user.tipo === "diretor")) {
        return res.status(403).json({ error: "Acesso negado. Apenas administradores/diretor podem acessar." });
    }
    try {
        const client = await pool.connect();
        const { rows } = await client.query(`SELECT id, nome, email, tipo, regiao, regioes_responsavel, ativo FROM usuarios ORDER BY nome`);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar usuários:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// GET /api/usuarios/captadores - para gerentes regionais
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
        console.error("Erro ao buscar captadores:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// POST /api/demandas - Adicionar nova demanda (corrigido)
app.post("/api/demandas", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    console.log("--------------------------------------------------");
    console.log("Requisição POST /api/demandas recebida.");
    console.log("Usuário logado (req.user):");
    console.log(req.user);
    console.log("Regiões permitidas para o usuário (req.regioesPermitidas):");
    console.log(req.regioesPermitidas);
    console.log("Corpo da requisição (req.body):");
    console.log(req.body);
    // Aceita nomes camelCase do frontend
    const {
        codigoDemanda,
        consultorLocacao,
        clienteInteressado,
        contato,
        tipoImovel,
        regiaoDesejada,
        faixaAluguel,
        caracteristicasDesejadas,
        prazoNecessidade,
        observacoes,
        regiaoDemanda
    } = req.body || {};

   // Função para normalizar o nome da região (sem acentos, espaços e tudo minúsculo)
const normalizarRegiao = (r) =>
  r ? r.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_') : 'geral';

// Normalizar campo de região: preferir regiaoDemanda, senão regiaoDesejada, senão região do usuário, senão 'geral'
const regiaoFinal = normalizarRegiao(regiaoDemanda || regiaoDesejada || req.user.regiao || 'geral');

    // Mapear para snake_case para inserir no DB
    const mapped = {
        codigo_demanda: codigoDemanda || `DEM-${Date.now()}`,
        consultor_locacao: consultorLocacao,
        cliente_interessado: clienteInteressado,
        contato: contato,
        tipo_imovel: tipoImovel,
        regiao_desejada: regiaoDesejada || regiaoFinal,
        regiao_demanda: regiaoFinal,
        faixa_aluguel: faixaAluguel,
        caracteristicas_desejadas: caracteristicasDesejadas,
        prazo_necessidade: prazoNecessidade,
        observacoes: observacoes,
        criado_por_id: req.user.id
    };

    // Validação básica
    if (!mapped.consultor_locacao || !mapped.cliente_interessado || !mapped.contato || !mapped.tipo_imovel || !mapped.regiao_desejada || !mapped.faixa_aluguel || !mapped.prazo_necessidade) {
        return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });
    }

    // Verificar permissão para a região (usa req.regioesPermitidas definido pelo middleware)
    // Normalizar as regiões permitidas para comparação
    const regioesPermitidasNormalizadas = req.regioesPermitidas ? req.regioesPermitidas.map(normalizarRegiao) : [];
    console.log("Regiões permitidas normalizadas:", regioesPermitidasNormalizadas);
    console.log("Região da demanda normalizada:", mapped.regiao_demanda);
    
    if (!regioesPermitidasNormalizadas.includes(mapped.regiao_demanda)) {
        return res.status(403).json({ error: "Acesso negado. Você não tem permissão para adicionar demandas nesta região." });
    }

    try {
        const client = await pool.connect();
        const { rows } = await client.query(
            `INSERT INTO demandas
             (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, regiao_demanda, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *`,
             [
                mapped.codigo_demanda,
                mapped.consultor_locacao,
                mapped.cliente_interessado,
                mapped.contato,
                mapped.tipo_imovel,
                mapped.regiao_desejada,
                mapped.regiao_demanda,
                mapped.faixa_aluguel,
                mapped.caracteristicas_desejadas,
                mapped.prazo_necessidade,
                mapped.observacoes,
                mapped.criado_por_id
            ]
        );
        const novaDemanda = rows[0];

        // Lógica para criar uma missão automaticamente
        // 1. Encontrar captadores na mesma região da demanda
        const captadoresNaRegiao = await client.query(
            `SELECT id, nome FROM usuarios WHERE tipo = 'captador' AND regiao = $1`,
            [novaDemanda.regiao_demanda]
        );

        if (captadoresNaRegiao.rows.length > 0) {
            // Atribuir ao primeiro captador encontrado na região (pode ser melhorado com lógica de round-robin ou carga)
            const captadorAtribuido = captadoresNaRegiao.rows[0];

            await client.query(
                `INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status, criado_por_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    novaDemanda.id,
                    novaDemanda.codigo_demanda,
                    captadorAtribuido.nome, // captador_responsavel
                    captadorAtribuido.id,   // captador_id
                    novaDemanda.consultor_locacao, // consultor_solicitante
                    novaDemanda.regiao_desejada, // regiao_bairro (usando regiao_desejada da demanda)
                    novaDemanda.caracteristicas_desejadas || 'N/A', // descricao_busca
                    'Em busca',
                    req.user.id
                ]
            );
            console.log(`Missão criada para a demanda ${novaDemanda.codigo_demanda} e atribuída a ${captadorAtribuido.nome}.`);
        } else {
            console.log(`Nenhum captador encontrado para a região ${novaDemanda.regiao_demanda}. Missão não criada automaticamente.`);
        }

        client.release();
        res.status(201).json(novaDemanda);
    } catch (err) {
        console.error("Erro ao inserir demanda:", err);
        res.status(500).json({ error: "Erro interno do servidor ao adicionar demanda." });
    }
});

// POST /api/missoes (mantido parecido)
app.get("/api/missoes", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    const user = req.user;
    const regioesPermitidas = req.regioesPermitidas;

    let query = `SELECT m.*, u.nome as captador_nome_completo FROM missoes m JOIN usuarios u ON m.captador_id = u.id WHERE 1=1`;
    const queryParams = [];
    let paramIndex = 1;

    // Lógica de filtro por região para gerentes regionais e captadores
    if (user.tipo === "gerente_regional") {
        // Gerente regional vê missões de suas regiões e missões de captadores sob sua responsabilidade
        // (Assumindo que captadores sob sua responsabilidade estão nas regioesPermitidas)
        if (regioesPermitidas && regioesPermitidas.length > 0) {
            query += ` AND m.regiao_bairro = ANY($${paramIndex++}::text[])`;
            queryParams.push(regioesPermitidas);
        }
    } else if (user.tipo === "captador") {
        // Captador vê apenas suas próprias missões
        query += ` AND m.captador_id = $${paramIndex++}`; // Filtrar por captador_id
        queryParams.push(user.id);
    }
    // Admin e Diretor veem todas as missões (sem filtro adicional aqui)

    query += ` ORDER BY m.data_missao DESC`;

    try {
        const client = await pool.connect();
        const { rows } = await client.query(query, queryParams);
        client.release();
        res.json(rows);
    } catch (err) {
        console.error("Erro ao buscar missões:", err);
        res.status(500).json({ error: "Erro interno do servidor ao buscar missões." });
    }
});

app.post("/api/missoes", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    const { demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status } = req.body || {};

    if (!demanda_id || !codigo_demanda || !captador_responsavel || !captador_id || !consultor_solicitante || !regiao_bairro || !descricao_busca) {
        return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });
    }

    try {
        const client = await pool.connect();
        const { rows: demandaRows } = await client.query("SELECT regiao_demanda FROM demandas WHERE id = $1", [demanda_id]);
        if (demandaRows.length === 0) {
            client.release();
            return res.status(404).json({ error: "Demanda não encontrada." });
        }
        const regiaoDemanda = demandaRows[0].regiao_demanda || 'Geral';

        if (!req.regioesPermitidas || !req.regioesPermitidas.includes(regiaoDemanda)) {
            client.release();
            return res.status(403).json({ error: "Acesso negado. Você não tem permissão para adicionar missões para demandas nesta região." });
        }

        const { rows } = await client.query(
            `INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
             [demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status || "Em busca", req.user.id]
        );
        const novaDemanda = rows[0];

        // Lógica para criar uma missão automaticamente
        // 1. Encontrar captadores na mesma região da demanda
        const captadoresNaRegiao = await client.query(
            `SELECT id, nome FROM usuarios WHERE tipo = 'captador' AND regiao = $1`,
            [novaDemanda.regiao_demanda]
        );

        if (captadoresNaRegiao.rows.length > 0) {
            // Atribuir ao primeiro captador encontrado na região (pode ser melhorado com lógica de round-robin ou carga)
            const captadorAtribuido = captadoresNaRegiao.rows[0];

            await client.query(
                `INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status, criado_por_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    novaDemanda.id,
                    novaDemanda.codigo_demanda,
                    captadorAtribuido.nome, // captador_responsavel
                    captadorAtribuido.id,   // captador_id
                    novaDemanda.consultor_locacao, // consultor_solicitante
                    novaDemanda.regiao_desejada, // regiao_bairro (usando regiao_desejada da demanda)
                    novaDemanda.caracteristicas_desejadas || 'N/A', // descricao_busca
                    'Em busca',
                    req.user.id
                ]
            );
            console.log(`Missão criada para a demanda ${novaDemanda.codigo_demanda} e atribuída a ${captadorAtribuido.nome}.`);
        } else {
            console.log(`Nenhum captador encontrado para a região ${novaDemanda.regiao_demanda}. Missão não criada automaticamente.`);
        }

        client.release();
        res.status(201).json(novaDemanda);
    } catch (err) {
        console.error("Erro ao adicionar demanda:", err);
        res.status(500).json({ error: "Erro interno do servidor ao adicionar demanda: " + err.message });
    }
});

// PUT /api/missoes/:id (exemplo) - atualização de status
app.put("/api/missoes/:id", authenticateToken, verificarPermissaoRegional, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: "Status é obrigatório." });

    try {
        const client = await pool.connect();
        // opcional: verificar permissão com base na demanda associada
        const { rows: missRows } = await client.query("SELECT * FROM missoes WHERE id = $1", [id]);
        if (missRows.length === 0) {
            client.release();
            return res.status(404).json({ error: "Missão não encontrada." });
        }
        // caso seja gerente, verificar região da demanda anexada
        const miss = missRows[0];
        const { rows: demandaRows } = await client.query("SELECT regiao_demanda FROM demandas WHERE codigo_demanda = $1", [miss.codigo_demanda]);
        const regiaoDemanda = demandaRows.length ? demandaRows[0].regiao_demanda : 'Geral';
        if (!req.regioesPermitidas.includes(regiaoDemanda)) {
            client.release();
            return res.status(403).json({ error: "Acesso negado para esta região." });
        }

        const { rows } = await client.query("UPDATE missoes SET status = $1, data_retorno = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *", [status, id]);
        client.release();
        res.json(rows[0]);
    } catch (err) {
        console.error("Erro ao atualizar missão:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});

// Exemplo de rota para gerenciar gerentes (diretor/admin)
app.put("/api/usuarios/:id/inativar", authenticateToken, requireDiretor, async (req, res) => {
    const { id } = req.params;
    try {
        const client = await pool.connect();
        const { rows } = await client.query("UPDATE usuarios SET ativo = FALSE WHERE id = $1 RETURNING id, nome, email, ativo", [id]);
        client.release();
        if (!rows.length) return res.status(404).json({ error: "Usuário não encontrado" });
        res.json(rows[0]);
    } catch (err) {
        console.error("Erro ao inativar usuário:", err);
        res.status(500).json({ error: "Erro interno do servidor" });
    }
});
// Rota do Dashboard (resumo geral)
app.get('/api/relatorios/dashboard', async (req, res) => {
try {
res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
res.setHeader('Pragma', 'no-cache');
res.setHeader('Expires', '0');

const result = await pool.query(`
WITH demandas_resumo AS (
  SELECT 
    COUNT(*) AS total_demandas,
    COUNT(*) FILTER (
      WHERE date_part('month', data_solicitacao) = date_part('month', CURRENT_DATE)
        AND date_part('year', data_solicitacao) = date_part('year', CURRENT_DATE)
    ) AS demandas_mes
  FROM demandas
),
missoes_resumo AS (
  SELECT 
    COUNT(*) AS total_missoes,
    COUNT(*) FILTER (WHERE LOWER(status) = 'locado') AS missoes_locadas,
    COUNT(*) FILTER (WHERE LOWER(status) = 'encontrado') AS missoes_encontradas,
    COUNT(*) FILTER (WHERE LOWER(status) = 'em busca') AS missoes_em_busca,
    ROUND(
      (SUM(CASE WHEN LOWER(status) = 'concluida' THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100,
      1
    ) AS taxa_sucesso
  FROM missoes
)
SELECT 
  COALESCE(d.total_demandas, 0) AS total_demandas,
  COALESCE(d.demandas_mes, 0) AS demandas_mes,
  COALESCE(m.total_missoes, 0) AS total_missoes,
  COALESCE(m.missoes_locadas, 0) AS missoes_locadas,
  COALESCE(m.missoes_encontradas, 0) AS missoes_encontradas,
  COALESCE(m.missoes_em_busca, 0) AS missoes_em_busca,
  COALESCE(m.taxa_sucesso, 0) AS taxa_sucesso
FROM demandas_resumo d
CROSS JOIN missoes_resumo m;
`);

const data = result.rows[0] || {
total_demandas: 0,
demandas_mes: 0,
total_missoes: 0,
missoes_locadas: 0,
missoes_encontradas: 0,
missoes_em_busca: 0,
taxa_sucesso: 0
};

// 🔧 Garante que as colunas de missões existam mesmo se o CROSS JOIN não retornar nada
if (!('total_missoes' in data)) data.total_missoes = 0;
if (!('missoes_locadas' in data)) data.missoes_locadas = 0;
if (!('missoes_encontradas' in data)) data.missoes_encontradas = 0;
if (!('missoes_em_busca' in data)) data.missoes_em_busca = 0;
if (!('taxa_sucesso' in data)) data.taxa_sucesso = 0;

    
if (isNaN(data.taxa_sucesso)) data.taxa_sucesso = 0;


console.log('📊 Dashboard Data:', data);
res.json(data);
} catch (error) {
console.error('❌ Erro ao gerar relatório de dashboard:', error);
res.status(500).json({ erro: 'Erro ao gerar relatório de dashboard' });
}
});


// ================================
// Relatórios - Performance Captadores
// ================================
app.get('/api/relatorios/performance-captadores', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COALESCE(m.captador_responsavel, 'Não definido') AS captador_nome,
        COALESCE(m.regiao_bairro, 'Não definida') AS regiao,
        COUNT(m.id) AS total_missoes,
        COUNT(*) FILTER (WHERE m.status = 'Locado') AS missoes_locadas,
        COUNT(*) FILTER (WHERE m.status = 'Encontrado') AS missoes_encontradas,
        COUNT(*) FILTER (WHERE m.status = 'Em Busca') AS missoes_em_busca,
        ROUND((COUNT(*) FILTER (WHERE m.status = 'Locado')::numeric / NULLIF(COUNT(m.id), 0)) * 100, 1) AS taxa_sucesso
      FROM missoes m
      GROUP BY m.captador_responsavel, m.regiao_bairro
      ORDER BY taxa_sucesso DESC NULLS LAST;
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao gerar relatório de performance:', error);
    res.status(500).json({ erro: 'Erro ao gerar relatório de performance' });
  }
});

// 🔹 Relatórios - Demandas detalhadas
app.get('/api/relatorios/demandas', async (req, res) => {
try {
const result = await pool.query(`
SELECT
d.id,
d.codigo_demanda,
d.cliente_interessado,
d.regiao_desejada,
d.tipo_imovel,
d.status,
d.data_criacao,
c.nome AS consultor_nome
FROM demandas d
LEFT JOIN consultores c ON d.consultor_solicitante = c.id
ORDER BY d.data_criacao DESC;
`);
res.json(result.rows);
} catch (error) {
console.error('Erro ao gerar relatório de demandas:', error);
res.status(500).json({ error: 'Erro ao gerar relatório de demandas' });
}
});


// 🔹 Relatórios - Histórico de alterações e ações
app.get('/api/relatorios/historico', async (req, res) => {
try {
const result = await pool.query(`
SELECT
h.id,
h.acao,
h.usuario_nome,
h.data_acao,
h.descricao,
COALESCE(d.codigo_demanda, m.codigo_demanda) AS referencia
FROM historico_acoes h
LEFT JOIN demandas d ON h.demanda_id = d.id
LEFT JOIN missoes m ON h.missao_id = m.id
ORDER BY h.data_acao DESC;
`);
res.json(result.rows);
} catch (error) {
console.error('Erro ao gerar histórico:', error);
res.status(500).json({ error: 'Erro ao gerar histórico' });
}
});

// Inicializar DB e iniciar servidor
initializeDb()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Servidor rodando na porta ${PORT}`);
        });
    })
    .catch(err => {
        console.error("Falha ao inicializar o servidor:", err);
        process.exit(1);
    });


// POST /api/sync-missions - Sincronizar demandas com missões (apenas para admin/diretor)
app.post("/api/sync-missions", authenticateToken, async (req, res) => {
    if (!(req.user.tipo === "admin" || req.user.tipo === "diretor")) {
        return res.status(403).json({ error: "Acesso negado. Apenas administradores/diretor podem sincronizar missões." });
    }

    let missionsCreatedCount = 0;
    let missionsAlreadyExistCount = 0;
    let demandsWithoutCaptador = 0;

    try {
        const client = await pool.connect();

        // 1. Obter todas as demandas
        const allDemandas = await client.query(`SELECT * FROM demandas`);

        for (const demanda of allDemandas.rows) {
            // 2. Verificar se já existe uma missão para esta demanda
            const existingMission = await client.query(
                `SELECT id FROM missoes WHERE demanda_id = $1`,
                [demanda.id]
            );

            if (existingMission.rows.length === 0) {
                // 3. Se não existir, criar uma nova missão
                // Lógica para encontrar captadores na mesma região da demanda (duplicada da rota POST /api/demandas)
                const captadoresNaRegiao = await client.query(
                    `SELECT id, nome FROM usuarios WHERE tipo = 'captador' AND regiao = $1`,
                    [demanda.regiao_demanda]
                );

                if (captadoresNaRegiao.rows.length > 0) {
                    const captadorAtribuido = captadoresNaRegiao.rows[0];

                    // Construir a descrição da busca para a missão
                    const descricaoBusca = `Cliente: ${demanda.cliente_interessado || 'N/A'} | Contato: ${demanda.contato || 'N/A'} | Tipo: ${demanda.tipo_imovel || 'N/A'} | Faixa Aluguel: ${demanda.faixa_aluguel || 'N/A'} | Características: ${demanda.caracteristicas_desejadas || 'N/A'}`;

                    await client.query(
                        `INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, captador_id, consultor_solicitante, regiao_bairro, descricao_busca, status, criado_por_id)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                        [
                            demanda.id,
                            demanda.codigo_demanda,
                            captadorAtribuido.nome,
                            captadorAtribuido.id,
                            demanda.consultor_locacao,
                            demanda.regiao_desejada,
                            descricaoBusca,
                            'Em busca',
                            demanda.criado_por_id // Usar o criado_por_id da demanda
                        ]
                    );
                    missionsCreatedCount++;
                } else {
                    console.log(`Nenhum captador encontrado para a região ${demanda.regiao_demanda} para a demanda ${demanda.codigo_demanda}. Missão não criada.`);
                    demandsWithoutCaptador++;
                }
            } else {
                missionsAlreadyExistCount++;
            }
        }

        client.release();
        res.status(200).json({
            message: "Sincronização de missões concluída.",
            missionsCreated: missionsCreatedCount,
            missionsAlreadyExist: missionsAlreadyExistCount,
            demandsWithoutCaptador: demandsWithoutCaptador,
        });
    } catch (err) {
        console.error("Erro ao sincronizar missões:", err);
        res.status(500).json({ error: "Erro interno do servidor ao sincronizar missões." });
    }
});
