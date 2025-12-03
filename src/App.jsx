import React, { useEffect, useMemo, useState } from 'react'
import { db } from './firebase'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { apiEnabled, api } from './api'
const readLS = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)||'null'); return Array.isArray(v) ? v : def } catch { return def } }
const readObj = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)||'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : def } catch { return def } }
const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v))

const ESTADOS = ["Aberta", "Em Progresso", "Concluída"]
const statusLabel = s => s === "Aberta" ? "Aberta" : s === "Em Progresso" ? "Em Progresso" : s === "Concluída" ? "Concluída" : s
const statusDot = s => s === "Aberta" ? "🟡" : s === "Em Progresso" ? "🔵" : s === "Concluída" ? "🟢" : "•"
const statusWithDot = s => `${statusDot(s)} ${statusLabel(s)}`
const statusClass = s => {
  const v = (s||'').toLowerCase()
  if (v.includes('pendente') || v.includes('aberta')) return 'st-pending'
  if (v.includes('progresso') || v.includes('produção')) return 'st-progress'
  if (v.includes('feedback')) return 'st-feedback'
  if (v.includes('conclu') || v.includes('aprov')) return 'st-done'
  if (v.includes('atras')) return 'st-late'
  return ''
}

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
const defaultTheme = {
  bg:'#070707',
  panel:'#0E0E0E',
  text:'#F2F2F2',
  muted:'#BDBDBD',
  border:'#ffffff1a',
  accent:'#BCD200',
  hover:'rgba(255,255,255,0.03)',
  btnBg:'#BCD200',
  btnText:'#111111',
  btnHoverBg:'#C7DB00',
  btnBorder:'#ffffff1a',
  shadow:'0 10px 30px rgba(0,0,0,.15)',
  green:'#10b981',
  yellow:'#f59e0b',
  red:'#ef4444',
  chart:'#3b82f6'
}

const hojeISO = () => {
  const d = new Date(); const z = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`
}
const ler = () => { try { return JSON.parse(localStorage.getItem('demandas')||'[]') } catch { return [] } }
const gravar = arr => localStorage.setItem('demandas', JSON.stringify(arr))
const proxId = arr => arr.length ? Math.max(...arr.map(x=>x.id))+1 : 1

function Counter({ value }) {
  const [v, setV] = useState(0)
  useEffect(()=>{
    let start = 0
    const target = Math.max(0, Number(value)||0)
    const steps = 20
    const inc = Math.max(1, Math.round(target/steps))
    setV(0)
    const id = setInterval(()=>{
      start += inc
      if (start >= target) { setV(target); clearInterval(id) }
      else setV(start)
    }, 25)
    return ()=> clearInterval(id)
  },[value])
  return <span>{v}</span>
}

function Sparkline({ series, color='#BCD200' }) {
  const w = 120, h = 30
  const max = Math.max(...series, 1)
  const step = series.length > 1 ? w/(series.length-1) : w
  const points = series.map((v,i)=> `${i*step},${h - (v/max)*h}`).join(' ')
  return (
    <svg width={w} height={h} className="sparkline" viewBox={`0 0 ${w} ${h}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  )
}

function Header({ onNew, view, setView, showNew }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="team">Equipe de Marketing</div>
      </div>
      <div className="topbar-right">
        {showNew && <button className="primary" onClick={onNew}>Nova Demanda</button>}
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

function FilterModal({ open, filtros, setFiltros, designers, onClose, cadStatus, cadPlataformas, cadTipos }) {
  const set = (k,v)=>setFiltros(prev=>({ ...prev, [k]: v }))
  const clear = ()=>setFiltros({designer:'',status:'',plataforma:'',cIni:'',cFim:'',sIni:'',sFim:''})
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
            <div className="chips">
              {cadStatus.map(s=> (
                <button key={s} className={`chip ${filtros.status===s?'active':''}`} onClick={()=> set('status', filtros.status===s?'':s)}>{s}</button>
              ))}
            </div>
          </div>
          <div className="form-row"><label>Tipo</label>
            <div className="chips">
              {cadTipos.map(t=> (
                <button key={t} className={`chip ${filtros.tipoMidia===t?'active':''}`} onClick={()=> set('tipoMidia', filtros.tipoMidia===t?'':t)}>{t}</button>
              ))}
            </div>
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
          <div className="form-row"><label>Plataforma</label>
            <select value={filtros.plataforma||''} onChange={e=>set('plataforma', e.target.value)}>
              <option value="">Plataforma</option>
              {cadPlataformas.map(p=> <option key={p} value={p}>{p}</option>)}
            </select>
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
    if (f.tipoMidia && it.tipoMidia !== f.tipoMidia) return false
    if (f.plataforma && (it.plataforma||'') !== f.plataforma) return false
    if (f.cIni && it.dataCriacao < f.cIni) return false
    if (f.cFim && it.dataCriacao > f.cFim) return false
    if (f.sIni && it.dataSolicitacao < f.sIni) return false
    if (f.sFim && it.dataSolicitacao > f.sFim) return false
    return true
  })
}

function TableView({ items, onEdit, onStatus, cadStatus, onDelete, onDuplicate, hasMore, showMore, canCollapse, showLess, shown, total, compact }) {
  const [menuOpen, setMenuOpen] = useState(null)
  const toggleMenu = (id) => setMenuOpen(prev => prev===id ? null : id)
  const pad = n => String(n).padStart(2,'0')
  const isoWeek = d => { const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dayNum = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - dayNum); const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1)); const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7); return `${date.getUTCFullYear()}-W${pad(weekNo)}` }
  const thisWeek = isoWeek(new Date())
  return (
    <div className={`table ${compact?'compact':''}`}>
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="row-clickable" onClick={()=>onEdit(it)}>
              <td className="name">{it.titulo}</td>
              <td>
                <div>{it.designer}</div>
              </td>
              <td>
                <select className={`status-select ${statusClass(it.status)}`} value={it.status} onChange={e=>onStatus(it.id, e.target.value)} onClick={e=>e.stopPropagation()}>
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
              <td className="actions-cell" onClick={e=>e.stopPropagation()}>
                <button className="icon" onClick={()=>toggleMenu(it.id)}>⋮</button>
                {menuOpen===it.id && (
                  <div className="actions-pop">
                    <button className="icon" onClick={()=>onEdit(it)}>✏️ Editar</button>
                    <button className="icon" onClick={()=>onDuplicate(it)}>📄 Duplicar</button>
                    <button className="icon" onClick={()=>onStatus(it.id, 'Concluída')}>✅ Concluir</button>
                  </div>
                )}
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

function BoardView({ items, onEdit, onStatus, cadStatus, onDelete, compact }) {
  const mondayCols = [
    { name:'Pendente', map:'Aberta' },
    { name:'Em produção', map:'Em Progresso' },
    { name:'Aguardando feedback', map:'Aguardando feedback' },
    { name:'Aprovada', map:'Concluída' },
    { name:'Concluída', map:'Concluída' },
  ]
  const available = new Set(cadStatus)
  const targetFor = (col) => available.has(col.map) ? col.map : (col.name==='Aguardando feedback' ? (available.has('Em Progresso')?'Em Progresso': cadStatus[0]) : (available.has('Concluída')?'Concluída': cadStatus[0]))
  const isInCol = (it, col) => {
    const t = targetFor(col)
    if (col.name==='Aguardando feedback') return (it.status||'').toLowerCase().includes('feedback') || it.status===t
    if (col.name==='Pendente') return (it.status||'').includes('Aberta') || it.status===t
    if (col.name==='Em produção') return it.status===t
    if (col.name==='Aprovada') return (it.status||'').toLowerCase().includes('aprov') || it.status===t
    if (col.name==='Concluída') return it.status===t
    return it.status===t
  }
  const onDropCol = (e, col) => {
    e.preventDefault()
    const id = Number(e.dataTransfer.getData('id'))
    const t = targetFor(col)
    if (id && t) onStatus(id, t)
  }
  const onDragOver = (e)=>{ e.preventDefault(); e.currentTarget.classList.add('dragover') }
  const onDragLeave = (e)=>{ e.currentTarget.classList.remove('dragover') }
  const statusColorFor = (s)=> statusColor(s, {})
  return (
    <div className="board">
      {mondayCols.map(col => (
        <div key={col.name} className="column">
          <div className="col-head">{col.name}</div>
          <div className="col-body dropzone" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={e=> onDropCol(e, col)}>
            {items.filter(it=> isInCol(it, col)).map(it => (
              <div key={it.id} className="card kanban-card" draggable onDragStart={e=> e.dataTransfer.setData('id', String(it.id))} onClick={()=>onEdit(it)}>
                <div className="kanban-avatar">{String(it.designer||'').slice(0,2).toUpperCase()}</div>
                <div>
                  <div className="card-top">
                    <div className="title">{it.titulo}</div>
                  </div>
                  <div className="meta">{it.tipoMidia}{it.plataforma?` • ${it.plataforma}`:''}</div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span className="pill" style={{borderColor:statusColorFor(it.status), color:statusColorFor(it.status)}}>{statusLabel(it.status)}</span>
                    {it.prazo && <span className="due">⏰ {it.prazo}</span>}
                  </div>
                </div>
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
  const [prazo, setPrazo] = useState(initial?.prazo || '')
  useEffect(()=>{
    setDesigner(initial?.designer || '')
    setTipoMidia(initial?.tipoMidia || 'Post')
    setTitulo(initial?.titulo || '')
    setLink(initial?.link || '')
    setArquivoNome('')
    setDataSolic(initial?.dataSolicitacao || hojeISO())
    setPlataforma(initial?.plataforma || (cadPlataformas?.[0] || ''))
    setArquivos(initial?.arquivos || [])
    setDataCriacao(initial?.dataCriacao || hojeISO())
    setDescricao(initial?.descricao || '')
    setPrazo(initial?.prazo || '')
  },[initial, open, cadDesigners, cadTipos, cadPlataformas])
  if (!open) return null
  const submit = e => { e.preventDefault(); onSubmit({ designer, tipoMidia, titulo, link, arquivoNome, dataSolic, plataforma, arquivos, descricao, prazo }) }
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
            
            <div className="form-row"><label>Data de Solicitação</label><input type="date" value={dataSolic} onChange={e=>setDataSolic(e.target.value)} disabled={mode==='create'} /></div>
            <div className="form-row"><label>Prazo</label><input type="date" value={prazo} onChange={e=>setPrazo(e.target.value)} /></div>
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
  const [compact, setCompact] = useState(false)
  const [route, setRoute] = useState('demandas')
  const [filtros, setFiltros] = useState({designer:'',status:'',plataforma:'',cIni:'',cFim:'',sIni:'',sFim:''})
  const [filterOpen, setFilterOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [editing, setEditing] = useState(null)
  const [themeVars, setThemeVars] = useState(readObj('themeVars', defaultTheme))
  
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
    Object.entries(themeVars||{}).forEach(([k,v])=>{
      try { document.documentElement.style.setProperty(`--${k}`, v) } catch {}
    })
    writeLS('themeVars', themeVars)
  },[themeVars])
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
  const onDuplicate = async (it) => {
    const base = { ...it, id: undefined, status: 'Aberta', dataSolicitacao: hojeISO(), dataCriacao: hojeISO() }
    if (apiEnabled) {
      const saved = await api.createDemanda(base)
      setDemandas(prev=> [...prev, { ...base, id: saved?.id ?? proxId(prev) }])
    } else {
      const nextId = proxId(demandas)
      setDemandas(prev=> [...prev, { ...base, id: nextId }])
    }
  }
  const onStatus = async (id, status) => {
    const today = hojeISO()
    setDemandas(prev=> prev.map(x=> {
      if (x.id!==id) return x
      const changed = x.status !== status
      const revisoes = changed ? (x.revisoes||0)+1 : (x.revisoes||0)
      const dataConclusao = status==='Concluída' ? (x.dataConclusao||today) : x.dataConclusao
      return { ...x, status, revisoes, dataConclusao }
    }))
    if (apiEnabled) {
      const found = demandas.find(x=>x.id===id)
      if (found) await api.updateDemanda(id, { ...found, status, dataConclusao: status==='Concluída' ? (found.dataConclusao||today) : found.dataConclusao, revisoes: (found.revisoes||0) + (found.status!==status?1:0) })
    }
  }
  const onDelete = async (id) => {
    setDemandas(prev=> prev.filter(x=> x.id!==id))
    if (apiEnabled) await api.deleteDemanda(id)
  }
  const onSubmit = async ({ designer, tipoMidia, titulo, link, arquivoNome, dataSolic, plataforma, arquivos, descricao, prazo }) => {
    if (modalMode==='edit' && editing) {
      const updated = { ...editing, designer, tipoMidia, titulo, link, descricao, arquivos: (arquivos && arquivos.length ? arquivos : editing.arquivos), arquivoNome: arquivoNome || editing.arquivoNome, dataSolicitacao: dataSolic || editing.dataSolicitacao, plataforma, prazo }
      setDemandas(prev=> prev.map(x=> x.id===editing.id ? updated : x))
      if (apiEnabled) await api.updateDemanda(editing.id, updated)
    } else {
      const novo = { designer, tipoMidia, titulo, link, descricao, arquivos: (arquivos||[]), arquivoNome, plataforma, dataSolicitacao: hojeISO(), dataCriacao: hojeISO(), status: 'Aberta', prazo }
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
          <Header onNew={onNew} view={view} setView={setView} showNew={route==='demandas'} />
          {route!=='config' && (
            <FilterBar filtros={filtros} setFiltros={setFiltros} designers={designers} />
          )}
          {route==='demandas' && (
            <div className="topnav">
              <button className="icon" onClick={()=> setCompact(c=>!c)}>{compact?'Expandido':'Compacto'}</button>
            </div>
          )}
          {route==='demandas' && view==='table' && <TableView items={itemsSorted.slice(0, tableLimit)} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} onDelete={onDelete} onDuplicate={onDuplicate} hasMore={itemsSorted.length>tableLimit} showMore={()=>setTableLimit(l=> Math.min(l+10, itemsSorted.length))} canCollapse={tableLimit>10} showLess={()=>setTableLimit(10)} shown={Math.min(tableLimit, itemsSorted.length)} total={itemsSorted.length} compact={compact} />}
          {route==='demandas' && view==='board' && <BoardView items={items} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} onDelete={onDelete} compact={compact} />}
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
              <FilterModal open={filterOpen} filtros={filtros} setFiltros={setFiltros} designers={designers} onClose={()=>setFilterOpen(false)} cadStatus={cadStatus} cadPlataformas={cadPlataformas} cadTipos={cadTipos} />
            </>
          )}
          {route==='config' && (
            <ConfigView themeVars={themeVars} setThemeVars={setThemeVars} />
          )}
          {route==='cadastros' && (
            <CadastrosView cadStatus={cadStatus} setCadStatus={setCadStatus} cadTipos={cadTipos} setCadTipos={setCadTipos} cadDesigners={cadDesigners} setCadDesigners={setCadDesigners} cadPlataformas={cadPlataformas} setCadPlataformas={setCadPlataformas} cadStatusColors={cadStatusColors} setCadStatusColors={setCadStatusColors} />
          )}
          {route==='relatorios' && (
            <DashboardView demandas={demandas} items={items} designers={designers} setView={setView} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} onDelete={onDelete} onDuplicate={onDuplicate} compact={compact} calRef={calRef} setCalRef={setCalRef} />
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
          <li><a href="#" className={`nav-link ${route==='config'?'active':''}`} onClick={e=>{ e.preventDefault(); setRoute('config') }}>🎨 Configurações</a></li>
          <li><a href="#" className={`nav-link ${route==='cadastros'?'active':''}`} onClick={e=>{ e.preventDefault(); setRoute('cadastros') }}>⚙️ Cadastros</a></li>
          <li><a href="#" className={`nav-link ${route==='relatorios'?'active':''}`} onClick={e=>{ e.preventDefault(); setRoute('relatorios') }}>📈 Relatórios</a></li>
        </ul>
      </nav>
    </aside>
  )
}

 

function ReportsView({ demandas, designers, setRoute, setFiltros, setView }) {
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
  const norm = s => (s||'').trim()
  const designersKeys = Array.from(new Set(designers.filter(Boolean).map(norm))).sort()
  const hoje = new Date()
  const hojeStr = toYMD(hoje)
  const semanaKey = isoWeek(hoje)
  const mesKey = toYM(hoje)
  const mesPassadoKey = toYM(new Date(hoje.getFullYear(), hoje.getMonth()-1, 1))
  const countBy = (designerKey, pred) => demandas.filter(x=> norm(x.designer)===designerKey && pred(x)).length
  const rows = [
    { label: 'Criados Hoje', get: d => countBy(d, x=> x.dataCriacao===hojeStr) },
    { label: 'Criados na Semana', get: d => countBy(d, x=> isoWeek(new Date(x.dataCriacao))===semanaKey) },
    { label: 'Criados no Mês', get: d => countBy(d, x=> toYM(new Date(x.dataCriacao))===mesKey) },
    { label: 'Total Criado Mês Passado', get: d => countBy(d, x=> toYM(new Date(x.dataCriacao))===mesPassadoKey) },
    { label: 'Total Criado', get: d => countBy(d, _=> true) },
  ]
  const countDoneBy = (designerKey, pred) => demandas.filter(x=> norm(x.designer)===designerKey && x.status==='Concluída' && pred(x)).length
  const rowsDone = [
    { label: 'Total Concluído', get: d => countDoneBy(d, _=> true) },
  ]
  const tipos = useMemo(()=> Array.from(new Set(demandas.map(x=> x.tipoMidia).filter(Boolean))).sort(), [demandas])
  const countTipoConcluida = (tipo) => demandas.filter(x=> x.tipoMidia===tipo && x.status==='Concluída').length
  const [period, setPeriod] = useState('today')
  const [customIni, setCustomIni] = useState('')
  const [customFim, setCustomFim] = useState('')
  const startEnd = useMemo(()=>{
    const d = new Date()
    const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1)
    const endOfMonth = new Date(d.getFullYear(), d.getMonth()+1, 0)
    const startOfLastMonth = new Date(d.getFullYear(), d.getMonth()-1, 1)
    const endOfLastMonth = new Date(d.getFullYear(), d.getMonth(), 0)
    const startOfISOWeek = (ref) => { const r = new Date(ref); const day = r.getDay()||7; r.setDate(r.getDate() - (day-1)); return new Date(r.getFullYear(), r.getMonth(), r.getDate()) }
    const endOfISOWeek = (ref) => { const s = startOfISOWeek(ref); const e = new Date(s); e.setDate(e.getDate()+6); return e }
    if (period==='today') return { ini: toYMD(d), fim: toYMD(d) }
    if (period==='week') { const s = startOfISOWeek(d); const e = endOfISOWeek(d); return { ini: toYMD(s), fim: toYMD(e) } }
    if (period==='month') return { ini: toYMD(startOfMonth), fim: toYMD(endOfMonth) }
    if (period==='last_month') return { ini: toYMD(startOfLastMonth), fim: toYMD(endOfLastMonth) }
    if (period==='last_30') { const e = d; const s = new Date(d); s.setDate(s.getDate()-29); return { ini: toYMD(s), fim: toYMD(e) } }
    if (period==='custom' && customIni && customFim) return { ini: customIni, fim: customFim }
    return { ini: toYMD(startOfMonth), fim: toYMD(endOfMonth) }
  },[period, customIni, customFim])
  const prevStartEnd = useMemo(()=>{
    const parse = (s)=>{ const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd) }
    const iniD = parse(startEnd.ini); const fimD = parse(startEnd.fim)
    const days = Math.round((fimD - iniD)/86400000)+1
    const shift = (ref, n)=>{ const r = new Date(ref); r.setDate(r.getDate()-n); return r }
    const iniPrev = shift(iniD, days)
    const fimPrev = shift(fimD, days)
    return { ini: toYMD(iniPrev), fim: toYMD(fimPrev) }
  },[startEnd])
  const inRange = (ymd, r) => ymd >= r.ini && ymd <= r.fim
  const totalCriadosPeriodo = demandas.filter(x=> inRange(x.dataCriacao, startEnd)).length
  const totalConcluidosPeriodo = demandas.filter(x=> x.status==='Concluída' && inRange(x.dataCriacao, startEnd)).length
  const prevCriados = demandas.filter(x=> inRange(x.dataCriacao, prevStartEnd)).length
  const prevConcluidos = demandas.filter(x=> x.status==='Concluída' && inRange(x.dataCriacao, prevStartEnd)).length
  const varCriados = prevCriados ? Math.round(((totalCriadosPeriodo - prevCriados)/prevCriados)*100) : (totalCriadosPeriodo?100:0)
  const varConcluidos = prevConcluidos ? Math.round(((totalConcluidosPeriodo - prevConcluidos)/prevConcluidos)*100) : (totalConcluidosPeriodo?100:0)
  const weekDays = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
  const weekdayCounts = useMemo(()=>{
    const parse = (s)=>{ const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd) }
    const map = Array(7).fill(0)
    const mapDone = Array(7).fill(0)
    demandas.forEach(x=>{
      const d = parse(x.dataCriacao)
      const ymd = toYMD(d)
      if (inRange(ymd, startEnd)) { const wd = d.getDay(); map[wd]++; if (x.status==='Concluída') mapDone[wd]++ }
    })
    return { created: map, done: mapDone }
  },[demandas, startEnd])
  const [designerSel, setDesignerSel] = useState('')
  const matchDesigner = (x) => !designerSel || norm(x.designer)===designerSel
  return (
    <div className="reports">
      <div className="panel">
        <div className="reports-toolbar">
          <div>Período</div>
          <select value={period} onChange={e=> setPeriod(e.target.value)}>
            <option value="today">Hoje</option>
            <option value="week">Esta semana</option>
            <option value="month">Este mês</option>
            <option value="last_month">Mês passado</option>
            <option value="last_30">Últimos 30 dias</option>
            <option value="custom">Personalizado</option>
          </select>
          {period==='custom' && (
            <>
              <input type="date" value={customIni} onChange={e=>setCustomIni(e.target.value)} />
              <span>–</span>
              <input type="date" value={customFim} onChange={e=>setCustomFim(e.target.value)} />
            </>
          )}
          <div>Designer</div>
          <select value={designerSel} onChange={e=> setDesignerSel(e.target.value)}>
            <option value="">Todos</option>
            {designersKeys.map(d=> <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-title">📅 Criados no período</div>
            <div className="metric-value"><Counter value={demandas.filter(x=> matchDesigner(x) && inRange(x.dataCriacao, startEnd)).length} /></div>
            <div className="today-meta">{varCriados>=0?'⬆':'⬇'} {Math.abs(varCriados)}% vs período anterior</div>
            <Sparkline series={(()=>{ const parse=s=>{const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c)}; const ini=parse(startEnd.ini); const fim=parse(startEnd.fim); const days=Math.max(1,Math.round((fim-ini)/86400000)+1); const arr=[]; for(let i=0;i<days;i++){ const d=new Date(ini); d.setDate(ini.getDate()+i); const ymd=toYMD(d); arr.push(demandas.filter(x=> matchDesigner(x) && inRange(x.dataCriacao,{ini:ymd,fim:ymd})).length) } return arr })()} color="#BCD200" />
          </div>
          <div className="metric-card">
            <div className="metric-title">🏁 Concluídos no período</div>
            <div className="metric-value"><Counter value={demandas.filter(x=> matchDesigner(x) && x.status==='Concluída' && inRange(x.dataCriacao, startEnd)).length} /></div>
            <div className="today-meta">{varConcluidos>=0?'⬆':'⬇'} {Math.abs(varConcluidos)}% vs período anterior</div>
            <Sparkline series={(()=>{ const parse=s=>{const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c)}; const ini=parse(startEnd.ini); const fim=parse(startEnd.fim); const days=Math.max(1,Math.round((fim-ini)/86400000)+1); const arr=[]; for(let i=0;i<days;i++){ const d=new Date(ini); d.setDate(ini.getDate()+i); const ymd=toYMD(d); arr.push(demandas.filter(x=> matchDesigner(x) && x.status==='Concluída' && inRange(x.dataCriacao,{ini:ymd,fim:ymd})).length) } return arr })()} color="#9ba7b4" />
          </div>
          <div className="metric-card">
            <div className="metric-title">Pendentes (Aberta)</div>
            <div className="metric-value"><Counter value={demandas.filter(x=> matchDesigner(x) && x.status==='Aberta' && inRange(x.dataCriacao, startEnd)).length} /></div>
            <Sparkline series={(()=>{ const parse=s=>{const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c)}; const ini=parse(startEnd.ini); const fim=parse(startEnd.fim); const days=Math.max(1,Math.round((fim-ini)/86400000)+1); const arr=[]; for(let i=0;i<days;i++){ const d=new Date(ini); d.setDate(ini.getDate()+i); const ymd=toYMD(d); arr.push(demandas.filter(x=> matchDesigner(x) && x.status==='Aberta' && inRange(x.dataCriacao,{ini:ymd,fim:ymd})).length) } return arr })()} color="#BCD200" />
          </div>
          <div className="metric-card">
            <div className="metric-title">Em produção</div>
            <div className="metric-value"><Counter value={demandas.filter(x=> matchDesigner(x) && x.status==='Em Progresso' && inRange(x.dataCriacao, startEnd)).length} /></div>
            <Sparkline series={(()=>{ const parse=s=>{const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c)}; const ini=parse(startEnd.ini); const fim=parse(startEnd.fim); const days=Math.max(1,Math.round((fim-ini)/86400000)+1); const arr=[]; for(let i=0;i<days;i++){ const d=new Date(ini); d.setDate(ini.getDate()+i); const ymd=toYMD(d); arr.push(demandas.filter(x=> matchDesigner(x) && x.status==='Em Progresso' && inRange(x.dataCriacao,{ini:ymd,fim:ymd})).length) } return arr })()} color="#BCD200" />
          </div>
        </div>
        <div className="reports-grid">
        <div className="report-card">
          <div className="report-title">📊 Criados por dia da semana</div>
          <div className="chart">
            {weekDays.map((w,i)=>{
              const maxv = Math.max(...weekDays.map((_,idx)=> demandas.filter(x=> matchDesigner(x) && inRange(x.dataCriacao, startEnd) && (new Date(x.dataCriacao).getDay()===idx)).length), 1)
              const created = demandas.filter(x=> matchDesigner(x) && inRange(x.dataCriacao, startEnd) && (new Date(x.dataCriacao).getDay()===i)).length
              const cw = Math.round((created/maxv)*100)
              return (
                <div key={w} className="chart-row">
                  <div className="chart-label">{w}</div>
                  <div className="chart-bar"><div className="chart-fill" style={{ width: cw+'%', background: 'var(--accent)' }}></div><div className="chart-value">{created}</div></div>
                </div>
              )
            })}
          </div>
          <button className="icon" onClick={()=>{ setFiltros(prev=> ({ ...prev, cIni: startEnd.ini, cFim: startEnd.fim, designer: designerSel||'' })); setRoute('demandas'); setView('table') }}>🔍 Ver detalhes</button>
        </div>
        <div className="report-card">
          <div className="report-title">📈 Concluídos por dia da semana</div>
          <div className="chart">
            {weekDays.map((w,i)=>{
              const maxv = Math.max(...weekDays.map((_,idx)=> demandas.filter(x=> matchDesigner(x) && x.status==='Concluída' && inRange(x.dataCriacao, startEnd) && (new Date(x.dataCriacao).getDay()===idx)).length), 1)
              const done = demandas.filter(x=> matchDesigner(x) && x.status==='Concluída' && inRange(x.dataCriacao, startEnd) && (new Date(x.dataCriacao).getDay()===i)).length
              const dw = Math.round((done/maxv)*100)
              return (
                <div key={w} className="chart-row">
                  <div className="chart-label">{w}</div>
                  <div className="chart-bar"><div className="chart-fill" style={{ width: dw+'%', background: '#bdbdbd' }}></div><div className="chart-value">{done}</div></div>
                </div>
              )
            })}
          </div>
          <button className="icon" onClick={()=>{ setFiltros(prev=> ({ ...prev, cIni: startEnd.ini, cFim: startEnd.fim, designer: designerSel||'' })); setRoute('demandas'); setView('table') }}>🔍 Ver detalhes</button>
        </div>
        <div className="report-card">
          <div className="report-title">🔥 Alertas importantes</div>
          <div className="today-list">
            <div className="today-item alert-red">⚠ {demandas.filter(x=> matchDesigner(x) && (x.prazo||'') && x.status!=='Concluída' && x.prazo < toYMD(new Date())).length} demandas atrasadas</div>
            <div className="today-item alert-yellow">⏳ {demandas.filter(x=> matchDesigner(x) && (x.prazo||'') && x.status!=='Concluída' && x.prazo===toYMD(new Date(new Date().setDate(new Date().getDate()+1)))).length} vencem amanhã</div>
            <div className="today-item alert-orange">❗ {demandas.filter(x=> matchDesigner(x) && !norm(x.designer)).length} sem designer atribuído</div>
            <div className="today-item alert-purple">🔁 {demandas.filter(x=> matchDesigner(x) && (x.revisoes||0) >= 3).length} com mais de 2 revisões</div>
            <div className="today-item alert-grey">📌 {demandas.filter(x=> matchDesigner(x) && !(x.prazo||'')).length} sem prazo definido</div>
          </div>
        </div>
        </div>
        
      </div>
    </div>
  )
}

function ConfigView({ themeVars, setThemeVars }) {
  const [localVars, setLocalVars] = useState(themeVars||{})
  const [novoNome, setNovoNome] = useState('')
  const [novoValor, setNovoValor] = useState('')
  useEffect(()=>{ setLocalVars(themeVars||{}) }, [themeVars])
  const hex6 = s => /^#[0-9a-fA-F]{6}$/.test(s||'')
  const hex8 = s => /^#[0-9a-fA-F]{8}$/.test(s||'')
  const rgba = s => /^rgba\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\)$/.exec(s||'')
  const toHex = n => Math.max(0, Math.min(255, n|0)).toString(16).padStart(2,'0')
  const hexToRgbParts = (h) => ({ r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) })
  const parseVal = (v) => {
    if (hex6(v)) return { fmt:'hex6', base:v, a:1 }
    if (hex8(v)) return { fmt:'hex8', base:'#'+v.slice(1,7), a: parseInt(v.slice(7,9),16)/255 }
    const m = rgba(v)
    if (m) return { fmt:'rgba', base:'#'+toHex(+m[1])+toHex(+m[2])+toHex(+m[3]), a: parseFloat(m[4]) }
    return { fmt:'other', base:v, a:1 }
  }
  const compose = (k, base, a) => {
    const fmtPref = (k==='hover') ? 'rgba' : (k==='border' || k==='btnBorder') ? 'hex8' : 'hex6'
    if (fmtPref==='hex6' || a>=1) return base
    if (fmtPref==='hex8') return base + toHex(Math.round(a*255))
    const { r,g,b } = hexToRgbParts(base)
    return `rgba(${r},${g},${b},${a})`
  }
  const onChange = (k, v) => {
    const nv = { ...localVars, [k]: v }
    setLocalVars(nv)
    setThemeVars(nv)
  }
  const onAlpha = (k, aPerc) => {
    const info = parseVal(localVars[k]||'')
    const a = Math.max(0, Math.min(100, Number(aPerc)||0))/100
    const next = compose(k, info.base, a)
    onChange(k, next)
  }
  const addVar = () => {
    if (!novoNome) return
    const nv = { ...localVars, [novoNome]: novoValor||'' }
    setLocalVars(nv)
    setThemeVars(nv)
    setNovoNome('')
    setNovoValor('')
  }
  const reset = () => setThemeVars(defaultTheme)
  const groups = [
    { title:'Base', keys:['bg','panel','accent'] },
    { title:'Texto', keys:['text','muted'] },
    { title:'Traçado', keys:['border'] },
    { title:'Botões', keys:['btnBg','btnText','btnHoverBg','btnBorder'] },
    { title:'Hover/Efeitos', keys:['hover','shadow'] },
    { title:'Extras', keys:['green','yellow','red','chart'] },
  ]
  return (
    <div className="panel">
      <div className="tabs">
        <button className="tab active">Tema</button>
      </div>
      <div className="config-grid">
        {groups.map(g=> (
          <div key={g.title} className="card">
            <div className="title">{g.title}</div>
            {g.keys.map(k=>{
              const v = localVars[k]||''
              const info = parseVal(v)
              const isColorish = info.fmt!=='other'
              const showAlpha = (k==='hover' || k==='border' || k==='btnBorder')
              return (
                <div className="form-row" key={k}>
                  <label>{k}</label>
                  <div className="color-row">
                    {isColorish ? (
                      <>
                        <input type="color" value={info.base} onChange={e=> onChange(k, compose(k, e.target.value, info.a))} />
                        {showAlpha && (
                          <input className="alpha" type="range" min="0" max="100" step="1" value={Math.round(info.a*100)} onChange={e=> onAlpha(k, e.target.value)} title={`Alpha ${Math.round(info.a*100)}%`} />
                        )}
                      </>
                    ) : (
                      <input value={v} onChange={e=> onChange(k, e.target.value)} />
                    )}
                    <div className="swatch" style={{background:v}} />
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div className="card" style={{gridColumn:'1 / -1'}}>
          <div className="title">Adicionar variável</div>
          <div className="color-row">
            <input placeholder="nome" value={novoNome} onChange={e=>setNovoNome(e.target.value)} />
            <input placeholder="valor" value={novoValor} onChange={e=>setNovoValor(e.target.value)} />
            <button className="primary" type="button" onClick={addVar}>Adicionar</button>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <button className="primary" type="button" onClick={reset}>Restaurar padrão</button>
      </div>
    </div>
  )
}
function FilterBar({ filtros, setFiltros, designers }) {
  const [period, setPeriod] = useState('today')
  useEffect(()=>{
    const d = new Date()
    const toYMD = x => { const p = n=>String(n).padStart(2,'0'); return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}` }
    const startOfISOWeek = (ref) => { const r = new Date(ref); const day = r.getDay()||7; r.setDate(r.getDate() - (day-1)); return new Date(r.getFullYear(), r.getMonth(), r.getDate()) }
    const endOfISOWeek = (ref) => { const s = startOfISOWeek(ref); const e = new Date(s); e.setDate(e.getDate()+6); return e }
    const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1)
    const endOfMonth = new Date(d.getFullYear(), d.getMonth()+1, 0)
    const startOfLastMonth = new Date(d.getFullYear(), d.getMonth()-1, 1)
    const endOfLastMonth = new Date(d.getFullYear(), d.getMonth(), 0)
    if (period==='today') setFiltros(prev=>({ ...prev, cIni: toYMD(d), cFim: toYMD(d) }))
    if (period==='week') { const s=startOfISOWeek(d), e=endOfISOWeek(d); setFiltros(prev=>({ ...prev, cIni: toYMD(s), cFim: toYMD(e) })) }
    if (period==='month') setFiltros(prev=>({ ...prev, cIni: toYMD(startOfMonth), cFim: toYMD(endOfMonth) }))
    if (period==='lastmonth') setFiltros(prev=>({ ...prev, cIni: toYMD(startOfLastMonth), cFim: toYMD(endOfLastMonth) }))
    if (period==='last30') { const s = new Date(d); s.setDate(s.getDate()-29); setFiltros(prev=>({ ...prev, cIni: toYMD(s), cFim: toYMD(d) })) }
  },[period])
  const setDesigner = (v) => setFiltros(prev=> ({ ...prev, designer: v==='Todos'?'':v }))
  const list = ['Hoje','Semana','Mês','Mês passado','Últimos 30 dias']
  const keyOf = s => s==='Hoje'?'today': s==='Semana'?'week': s==='Mês'?'month': s==='Mês passado'?'lastmonth':'last30'
  const designersKeys = ['Todos', ...designers]
  return (
    <div className="filterbar">
      <div className="seg">
        {list.map(lbl=> (
          <button key={lbl} className={`btn-md ${period===keyOf(lbl)?'active':''}`} onClick={()=> setPeriod(keyOf(lbl))}>{lbl}</button>
        ))}
      </div>
      <div className="seg">
        {designersKeys.map(d=> (
          <button key={d} className={`btn-md ${((filtros.designer||'')===d || (d==='Todos' && !filtros.designer))?'active':''}`} onClick={()=> setDesigner(d)}>{d}</button>
        ))}
      </div>
    </div>
  )
}

function DashboardView({ demandas, items, designers, setView, onEdit, onStatus, cadStatus, onDelete, onDuplicate, compact, calRef, setCalRef }) {
  const count = (pred) => items.filter(pred).length
  const countStatus = s => items.filter(x=> x.status===s).length
  const kpi = [{ icon:'📅', title:'Criados no período', value: count(_=>true) }, { icon:'🏁', title:'Concluídos no período', value: count(x=> x.status==='Concluída') }, { icon:'📌', title:'Pendentes (Abertas)', value: countStatus('Aberta') }, { icon:'⚙', title:'Em produção', value: countStatus('Em Progresso') }]
  const alerts = [
    { label:'demandas atrasadas', color:'#FF6A6A', value: demandas.filter(x=> x.status!=='Concluída' && x.prazo && x.prazo < hojeISO()).length },
    { label:'vencem amanhã', color:'#FFE55C', value: demandas.filter(x=> x.status!=='Concluída' && x.prazo===(()=>{ const d=new Date(); d.setDate(d.getDate()+1); const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}` })()).length },
    { label:'sem designer atribuído', color:'#4DA3FF', value: demandas.filter(x=> !x.designer).length },
    { label:'com mais de 2 revisões', color:'#6F2DBD', value: 0 },
    { label:'sem prazo definido', color:'#BDBDBD', value: demandas.filter(x=> !x.prazo).length },
  ]
  const weekCounts = (arr) => {
    const byDay = [0,0,0,0,0,0,0]
    arr.forEach(x=>{ const d = new Date(x.dataCriacao||x.dataCriacao||hojeISO()); byDay[d.getDay()]++ })
    return byDay
  }
  const criados = weekCounts(items)
  const concluidos = weekCounts(items.filter(x=> x.status==='Concluída'))
  const maxC = Math.max(...criados,1), maxD = Math.max(...concluidos,1)
  const files = demandas.flatMap(x=> (x.arquivos||[])).slice(0,50)
  const ganttData = demandas.filter(x=> x.prazo).map(x=> ({ titulo:x.titulo, inicio: x.dataCriacao || x.dataSolicitacao || hojeISO(), fim: x.prazo, status: x.status }))
  const monthDays = (()=>{ const d=new Date(); const s= new Date(d.getFullYear(), d.getMonth(), 1); const e= new Date(d.getFullYear(), d.getMonth()+1, 0); return { start:s, end:e, len:e.getDate() } })()
  const dayIndex = iso => { const [y,m,dd]=iso.split('-').map(Number); const dt = new Date(y,m-1,dd); return dt.getDate() }
  const colorByStatus = s => s==='Aberta' ? '#4DA3FF' : s==='Em Progresso' ? '#FFE55C' : '#00C58E'
  const total = items.length || 1
  const pct = (n)=> Math.round((n/total)*100)
  const [chartTab, setChartTab] = useState('barras')
  return (
    <div className="dashboard">
      <div className="widgets">
        <div className="widget">
          <div className="widget-title">KPIs principais</div>
          <div className="widget-subtitle">Indicadores gerais do período selecionado</div>
          <div className="kpi-grid">
            {kpi.map(it=> (
              <div key={it.title} className="kpi fade-in">
                <div className="widget-title">{it.icon} {it.title}</div>
                <div className="kpi-value"><Counter value={it.value} /></div>
                <div className="kpi-trend">↑ 12% vs período anterior</div>
              </div>
            ))}
          </div>
        </div>
        <div className="widget">
          <div className="widget-title">KPIs operacionais</div>
          <div className="widget-subtitle">Visão instantânea do status da operação</div>
          <div className="badge-grid">
            <div className="badge-group">
              {(()=>{
                const val = countStatus('Aberta'); const p = pct(val)
                return (
                  <div className={`badge blue ${p>50?'critical':''}`}>
                    <div>🔵 Pendente</div>
                    <div>{val}</div>
                    <div className="progress"><div className="progress-fill" style={{width:p+'%', background:'#4DA3FF'}} /></div>
                    <div className="kpi-trend">{p}% do total</div>
                  </div>
                )
              })()}
              {(()=>{
                const val = countStatus('Em Progresso'); const p = pct(val)
                return (
                  <div className="badge yellow">
                    <div>🟡 Em produção</div>
                    <div>{val}</div>
                    <div className="progress"><div className="progress-fill" style={{width:p+'%', background:'#FFE55C'}} /></div>
                    <div className="kpi-trend">{p}% do total</div>
                  </div>
                )
              })()}
              <div className="badge purple">
                <div>🟣 Aguardando feedback</div>
                <div>0</div>
                <div className="progress"><div className="progress-fill" style={{width:'0%', background:'#6F2DBD'}} /></div>
                <div className="kpi-trend">0% do total</div>
              </div>
            </div>
            <div className="badge-group">
              {(()=>{
                const val = countStatus('Concluída'); const p = pct(val)
                return (
                  <div className="badge green ok">
                    <div>🟢 Aprovada</div>
                    <div>{val}</div>
                    <div className="progress"><div className="progress-fill" style={{width:p+'%', background:'#00C58E'}} /></div>
                    <div className="kpi-trend">{p}% do total</div>
                  </div>
                )
              })()}
              {(()=>{
                const val = alerts[0].value; const p = pct(val)
                return (
                  <div className={`badge red ${val>0?'critical':''}`}>
                    <div>🔴 Atrasada</div>
                    <div>{val}</div>
                    <div className="progress"><div className="progress-fill" style={{width:p+'%', background:'#FF6A6A'}} /></div>
                    <div className="kpi-trend">{p}% do total</div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
        <div className="widget">
          <div className="widget-title">Criados por dia</div>
          <div className="tabs-inline">
            {['linha','barras','comparativo','designer'].map(t=> (
              <button key={t} className={`btn-md ${chartTab===t?'active':''}`} onClick={()=> setChartTab(t)}>{t[0].toUpperCase()+t.slice(1)}</button>
            ))}
          </div>
          <div className="section-divider" />
          {chartTab==='barras' && criados.map((v,i)=> (
            <div key={i} className="hbar"><div className="hfill" style={{width:`${Math.round(100*v/maxC)}%`, background:'#4DA3FF'}} /><div className="hval">{v}</div></div>
          ))}
          {chartTab==='linha' && <Sparkline series={criados} color="#4DA3FF" />}
          {chartTab==='comparativo' && (
            <>
              {criados.map((v,i)=> (
                <div key={i} className="hbar"><div className="hfill" style={{width:`${Math.round(100*v/maxC)}%`, background:'#4DA3FF'}} /></div>
              ))}
              <div className="section-divider" />
              {concluidos.map((v,i)=> (
                <div key={i} className="hbar"><div className="hfill" style={{width:`${Math.round(100*v/maxD)}%`, background:'#00C58E'}} /></div>
              ))}
            </>
          )}
          {chartTab==='designer' && (
            designers.map(d=> {
              const val = items.filter(x=> x.designer===d).length
              const p = pct(val)
              return (
                <div key={d} className="hbar"><div className="hfill" style={{width:p+'%', background:'#4DA3FF'}} /><div className="hval">{val} • {d}</div></div>
              )
            })
          )}
        </div>
        <div className="widget">
          <div className="widget-title">Concluídos por dia</div>
          <div className="section-divider" />
          {concluidos.map((v,i)=> (
            <div key={i} className="hbar"><div className="hfill" style={{width:`${Math.round(100*v/maxD)}%`, background:'#00C58E'}} /><div className="hval">{v}</div></div>
          ))}
        </div>
        <div className="widget">
          <div className="widget-title">Resumo por Designer</div>
          <div className="designer-summary">
            <table>
              <thead>
                <tr><th>Designer</th><th>Em produção</th><th>Concluído</th><th>Atrasadas</th><th>Média/dia</th></tr>
              </thead>
              <tbody>
                {designers.map(d=>{
                  const emProd = items.filter(x=> x.designer===d && x.status==='Em Progresso').length
                  const concl = items.filter(x=> x.designer===d && x.status==='Concluída').length
                  const atras = items.filter(x=> x.designer===d && x.status!=='Concluída' && x.prazo && x.prazo < hojeISO()).length
                  const dates = items.filter(x=> x.designer===d).map(x=> x.dataCriacao)
                  const min = dates.length? dates.reduce((a,b)=> a<b?a:b) : hojeISO()
                  const max = dates.length? dates.reduce((a,b)=> a>b?a:b) : hojeISO()
                  const toD = s=>{ const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd) }
                  const days = Math.max(1, Math.round((toD(max)-toD(min))/86400000)+1)
                  const mediaDia = (concl/days).toFixed(1)
                  return (
                    <tr key={d}><td>{d}</td><td>{emProd}</td><td>{concl}</td><td>{atras}</td><td>{mediaDia}</td></tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="widget">
          <div className="widget-title">Alertas importantes</div>
          {alerts.map(a=> (
            <div key={a.label} className="card" style={{borderColor:a.color}}>
              <div className="title">{a.label}</div>
              <div>{a.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
