import { Pool } from 'pg';

/* ================== POOL GLOBAL (SERVERLESS SAFE) ================== */
let pool;

if (!global.pgPool) {
  global.pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

pool = global.pgPool;

/* ================== CONFIG ================== */
export const config = {
  api: {
    bodyParser: true
  }
};

/* ================== HANDLER ================== */
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace('/api/', '');
    const query = Object.fromEntries(url.searchParams);

    /* ================= HEALTH ================= */
    if (path === '' || path === 'health') {
      return res.json({
        status: '✅ API FUNCIONANDO',
        banco: 'Neon PostgreSQL',
        tabelas: ['produtos', 'vendas']
      });
    }

    /* ================= DASHBOARD ================= */
    if (path === 'dashboard') {
      const periodo = query.periodo || 'hoje';

      let filtro = '';
      if (periodo === 'hoje') {
        filtro = "WHERE DATE(data_venda) = CURRENT_DATE";
      } else if (periodo === 'semana') {
        filtro = "WHERE data_venda >= CURRENT_DATE - INTERVAL '7 days'";
      } else if (periodo === 'mes') {
        filtro = "WHERE data_venda >= CURRENT_DATE - INTERVAL '30 days'";
      }

      const [vendas, produtos, top] = await Promise.all([
        pool.query(`
          SELECT 
            COUNT(*) AS total_vendas,
            COALESCE(SUM(valor_total), 0) AS faturamento,
            COALESCE(AVG(valor_total), 0) AS ticket_medio
          FROM vendas ${filtro}
        `),
        pool.query(`
          SELECT 
            COUNT(*) AS total_produtos,
            COALESCE(SUM(quantidade), 0) AS total_estoque
          FROM produtos
        `),
        pool.query(`
          SELECT 
            produto_nome,
            SUM(quantidade) AS total_vendido,
            SUM(valor_total) AS faturamento_total
          FROM vendas ${filtro}
          GROUP BY produto_nome
          ORDER BY total_vendido DESC
          LIMIT 5
        `)
      ]);

      return res.json({
        periodo,
        vendas: vendas.rows[0],
        produtos: produtos.rows[0],
        top_produtos: top.rows
      });
    }

    /* ================= PRODUTOS ================= */
    if (path === 'produtos') {
      if (req.method === 'GET') {
        const result = await pool.query(
          'SELECT * FROM produtos ORDER BY id DESC'
        );
        return res.json(result.rows);
      }

      if (req.method === 'POST') {
        const { nome, quantidade, valor_venda } = req.body;

        const result = await pool.query(
          `INSERT INTO produtos (nome, quantidade, valor_venda)
           VALUES ($1, $2, $3) RETURNING *`,
          [nome, quantidade || 0, valor_venda || 0]
        );

        return res.json(result.rows[0]);
      }
    }

    /* ================= VENDAS ================= */
    if (path === 'vendas') {
      if (req.method === 'GET') {
        const result = await pool.query(
          'SELECT * FROM vendas ORDER BY data_venda DESC'
        );
        return res.json(result.rows);
      }

      if (req.method === 'POST') {
        const { produto_id, produto_nome, quantidade, valor_unitario } = req.body;
        const valor_total = quantidade * valor_unitario;

        const produto = await pool.query(
          'SELECT quantidade FROM produtos WHERE id = $1',
          [produto_id]
        );

        if (produto.rows.length === 0) {
          return res.status(400).json({ error: 'Produto não encontrado' });
        }

        if (produto.rows[0].quantidade < quantidade) {
          return res.status(400).json({
            error: 'Estoque insuficiente',
            estoque: produto.rows[0].quantidade
          });
        }

        const venda = await pool.query(
          `INSERT INTO vendas 
           (produto_id, produto_nome, quantidade, valor_unitario, valor_total)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [produto_id, produto_nome, quantidade, valor_unitario, valor_total]
        );

        await pool.query(
          'UPDATE produtos SET quantidade = quantidade - $1 WHERE id = $2',
          [quantidade, produto_id]
        );

        return res.json(venda.rows[0]);
      }
    }

    /* ================= 404 ================= */
    return res.status(404).json({
      error: `Rota não encontrada: /api/${path}`
    });

  } catch (err) {
    console.error('ERRO API:', err);
    return res.status(500).json({ error: err.message });
  }
}
