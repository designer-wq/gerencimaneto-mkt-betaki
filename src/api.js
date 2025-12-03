const API_BASE = import.meta.env.VITE_API_BASE || ''

const get = (p) => fetch(`${API_BASE}${p}`).then(r=>r.json())
const post = (p, b) => fetch(`${API_BASE}${p}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }).then(r=>r.json())
const put = (p, b) => fetch(`${API_BASE}${p}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }).then(r=>r.json())
const del = (p) => fetch(`${API_BASE}${p}`, { method:'DELETE' }).then(r=>r.json())

export const apiEnabled = !!API_BASE
export const api = {
  listDemandas: () => get('/api/demandas'),
  createDemanda: (d) => post('/api/demandas', d),
  updateDemanda: (id, d) => put(`/api/demandas/${id}`, d),
  deleteDemanda: (id) => del(`/api/demandas/${id}`),
  listCadastros: (tipo) => get(`/api/cadastros/${tipo}`),
  addCadastro: (tipo, name) => post(`/api/cadastros/${tipo}`, { name }),
  removeCadastro: (tipo, name) => del(`/api/cadastros/${tipo}/${encodeURIComponent(name)}`),
}
