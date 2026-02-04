// api/index.js - TESTE QUE FUNCIONA
export default function handler(req, res) {
  console.log('API chamada:', req.url);
  res.json({ 
    status: '✅ API FUNCIONANDO!',
    url: req.url,
    data: new Date().toISOString()
  });
}
