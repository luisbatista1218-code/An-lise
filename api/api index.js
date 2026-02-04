import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  const path = req.url.replace('/api/', '');
  
  try {
    // ================= HEALTH CHECK =================
    if (path === '' || path === 'health') {
      return res.json({ 
        status: '✅ API DO SEU BANCO FUNCIONANDO!',
        banco: 'Neon PostgreSQL',
        tabelas: ['produtos', 'vendas']
      });
    }
    
    // ================= DASHBOARD =================
    if (path === 'dashboard') {
      const { periodo = 'hoje' } = req.query;
      
      let filtro = '';
      if (periodo === 'hoje') {
        filtro = "WHERE DATE(data_venda) = CURRENT_DATE";
      } else if (periodo === 'semana') {
        filtro = "WHERE data_venda >= CURRENT_DATE - INTERVAL '7 days'";
      } else if (periodo === 'mes') {
        filtro = "WHERE data_venda >= CURRENT_DATE - INTERVAL '30 days'";
      }
      
      // Dados do dashboard
      const [vendasHoje, totalProdutos, topVendas] = await Promise.all([
        // Vendas do período
        pool.query(`
          SELECT 
            COUNT(*) as total_vendas,
            COALESCE(SUM(valor_total), 0) as faturamento,
            COALESCE(AVG(valor_total), 0) as ticket_medio
          FROM vendas ${filtro}
        `),
        
        // Produtos em estoque
        pool.query(`
          SELECT 
            COUNT(*) as total_produtos,
            COALESCE(SUM(quantidade), 0) as total_estoque
          FROM produtos
        `),
        
        // Produtos mais vendidos
        pool.query(`
          SELECT 
            produto_nome,
            SUM(quantidade) as total_vendido,
            SUM(valor_total) as faturamento_total
          FROM vendas ${filtro}
          GROUP BY produto_nome
          ORDER BY total_vendido DESC
          LIMIT 5
        `)
      ]);
      
      return res.json({
        periodo: periodo,
        vendas: {
          total: parseInt(vendasHoje.rows[0].total_vendas) || 0,
          faturamento: parseFloat(vendasHoje.rows[0].faturamento) || 0,
          ticket_medio: parseFloat(vendasHoje.rows[0].ticket_medio) || 0
        },
        produtos: {
          total: parseInt(totalProdutos.rows[0].total_produtos) || 0,
          estoque: parseInt(totalProdutos.rows[0].total_estoque) || 0
        },
        top_produtos: topVendas.rows || []
      });
    }
    
    // ================= PRODUTOS =================
    if (path === 'produtos') {
      if (req.method === 'GET') {
        const result = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
        return res.json(result.rows);
      }
      
      if (req.method === 'POST') {
        const { nome, quantidade, valor_venda } = await req.json();
        const result = await pool.query(
          'INSERT INTO produtos (nome, quantidade, valor_venda) VALUES ($1, $2, $3) RETURNING *',
          [nome, parseInt(quantidade) || 0, parseFloat(valor_venda) || 0]
        );
        return res.json(result.rows[0]);
      }
    }
    
    // ================= VENDAS =================
    if (path === 'vendas') {
      if (req.method === 'GET') {
        const result = await pool.query(`
          SELECT * FROM vendas 
          ORDER BY data_venda DESC
        `);
        return res.json(result.rows);
      }
      
      if (req.method === 'POST') {
        const { produto_id, produto_nome, quantidade, valor_unitario } = await req.json();
        const valor_total = valor_unitario * quantidade;
        
        // Verifica estoque
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
            estoque_disponivel: produto.rows[0].quantidade 
          });
        }
        
        // Registra venda
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
    
    // Rota não encontrada
    res.status(404).json({ error: 'Rota não encontrada: /api/' + path });
    
  } catch (error) {
    console.error('Erro API:', error);
    res.status(500).json({ error: error.message });
  }
}
