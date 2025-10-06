// Importa as bibliotecas necessárias
require('dotenv').config(); // Para carregar variáveis de ambiente do arquivo .env
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// --- Configuração do Banco de Dados ---
// O Pool gerencia múltiplas conexões com o banco de dados.
// A string de conexão é pega da variável de ambiente `DATABASE_URL`,
// que será configurada no Railway.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necessário para conexões com o Heroku/Railway
  }
});


// --- Configuração do Servidor Express ---
const app = express();
const PORT = process.env.PORT || 3001; // O Railway fornecerá a porta via process.env.PORT

// Middlewares
app.use(cors()); // Permite que o frontend (em outro domínio) acesse esta API
app.use(express.json()); // Permite que o servidor entenda JSON no corpo das requisições

// --- Listas (normalmente viriam do banco, mas aqui para simplificar a lógica da roleta) ---
const captadores = ["Bruna S", "Michele", "Morgana"];


// --- Rotas da API (Endpoints) ---

// Rota de teste para verificar se o servidor está no ar
app.get('/', (req, res) => {
  res.send('API do Sistema Imóvel Certo está funcionando!');
});

// GET /api/missoes - Retorna todas as missões
app.get('/api/missoes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM missoes ORDER BY data_missao DESC');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erro no servidor');
  }
});

// GET /api/demandas - Retorna todas as demandas
app.get('/api/demandas', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM demandas ORDER BY data_solicitacao DESC');
      res.json(rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Erro no servidor');
    }
});


// POST /api/demandas - Cria uma nova demanda e uma missão associada (Lógica da Roleta)
app.post('/api/demandas', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Inicia uma transação

        const { consultorLocacao, clienteInteressado, contato, tipoImovel, regiaoDesejada, faixaAluguel, caracteristicasDesejadas, prazoNecessidade, observacoes } = req.body;
        
        // 1. Lógica da Roleta para definir o próximo captador
        const lastMissionResult = await client.query('SELECT captador_responsavel FROM missoes ORDER BY data_missao DESC LIMIT 1');
        let proximoCaptador;
        if (lastMissionResult.rows.length === 0) {
            proximoCaptador = captadores[0]; // Se não há missões, começa com o primeiro da lista
        } else {
            const ultimoCaptador = lastMissionResult.rows[0].captador_responsavel;
            const ultimoIndex = captadores.indexOf(ultimoCaptador);
            proximoCaptador = captadores[(ultimoIndex + 1) % captadores.length];
        }

        // 2. Insere a nova demanda no banco de dados
        const codigoDemanda = `LOC-${Date.now().toString().slice(-6)}`;
        const novaDemandaQuery = 'INSERT INTO demandas (codigo_demanda, consultor_locacao, cliente_interessado, contato, tipo_imovel, regiao_desejada, faixa_aluguel, caracteristicas_desejadas, prazo_necessidade, observacoes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id';
        const demandaResult = await client.query(novaDemandaQuery, [codigoDemanda, consultorLocacao, clienteInteressado, contato, tipoImovel, regiaoDesejada, faixaAluguel, caracteristicasDesejadas, prazoNecessidade, observacoes]);
        const novaDemandaId = demandaResult.rows[0].id;

        // 3. Cria a missão associada
        const novaMissaoQuery = 'INSERT INTO missoes (demanda_id, codigo_demanda, captador_responsavel, consultor_solicitante, regiao_bairro, descricao_busca, status) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        await client.query(novaMissaoQuery, [novaDemandaId, codigoDemanda, proximoCaptador, consultorLocacao, regiaoDesejada, caracteristicasDesejadas, 'Em busca']);
        
        await client.query('COMMIT'); // Confirma a transação
        res.status(201).json({ message: 'Demanda e missão criadas com sucesso!' });

    } catch (err) {
        await client.query('ROLLBACK'); // Desfaz a transação em caso de erro
        console.error(err.message);
        res.status(500).send('Erro no servidor');
    } finally {
        client.release(); // Libera o cliente de volta para o pool
    }
});


// PATCH /api/missoes/:id/status - Atualiza o status de uma missão
app.patch('/api/missoes/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        let query;
        let queryParams;

        // Se o novo status for 'Encontrado' ou 'Locado', atualizamos também a data de retorno.
        if (status === 'Encontrado' || status === 'Locado') {
            query = 'UPDATE missoes SET status = $1, data_retorno = NOW() WHERE id = $2';
            queryParams = [status, id];
        } else {
            query = 'UPDATE missoes SET status = $1 WHERE id = $2';
            queryParams = [status, id];
        }

        const result = await pool.query(query, queryParams);

        if (result.rowCount === 0) {
            return res.status(404).send('Missão não encontrada.');
        }

        res.status(200).json({ message: 'Status da missão atualizado com sucesso.' });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Erro no servidor');
    }
});


// Inicia o servidor para ouvir requisições
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
