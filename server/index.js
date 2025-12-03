import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null

async function init() {
  if (!pool) return
  await pool.query(`create table if not exists demandas(
    id serial primary key,
    designer text,
    tipo_midia text,
    titulo text,
    link text,
    arquivos jsonb,
    arquivo_nome text,
    plataforma text,
    data_solicitacao date,
    data_criacao date,
    status text,
    descricao text,
    created_at timestamptz default now()
  )`)
  await pool.query(`create table if not exists cad_designers(name text primary key)`)
  await pool.query(`create table if not exists cad_status(name text primary key)`)
  await pool.query(`create table if not exists cad_tipos(name text primary key)`)
  await pool.query(`create table if not exists cad_plataformas(name text primary key)`)
}

app.get('/api/demandas', async (req, res) => {
  if (!pool) return res.json([])
  const r = await pool.query('select * from demandas order by id asc')
  const rows = r.rows.map(x => ({
    id: x.id,
    designer: x.designer,
    tipoMidia: x.tipo_midia,
    titulo: x.titulo,
    link: x.link,
    arquivos: x.arquivos || [],
    arquivoNome: x.arquivo_nome,
    plataforma: x.plataforma,
    dataSolicitacao: x.data_solicitacao ? x.data_solicitacao.toISOString().slice(0,10) : null,
    dataCriacao: x.data_criacao ? x.data_criacao.toISOString().slice(0,10) : null,
    status: x.status,
    descricao: x.descricao
  }))
  res.json(rows)
})

app.post('/api/demandas', async (req, res) => {
  if (!pool) return res.status(200).json(req.body)
  const b = req.body
  const r = await pool.query(
    `insert into demandas(designer,tipo_midia,titulo,link,arquivos,arquivo_nome,plataforma,data_solicitacao,data_criacao,status,descricao)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [b.designer,b.tipoMidia,b.titulo,b.link,b.arquivos||[],b.arquivoNome||null,b.plataforma||null,b.dataSolicitacao||null,b.dataCriacao||null,b.status||null,b.descricao||null]
  )
  res.json({ ...b, id: r.rows[0].id })
})

app.put('/api/demandas/:id', async (req, res) => {
  if (!pool) return res.status(200).json(req.body)
  const id = Number(req.params.id)
  const b = req.body
  await pool.query(
    `update demandas set designer=$1,tipo_midia=$2,titulo=$3,link=$4,arquivos=$5,arquivo_nome=$6,plataforma=$7,data_solicitacao=$8,data_criacao=$9,status=$10,descricao=$11 where id=$12`,
    [b.designer,b.tipoMidia,b.titulo,b.link,b.arquivos||[],b.arquivoNome||null,b.plataforma||null,b.dataSolicitacao||null,b.dataCriacao||null,b.status||null,b.descricao||null,id]
  )
  res.json({ ok: true })
})

app.delete('/api/demandas/:id', async (req, res) => {
  if (!pool) return res.json({ ok: true })
  const id = Number(req.params.id)
  await pool.query(`delete from demandas where id=$1`, [id])
  res.json({ ok: true })
})

function cadTable(tipo) {
  if (tipo==='designers') return 'cad_designers'
  if (tipo==='status') return 'cad_status'
  if (tipo==='tipos') return 'cad_tipos'
  if (tipo==='plataformas') return 'cad_plataformas'
  return null
}

app.get('/api/cadastros/:tipo', async (req, res) => {
  if (!pool) return res.json([])
  const tbl = cadTable(req.params.tipo)
  if (!tbl) return res.status(400).json([])
  const r = await pool.query(`select name from ${tbl} order by name asc`)
  res.json(r.rows.map(x=>x.name))
})

app.post('/api/cadastros/:tipo', async (req, res) => {
  if (!pool) return res.json({ ok: true })
  const tbl = cadTable(req.params.tipo)
  if (!tbl) return res.status(400).json({ ok: false })
  const { name } = req.body
  if (!name) return res.status(400).json({ ok: false })
  await pool.query(`insert into ${tbl}(name) values($1) on conflict (name) do nothing`, [name])
  res.json({ ok: true })
})

app.delete('/api/cadastros/:tipo/:name', async (req, res) => {
  if (!pool) return res.json({ ok: true })
  const tbl = cadTable(req.params.tipo)
  if (!tbl) return res.status(400).json({ ok: false })
  await pool.query(`delete from ${tbl} where name=$1`, [req.params.name])
  res.json({ ok: true })
})

const dist = path.join(__dirname, '../dist')
app.use(express.static(dist))
app.get('*', (req, res) => {
  res.sendFile(path.join(dist, 'index.html'))
})

init().then(()=>{
  const port = process.env.PORT || 3000
  app.listen(port, () => {})
})

