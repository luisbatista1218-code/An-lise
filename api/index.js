import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  const { method, url } = req;
  const path = url.replace('/api/', '');

  try {
    // ================= PRODUTOS =================
    if (path === 'produtos') {
      if (method === 'GET') {
        const result = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
        return res.json(result.rows);
      }
      
      if (method === 'POST') {
        const { nome, quantidade = 0, valor_venda } = await req.json();
        const result = await pool.query(
          'INSERT INTO produtos (nome, quantidade, valor_venda) VALUES ($1, $2, $3) RETURNING *',
          [nome, quantidade, valor_venda]
        );
        return res.json(result.rows[0]);
      }
    }

    // ================= VENDAS =================
    if (path === 'vendas') {
      if (method === 'GET') {
        const result = await pool.query(`
          SELECT v.*, p.nome as produto_nome 
          FROM vendas v 
          LEFT JOIN produtos p ON v.produto_id = p.id 
          ORDER BY v.data_venda DESC
        `);
        return res.json(result.rows);
      }
      
      if (method === 'POST') {
        const { produto_id, produto_nome, quantidade, valor_unitario } = await req.json();
        const valor_total = valor_unitario * quantidade;
        
        const result = await pool.query(
          `INSERT INTO vendas (produto_id, produto_nome, quantidade, valor_unitario, valor_total) 
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [produto_id, produto_nome, quantidade, valor_unitario, valor_total]
        );
        
        // Atualiza estoque
        await pool.query(
          'UPDATE produtos SET quantidade = quantidade - $1 WHERE id = $2',
          [quantidade, produto_id]
        );
        
        return res.json(result.rows[0]);
      }
    }

    // ================= DASHBOARD =================
    if (path === 'dashboard') {
      const { periodo = 'hoje' } = req.query;
      
      let where = '';
      switch (periodo) {
        case 'hoje': where = "WHERE DATE(data_venda) = CURRENT_DATE"; break;
        case 'semana': where = "WHERE data_venda >= CURRENT_DATE - INTERVAL '7 days'"; break;
        case 'mes': where = "WHERE data_venda >= CURRENT_DATE - INTERVAL '30 days'"; break;
      }
      
      const [vendas, produtos, topVendas] = await Promise.all([
        // Total vendas e faturamento
        pool.query(`
          SELECT 
            COUNT(*) as total,
            COALESCE(SUM(valor_total), 0) as faturamento,
            COALESCE(AVG(valor_total), 0) as ticket_medio
          FROM vendas ${where}
        `),
        
        // Estoque total
        pool.query(`
          SELECT 
            COUNT(*) as total_produtos,
            SUM(quantidade) as total_estoque,
            COUNT(CASE WHEN quantidade < 10 THEN 1 END) as baixo_estoque
          FROM produtos
        `),
        
        // Produtos mais vendidos
        pool.query(`
          SELECT 
            produto_nome,
            SUM(quantidade) as total_vendido,
            SUM(valor_total) as faturamento
          FROM vendas ${where}
          GROUP BY produto_nome
          ORDER BY total_vendido DESC
          LIMIT 5
        `)
      ]);
      
      return res.json({
        periodo,
        vendas: {
          total: parseInt(vendas.rows[0].total),
          faturamento: parseFloat(vendas.rows[0].faturamento),
          ticket_medio: parseFloat(vendas.rows[0].ticket_medio)
        },
        produtos: {
          total: parseInt(produtos.rows[0].total_produtos),
          estoque: parseInt(produtos.rows[0].total_estoque),
          baixo_estoque: parseInt(produtos.rows[0].baixo_estoque)
        },
        top_produtos: topVendas.rows
      });
    }

    // ================= HEALTH CHECK =================
    if (path === '' || path === 'health') {
      const [produtos, vendas] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM produtos'),
        pool.query('SELECT COUNT(*) FROM vendas')
      ]);
      
      return res.json({
        status: 'API funcionando',
        banco: 'Neon PostgreSQL',
        contagens: {
          produtos: parseInt(produtos.rows[0].count),
          vendas: parseInt(vendas.rows[0].count)
        },
        endpoints: ['/produtos', '/vendas', '/dashboard']
      });
    }

    res.status(404).json({ error: 'Endpoint não encontrado' });
    
  } catch (error) {
    console.error('Erro API:', error);
    res.status(500).json({ error: error.message });
  }
        }
