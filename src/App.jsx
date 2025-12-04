import React, { useEffect, useMemo, useState } from 'react'
import { db } from './firebase'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { apiEnabled, api } from './api'
const readLS = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)||'null'); return Array.isArray(v) ? v : def } catch { return def } }
const readObj = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)||'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : def } catch { return def } }
const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v))

const ESTADOS = ["Aberta", "Em Progresso", "Concluída"]
const FIXED_STATUS = ["Pendente","Em produção","Aguardando Feedback","Aprovada","Revisar","Concluida"]
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
    <div className="tabs-inline">
      <button className={`tab-btn ${view==='table'?'active':''}`} onClick={()=>setView('table')}><span className="icon">▦</span><span>Table</span></button>
      <button className={`tab-btn ${view==='board'?'active':''}`} onClick={()=>setView('board')}><span className="icon">🗂</span><span>Board</span></button>
      <button className={`tab-btn ${view==='calendar'?'active':''}`} onClick={()=>setView('calendar')}><span className="icon">🗓</span><span>Calendar</span></button>
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
              {FIXED_STATUS.map(s=> <option key={s} value={s}>{statusWithDot(s)}</option>)}
            </select>
            <div className="chips">
              {FIXED_STATUS.map(s=> (
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
  const diffDays = (a,b)=>{ const toD=s=>{ if(!s) return null; const [y,m,dd]=String(s).split('-').map(Number); return new Date(y,m-1,dd) }; const da=toD(a), db=toD(b); if(!da||!db) return ''; return Math.round((db - da)/86400000) }
  const fmtDM = (s)=>{ if(!s) return ''; const [y,m,d]=String(s).split('-').map(Number); const dd=String(d).padStart(2,'0'); const ab=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Math.max(0,Math.min(11,(m-1)||0))]; return `${dd}.${ab}` }
  return (
    <div className={`table ${compact?'compact':''}`}>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Designer</th>
            <th>Status</th>
            <th>Data de Solicitação</th>
            <th>Data de Criação</th>
            <th>Prazo (dias)</th>
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
              <td>
                <div>{it.designer}</div>
              </td>
              <td>
                <select className={`status-select ${statusClass(it.status)}`} value={it.status} onChange={e=>onStatus(it.id, e.target.value)} onClick={e=>e.stopPropagation()}>
                  {FIXED_STATUS.map(s=> <option key={s} value={s}>{statusWithDot(s)}</option>)}
                </select>
              </td>
              <td>{fmtDM(it.dataSolicitacao)}</td>
              <td>{fmtDM(it.dataCriacao)}</td>
              <td>{diffDays(it.dataCriacao, it.prazo)}</td>
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
    const s = String(it.status||'')
    const v = s.toLowerCase()
    if (col.name==='Pendente') return v.includes('pendente') || s==='Aberta' || s==='Pendente'
    if (col.name==='Em produção') return v.includes('produção') || s==='Em Progresso' || s==='Em produção'
    if (col.name==='Aguardando feedback') return v.includes('feedback') || s==='Aguardando feedback' || s==='Aguardando Feedback' || v.includes('revisar')
    if (col.name==='Aprovada') return v.includes('aprov') || s==='Aprovada'
    if (col.name==='Concluída') return s==='Concluída' || v.includes('concluida')
    return s===col.map
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
  const labelClass = (s)=>{
    const v = String(s||'').toLowerCase()
    if (v.includes('ads')) return 'label-ads'
    if (v.includes('motion') || v.includes('vídeo') || v.includes('video')) return 'label-motion'
    if (v.includes('esporte')) return 'label-esporte'
    if (v.includes('post')) return 'label-post'
    if (v.includes('story')) return 'label-story'
    return 'label-default'
  }
  return (
    <div className="board">
      {mondayCols.map(col => (
        <div key={col.name} className="column">
          <div className="col-head">
            <div>{col.name}</div>
            <button className="action-btn" type="button">⋯</button>
          </div>
          <div className="col-body dropzone" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={e=> onDropCol(e, col)}>
            {items.filter(it=> isInCol(it, col)).map(it => (
              <div key={it.id} className="card kanban-card" draggable onDragStart={e=>{ e.dataTransfer.setData('id', String(it.id)); e.currentTarget.classList.add('dragging') }} onDragEnd={e=> e.currentTarget.classList.remove('dragging')} onClick={()=>onEdit(it)}>
                <div className="kanban-avatar">{String(it.designer||'').slice(0,2).toUpperCase()}</div>
                <div>
                  <div className="label-row">
                    {[it.tipoMidia, it.plataforma].filter(Boolean).map(lbl=> (
                      <span key={lbl} className={`label-pill ${labelClass(lbl)}`}>{lbl}</span>
                    ))}
                  </div>
                  <div className="card-top">
                    <div className="title">{it.titulo}</div>
                    <button className="action-btn" type="button">⋯</button>
                  </div>
                  {it.prazo && (
                    <div className="deadline-pill">🕒 {new Date(it.prazo).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })}</div>
                  )}
                  <div className="meta">{it.tipoMidia}{it.plataforma?` • ${it.plataforma}`:''}</div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span className="pill" style={{borderColor:statusColorFor(it.status), color:statusColorFor(it.status)}}>{statusLabel(it.status)}</span>
                  </div>
                  {(()=>{ const a = it.arquivos||[]; const f = a[0]; const src = typeof f==='string' ? f : (f&&f.url?f.url:null); return src ? (<img className="card-preview" src={src} alt="preview" />) : null })()}
                  <div className="card-footer">
                    <div className="foot-item">📎 {(it.arquivos||[]).length||0}</div>
                    <div className="foot-item">💬 {it.revisoes||0}</div>
                    <div className="foot-item">☑ 0</div>
                    <div className="foot-spacer" />
                    <div className="kanban-avatar small">{String(it.designer||'').slice(0,1).toUpperCase()}</div>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="add-card"><span className="icon">＋</span><span>Adicionar um cartão</span></button>
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
  const [dataSolic, setDataSolic] = useState(initial?.dataSolicitacao || '')
  const [plataforma, setPlataforma] = useState(initial?.plataforma || '')
  const [arquivos, setArquivos] = useState(initial?.arquivos || [])
  const [dataCriacao, setDataCriacao] = useState(initial?.dataCriacao || '')
  const [descricao, setDescricao] = useState(initial?.descricao || '')
  const [prazo, setPrazo] = useState(initial?.prazo || '')
  useEffect(()=>{
    setDesigner(initial?.designer || '')
    setTipoMidia(initial?.tipoMidia || 'Post')
    setTitulo(initial?.titulo || '')
    setLink(initial?.link || '')
    setArquivoNome('')
    setDataSolic(initial?.dataSolicitacao || '')
    setPlataforma(initial?.plataforma || (cadPlataformas?.[0] || ''))
    setArquivos(initial?.arquivos || [])
    setDataCriacao(initial?.dataCriacao || '')
    setDescricao(initial?.descricao || '')
    setPrazo(initial?.prazo || '')
  },[initial, open, cadDesigners, cadTipos, cadPlataformas])
  if (!open) return null
  const submit = e => { e.preventDefault(); onSubmit({ designer, tipoMidia, titulo, link, arquivoNome, dataSolic, dataCriacao, plataforma, arquivos, descricao, prazo }) }
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
            
            <div className="form-row"><label>Data de Solicitação</label><input type="date" value={dataSolic} onChange={e=>setDataSolic(e.target.value)} required /></div>
            <div className="form-row"><label>Data de Criação</label><input type="date" value={dataCriacao} onChange={e=>setDataCriacao(e.target.value)} required /></div>
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
      const isRev = String(status||'').toLowerCase().includes('revisar')
      const revisoes = changed && isRev ? (x.revisoes||0)+1 : (x.revisoes||0)
      const isDone = String(status||'').toLowerCase().includes('concluida') || status==='Concluída'
      const dataConclusao = isDone ? (x.dataConclusao||today) : x.dataConclusao
      return { ...x, status, revisoes, dataConclusao }
    }))
    if (apiEnabled) {
      const found = demandas.find(x=>x.id===id)
      if (found) await api.updateDemanda(id, { ...found, status, dataConclusao: (String(status||'').toLowerCase().includes('concluida') || status==='Concluída') ? (found.dataConclusao||today) : found.dataConclusao, revisoes: (found.revisoes||0) + ((found.status!==status && String(status||'').toLowerCase().includes('revisar'))?1:0) })
    }
  }
  const onDelete = async (id) => {
    setDemandas(prev=> prev.filter(x=> x.id!==id))
    if (apiEnabled) await api.deleteDemanda(id)
  }
  const onSubmit = async ({ designer, tipoMidia, titulo, link, arquivoNome, dataSolic, dataCriacao, plataforma, arquivos, descricao, prazo }) => {
    if (modalMode==='edit' && editing) {
      const updated = { ...editing, designer, tipoMidia, titulo, link, descricao, arquivos: (arquivos && arquivos.length ? arquivos : editing.arquivos), arquivoNome: arquivoNome || editing.arquivoNome, dataSolicitacao: dataSolic || editing.dataSolicitacao, dataCriacao: dataCriacao || editing.dataCriacao, plataforma, prazo }
      setDemandas(prev=> prev.map(x=> x.id===editing.id ? updated : x))
      if (apiEnabled) await api.updateDemanda(editing.id, updated)
    } else {
      const novo = { designer, tipoMidia, titulo, link, descricao, arquivos: (arquivos||[]), arquivoNome, plataforma, dataSolicitacao: dataSolic, dataCriacao: dataCriacao, status: 'Aberta', prazo }
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
          {route==='demandas' && (
            <FilterBar filtros={filtros} setFiltros={setFiltros} designers={designers} />
          )}
          {route==='demandas' && (
            <div className="topnav">
              <ViewButtonsInner view={view} setView={setView} />
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
            <ReportsView demandas={demandas} items={items} designers={designers} filtros={filtros} setFiltros={setFiltros} />
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
      <div className="seg" style={{flex:1, minWidth:220}}>
        <input className="search" placeholder="Pesquisar demandas..." value={filtros.q||''} onChange={e=> setFiltros(prev=> ({ ...prev, q: e.target.value }))} />
      </div>
      <div className="seg">
        <div className="filter-title">Período</div>
        {list.map(lbl=> (
          <button key={lbl} className={`btn-md ${period===keyOf(lbl)?'active':''}`} onClick={()=> setPeriod(keyOf(lbl))}>
            <span className="icon">🗓</span><span>{lbl}</span>
          </button>
        ))}
      </div>
      <div className="seg">
        <div className="filter-title">Designer</div>
        {designersKeys.map(d=> (
          <button key={d} className={`btn-md ${((filtros.designer||'')===d || (d==='Todos' && !filtros.designer))?'active':''}`} onClick={()=> setDesigner(d)}>
            <span className="icon">👤</span><span>{d}</span>
          </button>
        ))}
      </div>
      <div className="seg">
        <div className="filter-title">Data</div>
        <div className="date-pill">
          <span className="icon">🗓</span>
          <input type="date" value={filtros.cIni||''} onChange={e=> setFiltros(prev=> ({ ...prev, cIni: e.target.value }))} />
          <span style={{color:'var(--muted)'}}>—</span>
          <input type="date" value={filtros.cFim||''} onChange={e=> setFiltros(prev=> ({ ...prev, cFim: e.target.value }))} />
        </div>
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
                    <div className="kpi-trend">{pct(it.value)}% das demandas no período</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
    </div>
  )
}

function ReportsView({ demandas, items, designers, filtros, setFiltros }) {
  const periodLabel = ['Hoje','Semana','Mês','Mês passado']
  const keyOf = s => s==='Hoje'?'today': s==='Semana'?'week': s==='Mês'?'month':'lastmonth'
  const [period, setPeriod] = useState('month')
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
  },[period])
  const designersKeys = ['Todos', ...designers]
  const setDesigner = (v) => setFiltros(prev=> ({ ...prev, designer: v==='Todos'?'':v }))
  const daysInPeriod = (()=>{
    const toD = s=>{ if(!s) return null; const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd) }
    const s = toD(filtros.cIni), e = toD(filtros.cFim)
    if (!s || !e) return 1
    return Math.max(1, Math.round((e - s)/86400000) + 1)
  })()
  const concluidos = items.filter(x=> x.status==='Concluída')
  const pendentes = items.filter(x=> x.status==='Aberta')
  const emProducao = items.filter(x=> x.status==='Em Progresso')
  const revisoesTot = demandas.reduce((acc,x)=> acc + (x.revisoes||0), 0)
  const produtividadeMedia = concluidos.length / daysInPeriod
  const byDesigner = (arr) => {
    const map = new Map()
    arr.forEach(x=> map.set(x.designer||'—', (map.get(x.designer||'—')||0)+1))
    return Array.from(map.entries()).map(([designer,qty])=>({designer,qty}))
  }
  const conclPorDesigner = byDesigner(concluidos)
  const criadasPorDesigner = byDesigner(items)
  const tempoEntregaStats = (()=>{
    const diffDays = (a,b)=>{ const toD = s=>{ const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd) }; if(!a||!b) return null; return Math.max(0, Math.round((toD(b)-toD(a))/86400000)) }
    const per = {}
    demandas.forEach(x=>{
      if (x.dataConclusao) {
        const d = x.designer||'—'
        const t = diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)
        if (t!=null) { const cur = per[d]||{ cnt:0, sum:0, min:9999, max:0 }; per[d]={ cnt:cur.cnt+1, sum:cur.sum+t, min:Math.min(cur.min,t), max:Math.max(cur.max,t) } }
      }
    })
    return Object.entries(per).map(([designer,v])=> ({ designer, media: (v.sum/v.cnt)||0, min:v.min===9999?0:v.min, max:v.max }))
  })()
  const slaStats = (()=>{
    const per = {}
    demandas.forEach(x=>{
      if (x.prazo && x.dataConclusao) {
        const d = x.designer||'—'
        const ok = x.dataConclusao <= x.prazo
        const cur = per[d]||{ ok:0, total:0 }
        per[d] = { ok: cur.ok + (ok?1:0), total: cur.total + 1 }
      }
    })
    return Object.entries(per).map(([designer,v])=> ({ designer, pct: Math.round(((v.ok/(v.total||1))*100)), ok:v.ok, total:v.total }))
  })()
  const revisoesStats = (()=>{
    const per = {}
    items.forEach(x=>{
      const d = x.designer||'—'
      const r = x.revisoes||0
      const cur = per[d]||{ rTot:0, cnt:0 }
      per[d] = { rTot: cur.rTot + r, cnt: cur.cnt + 1 }
    })
    return Object.entries(per).map(([designer,v])=> ({ designer, total:v.rTot, porPeca: +(v.rTot/(v.cnt||1)).toFixed(2), percRetrab: Math.round(100 * ((v.rTot>0 ? 1 : 0))) }))
  })()
  const tiposDist = (()=>{
    const per = {}
    items.forEach(x=>{ const t=x.tipoMidia||'Outro'; per[t]=(per[t]||0)+1 })
    const total = items.length||1
    return Object.entries(per).map(([tipo,q])=> ({ tipo, q, pct: Math.round((q/total)*100) }))
  })()
  const workload = (()=>{
    const capacity = 4
    const per = {}
    concluidos.forEach(x=>{ const d=x.designer||'—'; per[d]=(per[d]||0)+1 })
    return Object.entries(per).map(([designer,q])=> ({ designer, ideal: capacity*daysInPeriod, real:q, status: q>capacity*daysInPeriod? 'Acima' : (q<capacity*daysInPeriod? 'Abaixo' : 'Dentro') }))
  })()
  const timeline = (()=>{
    const d = new Date(); const monthStart = new Date(d.getFullYear(), d.getMonth(), 1); const days = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()
    const toIdx = s=>{ if(!s) return null; const [y,m,dd]=s.split('-').map(Number); const dt=new Date(y,m-1,dd); if(dt.getMonth()!==d.getMonth()||dt.getFullYear()!==d.getFullYear()) return null; return dt.getDate()-1 }
    const per = {}
    demandas.forEach(x=>{ const di = toIdx(x.dataCriacao||x.dataSolicitacao); if (di!=null) { const dname=x.designer||'—'; const arr = per[dname]||Array(days).fill(0); arr[di]++; per[dname]=arr } })
    return per
  })()
  const heatmap = (()=>{
    const byDayWeek = Array.from({length:7},()=>Array(6).fill(0))
    items.forEach(x=>{ const toD=s=>{ if(!s) return null; const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd) }; const dt = toD(x.dataCriacao||x.dataSolicitacao); if(!dt) return; const day = dt.getDay(); const week = Math.floor((dt.getDate()-1)/7); byDayWeek[day][week]++ })
    return byDayWeek
  })()
  const ranking = (()=>{
    const prod = conclPorDesigner.reduce((m,{designer,qty})=> (m[designer]=qty,m), {})
    const slaM = slaStats.reduce((m,{designer,pct})=> (m[designer]=pct,m), {})
    const tempoM = tempoEntregaStats.reduce((m,{designer,media})=> (m[designer]=media,m), {})
    const revM = revisoesStats.reduce((m,{designer,porPeca})=> (m[designer]=porPeca,m), {})
    const names = Array.from(new Set([...Object.keys(prod), ...Object.keys(slaM), ...Object.keys(tempoM), ...Object.keys(revM)])).filter(Boolean)
    const norm = (val, min, max) => { if(max===min) return 1; return Math.max(0, Math.min(1, (val-min)/(max-min))) }
    const maxProd = Math.max(...Object.values(prod||{_:-1}),0), minProd = Math.min(...Object.values(prod||{_:-1}),0)
    const maxSla = 100, minSla = 0
    const maxTempo = Math.max(...Object.values(tempoM||{_:-1}),0), minTempo = Math.min(...Object.values(tempoM||{_:-1}),0)
    const maxRev = Math.max(...Object.values(revM||{_:-1}),0), minRev = Math.min(...Object.values(revM||{_:-1}),0)
    const list = names.map(n=>{
      const sProd = norm(prod[n]||0, minProd, maxProd)
      const sSla = norm(slaM[n]||0, minSla, maxSla)
      const sTempoInv = 1 - norm(tempoM[n]||0, minTempo, maxTempo)
      const sRevInv = 1 - norm(revM[n]||0, minRev, maxRev)
      const score = Math.round(((sProd*0.4)+(sSla*0.3)+(sTempoInv*0.2)+(sRevInv*0.1))*100)
      return { designer:n, score }
    }).sort((a,b)=> b.score - a.score)
    return list
  })()
  const alerts = [
    { icon:'⚠', text:'Designer com maior carga no período', val: conclPorDesigner.sort((a,b)=> b.qty-a.qty)[0]?.designer||'—' },
    { icon:'⏳', text:'Designer com mais tarefas próximas do prazo', val: (()=>{ const near = demandas.filter(x=> x.prazo && x.status!=='Concluída'); const per={}; near.forEach(x=> per[x.designer||'—']=(per[x.designer||'—']||0)+1); return Object.entries(per).sort((a,b)=> b[1]-a[1])[0]?.[0]||'—' })() },
    { icon:'🔁', text:'Designer com mais revisões', val: revisoesStats.sort((a,b)=> b.total-a.total)[0]?.designer||'—' },
    { icon:'💤', text:'Designer com menor atividade', val: conclPorDesigner.sort((a,b)=> a.qty-b.qty)[0]?.designer||'—' },
    { icon:'🚨', text:'Alertas de atraso repetidos', val: demandas.filter(x=> x.prazo && x.status!=='Concluída' && x.prazo < hojeISO()).length }
  ]
  return (
    <div className="reports">
      <div className="reports-toolbar">
        <div className="chips">
          {periodLabel.map(lbl=> (
            <button key={lbl} className={`btn-md ${period===keyOf(lbl)?'active':''}`} onClick={()=> setPeriod(keyOf(lbl))}><span className="icon">🗓</span><span>{lbl}</span></button>
          ))}
          <div className="date-pill">
            <span className="icon">🗓</span>
            <input type="date" value={filtros.cIni||''} onChange={e=> setFiltros(prev=> ({ ...prev, cIni: e.target.value }))} />
            <span style={{color:'var(--muted)'}}>—</span>
            <input type="date" value={filtros.cFim||''} onChange={e=> setFiltros(prev=> ({ ...prev, cFim: e.target.value }))} />
          </div>
        </div>
        <div className="chips">
          {designersKeys.map(d=> (
            <button key={d} className={`btn-md ${((filtros.designer||'')===d || (d==='Todos' && !filtros.designer))?'active':''}`} onClick={()=> setDesigner(d)}><span className="icon">👤</span><span>{d}</span></button>
          ))}
        </div>
      </div>
      <div className="metrics-grid">
        {[
          { icon:'🏁', label:'Concluídas no período', val: concluidos.length },
          { icon:'📅', label:'Criadas no período', val: items.length },
          { icon:'📌', label:'Pendentes', val: pendentes.length },
          { icon:'🟡', label:'Em produção', val: emProducao.length },
          { icon:'🔁', label:'Revisões realizadas', val: revisoesTot },
          { icon:'⚡', label:'Produtividade média (peças/dia)', val: +produtividadeMedia.toFixed(1) },
        ].map(m=> (
          <div key={m.label} className="metric-card">
            <div className="metric-title">{m.icon} {m.label}</div>
            <div className="metric-value">{m.val}</div>
            <Sparkline series={[m.val/2, m.val*0.8, m.val]} color="#4DA3FF" />
          </div>
        ))}
      </div>
      <div className="reports-grid">
        <div className="report-card">
          <div className="report-title">Produtividade por designer</div>
          {conclPorDesigner.map(({designer,qty})=> (
            <div key={designer} className="chart-row"><div className="chart-label">{designer}</div><div className="chart-bar"><div className="chart-fill" style={{width:`${Math.round(100*qty/Math.max(1,Math.max(...conclPorDesigner.map(x=>x.qty))))}%`, background:'#4DA3FF'}} /><div className="chart-value">{qty}</div></div></div>
          ))}
          <div className="section-divider" />
          <table>
            <thead><tr><th>Designer</th><th>Criadas</th><th>Concluídas</th><th>% Conclusão</th></tr></thead>
            <tbody>
              {designers.map(d=>{ const cr = (criadasPorDesigner.find(x=>x.designer===d)?.qty)||0; const co = (conclPorDesigner.find(x=>x.designer===d)?.qty)||0; const pc = Math.round(100*(co/Math.max(1,cr))); return (<tr key={d}><td>{d}</td><td>{cr}</td><td>{co}</td><td>{pc}%</td></tr>) })}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Tempo médio de entrega (por designer)</div>
          {tempoEntregaStats.map(({designer,media})=> (
            <div key={designer} className="chart-row"><div className="chart-label">{designer}</div><div className="chart-bar"><div className="chart-fill" style={{width:`${Math.round(100*media/Math.max(1,Math.max(...tempoEntregaStats.map(x=>x.media))))}%`, background:'#A66BFF'}} /><div className="chart-value">{media.toFixed(1)}d</div></div></div>
          ))}
          <div className="section-divider" />
          <table>
            <thead><tr><th>Designer</th><th>Tempo médio</th><th>Tempo mín</th><th>Tempo máx</th></tr></thead>
            <tbody>
              {tempoEntregaStats.map(r=> (<tr key={r.designer}><td>{r.designer}</td><td>{r.media.toFixed(1)}d</td><td>{r.min}d</td><td>{r.max}d</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">SLA de entrega</div>
          {(()=>{ const ok = slaStats.reduce((a,x)=> a+x.ok,0); const total = slaStats.reduce((a,x)=> a+x.total,0); const pct = Math.round(100*(ok/Math.max(1,total))); const r=40; const c=2*Math.PI*r; const off = c*(1 - pct/100); return (
            <svg width="160" height="120"><g transform="translate(20,20)"><circle cx="60" cy="40" r={r} stroke="#222" strokeWidth="10" fill="none" /><circle cx="60" cy="40" r={r} stroke="#00C58E" strokeWidth="10" fill="none" strokeDasharray={`${c} ${c}`} strokeDashoffset={off} /><text x="60" y="46" textAnchor="middle" fill="#fff">{pct}%</text></g></svg>
          ) })()}
          <div className="section-divider" />
          <table>
            <thead><tr><th>Designer</th><th>SLA%</th><th>Dentro</th><th>Fora</th></tr></thead>
            <tbody>
              {slaStats.map(r=> (<tr key={r.designer}><td>{r.designer}</td><td style={{color: r.pct>=90?'#BCD200': r.pct>=70?'#FFE55C':'#FF5E5E'}}>{r.pct}%</td><td>{r.ok}</td><td>{r.total-r.ok}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Revisões / retrabalho</div>
          {revisoesStats.map(({designer,total})=> (
            <div key={designer} className="chart-row"><div className="chart-label">{designer}</div><div className="chart-bar"><div className="chart-fill" style={{width:`${Math.round(100*total/Math.max(1,Math.max(...revisoesStats.map(x=>x.total))))}%`, background:'#FF6A88'}} /><div className="chart-value">{total}</div></div></div>
          ))}
          <div className="section-divider" />
          <table>
            <thead><tr><th>Designer</th><th>Revisões totais</th><th>Revisões/peça</th><th>% retrabalho</th></tr></thead>
            <tbody>
              {revisoesStats.map(r=> (<tr key={r.designer}><td>{r.designer}</td><td>{r.total}</td><td>{r.porPeca}</td><td>{r.percRetrab}%</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Tipos de peça</div>
          <div className="section-divider" />
          <table>
            <thead><tr><th>Tipo</th><th>Qtd</th><th>%</th></tr></thead>
            <tbody>
              {tiposDist.map(t=> (<tr key={t.tipo}><td>{t.tipo}</td><td>{t.q}</td><td>{t.pct}%</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Workload (capacidade × produção)</div>
          {workload.map(r=> (
            <div key={r.designer} className="chart-row"><div className="chart-label">{r.designer}</div><div className="chart-bar"><div className="chart-fill" style={{width:`${Math.round(100*r.real/Math.max(1,r.ideal))}%`, background: r.status==='Dentro'?'#BCD200': r.status==='Acima'?'#FF5E5E':'#FFE55C'}} /><div className="chart-value">{r.real}/{r.ideal}</div></div></div>
          ))}
          <div className="section-divider" />
          <table>
            <thead><tr><th>Designer</th><th>Capacidade ideal</th><th>Produção real</th><th>Status</th></tr></thead>
            <tbody>
              {workload.map(r=> (<tr key={r.designer}><td>{r.designer}</td><td>{r.ideal}</td><td>{r.real}</td><td>{r.status}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Linha do tempo mensal</div>
          <div className="chips">
            {Object.entries(timeline).map(([designer,series])=> (
              <div key={designer} style={{display:'inline-flex',alignItems:'center',gap:6}}><span className="chip">{designer}</span><Sparkline series={series} color={designer==='Thiago'?'#4DA3FF': designer==='Felipe'?'#00C58E':'#A66BFF'} /></div>
            ))}
          </div>
        </div>
        <div className="report-card">
          <div className="report-title">Heatmap de produtividade</div>
          <div className="heatmap">
            {heatmap.map((row,ri)=> (
              <div key={ri} className="heat-row">
                {row.map((v,ci)=> { const color = v===0?'#222': v<2?'#4DA3FF33':'#4DA3FF'; return (<div key={ci} className="heat-cell" style={{background:color}} title={`D${ri} W${ci}: ${v}`} />) })}
              </div>
            ))}
          </div>
        </div>
        <div className="report-card">
          <div className="report-title">Ranking dos designers</div>
          <table>
            <thead><tr><th>#</th><th>Designer</th><th>Score</th></tr></thead>
            <tbody>
              {ranking.map((r,i)=> (<tr key={r.designer}><td>{i+1}</td><td>{r.designer}</td><td>{r.score}/100</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Alertas automáticos</div>
          <div className="today-list">
            {alerts.map(a=> (
              <div key={a.text} className="today-item"><div className="today-name">{a.icon} {a.text}</div><div className="today-meta">{a.val}</div></div>
            ))}
          </div>
        </div>
        <div className="report-card">
          <div className="report-title">Resumo geral do período</div>
          <div className="chips">
            <span className="chip">Total criado: {items.length}</span>
            <span className="chip">Total concluído: {concluidos.length}</span>
            <span className="chip">Melhor designer: {ranking[0]?.designer||'—'}</span>
            <span className="chip">Tipo mais produzido: {tiposDist.sort((a,b)=> b.q-a.q)[0]?.tipo||'—'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
