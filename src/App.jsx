import React, { useEffect, useMemo, useState } from 'react'
import { db } from './firebase'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { apiEnabled, api } from './api'
const readLS = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)||'null'); return Array.isArray(v) ? v : def } catch { return def } }
const readObj = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)||'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : def } catch { return def } }
const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v))

const ESTADOS = ["Aberta", "Em Progresso", "Concluída"]
const statusLabel = s => s === "Aberta" ? "Aberta" : s === "Em Progresso" ? "Em Progresso" : "Concluída"
const statusDot = s => s === "Aberta" ? "🟡" : s === "Em Progresso" ? "🔵" : s === "Concluída" ? "🟢" : "•"
const statusWithDot = s => `${statusDot(s)} ${statusLabel(s)}`
const statusClass = s => s === 'Aberta' ? 'st-open' : s === 'Em Progresso' ? 'st-progress' : 'st-done'

const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'')
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : { r:17,g:24,b:39 }
}
const contrastText = (hex) => {
  const {r,g,b} = hexToRgb(hex)
  const yiq = (r*299 + g*587 + b*114)/1000
  return yiq >= 128 ? '#111' : '#fff'
}
const statusColor = (s, colors) => colors?.[s] || (s==='Aberta'?'#f59e0b': s==='Em Progresso'?'#3b82f6': s==='Concluída'?'#10b981':'#3b82f6')

const hojeISO = () => {
  const d = new Date(); const z = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`
}
const ler = () => { try { return JSON.parse(localStorage.getItem('demandas')||'[]') } catch { return [] } }
const gravar = arr => localStorage.setItem('demandas', JSON.stringify(arr))
const proxId = arr => arr.length ? Math.max(...arr.map(x=>x.id))+1 : 1

function Header({ onNew, view, setView }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="team">Equipe de Marketing</div>
      </div>
      <div className="topbar-right">
        <button className="primary" onClick={onNew}>Nova Demanda</button>
      </div>
    </div>
  )
}

function FilterButton({ onOpen, view, setView, filtros, setFiltros }) {
  return (
    <div className="filtersbar toolbar">
      <button className="icon" onClick={onOpen}>🔎 Filtro</button>
      <input
        className="search"
        type="search"
        placeholder="Pesquisar por título"
        value={filtros.q||''}
        onChange={e=> setFiltros(prev=> ({ ...prev, q: e.target.value }))}
      />
      <div className="view-icons">
        <span>Visualização</span>
        <ViewButtonsInner view={view} setView={setView} />
      </div>
    </div>
  )
}

function ViewButtonsInner({ view, setView }) {
  return (
    <div className="views-inline">
      <button className={`icon ${view==='table'?'active':''}`} title="Tabela" onClick={()=>setView('table')}>📄</button>
      <button className={`icon ${view==='board'?'active':''}`} title="Quadro" onClick={()=>setView('board')}>🗂</button>
      <button className={`icon ${view==='calendar'?'active':''}`} title="Calendário" onClick={()=>setView('calendar')}>📅</button>
    </div>
  )
}

function FilterModal({ open, filtros, setFiltros, designers, onClose, cadStatus }) {
  const set = (k,v)=>setFiltros(prev=>({ ...prev, [k]: v }))
  const clear = ()=>setFiltros({designer:'',status:'',cIni:'',cFim:'',sIni:'',sFim:''})
  if (!open) return null
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-dialog" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div className="title">🔎 Filtros</div>
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row"><label>Designer</label>
            <select value={filtros.designer} onChange={e=>set('designer', e.target.value)}>
              <option value="">Designer</option>
              {designers.map(d=> <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Status</label>
            <select className="status-select" value={filtros.status} onChange={e=>set('status', e.target.value)}>
              <option value="">Status</option>
              {cadStatus.map(s=> <option key={s} value={s}>{statusWithDot(s)}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Data de Criação</label>
            <div className="range">
              <input type="date" value={filtros.cIni} onChange={e=>set('cIni', e.target.value)} />
              <span>–</span>
              <input type="date" value={filtros.cFim} onChange={e=>set('cFim', e.target.value)} />
            </div>
          </div>
          <div className="form-row"><label>Data de Solicitação</label>
            <div className="range">
              <input type="date" value={filtros.sIni} onChange={e=>set('sIni', e.target.value)} />
              <span>–</span>
              <input type="date" value={filtros.sFim} onChange={e=>set('sFim', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="icon" onClick={clear}>🧹 Limpar</button>
          <button className="primary" onClick={onClose}>Aplicar</button>
        </div>
      </div>
    </div>
  )
}

function aplicarFiltros(items, f) {
  return items.filter(it => {
    if (f.q && !(it.titulo||'').toLowerCase().includes(f.q.toLowerCase())) return false
    if (f.designer && it.designer !== f.designer) return false
    if (f.status && it.status !== f.status) return false
    if (f.cIni && it.dataCriacao < f.cIni) return false
    if (f.cFim && it.dataCriacao > f.cFim) return false
    if (f.sIni && it.dataSolicitacao < f.sIni) return false
    if (f.sFim && it.dataSolicitacao > f.sFim) return false
    return true
  })
}

function TableView({ items, onEdit, onStatus, cadStatus, onDelete, hasMore, showMore, canCollapse, showLess, shown, total }) {
  return (
    <div className="table">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Designer</th>
            <th>Status</th>
            <th>Data de Solicitação</th>
            <th>Tipo</th>
            <th>Plataforma</th>
            <th>Link</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="row-clickable" onClick={()=>onEdit(it)}>
              <td className="name">{it.titulo}</td>
              <td>{it.designer}</td>
              <td>
                <select className="status-select" value={it.status} onChange={e=>onStatus(it.id, e.target.value)} onClick={e=>e.stopPropagation()}>
                  {cadStatus.map(s=> <option key={s} value={s}>{statusWithDot(s)}</option>)}
                </select>
              </td>
              <td>{it.dataSolicitacao}</td>
              <td>{it.tipoMidia}</td>
              <td>{it.plataforma || ''}</td>
              <td>{it.link ? <a href={it.link} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>Visualizar</a> : ''}</td>
              <td>
                {Array.isArray(it.arquivos) && it.arquivos.length ? (
                  <div className="files">
                    {it.arquivos.slice(0,5).map((f)=> (
                      <a key={f.name} href={f.url} target="_blank" rel="noreferrer" title={f.name} onClick={e=>e.stopPropagation()}>
                        <img className="file-thumb" src={f.url} alt={f.name} />
                      </a>
                    ))}
                  </div>
                ) : (it.arquivoNome || '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-footer">
        {hasMore && <button className="primary" onClick={showMore}>Mostrar mais demandas</button>}
        {canCollapse && <button className="primary" onClick={showLess}>Mostrar menos demandas</button>}
      </div>
    </div>
  )
}

function BoardView({ items, onEdit, onStatus, cadStatus, onDelete }) {
  return (
    <div className="board">
      {cadStatus.map(st => (
        <div key={st} className="column">
          <div className="col-head">{statusWithDot(st)}</div>
          <div className="col-body">
            {items.filter(x=>x.status===st).map(it => (
              <div key={it.id} className="card" onClick={()=>onEdit(it)}>
                <div className="card-top">
                  <div className="title">{it.titulo}</div>
                  <div className="acts" />
                </div>
                <div className="meta">{it.designer} • {it.tipoMidia}{it.plataforma?` • ${it.plataforma}`:''}</div>
                <select className="status-select" value={it.status} onChange={e=>onStatus(it.id, e.target.value)} onClick={e=>e.stopPropagation()}>
                  {cadStatus.map(s=> <option key={s} value={s}>{statusWithDot(s)}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CalendarView({ items, refDate }) {
  const inicio = new Date(refDate.getFullYear(), refDate.getMonth(), 1)
  const fim = new Date(refDate.getFullYear(), refDate.getMonth()+1, 0)
  const firstWeekday = inicio.getDay(); const dias = fim.getDate()
  const porDia = {}
  items.forEach(it => { const k = it.dataSolicitacao; const d = new Date(k); if (d.getMonth()===refDate.getMonth() && d.getFullYear()===refDate.getFullYear()) { (porDia[k] ||= []).push(it) } })
  const days = []
  for (let i=0;i<firstWeekday;i++) days.push(null)
  for (let d=1; d<=dias; d++) days.push(d)
  return (
    <div className="calendar">
      <div className="cal-head">
        <div className="month">{refDate.toLocaleString('pt-BR', { month:'long', year:'numeric' })}</div>
      </div>
      <div className="cal-grid">
        {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map(w => <div key={w} className="cal-cell head">{w}</div>)}
        {days.map((d,i)=>{
          if (!d) return <div key={i} className="cal-cell" />
          const key = `${refDate.getFullYear()}-${String(refDate.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          const arr = porDia[key]||[]
          return (
            <div key={i} className="cal-cell">
              <div className="day">{d}</div>
              {arr.map(x=> <div key={x.id} className="cal-item">{x.titulo} ({x.designer})</div>)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Modal({ open, mode, onClose, onSubmit, initial, cadTipos, cadDesigners, cadPlataformas, onDelete }) {
  const [designer, setDesigner] = useState(initial?.designer || '')
  const [tipoMidia, setTipoMidia] = useState(initial?.tipoMidia || 'Post')
  const [titulo, setTitulo] = useState(initial?.titulo || '')
  const [link, setLink] = useState(initial?.link || '')
  const [arquivoNome, setArquivoNome] = useState('')
  const [dataSolic, setDataSolic] = useState(initial?.dataSolicitacao || hojeISO())
  const [plataforma, setPlataforma] = useState(initial?.plataforma || '')
  const [arquivos, setArquivos] = useState(initial?.arquivos || [])
  const [dataCriacao, setDataCriacao] = useState(initial?.dataCriacao || hojeISO())
  const [descricao, setDescricao] = useState(initial?.descricao || '')
  useEffect(()=>{
    setDesigner(initial?.designer || (cadDesigners?.[0] || ''))
    setTipoMidia(initial?.tipoMidia || (cadTipos?.[0] || 'Post'))
    setTitulo(initial?.titulo || '')
    setLink(initial?.link || '')
    setArquivoNome('')
    setDataSolic(initial?.dataSolicitacao || hojeISO())
    setPlataforma(initial?.plataforma || (cadPlataformas?.[0] || ''))
    setArquivos(initial?.arquivos || [])
    setDataCriacao(initial?.dataCriacao || hojeISO())
    setDescricao(initial?.descricao || '')
  },[initial, open, cadDesigners, cadTipos, cadPlataformas])
  if (!open) return null
  const submit = e => { e.preventDefault(); onSubmit({ designer, tipoMidia, titulo, link, arquivoNome, dataSolic, plataforma, arquivos, descricao }) }
  return (
    <div className="modal" onClick={mode==='create'? undefined : onClose}>
      <div className="modal-dialog" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div className="title">{mode==='create'? '➕ Nova demanda' : '✏️ Editar demanda'}</div>
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <form className="modal-body" onSubmit={submit}>
          <div className="form-grid">
            <div className="form-row"><label>Designer</label>
              <select value={designer} onChange={e=>setDesigner(e.target.value)} required>
                <option value="">Designer</option>
                {(cadDesigners||[]).map(d=> <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-row"><label>Tipo</label><select value={tipoMidia} onChange={e=>setTipoMidia(e.target.value)}>
              {(cadTipos||['Post','Story','Banner','Vídeo','Outro']).map(t=> <option key={t} value={t}>{t}</option>)}
            </select></div>
            <div className="form-row"><label>Titulo</label><input value={titulo} onChange={e=>setTitulo(e.target.value)} required /></div>
            <div className="form-row"><label>Plataforma</label>
              <select value={plataforma} onChange={e=>setPlataforma(e.target.value)}>
                <option value="">Plataforma</option>
                {(cadPlataformas||[]).map(p=> <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-row"><label>Link</label><input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://" /></div>
            <div className="form-row"><label>Arquivo</label>
              <input type="file" multiple accept="image/*" onChange={e=>{
                const files = Array.from(e.target.files||[]).slice(0,5)
                const readers = files.map(f => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve({ name: f.name, url: r.result }); r.readAsDataURL(f) }))
                Promise.all(readers).then(arr => setArquivos(arr))
              }} />
            </div>
            {mode!=='create' && <div className="form-row"><label>Data de Criação</label><input type="date" value={dataCriacao} disabled /></div>}
            <div className="form-row"><label>Data de Solicitação</label><input type="date" value={dataSolic} onChange={e=>setDataSolic(e.target.value)} disabled={mode==='create'} /></div>
          </div>
          <div className="form-row"><label>Descrição</label><textarea rows={3} value={descricao} onChange={e=>setDescricao(e.target.value)} /></div>
          <div className="modal-footer">
            {mode==='edit' && <button className="danger" type="button" onClick={()=>{ if (window.confirm('Confirmar exclusão desta demanda?')) { onDelete(initial.id); onClose() } }}>Excluir</button>}
            <button className="primary" type="submit">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CadastrosView({ cadStatus, setCadStatus, cadTipos, setCadTipos, cadDesigners, setCadDesigners, cadPlataformas, setCadPlataformas, cadStatusColors, setCadStatusColors }) {
  const [tab, setTab] = useState('designer')
  const [novo, setNovo] = useState('')
  const [novoCor, setNovoCor] = useState('#f59e0b')
  const lista = tab==='designer' ? cadDesigners : tab==='status' ? cadStatus : tab==='tipo' ? cadTipos : cadPlataformas
  const setLista = (arr) => {
    if (tab==='designer') setCadDesigners(arr)
    else if (tab==='status') setCadStatus(arr)
    else if (tab==='tipo') setCadTipos(arr)
    else setCadPlataformas(arr)
  }
  const addItem = async () => { const v = novo.trim(); if (!v) return; if (lista.includes(v)) return; const arr = [...lista, v]; setLista(arr); setNovo(''); if (tab==='status') setCadStatusColors(prev=> ({ ...prev, [v]: novoCor })); if (apiEnabled) await api.addCadastro(tab==='designer'?'designers':tab==='status'?'status':tab==='tipo'?'tipos':'plataformas', v) }
  const removeItem = async (v) => { const arr = lista.filter(x=>x!==v); setLista(arr); if (apiEnabled) await api.removeCadastro(tab==='designer'?'designers':tab==='status'?'status':tab==='tipo'?'tipos':'plataformas', v) }
  return (
    <div className="panel">
      <div className="tabs">
        <button className={`tab ${tab==='designer'?'active':''}`} onClick={()=>setTab('designer')}>Designer</button>
        <button className={`tab ${tab==='status'?'active':''}`} onClick={()=>setTab('status')}>Status</button>
        <button className={`tab ${tab==='tipo'?'active':''}`} onClick={()=>setTab('tipo')}>Tipo</button>
        <button className={`tab ${tab==='plataforma'?'active':''}`} onClick={()=>setTab('plataforma')}>Plataforma</button>
      </div>
      <div className="form-row" style={{marginTop:10}}>
        <label>{tab==='designer'?'Novo Designer':tab==='status'?'Novo Status':tab==='tipo'?'Novo Tipo':'Nova Plataforma'}</label>
        <div style={{display:'flex', gap:8}}>
          <input value={novo} onChange={e=>setNovo(e.target.value)} />
          {tab==='status' && <input type="color" value={novoCor} onChange={e=>setNovoCor(e.target.value)} title="Cor" />}
          <button className="primary" onClick={addItem}>Adicionar</button>
        </div>
      </div>
      <div className="list" style={{marginTop:12}}>
        {lista.length===0 ? <div className="empty">Sem itens</div> : (
          lista.map(v => (
            <div key={v} className="list-item" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px',border:'1px solid var(--border)',borderRadius:8,background:'#0b0e12',marginBottom:6}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {tab==='status' && <span className="status-dot" style={{background: cadStatusColors[v] || '#3b82f6'}} />}
                <div>{v}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {tab==='status' && <input type="color" value={cadStatusColors[v] || '#3b82f6'} onChange={e=> setCadStatusColors(prev=> ({ ...prev, [v]: e.target.value }))} />}
                <button className="icon" onClick={()=>removeItem(v)}>🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [demandas, setDemandas] = useState(ler())
  const [view, setView] = useState('table')
  const [route, setRoute] = useState('demandas')
  const [filtros, setFiltros] = useState({designer:'',status:'',cIni:'',cFim:'',sIni:'',sFim:''})
  const [filterOpen, setFilterOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [editing, setEditing] = useState(null)
  
  const [cadStatus, setCadStatus] = useState(readLS('cadStatus', ["Aberta","Em Progresso","Concluída"]))
  const [cadTipos, setCadTipos] = useState(readLS('cadTipos', ["Post","Story","Banner","Vídeo","Outro"]))
  const [cadDesigners, setCadDesigners] = useState(readLS('cadDesigners', []))
  const [cadPlataformas, setCadPlataformas] = useState(readLS('cadPlataformas', []))
  const [cadStatusColors, setCadStatusColors] = useState(readObj('cadStatusColors', { Aberta:'#f59e0b', "Em Progresso":"#3b82f6", "Concluída":"#10b981" }))
  const designersFromDemandas = useMemo(()=> Array.from(new Set(demandas.map(x=>x.designer).filter(Boolean))).sort(), [demandas])
  const designers = useMemo(()=> Array.from(new Set([...cadDesigners, ...designersFromDemandas])).sort(), [cadDesigners, designersFromDemandas])
  const items = useMemo(()=> aplicarFiltros(demandas, filtros), [demandas, filtros])
  const itemsSorted = useMemo(()=> items.slice().sort((a,b)=>{
    const da = a.dataCriacao||''; const db = b.dataCriacao||''; const c = db.localeCompare(da); if (c!==0) return c; const ia = a.id||0; const ib = b.id||0; return ib - ia
  }), [items])
  const [tableLimit, setTableLimit] = useState(10)
  const [calRef, setCalRef] = useState(new Date())

  useEffect(()=>{ gravar(demandas) },[demandas])
  useEffect(()=>{ writeLS('cadStatus', cadStatus) },[cadStatus])
  useEffect(()=>{ writeLS('cadTipos', cadTipos) },[cadTipos])
  useEffect(()=>{ writeLS('cadDesigners', cadDesigners) },[cadDesigners])
  useEffect(()=>{ writeLS('cadPlataformas', cadPlataformas) },[cadPlataformas])
  useEffect(()=>{ writeLS('cadStatusColors', cadStatusColors) },[cadStatusColors])
  useEffect(()=>{
    if (apiEnabled) {
      api.listDemandas().then(list => { if (Array.isArray(list)) setDemandas(list) })
      api.listCadastros('status').then(arr=> Array.isArray(arr) && setCadStatus(arr))
      api.listCadastros('tipos').then(arr=> Array.isArray(arr) && setCadTipos(arr))
      api.listCadastros('designers').then(arr=> Array.isArray(arr) && setCadDesigners(arr))
      api.listCadastros('plataformas').then(arr=> Array.isArray(arr) && setCadPlataformas(arr))
    }
  },[])

  const onNew = ()=>{ setModalMode('create'); setEditing(null); setModalOpen(true) }
  const onEdit = it => { setModalMode('edit'); setEditing(it); setModalOpen(true) }
  const onStatus = async (id, status) => {
    setDemandas(prev=> prev.map(x=> x.id===id ? { ...x, status } : x))
    if (apiEnabled) {
      const found = demandas.find(x=>x.id===id)
      if (found) await api.updateDemanda(id, { ...found, status })
    }
  }
  const onDelete = async (id) => {
    setDemandas(prev=> prev.filter(x=> x.id!==id))
    if (apiEnabled) await api.deleteDemanda(id)
  }
  const onSubmit = async ({ designer, tipoMidia, titulo, link, arquivoNome, dataSolic, plataforma, arquivos, descricao }) => {
    if (modalMode==='edit' && editing) {
      const updated = { ...editing, designer, tipoMidia, titulo, link, descricao, arquivos: (arquivos && arquivos.length ? arquivos : editing.arquivos), arquivoNome: arquivoNome || editing.arquivoNome, dataSolicitacao: dataSolic || editing.dataSolicitacao, plataforma }
      setDemandas(prev=> prev.map(x=> x.id===editing.id ? updated : x))
      if (apiEnabled) await api.updateDemanda(editing.id, updated)
    } else {
      const novo = { designer, tipoMidia, titulo, link, descricao, arquivos: (arquivos||[]), arquivoNome, plataforma, dataSolicitacao: hojeISO(), dataCriacao: hojeISO(), status: 'Aberta' }
      if (apiEnabled) {
        const saved = await api.createDemanda(novo)
        setDemandas(prev=> [...prev, { ...novo, id: saved?.id ?? proxId(prev) }])
      } else {
        const nextId = proxId(demandas)
        setDemandas(prev=> [...prev, { ...novo, id: nextId }])
        if (db) {
          try { await addDoc(collection(db, 'demandas'), { ...novo, id: nextId, createdAt: serverTimestamp() }) } catch {}
        }
      }
    }
    setModalOpen(false)
  }

  

  return (
    <div className="layout">
      <Sidebar route={route} setRoute={setRoute} />
      <div className="content">
        <div className="app">
          <Header onNew={onNew} view={view} setView={setView} />
          {route==='demandas' && <FilterButton onOpen={()=>setFilterOpen(true)} view={view} setView={setView} filtros={filtros} setFiltros={setFiltros} />}
          {route==='demandas' && view==='table' && <TableView items={itemsSorted.slice(0, tableLimit)} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} onDelete={onDelete} hasMore={itemsSorted.length>tableLimit} showMore={()=>setTableLimit(l=> Math.min(l+10, itemsSorted.length))} canCollapse={tableLimit>10} showLess={()=>setTableLimit(10)} shown={Math.min(tableLimit, itemsSorted.length)} total={itemsSorted.length} />}
          {route==='demandas' && view==='board' && <BoardView items={items} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} onDelete={onDelete} />}
          {route==='demandas' && view==='calendar' && (
          <div className="calendar-wrap">
            <div className="calendar-toolbar">
              <button onClick={()=>setView('table')}>Voltar</button>
              <div className="spacer" />
              <button onClick={()=> setCalRef(new Date(calRef.getFullYear(), calRef.getMonth()-1, 1))}>◀</button>
              <button onClick={()=> setCalRef(new Date())}>Hoje</button>
              <button onClick={()=> setCalRef(new Date(calRef.getFullYear(), calRef.getMonth()+1, 1))}>▶</button>
            </div>
            <CalendarView items={items} refDate={calRef} />
          </div>
          )}
          {route==='demandas' && (
            <>
          <Modal open={modalOpen} mode={modalMode} onClose={()=>setModalOpen(false)} onSubmit={onSubmit} initial={editing} cadTipos={cadTipos} cadDesigners={cadDesigners} cadPlataformas={cadPlataformas} onDelete={onDelete} />
              <FilterModal open={filterOpen} filtros={filtros} setFiltros={setFiltros} designers={designers} onClose={()=>setFilterOpen(false)} cadStatus={cadStatus} />
            </>
          )}
          {route==='cadastros' && (
            <CadastrosView cadStatus={cadStatus} setCadStatus={setCadStatus} cadTipos={cadTipos} setCadTipos={setCadTipos} cadDesigners={cadDesigners} setCadDesigners={setCadDesigners} cadPlataformas={cadPlataformas} setCadPlataformas={setCadPlataformas} cadStatusColors={cadStatusColors} setCadStatusColors={setCadStatusColors} />
          )}
          {route==='relatorios' && (
            <ReportsView demandas={demandas} designers={designers} />
          )}
          
        </div>
      </div>
    </div>
  )
}
function Sidebar({ route, setRoute }) {
  return (
    <aside className="sidebar">
      <nav>
        <ul className="nav-list">
          <li><a href="#" className={`nav-link ${route==='demandas'?'active':''}`} onClick={e=>{ e.preventDefault(); setRoute('demandas') }}>📋 Demandas</a></li>
          <li><a href="#" className={`nav-link ${route==='cadastros'?'active':''}`} onClick={e=>{ e.preventDefault(); setRoute('cadastros') }}>⚙️ Cadastros</a></li>
          <li><a href="#" className={`nav-link ${route==='relatorios'?'active':''}`} onClick={e=>{ e.preventDefault(); setRoute('relatorios') }}>📈 Relatórios</a></li>
        </ul>
      </nav>
    </aside>
  )
}

 

function ReportsView({ demandas, designers }) {
  const pad = n => String(n).padStart(2,'0')
  const toYMD = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const toYM = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`
  const isoWeek = d => {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    const dayNum = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1))
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7)
    return `${date.getUTCFullYear()}-W${pad(weekNo)}`
  }
  const hoje = new Date()
  const hojeStr = toYMD(hoje)
  const semanaKey = isoWeek(hoje)
  const mesKey = toYM(hoje)
  const mesPassadoKey = toYM(new Date(hoje.getFullYear(), hoje.getMonth()-1, 1))
  const countBy = (designer, pred) => demandas.filter(x=> x.designer===designer && pred(x)).length
  const rows = [
    { label: 'Criados Hoje', get: d => countBy(d, x=> x.dataCriacao===hojeStr) },
    { label: 'Criados na Semana', get: d => countBy(d, x=> isoWeek(new Date(x.dataCriacao))===semanaKey) },
    { label: 'Criados no Mês', get: d => countBy(d, x=> toYM(new Date(x.dataCriacao))===mesKey) },
    { label: 'Total Criado Mês Passado', get: d => countBy(d, x=> toYM(new Date(x.dataCriacao))===mesPassadoKey) },
    { label: 'Total Criado', get: d => countBy(d, _=> true) },
  ]
  const tipos = useMemo(()=> Array.from(new Set(demandas.map(x=> x.tipoMidia).filter(Boolean))).sort(), [demandas])
  const countTipoConcluida = (tipo) => demandas.filter(x=> x.tipoMidia===tipo && x.status==='Concluída').length
  return (
    <div className="reports">
      <div className="panel">
        <div className="report-matrix">
          <table>
            <thead>
              <tr>
                <th>Títulos</th>
                {designers.map(d=> <th key={d}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  {designers.map(d => <td key={d+r.label}>{r.get(d)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="report-matrix">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Concluídas</th>
              </tr>
            </thead>
            <tbody>
              {tipos.map(t => (
                <tr key={t}>
                  <td>{t}</td>
                  <td>{countTipoConcluida(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
