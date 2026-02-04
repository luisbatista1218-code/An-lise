import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  try {
    // GET - Listar vendas com filtros
    if (req.method === 'GET') {
      const { periodo, page = 1, limit = 50 } = req.query;
      
      let query = `
        SELECT v.*, p.nome as produto_nome_completo 
        FROM vendas v
        LEFT JOIN produtos p ON v.produto_id = p.id
      `;
      
      let params = [];
      let whereClauses = [];
      
      // Filtro por período
      if (periodo === 'hoje') {
        whereClauses.push('DATE(v.data_venda) = CURRENT_DATE');
      } else if (periodo === 'semana') {
        whereClauses.push('v.data_venda >= CURRENT_DATE - INTERVAL \'7 days\'');
      } else if (periodo === 'mes') {
        whereClauses.push('v.data_venda >= CURRENT_DATE - INTERVAL \'30 days\'');
      }
      
      if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
      }
      
      query += ' ORDER BY v.data_venda DESC';
      
      // Paginação
      query += ` LIMIT $${params.length + 1}`;
      params.push(parseInt(limit));
      
      if (page > 1) {
        query += ` OFFSET $${params.length + 1}`;
        params.push((page - 1) * limit);
      }
      
      const result = await pool.query(query, params);
      const totalResult = await pool.query(
        'SELECT COUNT(*) as total FROM vendas' + 
        (whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : ''),
        []
      );
      
      // Calcula totais
      const totaisResult = await pool.query(`
        SELECT 
          COUNT(*) as total_vendas,
          COALESCE(SUM(valor_total), 0) as faturamento_total,
          COALESCE(AVG(valor_total), 0) as ticket_medio
        FROM vendas
        ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
      `, []);
      
      return res.status(200).json({
        vendas: result.rows,
        total: parseInt(totalResult.rows[0].total),
        page: parseInt(page),
        total_pages: Math.ceil(totalResult.rows[0].total / limit),
        estatisticas: {
          total_vendas: parseInt(totaisResult.rows[0].total_vendas),
          faturamento_total: parseFloat(totaisResult.rows[0].faturamento_total),
          ticket_medio: parseFloat(totaisResult.rows[0].ticket_medio)
        }
      });
    }
    
    // POST - Registrar nova venda
    if (req.method === 'POST') {
      const { produto_id, produto_nome, quantidade, valor_unitario, valor_total, forma_pagamento } = req.body;
      
      // Validações
      if (!produto_id || !produto_nome || !quantidade || !valor_unitario || !valor_total) {
        return res.status(400).json({ 
          error: 'Campos obrigatórios não preenchidos' 
        });
      }
      
      // Verifica estoque usando transação
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Busca produto e verifica estoque
        const produtoResult = await client.query(
          'SELECT id, nome, quantidade FROM produtos WHERE id = $1 FOR UPDATE',
          [produto_id]
        );
        
        if (produtoResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Produto não encontrado' });
        }
        
        const produto = produtoResult.rows[0];
        
        if (produto.quantidade < quantidade) {
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            error: 'Estoque insuficiente',
            estoque_disponivel: produto.quantidade 
          });
        }
        
        // Atualiza estoque
        await client.query(
          'UPDATE produtos SET quantidade = quantidade - $1 WHERE id = $2',
          [quantidade, produto_id]
        );
        
        // Registra venda
        const vendaResult = await client.query(
          `INSERT INTO vendas 
           (produto_id, produto_nome, quantidade, valor_unitario, valor_total, forma_pagamento) 
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            produto_id,
            produto_nome,
            parseInt(quantidade),
            parseFloat(valor_unitario),
            parseFloat(valor_total),
            forma_pagamento || 'dinheiro'
          ]
        );
        
        await client.query('COMMIT');
        
        return res.status(201).json(vendaResult.rows[0]);
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
    
  } catch (error) {
    console.error('Erro API vendas:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      detalhes: error.message 
    });
  }
  }
