import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  try {
    // GET - Listar todos produtos (com filtro)
    if (req.method === 'GET') {
      const { search, page = 1, limit = 50 } = req.query;
      let query = 'SELECT * FROM produtos';
      let params = [];
      
      if (search) {
        query += ' WHERE nome ILIKE $1 OR descricao ILIKE $1';
        params.push(`%${search}%`);
      }
      
      query += ' ORDER BY id DESC';
      
      if (limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));
      }
      
      if (page > 1) {
        query += ` OFFSET $${params.length + 1}`;
        params.push((page - 1) * limit);
      }
      
      const result = await pool.query(query, params);
      const totalResult = await pool.query('SELECT COUNT(*) as total FROM produtos');
      
      return res.status(200).json({
        produtos: result.rows,
        total: parseInt(totalResult.rows[0].total),
        page: parseInt(page),
        total_pages: Math.ceil(totalResult.rows[0].total / limit)
      });
    }
    
    // POST - Criar novo produto
    if (req.method === 'POST') {
      const { nome, descricao, quantidade, valor_venda, valor_aquisicao } = req.body;
      
      if (!nome || !valor_venda) {
        return res.status(400).json({ 
          error: 'Nome e valor de venda são obrigatórios' 
        });
      }
      
      const result = await pool.query(
        `INSERT INTO produtos (nome, descricao, quantidade, valor_venda, valor_aquisicao) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          nome || '',
          descricao || '',
          parseInt(quantidade) || 0,
          parseFloat(valor_venda) || 0,
          parseFloat(valor_aquisicao) || 0
        ]
      );
      
      return res.status(201).json(result.rows[0]);
    }
    
    // PUT - Atualizar produto
    if (req.method === 'PUT') {
      const { id } = req.query;
      const { nome, descricao, quantidade, valor_venda, valor_aquisicao } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'ID do produto é obrigatório' });
      }
      
      const result = await pool.query(
        `UPDATE produtos 
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             quantidade = COALESCE($3, quantidade),
             valor_venda = COALESCE($4, valor_venda),
             valor_aquisicao = COALESCE($5, valor_aquisicao),
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = $6 RETURNING *`,
        [
          nome,
          descricao,
          quantidade ? parseInt(quantidade) : null,
          valor_venda ? parseFloat(valor_venda) : null,
          valor_aquisicao ? parseFloat(valor_aquisicao) : null,
          id
        ]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Produto não encontrado' });
      }
      
      return res.status(200).json(result.rows[0]);
    }
    
    // DELETE - Remover produto
    if (req.method === 'DELETE') {
      const { id } = req.query;
      
      if (!id) {
        return res.status(400).json({ error: 'ID do produto é obrigatório' });
      }
      
      // Verifica se produto tem vendas
      const vendasResult = await pool.query(
        'SELECT COUNT(*) FROM vendas WHERE produto_id = $1',
        [id]
      );
      
      if (parseInt(vendasResult.rows[0].count) > 0) {
        return res.status(400).json({ 
          error: 'Não é possível excluir produto com vendas registradas' 
        });
      }
      
      await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
      return res.status(200).json({ success: true, message: 'Produto excluído' });
    }
    
    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
    
  } catch (error) {
    console.error('Erro API produtos:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      detalhes: error.message 
    });
  }
                                      }
