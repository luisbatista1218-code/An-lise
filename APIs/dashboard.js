import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Método não permitido' });
    }
    
    const { periodo = 'dia' } = req.query;
    
    // Período para filtros
    let periodoFilter = '';
    switch(periodo) {
      case 'dia':
        periodoFilter = "DATE(data_venda) = CURRENT_DATE";
        break;
      case 'semana':
        periodoFilter = "data_venda >= CURRENT_DATE - INTERVAL '7 days'";
        break;
      case 'mes':
        periodoFilter = "data_venda >= CURRENT_DATE - INTERVAL '30 days'";
        break;
      default:
        periodoFilter = "DATE(data_venda) = CURRENT_DATE";
    }
    
    // 1. ESTATÍSTICAS PRINCIPAIS
    const [vendasHoje, totalProdutos, baixoEstoque, ultimasVendas, produtosMaisVendidos, horarioPico] = await Promise.all([
      // Vendas hoje
      pool.query(`
        SELECT 
          COUNT(*) as total_vendas,
          COALESCE(SUM(valor_total), 0) as faturamento,
          COALESCE(AVG(valor_total), 0) as ticket_medio
        FROM vendas 
        WHERE ${periodoFilter}
      `),
      
      // Total produtos em estoque
      pool.query(`
        SELECT 
          COUNT(*) as total_cadastrados,
          COALESCE(SUM(quantidade), 0) as total_estoque,
          COUNT(CASE WHEN quantidade < 20 THEN 1 END) as criticos
        FROM produtos
      `),
      
      // Produtos baixo estoque (< 20)
      pool.query(`
        SELECT id, nome, quantidade, valor_venda
        FROM produtos 
        WHERE quantidade < 20 
        ORDER BY quantidade ASC 
        LIMIT 10
      `),
      
      // Últimas 5 vendas
      pool.query(`
        SELECT v.*, p.nome as produto_nome_completo
        FROM vendas v
        LEFT JOIN produtos p ON v.produto_id = p.id
        ORDER BY v.data_venda DESC 
        LIMIT 5
      `),
      
      // Produtos mais vendidos
      pool.query(`
        SELECT 
          p.nome,
          SUM(v.quantidade) as total_vendido,
          SUM(v.valor_total) as faturamento_total
        FROM vendas v
        JOIN produtos p ON v.produto_id = p.id
        WHERE ${periodoFilter}
        GROUP BY p.id, p.nome
        ORDER BY total_vendido DESC
        LIMIT 5
      `),
      
      // Horário de pico
      pool.query(`
        SELECT 
          EXTRACT(HOUR FROM data_venda) as hora,
          COUNT(*) as total_vendas,
          SUM(valor_total) as faturamento
        FROM vendas
        WHERE ${periodoFilter}
        GROUP BY EXTRACT(HOUR FROM data_venda)
        ORDER BY total_vendas DESC
        LIMIT 1
      `)
    ]);
    
    // 2. VENDAS POR DIA (ÚLTIMOS 7 DIAS)
    const vendasPorDia = await pool.query(`
      SELECT 
        DATE(data_venda) as data,
        COUNT(*) as total_vendas,
        COALESCE(SUM(valor_total), 0) as faturamento
      FROM vendas
      WHERE data_venda >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(data_venda)
      ORDER BY data DESC
    `);
    
    // 3. LUCRO ESTIMADO (40% margem padrão)
    const faturamentoTotal = parseFloat(vendasHoje.rows[0].faturamento) || 0;
    const lucroEstimado = faturamentoTotal * 0.4;
    
    // 4. PRODUTO DO DIA
    const produtoDoDia = produtosMaisVendidos.rows[0] || null;
    
    // 5. MELHOR PERÍODO
    const melhorHorario = horarioPico.rows[0] || { hora: 12, total_vendas: 0 };
    
    // Monta resposta
    const response = {
      // Cards principais
      vendas_hoje: parseInt(vendasHoje.rows[0].total_vendas) || 0,
      faturamento_hoje: faturamentoTotal,
      ticket_medio: parseFloat(vendasHoje.rows[0].ticket_medio) || 0,
      lucro_hoje: lucroEstimado,
      
      // Estoque
      total_estoque: parseInt(totalProdutos.rows[0].total_estoque) || 0,
      total_cadastrados: parseInt(totalProdutos.rows[0].total_cadastrados) || 0,
      estoque_criticos: parseInt(totalProdutos.rows[0].criticos) || 0,
      
      // Listas
      baixo_estoque: baixoEstoque.rows,
      ultimas_vendas: ultimasVendas.rows,
      produtos_mais_vendidos: produtosMaisVendidos.rows,
      
      // Análises
      produto_do_dia: produtoDoDia ? {
        nome: produtoDoDia.nome,
        vendas: produtoDoDia.total_vendido,
        faturamento: produtoDoDia.faturamento_total
      } : null,
      
      melhor_periodo: {
        hora: melhorHorario.hora,
        total_vendas: parseInt(melhorHorario.total_vendas) || 0
      },
      
      // Gráficos
      vendas_por_dia: vendasPorDia.rows.map(row => ({
        data: row.data,
        vendas: parseInt(row.total_vendas),
        faturamento: parseFloat(row.faturamento)
      }))
    };
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Erro API dashboard:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      detalhes: error.message 
    });
  }
      }
