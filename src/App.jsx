import React, { useEffect, useMemo, useState } from 'react'
import { db, isFirebaseEnabled, auth, firebaseApp } from './firebase'
import { collection, addDoc, serverTimestamp, getDocs, deleteDoc, doc, updateDoc, setDoc, getDoc, query, where, onSnapshot } from 'firebase/firestore'
import { getAuth, onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { apiEnabled, api } from './api'
const readLS = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)||'null'); return Array.isArray(v) ? v : def } catch { return def } }
const readObj = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)||'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : def } catch { return def } }
const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v))
const readUsers = () => { try { return JSON.parse(localStorage.getItem('users')||'[]') } catch { return [] } }
const writeUsers = (arr) => localStorage.setItem('users', JSON.stringify(arr))
const ensureAdminSeed = () => {
  const list = readUsers()
  if (!list.find(u=> u.username==='admin')) {
    const admin = { username:'admin', name:'Administrador', role:'admin', password:'f3l1p3', pages:{ dashboard:true, demandas:true, config:true, cadastros:true, relatorios:true, usuarios:true }, actions:{ criar:true, excluir:true, visualizar:true } }
    writeUsers([...list, admin])
  }
}

const ESTADOS = ["Aberta", "Em Progresso", "Concluída"]
const FIXED_STATUS = ["Pendente","Em produção","Aguardando Feedback","Aprovada","Revisar","Concluida"]
const ORIGENS = ["Instagram","Tráfego Pago","CRM","Influencers","Site","Branding","Outros"]
const statusLabel = s => s === "Aberta" ? "Aberta" : s === "Em Progresso" ? "Em Progresso" : s === "Concluída" ? "Concluída" : s
const statusWithDot = s => statusLabel(s)
const statusClass = s => {
  const v = (s||'').toLowerCase()
  if (v.includes('pendente') || v.includes('aberta')) return 'st-pending'
  if (v.includes('progresso') || v.includes('produção')) return 'st-progress'
  if (v.includes('feedback')) return 'st-feedback'
  if (v.includes('conclu') || v.includes('aprov')) return 'st-done'
  if (v.includes('atras')) return 'st-late'
  return ''
}

const isPendingStatus = (s)=>{ const v=String(s||'').toLowerCase(); return v.includes('pendente') || v.includes('aberta') || s==='Aberta' || s==='Pendente' }
const isProdStatus = (s)=>{ const v=String(s||'').toLowerCase(); return v.includes('produção') || v.includes('progresso') || s==='Em Progresso' || s==='Em produção' }
const isDoneStatus = (s)=>{ const v=String(s||'').toLowerCase(); return v.includes('conclu') || v.includes('aprov') || s==='Concluída' || s==='Aprovada' }

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
const proxId = arr => {
  const nums = arr.map(x=> (typeof x.id==='number' ? x.id : Number(x.id)||0))
  return nums.length ? Math.max(...nums) + 1 : 1
}

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

function Icon({ name, size=18 }) {
  const s = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round' }
  if (name==='dashboard') return (<svg {...s}><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>)
  if (name==='demandas') return (<svg {...s}><path d="M8 3h8"/><path d="M8 7h8"/><rect x="5" y="3" width="14" height="18" rx="2"/></svg>)
  if (name==='config') return (<svg {...s}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-1.5 2.6-.1.1a1.8 1.8 0 0 0-2.2.8h-.2l-3-.4h-.2a1.8 1.8 0 0 0-1.6 0h-.2l-3 .4h-.2a1.8 1.8 0 0 0-2.2-.8l-.1-.1-1.5-2.6.1-.1a1.8 1.8 0 0 0 .3-1.8v-.2l-.4-3v-.2a1.8 1.8 0 0 0 0-1.6v-.2l.4-3v-.2a1.7 1.7 0 0 0-.3-1.8l-.1-.1L4.4 4l.1-.1a1.8 1.8 0 0 0 2.2-.8h.2l3 .4h.2a1.8 1.8 0 0 0 1.6 0h.2l3-.4h.2a1.8 1.8 0 0 0 2.2.8l.1.1 1.5 2.6-.1.1a1.8 1.8 0 0 0-.3 1.8v.2l.4 3v.2a1.8 1.8 0 0 0 0 1.6v.2Z"/></svg>)
  if (name==='cadastros') return (<svg {...s}><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/></svg>)
  if (name==='relatorios') return (<svg {...s}><path d="M3 20h18"/><rect x="6" y="14" width="3" height="6"/><rect x="11" y="10" width="3" height="10"/><rect x="16" y="6" width="3" height="14"/></svg>)
  if (name==='usuarios') return (<svg {...s}><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>)
  if (name==='filter') return (<svg {...s}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>)
  if (name==='table') return (<svg {...s}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M10 4v16"/></svg>)
  if (name==='board') return (<svg {...s}><rect x="3" y="4" width="5" height="16" rx="2"/><rect x="10" y="4" width="5" height="16" rx="2"/><rect x="17" y="4" width="4" height="16" rx="2"/></svg>)
  if (name==='calendar') return (<svg {...s}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 11h18"/></svg>)
  if (name==='close') return (<svg {...s}><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>)
  if (name==='clock') return (<svg {...s}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>)
  if (name==='paperclip') return (<svg {...s}><path d="M21.44 11.05 12.5 20a5 5 0 1 1-7.07-7.07L14.36 4a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19"/></svg>)
  if (name==='chat') return (<svg {...s}><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/></svg>)
  if (name==='check') return (<svg {...s}><path d="M20 6 9 17l-5-5"/></svg>)
  if (name==='plus') return (<svg {...s}><path d="M12 5v14"/><path d="M5 12h14"/></svg>)
  if (name==='dot') return (<svg {...s}><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/></svg>)
  if (name==='trash') return (<svg {...s}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><rect x="5" y="6" width="14" height="14" rx="2"/></svg>)
  if (name==='logout') return (<svg {...s}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>)
  if (name==='link') return (<svg {...s}><path d="M10 13a5 5 0 0 0 7.07 0l3.54-3.54a5 5 0 1 0-7.07-7.07L10 4"/><path d="M14 11a5 5 0 0 1-7.07 0L3.39 7.46a5 5 0 1 1 7.07-7.07L14 4"/></svg>)
  if (name==='tag') return (<svg {...s}><path d="M20 10V4H14L4 14l6 6 10-10Z"/><circle cx="16.5" cy="7.5" r="1.5"/></svg>)
  return null
}

function Header({ onNew, view, setView, showNew, user, onLogout }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="team">Equipe de Marketing</div>
      </div>
      <div className="topbar-right">
        {user ? (
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="chip">{user.name||user.username}</span>
            <button className="primary" onClick={onLogout}><span className="icon"><Icon name="logout" /></span><span>Sair</span></button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function FilterButton({ onOpen, view, setView, filtros, setFiltros }) {
  return (
    <div className="filtersbar toolbar">
      <button className="icon" onClick={onOpen}><Icon name="filter" /><span>Filtro</span></button>
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
      <button className={`tab-btn ${view==='table'?'active':''}`} onClick={()=>setView('table')}><span className="icon"><Icon name="table" /></span><span>Table</span></button>
      <button className={`tab-btn ${view==='board'?'active':''}`} onClick={()=>setView('board')}><span className="icon"><Icon name="board" /></span><span>Board</span></button>
      <button className={`tab-btn ${view==='calendar'?'active':''}`} onClick={()=>setView('calendar')}><span className="icon"><Icon name="calendar" /></span><span>Calendar</span></button>
    </div>
  )
}

function LoginView({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e)=>{ e.preventDefault(); if (loading) return; setError(''); setLoading(true); try { await onLogin(username, password) } catch (err) { const msg = (err && (err.code || err.message)) || 'Falha ao entrar'; setError(String(msg)) } finally { setLoading(false) } }
  return (
    <div className="login-wrap">
      <div className="login-banner">BANNER TELA LOGIN</div>
      <div className="login-card">
        <div className="login-title">Gerenciamento Mkt!</div>
        <form onSubmit={submit} className="login-form">
          <div className="input-with-icon">
            <input className="login-input" placeholder="Usuário" value={username} onChange={e=>setUsername(e.target.value)} required />
            <span className="input-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg></span>
          </div>
          <div className="input-with-icon">
            <input className="login-input" type="password" placeholder="Insira sua senha" value={password} onChange={e=>setPassword(e.target.value)} required />
            <span className="input-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg></span>
          </div>
          {error ? (<div className="login-error" role="alert">{error}</div>) : null}
          <div className="login-links"><a href="#" onClick={e=>e.preventDefault()}>Esqueceu sua senha?</a></div>
          <button className="primary btn-lg" type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  )
}

function FilterModal({ open, filtros, setFiltros, designers, onClose, cadStatus, cadPlataformas, cadTipos, origens, campanhas }) {
  const set = (k,v)=>setFiltros(prev=>({ ...prev, [k]: v }))
  const clear = ()=>setFiltros({designer:'',status:'',plataforma:'',cIni:'',cFim:'',sIni:'',sFim:''})
  if (!open) return null
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-dialog" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div className="title"><span className="icon"><Icon name="filter" /></span><span>Filtros</span></div>
          <button className="icon" onClick={onClose}><Icon name="close" /></button>
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
          <div className="form-row"><label>Origem</label>
            <div className="chips">
              {(origens||ORIGENS).map(o=> (
                <button key={o} className={`chip ${filtros.origem===o?'active':''}`} onClick={()=> set('origem', filtros.origem===o?'':o)}>{o}</button>
              ))}
            </div>
          </div>
          <div className="form-row"><label>Campanha</label>
            <select value={filtros.campanha||''} onChange={e=>set('campanha', e.target.value)}>
              <option value="">Campanha</option>
              {(campanhas||[]).map(c=> <option key={c} value={c}>{c}</option>)}
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
          <div className="form-row"><label>Plataforma</label>
            <select value={filtros.plataforma||''} onChange={e=>set('plataforma', e.target.value)}>
              <option value="">Plataforma</option>
              {cadPlataformas.map(p=> <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="icon" onClick={clear}><Icon name="close" /><span>Limpar</span></button>
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
    if (f.origem && (it.origem||'') !== f.origem) return false
    if (f.campanha && (it.campanha||'') !== f.campanha) return false
    if (f.cIni && it.dataCriacao && it.dataCriacao < f.cIni) return false
    if (f.cFim && it.dataCriacao && it.dataCriacao > f.cFim) return false
    if (f.sIni && it.dataSolicitacao < f.sIni) return false
    if (f.sFim && it.dataSolicitacao > f.sFim) return false
    return true
  })
}

function TableView({ items, onEdit, onStatus, cadStatus, onDelete, onDuplicate, hasMore, showMore, canCollapse, showLess, shown, total, compact, canEdit }) {
  const [menuOpen, setMenuOpen] = useState(null)
  const toggleMenu = (id) => setMenuOpen(prev => prev===id ? null : id)
  const pad = n => String(n).padStart(2,'0')
  const isoWeek = d => { const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dayNum = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - dayNum); const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1)); const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7); return `${date.getUTCFullYear()}-W${pad(weekNo)}` }
  const thisWeek = isoWeek(new Date())
  const daysLeft = (p)=>{ if(!p) return ''; const [y,m,d]=String(p).split('-').map(Number); const end=new Date(y,(m||1)-1,(d||1)); const start=new Date(); start.setHours(0,0,0,0); end.setHours(0,0,0,0); return Math.round((end - start)/86400000) }
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
                <select className={`status-select ${statusClass(it.status)}`} value={it.status} onChange={e=>onStatus(it.id, e.target.value)} onClick={e=>e.stopPropagation()} disabled={!canEdit}>
                  {FIXED_STATUS.map(s=> <option key={s} value={s}>{statusWithDot(s)}</option>)}
                </select>
              </td>
              <td>{fmtDM(it.dataSolicitacao)}</td>
              <td>{fmtDM(it.dataCriacao)}</td>
              <td>{daysLeft(it.prazo)}</td>
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
                    <div className="deadline-pill"><span className="icon"><Icon name="clock" /></span><span>{new Date(it.prazo).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })}</span></div>
                  )}
                  <div className="meta">{it.tipoMidia}{it.plataforma?` • ${it.plataforma}`:''}</div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span className="pill" style={{borderColor:statusColorFor(it.status), color:statusColorFor(it.status)}}>{statusLabel(it.status)}</span>
                  </div>
                  {(()=>{ const a = it.arquivos||[]; const f = a[0]; const src = typeof f==='string' ? f : (f&&f.url?f.url:null); return src ? (<img className="card-preview" src={src} alt="preview" />) : null })()}
                  <div className="card-footer">
                    <div className="foot-item"><span className="icon"><Icon name="paperclip" /></span><span>{(it.arquivos||[]).length||0}</span></div>
                    <div className="foot-item"><span className="icon"><Icon name="chat" /></span><span>{it.revisoes||0}</span></div>
                    <div className="foot-item"><span className="icon"><Icon name="check" /></span><span>0</span></div>
                    <div className="foot-spacer" />
                    <div className="kanban-avatar small">{String(it.designer||'').slice(0,1).toUpperCase()}</div>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="add-card"><span className="icon"><Icon name="plus" /></span><span>Adicionar um cartão</span></button>
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

function Modal({ open, mode, onClose, onSubmit, initial, cadTipos, designers, cadPlataformas, onDelete, userLabel, canDelete }) {
  const [designer, setDesigner] = useState(initial?.designer || '')
  const [tipoMidia, setTipoMidia] = useState(initial?.tipoMidia || 'Post')
  const [titulo, setTitulo] = useState(initial?.titulo || '')
  const [link, setLink] = useState(initial?.link || '')
  const [arquivoNome, setArquivoNome] = useState('')
  const [dataSolic, setDataSolic] = useState(initial?.dataSolicitacao || hojeISO())
  const [plataforma, setPlataforma] = useState(initial?.plataforma || '')
  const [arquivos, setArquivos] = useState(initial?.arquivos || [])
  const [dataCriacao, setDataCriacao] = useState(initial?.dataCriacao || '')
  const [dataFeedback, setDataFeedback] = useState(initial?.dataFeedback || '')
  const [descricao, setDescricao] = useState(initial?.descricao || '')
  const [prazo, setPrazo] = useState(initial?.prazo || '')
  const [comentarios, setComentarios] = useState(initial?.comentarios || [])
  const [novoComentario, setNovoComentario] = useState('')
  const [historico, setHistorico] = useState(initial?.historico || [])
  const [origem, setOrigem] = useState(initial?.origem || '')
  const [campanha, setCampanha] = useState(initial?.campanha || '')
  useEffect(()=>{
    setDesigner(initial?.designer || '')
    setTipoMidia(initial?.tipoMidia || 'Post')
    setTitulo(initial?.titulo || '')
    setLink(initial?.link || '')
    setArquivoNome('')
    setDataSolic(initial?.dataSolicitacao ?? (mode==='create' ? hojeISO() : ''))
    setPlataforma(initial?.plataforma || (cadPlataformas?.[0] || ''))
    setArquivos(initial?.arquivos || [])
    setDataCriacao(initial?.dataCriacao || '')
    setDataFeedback(initial?.dataFeedback || '')
    setDescricao(initial?.descricao || '')
    setPrazo(initial?.prazo || '')
    setComentarios(initial?.comentarios || [])
    setNovoComentario('')
    setHistorico(initial?.historico || [])
    setOrigem(initial?.origem || '')
    setCampanha(initial?.campanha || '')
  },[initial, open, designers, cadTipos, cadPlataformas])
  const submit = e => { e.preventDefault(); onSubmit({ designer, tipoMidia, titulo, link, arquivoNome, dataSolic, dataCriacao, dataFeedback, plataforma, arquivos, descricao, prazo, comentarios, historico, origem, campanha }) }
  const addComentario = () => { const v = novoComentario.trim(); if (!v) return; const c = { texto: v, data: hojeISO() }; setComentarios(prev=> [c, ...prev]); setHistorico(prev=> [{ tipo:'comentario', autor:userLabel, data: c.data, texto: v }, ...prev]); setNovoComentario('') }
  const fmtDT = (s)=>{ if(!s) return ''; try{ return new Date(s).toLocaleString('pt-BR',{ day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) }catch{return s} }
  const [nowTs, setNowTs] = useState(Date.now())
  useEffect(()=>{ const id = setInterval(()=> setNowTs(Date.now()), 1000); return ()=> clearInterval(id) },[])
  const fmtHMS = (ms)=>{ if(!ms||ms<=0) return '00:00:00'; const s = Math.floor(ms/1000); const hh = String(Math.floor(s/3600)).padStart(2,'0'); const mm = String(Math.floor((s%3600)/60)).padStart(2,'0'); const ss = String(s%60).padStart(2,'0'); return `${hh}:${mm}:${ss}` }
  const baseMs = Number(initial?.tempoProducaoMs||0)
  const startedAtMs = initial?.startedAt ? Date.parse(initial.startedAt) : null
  const isProdNow = /produ|progresso/i.test(String(initial?.status||''))
  const [fallbackStart] = useState(()=> (!startedAtMs && isProdNow) ? Date.now() : null)
  const effectiveStart = startedAtMs ?? fallbackStart
  const totalMs = baseMs + (effectiveStart ? Math.max(0, nowTs - effectiveStart) : 0)
  if (!open) return null
  return (
    <div className="modal">
      <div className={`modal-dialog ${mode!=='create'?'tall':''}`} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          {mode==='create' ? (
            <div className="title"><span className="icon"><Icon name="plus" /></span><span>Nova demanda</span></div>
          ) : (
            <div className="title editable" contentEditable suppressContentEditableWarning onInput={e=> setTitulo(e.currentTarget.textContent || '')}>{titulo || 'Sem título'}</div>
          )}
          <button className="icon" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className={`status-bar ${statusClass(initial?.status || 'Aberta')}`}>
          <div>{initial?.status || 'Aberta'}</div>
          {mode!=='create' && (<div className="timer"><span className="icon"><Icon name="clock" /></span><span>{fmtHMS(totalMs)}</span></div>)}
        </div>
        <form id="modalForm" className="modal-body" onSubmit={submit}>
          <div className={`modal-columns ${mode==='create'?'single':'cols3'}`}>
            <div className="modal-main">
              <div className={mode==='create'?"form-grid":"form-stack"}>
              <div className="form-row"><label>Designer</label>
                <select value={designer} onChange={e=>setDesigner(e.target.value)} required>
                  <option value="">Designer</option>
                  {(designers||[]).map(d=> <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="form-row"><label>Tipo</label><select value={tipoMidia} onChange={e=>setTipoMidia(e.target.value)}>
                {(cadTipos||['Post','Story','Banner','Vídeo','Outro']).map(t=> <option key={t} value={t}>{t}</option>)}
              </select></div>
              {mode==='create' && (
                <div className="form-row"><label>Titulo</label><input value={titulo} onChange={e=>setTitulo(e.target.value)} required /></div>
              )}
              <div className="form-row"><label>Plataforma</label>
                <select value={plataforma} onChange={e=>setPlataforma(e.target.value)}>
                  <option value="">Plataforma</option>
                  {(cadPlataformas||[]).map(p=> <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="form-row"><label>Origem da Demanda</label>
                <select value={origem} onChange={e=>setOrigem(e.target.value)} required>
                  <option value="">Origem</option>
                  {ORIGENS.map(o=> <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-row"><label>Campanha</label>
                <input value={campanha} onChange={e=>setCampanha(e.target.value)} placeholder="Ex: Black Friday" />
              </div>
              <div className="form-row"><label>Link</label><input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://" /></div>
              {mode==='create' ? (
                <div className="row-2">
                  <div className="form-row"><label>Arquivo</label>
                    <input type="file" multiple accept="image/*" onChange={e=>{
                      const max = 1024*1024
                      const files = Array.from(e.target.files||[]).filter(f=> (f.size||0) <= max).slice(0,5)
                      const readers = files.map(f => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve({ name: f.name, url: r.result }); r.readAsDataURL(f) }))
                      Promise.all(readers).then(arr => {
                        setArquivos(arr)
                        setHistorico(prev=> [{ tipo:'arquivo', autor:userLabel, data: hojeISO(), arquivos: arr }, ...prev])
                        const nomes = arr.map(a=>a.name).join(', ')
                        setComentarios(prev=> [{ texto: `Arquivos anexados: ${nomes||arr.length}`, data: hojeISO() }, ...prev])
                      })
                    }} />
                  </div>
                  <div className="form-row"><label>Prazo</label><input type="date" value={prazo} onChange={e=>setPrazo(e.target.value)} /></div>
                </div>
              ) : (
                <div className="form-row"><label>Arquivo</label>
                  <input type="file" multiple accept="image/*" onChange={e=>{
                    const max = 1024*1024
                    const files = Array.from(e.target.files||[]).filter(f=> (f.size||0) <= max).slice(0,5)
                    const readers = files.map(f => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve({ name: f.name, url: r.result }); r.readAsDataURL(f) }))
                    Promise.all(readers).then(arr => {
                      setArquivos(arr)
                      setHistorico(prev=> [{ tipo:'arquivo', autor:userLabel, data: hojeISO(), arquivos: arr }, ...prev])
                      const nomes = arr.map(a=>a.name).join(', ')
                      setComentarios(prev=> [{ texto: `Arquivos anexados: ${nomes||arr.length}`, data: hojeISO() }, ...prev])
                    })
                  }} />
                </div>
              )}
              
              
              </div>
              {mode==='create' && (
                <div className="form-row"><label>Descrição</label><textarea rows={8} className="desc-input" value={descricao} onChange={e=> setDescricao(e.target.value)} /></div>
              )}
              
            </div>
            {mode!=='create' && (
              <div className="modal-center">
                <div className="date-row">
                  <div className="form-row"><label>Data de Solicitação</label><input type="date" value={dataSolic} disabled /></div>
                  <div className="form-row"><label>Data de Criação</label><input type="date" value={dataCriacao} disabled /></div>
                  <div className="form-row"><label>Prazo</label><input type="date" value={prazo} onChange={e=>setPrazo(e.target.value)} /></div>
                  {String(initial?.status||'').toLowerCase().includes('feedback') && (
                    <div className="form-row"><label>Data de Feedback</label><input type="date" value={dataFeedback} onChange={e=> setDataFeedback(e.target.value)} /></div>
                  )}
                </div>
                <div className="form-row"><label>Descrição</label><textarea rows={12} className="desc-input" value={descricao} onChange={e=> setDescricao(e.target.value)} /></div>
              </div>
            )}
            {mode!=='create' && (
              <div className="modal-side">
              <div className="activity">
                <div className="form-row"><label>Comentários e atividade</label>
                  <input placeholder="Escrever um comentário..." value={novoComentario} onChange={e=>setNovoComentario(e.target.value)} />
                  {novoComentario.trim().length>0 && (
                    <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
                      <button className="primary" type="button" onClick={addComentario}>Adicionar</button>
                    </div>
                  )}
                </div>
                <div className="activity-list">
                  {(historico||[]).length===0 ? <div className="empty">Sem atividade</div> : (
                    (historico||[]).map((ev,i)=> (
                      <div key={i} className="activity-item">
                        <div className="activity-entry">
                          <div className="avatar">V</div>
                          <div className="entry-content">
                            <div className="entry-title">
                              {ev.tipo==='status' && (<span>{ev.autor||'—'} moveu este cartão de {ev.de||''} para {ev.para||''}</span>)}
                              {ev.tipo==='comentario' && (<span><strong>{ev.autor||'—'}</strong> comentou: {ev.texto}</span>)}
                              {ev.tipo==='arquivo' && (<span>{ev.autor||'—'} anexou {Array.isArray(ev.arquivos)?ev.arquivos.length:1} arquivo(s)</span>)}
                            </div>
                            <div className="entry-time">{fmtDT(ev.data)}</div>
                            {ev.tipo==='arquivo' && Array.isArray(ev.arquivos) && (
                              <div className="thumbs">
                                {ev.arquivos.map((f)=> (
                                  <img key={f.name} className="file-thumb" src={f.url} alt={f.name} />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              </div>
            )}
          </div>
        </form>
        <div className="modal-actions">
          {mode==='edit' && canDelete && <button className="danger" type="button" onClick={()=>{ if (window.confirm('Confirmar exclusão desta demanda?')) { onDelete(initial.id); onClose() } }}>Excluir</button>}
          <button className="primary" type="submit" form="modalForm">Salvar</button>
        </div>
      </div>
    </div>
  )
}

function CadastrosView({ cadStatus, setCadStatus, cadTipos, setCadTipos, cadPlataformas, setCadPlataformas, cadStatusColors, setCadStatusColors }) {
  const [tab, setTab] = useState('tipo')
  const [novo, setNovo] = useState('')
  const [novoCor, setNovoCor] = useState('#f59e0b')
  const lista = tab==='status' ? cadStatus : tab==='tipo' ? cadTipos : cadPlataformas
  const setLista = (arr) => {
    if (tab==='status') setCadStatus(arr)
    else if (tab==='tipo') setCadTipos(arr)
    else setCadPlataformas(arr)
  }
  const addItem = async () => { const v = novo.trim(); if (!v) return; if (lista.includes(v)) return; const arr = [...lista, v]; setLista(arr); setNovo(''); if (tab==='status') setCadStatusColors(prev=> ({ ...prev, [v]: novoCor })); if (apiEnabled) await api.addCadastro(tab==='status'?'status':tab==='tipo'?'tipos':'plataformas', v); else if (db) { const col = tab==='status'?'cad_status':tab==='tipo'?'cad_tipos':'cad_plataformas'; try { await setDoc(doc(db, col, v), { name: v }) } catch {} } }
  const removeItem = async (v) => { const arr = lista.filter(x=>x!==v); setLista(arr); if (apiEnabled) await api.removeCadastro(tab==='status'?'status':tab==='tipo'?'tipos':'plataformas', v); else if (db) { const col = tab==='status'?'cad_status':tab==='tipo'?'cad_tipos':'cad_plataformas'; try { await deleteDoc(doc(db, col, v)) } catch {} } }
  return (
    <div className="panel">
      <div className="tabs">
        <button className={`tab ${tab==='tipo'?'active':''}`} onClick={()=>setTab('tipo')}>Tipo</button>
        <button className={`tab ${tab==='plataforma'?'active':''}`} onClick={()=>setTab('plataforma')}>Plataforma</button>
      </div>
      <div className="form-row" style={{marginTop:10}}>
        <label>{tab==='status'?'Novo Status':tab==='tipo'?'Novo Tipo':'Nova Plataforma'}</label>
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
                <button className="icon" onClick={()=>removeItem(v)}><Icon name="trash" /></button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function AlertBar({ revisarCount, aprovadaCount, onShowRevisar, onShowAprovada }) {
  if (!revisarCount && !aprovadaCount) return null
  return (
    <div className="alertbar">
      {revisarCount>0 && (
        <button className="alert-pill red" type="button" onClick={onShowRevisar}>
          <span>Revisar</span>
          <span className="alert-count">{revisarCount}</span>
        </button>
      )}
      {aprovadaCount>0 && (
        <button className="alert-pill green" type="button" onClick={onShowAprovada}>
          <span>Aprovada</span>
          <span className="alert-count">{aprovadaCount}</span>
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [demandas, setDemandas] = useState(ler())
  const [view, setView] = useState('table')
  const [compact, setCompact] = useState(false)
  const [route, setRoute] = useState('dashboard')
  const [filtros, setFiltros] = useState({designer:'',status:'',plataforma:'',tipoMidia:'',origem:'',campanha:'',cIni:'',cFim:'',sIni:'',sFim:''})
  const [filterOpen, setFilterOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [editing, setEditing] = useState(null)
  const [themeVars, setThemeVars] = useState(readObj('themeVars', defaultTheme))
  
  const [cadStatus, setCadStatus] = useState(readLS('cadStatus', ["Aberta","Em Progresso","Concluída"]))
  const [cadTipos, setCadTipos] = useState(readLS('cadTipos', ["Post","Story","Banner","Vídeo","Outro"]))
  const [cadPlataformas, setCadPlataformas] = useState(readLS('cadPlataformas', []))
  const [usersAll, setUsersAll] = useState([])
  const [cadStatusColors, setCadStatusColors] = useState(readObj('cadStatusColors', { Aberta:'#f59e0b', "Em Progresso":"#3b82f6", "Concluída":"#10b981" }))
  const designersFromDemandas = useMemo(()=> Array.from(new Set(demandas.map(x=>x.designer).filter(Boolean))).sort(), [demandas])
  const designersFromUsers = useMemo(()=> usersAll.filter(u=> (u.cargo||'')==='Designer').map(u=> u.username).filter(Boolean).sort(), [usersAll])
  const designers = useMemo(()=> Array.from(new Set([...designersFromUsers, ...designersFromDemandas])).sort(), [designersFromUsers, designersFromDemandas])
  const campanhas = useMemo(()=> Array.from(new Set(demandas.map(x=>x.campanha).filter(Boolean))).sort(), [demandas])
  const role = user?.role||'comum'
  const items = useMemo(()=> aplicarFiltros(demandas, filtros), [demandas, filtros])
  const dashItems = useMemo(()=>{
    if (role==='admin' || role==='gerente') return items
    const uname = user?.username||''
    return items.filter(x=> (x.designer||'')===uname)
  }, [items, role, user])
  const dashDesigners = useMemo(()=> (role==='admin'||role==='gerente') ? designers : [user?.username].filter(Boolean), [designers, role, user])
  const itemsSorted = useMemo(()=> items.slice().sort((a,b)=>{
    const da = a.dataCriacao||''; const db = b.dataCriacao||''; const c = db.localeCompare(da); if (c!==0) return c; const ia = a.id||0; const ib = b.id||0; return ib - ia
  }), [items])
  const designersVisible = useMemo(()=> (role==='admin'||role==='gerente') ? designers : [user?.username].filter(Boolean), [designers, role, user])
  const itemsVisible = useMemo(()=> (role==='admin'||role==='gerente') ? itemsSorted : itemsSorted.filter(x=> (x.designer||'')===(user?.username||'')), [itemsSorted, role, user])
  const revisarCount = useMemo(()=> itemsVisible.filter(x=> /revisar/i.test(String(x.status||''))).length, [itemsVisible])
  const aprovadaCount = useMemo(()=> itemsVisible.filter(x=> /aprovada/i.test(String(x.status||''))).length, [itemsVisible])
  const onShowRevisar = ()=>{ setRoute('demandas'); setFiltros(prev=> ({ ...prev, status: 'Revisar' })) }
  const onShowAprovada = ()=>{ setRoute('demandas'); setFiltros(prev=> ({ ...prev, status: 'Aprovada' })) }
  const statusCounts = useMemo(()=>{
    const arr = itemsVisible
    const low = s=> String(s||'').toLowerCase()
    return {
      'Pendente': arr.filter(x=> isPendingStatus(x.status)).length,
      'Em produção': arr.filter(x=> isProdStatus(x.status)).length,
      'Aguardando Feedback': arr.filter(x=> low(x.status).includes('feedback')).length,
      'Aprovada': arr.filter(x=> low(x.status).includes('aprov')).length,
      'Revisar': arr.filter(x=> low(x.status).includes('revisar')).length,
      'Concluida': arr.filter(x=> low(x.status).includes('conclu')).length,
    }
  },[itemsVisible])
 
  const [tableLimit, setTableLimit] = useState(10)
  const [calRef, setCalRef] = useState(new Date())
  const userLabel = useMemo(()=> user?.name || user?.username || 'Você', [user])
  const allRoutes = ['dashboard','demandas','config','cadastros','relatorios','usuarios']
  const allowedRoutes = useMemo(()=>{
    const p = user?.pages
    if (!p) return allRoutes
    return allRoutes.filter(r => p[r] !== false)
  },[user])

  useEffect(()=>{ if (!db) gravar(demandas) },[demandas, db])
  useEffect(()=>{ if (!db) writeLS('cadStatus', cadStatus) },[cadStatus, db])
  useEffect(()=>{ if (!db) writeLS('cadTipos', cadTipos) },[cadTipos, db])
  
  useEffect(()=>{ if (!db) writeLS('cadPlataformas', cadPlataformas) },[cadPlataformas, db])
  useEffect(()=>{ if (!db) writeLS('cadStatusColors', cadStatusColors) },[cadStatusColors, db])
  useEffect(()=>{
    if (!db) {
      ensureAdminSeed()
      const saved = readObj('localUser', null)
      if (saved) setUser(saved)
    }
  },[db])
  useEffect(()=>{
    if (!db || !auth) return
    const unsub = onAuthStateChanged(auth, async (cur)=>{
      if (cur) {
        let meta = null
        try { const snap = await getDoc(doc(db, 'usuarios', cur.uid)); if (snap.exists()) meta = snap.data() } catch {}
        if (!meta) {
          try { const q = query(collection(db, 'usuarios'), where('email','==', cur.email||'')); const snap = await getDocs(q); snap.forEach(d=>{ if (!meta) meta = d.data() }) } catch {}
        }
        const u = { username: meta?.username || (cur.email||'').split('@')[0], name: meta?.name || cur.displayName || (cur.email||''), role: meta?.role || 'comum', pages: meta?.pages || null, actions: meta?.actions || null, cargo: meta?.cargo || '' }
        setUser(u)
      } else {
        setUser(null)
      }
    })
    return ()=>{ try { unsub() } catch {} }
  },[db, auth])
  useEffect(()=>{
    Object.entries(themeVars||{}).forEach(([k,v])=>{
      try { document.documentElement.style.setProperty(`--${k}`, v) } catch {}
    })
    writeLS('themeVars', themeVars)
  },[themeVars])
  useEffect(()=>{
    if (db && user) {
      let unsubDemandas = null
      let unsubCadStatus = null
      let unsubCadTipos = null
      let unsubCadPlataformas = null
      let unsubUsuarios = null
      try {
        const uname = user?.username||''
        const isMgr = (user?.role==='admin' || user?.role==='gerente')
        const base = collection(db, 'demandas')
        const q = isMgr ? base : query(base, where('designer','==', uname))
        unsubDemandas = onSnapshot(q, snap => {
          const arr = []
          snap.forEach(d => arr.push({ id: d.id, ...d.data() }))
          setDemandas(arr)
        })
      } catch {}
      try {
        unsubCadStatus = onSnapshot(collection(db, 'cad_status'), snap => {
          const arr = []
          snap.forEach(d => arr.push(d.data()?.name || d.id))
          setCadStatus(arr)
        })
      } catch {}
      try {
        unsubCadTipos = onSnapshot(collection(db, 'cad_tipos'), snap => {
          const arr = []
          snap.forEach(d => arr.push(d.data()?.name || d.id))
          setCadTipos(arr)
        })
      } catch {}
      try {
        unsubUsuarios = onSnapshot(collection(db, 'usuarios'), snap => {
          const arr = []
          snap.forEach(d => arr.push({ id: d.id, ...d.data() }))
          setUsersAll(arr)
        })
      } catch {}
      try {
        unsubCadPlataformas = onSnapshot(collection(db, 'cad_plataformas'), snap => {
          const arr = []
          snap.forEach(d => arr.push(d.data()?.name || d.id))
          setCadPlataformas(arr)
        })
      } catch {}
      return ()=>{
        try { unsubDemandas && unsubDemandas() } catch {}
        try { unsubCadStatus && unsubCadStatus() } catch {}
        try { unsubCadTipos && unsubCadTipos() } catch {}
        try { unsubUsuarios && unsubUsuarios() } catch {}
        try { unsubCadPlataformas && unsubCadPlataformas() } catch {}
      }
    } else if (!db && apiEnabled) {
      api.listDemandas().then(list => { if (Array.isArray(list)) setDemandas(list) })
      api.listCadastros('status').then(arr=> Array.isArray(arr) && setCadStatus(arr))
      api.listCadastros('tipos').then(arr=> Array.isArray(arr) && setCadTipos(arr))
      api.listCadastros('plataformas').then(arr=> Array.isArray(arr) && setCadPlataformas(arr))
    }
  },[db, user])
  useEffect(()=>{
    if (user && !allowedRoutes.includes(route)) {
      setRoute(allowedRoutes[0])
    }
    if (!user && route!=='dashboard' && route!=='demandas' && route!=='config' && route!=='cadastros' && route!=='relatorios' && route!=='usuarios') {
      setRoute('dashboard')
    }
  },[user, allowedRoutes, route])

  const logout = async ()=>{ try { await signOut(auth) } catch {} try { localStorage.removeItem('localUser') } catch {} setUser(null) }
  const login = async (username, password) => {
    const uname = String(username||'').trim()
    if (!uname || !password) throw new Error('Credenciais ausentes')
    if (!auth || !db) {
      ensureAdminSeed()
      const list = readUsers()
      const found = list.find(u=> u.username===uname && u.password===password)
      if (!found) throw new Error('Firebase não configurado ou usuário local inválido')
      const u = { username: found.username, name: found.name||found.username, role: found.role||'comum', pages: found.pages||null, actions: found.actions||null, cargo: found.cargo||'' }
      try { writeLS('localUser', u) } catch {}
      setUser(u)
      return
    }
    let email = uname
    if (!/@/.test(uname)) {
      try {
        const qy = query(collection(db, 'usuarios'), where('username','==', uname))
        const snap = await getDocs(qy)
        let found = null
        snap.forEach(d=>{ const data=d.data(); if (!found && data?.email) found = data.email })
        email = found || `${uname}@betaki.bet.br`
      } catch {
        email = `${uname}@betaki.bet.br`
      }
    }
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e) {
      const code = e?.code || ''
      try {
        if (code==='auth/invalid-credential' || code==='auth/user-not-found') {
          const cred = await createUserWithEmailAndPassword(auth, email, password)
          const uidEmail = cred?.user?.email || email
          const docId = uname
          try { await setDoc(doc(db,'usuarios', docId), { username: uname, email: uidEmail }, { merge: true }) } catch {}
        } else {
          throw e
        }
      } catch (err) {
        throw err
      }
    }
  }

  const canCreate = (user?.actions?.criar !== false)
  const canDelete = (user?.actions?.excluir !== false)
  const canView = (user?.actions?.visualizar !== false)
  const onNew = ()=>{ if (!user || !canCreate) return; setModalMode('create'); setEditing(null); setModalOpen(true) }
  const onEdit = it => { if (!user || !canView) return; setModalMode('edit'); setEditing(it); setModalOpen(true) }
  const onDuplicate = async (it) => {
    const base = { ...it, id: undefined, status: 'Aberta', dataSolicitacao: hojeISO(), dataCriacao: hojeISO() }
    if (apiEnabled) {
      const saved = await api.createDemanda(base)
      setDemandas(prev=> [...prev, { ...base, id: saved?.id ?? proxId(prev) }])
    } else {
      const nextId = proxId(demandas)
      setDemandas(prev=> [...prev, { ...base, id: nextId }])
      if (db) {
        try { await setDoc(doc(db, 'demandas', String(nextId)), { ...base, id: nextId, createdAt: serverTimestamp() }) } catch {}
      }
    }
  }
  const onStatus = async (id, status) => {
    const today = hojeISO()
    setDemandas(prev=> prev.map(x=> {
      if (x.id!==id) return x
      const changed = x.status !== status
      const wasProd = String(x.status||'').toLowerCase().includes('produ') || String(x.status||'').toLowerCase().includes('progresso')
      const isProd = String(status||'').toLowerCase().includes('produ') || String(status||'').toLowerCase().includes('progresso')
      const nowMs = Date.now()
      let tempoProducaoMs = Number(x.tempoProducaoMs||0)
      let startedAt = x.startedAt || null
      let finishedAt = x.finishedAt || null
      const isFeedback = String(status||'').toLowerCase().includes('feedback')
      if (changed) {
        if (wasProd && !isProd && startedAt) {
          const startedMs = Date.parse(startedAt)
          if (!isNaN(startedMs)) tempoProducaoMs += Math.max(0, nowMs - startedMs)
          startedAt = null
        }
        if (!wasProd && isProd && !startedAt) {
          startedAt = new Date(nowMs).toISOString()
        }
      }
      const isRev = String(status||'').toLowerCase().includes('revisar')
      const revisoes = changed && isRev ? (x.revisoes||0)+1 : (x.revisoes||0)
      const isDone = String(status||'').toLowerCase().includes('concluida') || status==='Concluída'
      const dataConclusao = isDone ? (x.dataConclusao||today) : x.dataConclusao
      const dataCriacao = isDone ? (x.dataCriacao||today) : x.dataCriacao
      if (changed && isDone) finishedAt = new Date(nowMs).toISOString()
      const histItem = changed ? { tipo:'status', autor: userLabel, data: today, de: x.status, para: status } : null
      const historico = histItem ? [histItem, ...(x.historico||[])] : (x.historico||[])
      const nextFeedback = (changed && isFeedback && !x.dataFeedback) ? today : x.dataFeedback
      return { ...x, status, revisoes, dataConclusao, dataCriacao, dataFeedback: nextFeedback, historico, tempoProducaoMs, startedAt, finishedAt }
    }))
    const found = demandas.find(x=>x.id===id)
    if (apiEnabled && found) {
      await api.updateDemanda(id, { ...found, status, dataCriacao: ((String(status||'').toLowerCase().includes('concluida') || status==='Concluída')) ? (found.dataCriacao||today) : found.dataCriacao, dataConclusao: (String(status||'').toLowerCase().includes('concluida') || status==='Concluída') ? (found.dataConclusao||today) : found.dataConclusao, dataFeedback: ((found.status!==status && String(status||'').toLowerCase().includes('feedback')) && !found.dataFeedback) ? today : found.dataFeedback, revisoes: (found.revisoes||0) + ((found.status!==status && String(status||'').toLowerCase().includes('revisar'))?1:0), historico: [{ tipo:'status', autor: userLabel, data: today, de: found.status, para: status }, ...(found.historico||[]) ], tempoProducaoMs: found.tempoProducaoMs, startedAt: found.startedAt, finishedAt: (String(status||'').toLowerCase().includes('concluida') || status==='Concluída') ? new Date().toISOString() : found.finishedAt })
    } else if (db && found) {
      try { await updateDoc(doc(db, 'demandas', String(id)), { ...found, status, dataCriacao: ((String(status||'').toLowerCase().includes('concluida') || status==='Concluída')) ? (found.dataCriacao||today) : found.dataCriacao, dataConclusao: (String(status||'').toLowerCase().includes('concluida') || status==='Concluída') ? (found.dataConclusao||today) : found.dataConclusao, dataFeedback: ((found.status!==status && String(status||'').toLowerCase().includes('feedback')) && !found.dataFeedback) ? today : found.dataFeedback, revisoes: (found.revisoes||0) + ((found.status!==status && String(status||'').toLowerCase().includes('revisar'))?1:0), historico: [{ tipo:'status', autor: userLabel, data: today, de: found.status, para: status }, ...(found.historico||[]) ], tempoProducaoMs: found.tempoProducaoMs, startedAt: found.startedAt, finishedAt: (String(status||'').toLowerCase().includes('concluida') || status==='Concluída') ? new Date().toISOString() : found.finishedAt }) } catch {}
    }
  }
  const onDelete = async (id) => {
    setDemandas(prev=> prev.filter(x=> x.id!==id))
    if (apiEnabled) await api.deleteDemanda(id)
    else if (db) { try { await deleteDoc(doc(db, 'demandas', String(id))) } catch {} }
  }
  const onSubmit = async ({ designer, tipoMidia, titulo, link, arquivoNome, dataSolic, dataCriacao, dataFeedback, plataforma, arquivos, descricao, prazo, comentarios, historico, origem, campanha }) => {
    const ensureCad = async () => {
      if (!db) return
      try { if (tipoMidia) await setDoc(doc(db, 'cad_tipos', String(tipoMidia)), { name: tipoMidia }, { merge: true }) } catch {}
      try { if (plataforma) await setDoc(doc(db, 'cad_plataformas', String(plataforma)), { name: plataforma }, { merge: true }) } catch {}
      try { if (historico && Array.isArray(historico)) { const last = historico[0]; const st = last?.para || last?.de || 'Aberta'; if (st) await setDoc(doc(db, 'cad_status', String(st)), { name: st }, { merge: true }) } } catch {}
    }
    if (modalMode==='edit' && editing) {
      const updated = { ...editing, designer, tipoMidia, titulo, link, descricao, comentarios: comentarios ?? editing.comentarios, historico: historico ?? editing.historico, arquivos: (arquivos && arquivos.length ? arquivos : editing.arquivos), arquivoNome: arquivoNome || editing.arquivoNome, dataSolicitacao: dataSolic || editing.dataSolicitacao, dataCriacao: dataCriacao || editing.dataCriacao, dataFeedback: dataFeedback || editing.dataFeedback, plataforma, prazo, origem, campanha }
      setDemandas(prev=> prev.map(x=> x.id===editing.id ? updated : x))
      if (apiEnabled) await api.updateDemanda(editing.id, updated)
      else if (db) { try { await updateDoc(doc(db, 'demandas', String(editing.id)), updated) } catch {} }
      await ensureCad()
    } else {
      const hoje = hojeISO()
      const inicial = { tipo:'status', autor: userLabel, data: hoje, de: '', para: 'Aberta' }
      const novo = { designer, tipoMidia, titulo, link, descricao, comentarios: [], historico: [inicial], arquivos: (arquivos||[]), arquivoNome, plataforma, origem, campanha, dataSolicitacao: dataSolic, dataCriacao: hoje, dataFeedback: undefined, status: 'Aberta', prazo, tempoProducaoMs: 0, startedAt: null, finishedAt: null, revisoes: 0, createdBy: userLabel }
      if (apiEnabled) {
        const saved = await api.createDemanda(novo)
        setDemandas(prev=> [...prev, { ...novo, id: saved?.id ?? proxId(prev) }])
      } else {
        const nextId = proxId(demandas)
        setDemandas(prev=> [...prev, { ...novo, id: nextId }])
        if (db) {
          try { await setDoc(doc(db, 'demandas', String(nextId)), { ...novo, id: nextId, createdAt: serverTimestamp() }) } catch {}
        }
      }
      await ensureCad()
    }
    setModalOpen(false)
  }

  const onResetSystem = async () => {
    if (!window.confirm('Confirmar: apagar TODAS as demandas e limpar relatórios?')) return
    const toDelete = apiEnabled ? [...demandas] : []
    setDemandas([])
    try { localStorage.removeItem('demandas') } catch {}
    try { setFiltros({designer:'',status:'',plataforma:'',tipoMidia:'',origem:'',campanha:'',cIni:'',cFim:'',sIni:'',sFim:''}) } catch {}
    if (apiEnabled && toDelete.length) {
      try { await Promise.all(toDelete.map(x=> api.deleteDemanda(x.id))) } catch {}
    }
    if (db) {
      try {
        const snap = await getDocs(collection(db, 'demandas'))
        const tasks = []
        snap.forEach(docSnap=> tasks.push(deleteDoc(doc(db, 'demandas', docSnap.id))))
        if (tasks.length) await Promise.all(tasks)
      } catch {}
    }
  }

  

  return (
    <div className="layout">
      {user ? <Sidebar route={route} setRoute={setRoute} allowedRoutes={allowedRoutes} /> : null}
      <div className={`content ${user?'':'no-sidebar'}`}>
        <div className="app">
          {user ? <Header onNew={onNew} view={view} setView={setView} showNew={!!user} user={user} onLogout={logout} setRoute={setRoute} /> : null}
          
          {!user && (
            <LoginView onLogin={login} />
          )}
          {user && route==='dashboard' && (
            <DashboardView demandas={demandas} items={dashItems} designers={dashDesigners} setView={setView} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} onDelete={onDelete} onDuplicate={onDuplicate} compact={compact} calRef={calRef} setCalRef={setCalRef} />
          )}
          {user && route==='demandas' && (
            <div className="demandas-layout">
              <div className="sidebar-col">
                <FilterBar filtros={filtros} setFiltros={setFiltros} designers={designersVisible} showSearch={false} statusCounts={statusCounts} />
              </div>
              <div className="content-col">
                <div className="top-search">
                  <input className="search" placeholder="Pesquisar demandas..." value={filtros.q||''} onChange={e=> setFiltros(prev=> ({ ...prev, q: e.target.value }))} />
                  <button className="primary" onClick={onNew} disabled={!canCreate}><span className="icon"><Icon name="plus" /></span><span>Nova demanda</span></button>
                </div>
                <div className="table-scroll">
                  <TableView items={itemsVisible.slice(0, tableLimit)} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} onDelete={onDelete} onDuplicate={onDuplicate} hasMore={itemsVisible.length>tableLimit} showMore={()=>setTableLimit(l=> Math.min(l+10, itemsVisible.length))} canCollapse={tableLimit>10} showLess={()=>setTableLimit(10)} shown={Math.min(tableLimit, itemsVisible.length)} total={itemsVisible.length} compact={compact} canEdit={!!user} />
                </div>
                <Modal open={modalOpen} mode={modalMode} onClose={()=>setModalOpen(false)} onSubmit={onSubmit} initial={editing} cadTipos={cadTipos} designers={designersVisible} cadPlataformas={cadPlataformas} onDelete={onDelete} userLabel={userLabel} canDelete={canDelete} />
                <FilterModal open={filterOpen} filtros={filtros} setFiltros={setFiltros} designers={designersVisible} onClose={()=>setFilterOpen(false)} cadStatus={cadStatus} cadPlataformas={cadPlataformas} cadTipos={cadTipos} origens={ORIGENS} campanhas={campanhas} />
              </div>
            </div>
          )}
          {user && route==='config' && (
            <ConfigView themeVars={themeVars} setThemeVars={setThemeVars} onReset={onResetSystem} />
          )}
          {user && route==='cadastros' && (
            <CadastrosView cadStatus={cadStatus} setCadStatus={setCadStatus} cadTipos={cadTipos} setCadTipos={setCadTipos} cadPlataformas={cadPlataformas} setCadPlataformas={setCadPlataformas} cadStatusColors={cadStatusColors} setCadStatusColors={setCadStatusColors} />
          )}
          {user && route==='relatorios' && (
            <ReportsView demandas={demandas} items={itemsVisible} designers={designersVisible} filtros={filtros} setFiltros={setFiltros} />
          )}
          {user && route==='usuarios' && (
            <UsersView users={readUsers()} onCreate={(nu)=>{ const list=readUsers(); writeUsers([...list, nu]) }} onDelete={(username)=>{ const list=readUsers().filter(u=>u.username!==username); writeUsers(list) }} onUpdate={(username, patch)=>{ const list=readUsers().map(u=> u.username===username ? { ...u, ...patch } : u); writeUsers(list) }} role={role} />
          )}
          
        </div>
      </div>
    </div>
  )
}
function Sidebar({ route, setRoute, allowedRoutes }) {
  return (
    <aside className="sidebar">
      <nav>
        <ul className="nav-list">
          {allowedRoutes.map(r=> (
            <li key={r}><a href="#" className={`nav-link ${route===r?'active':''}`} onClick={e=>{ e.preventDefault(); setRoute(r) }}>
              <span className="nav-ico">{r==='dashboard'?<Icon name="dashboard" />: r==='demandas'?<Icon name="demandas" />: r==='config'?<Icon name="config" />: r==='cadastros'?<Icon name="cadastros" />: r==='relatorios'?<Icon name="relatorios" />:<Icon name="usuarios" />}</span>
              <span>{r==='dashboard'?'Dashboard': r==='demandas'?'Demandas': r==='config'?'Configurações': r==='cadastros'?'Cadastros': r==='relatorios'?'Relatórios':'Usuários'}</span>
            </a></li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

function UsersView({ users, onCreate, onDelete, onUpdate, role }) {
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [urole, setUrole] = useState('comum')
  const [cargo, setCargo] = useState('Designer')
  const [list, setList] = useState([])
  const fns = useMemo(()=> (firebaseApp ? getFunctions(firebaseApp) : null), [])
  const [pwdEdit, setPwdEdit] = useState({})
  useEffect(()=>{ if (db) { const unsub = onSnapshot(collection(db,'usuarios'), s=>{ const arr=[]; s.forEach(d=> arr.push({ id:d.id, ...d.data() })); setList(arr) }); return ()=>{ try{unsub()}catch{} } } else { setList(readUsers()) } },[])
  const refresh = ()=> setList(readUsers())
  const [pages, setPages] = useState({ dashboard:true, demandas:true, config:true, cadastros:true, relatorios:true, usuarios:true })
  const [actions, setActions] = useState({ criar:true, excluir:true, visualizar:true })
  const toggle = (objSetter, key) => objSetter(prev=> ({ ...prev, [key]: !prev[key] }))
  const create = async ()=>{ const u=username.trim(); const em=(email.trim()||`${u}@betaki.bet.br`); if(!u||!password) return; const nu={ username:u, name: name||u, role: urole, cargo, pages, actions, email: em }; if (db) { try { try { await createUserWithEmailAndPassword(auth, em, password) } catch(e) { if (e?.code!=='auth/email-already-in-use') throw e } await setDoc(doc(db,'usuarios', u), nu) } catch {} } else { onCreate({ ...nu, password }); refresh() } setUsername(''); setName(''); setPassword(''); setEmail(''); setUrole('comum'); setCargo('Designer'); setPages({ dashboard:true, demandas:true, config:true, cadastros:true, relatorios:true, usuarios:true }); setActions({ criar:true, excluir:true, visualizar:true }) }
  const del = async (u)=>{
    if ((u.username||u.id)==='admin') return
    if (db) {
      try { await deleteDoc(doc(db,'usuarios', u.username||u.id)); setList(prev=> prev.filter(x=> (x.username||x.id)!==(u.username||u.id))) } catch {}
    } else {
      onDelete(u.username)
      refresh()
    }
  }
  const updatePwd = async (u)=>{
    const newPwd = String(pwdEdit[u.username||u.id]||'').trim()
    if (!newPwd) return
    if (fns) {
      try { const call = httpsCallable(fns, 'updateUserPassword'); await call({ username: u.username||u.id, password: newPwd, email: u.email||undefined }); setPwdEdit(prev=> ({ ...prev, [u.username||u.id]: '' })) } catch {}
    }
  }
  const togglePage = async (u, key)=>{ const cur=u.pages||{}; const patch = { pages: { ...cur, [key]: !(cur[key]!==false) } }; if (db) { try { await updateDoc(doc(db,'usuarios', u.username||u.id), patch); setList(prev=> prev.map(x=> (x.username===u.username||x.id===u.id) ? { ...x, ...patch } : x)) } catch {} } else { onUpdate(u.username, patch); refresh() } }
  const toggleAction = async (u, key)=>{ const cur=u.actions||{}; const patch = { actions: { ...cur, [key]: !(cur[key]!==false) } }; if (db) { try { await updateDoc(doc(db,'usuarios', u.username||u.id), patch); setList(prev=> prev.map(x=> (x.username===u.username||x.id===u.id) ? { ...x, ...patch } : x)) } catch {} } else { onUpdate(u.username, patch); refresh() } }
  return (
    <div className="panel users-panel">
      <div className="tabs"><button className="tab active">Usuários</button></div>
      <div className="form-grid">
        <div className="form-row"><label>Usuário</label><input value={username} onChange={e=>setUsername(e.target.value)} /></div>
        <div className="form-row"><label>Nome</label><input value={name} onChange={e=>setName(e.target.value)} /></div>
        <div className="form-row"><label>Senha</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} /></div>
        <div className="form-row"><label>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
        <div className="form-row"><label>Perfil</label>
          <select value={urole} onChange={e=>setUrole(e.target.value)}>
            <option value="comum">Comum</option>
            <option value="gerente">Gerente</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="form-row"><label>Cargo</label>
          <select value={cargo} onChange={e=>setCargo(e.target.value)}>
            <option value="Designer">Designer</option>
            <option value="Social Media">Social Media</option>
            <option value="Gerente">Gerente</option>
            <option value="Externo">Externo</option>
          </select>
        </div>
        <div className="form-row"><label>Páginas</label>
          <div className="chips">
            {['dashboard','demandas','config','cadastros','relatorios','usuarios'].map(k=> (
              <button key={k} className={`btn-md ${pages[k]?'active':''}`} type="button" onClick={()=> toggle(setPages, k)}><span className="icon"><Icon name={k==='dashboard'?'dashboard': k==='demandas'?'demandas': k==='config'?'config': k==='cadastros'?'cadastros': k==='relatorios'?'relatorios':'usuarios'} /></span><span>{k==='dashboard'?'Dashboard': k==='demandas'?'Demandas': k==='config'?'Configurações': k==='cadastros'?'Cadastros': k==='relatorios'?'Relatórios':'Usuários'}</span></button>
            ))}
          </div>
        </div>
        <div className="form-row"><label>Ações</label>
          <div className="chips">
            {[['criar','plus','Criar'], ['excluir','trash','Excluir'], ['visualizar','table','Visualizar']].map(([k,ico,label])=> (
              <button key={k} className={`btn-md ${actions[k]?'active':''}`} type="button" onClick={()=> toggle(setActions, k)}><span className="icon"><Icon name={ico} /></span><span>{label}</span></button>
            ))}
          </div>
        </div>
        <div className="modal-actions"><button className="primary" type="button" onClick={create}>Criar usuário</button></div>
      </div>
      <div className="section-divider" />
      <table className="report-matrix">
        <thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>Cargo</th><th>Páginas</th><th>Ações</th><th>Senha</th><th>Gerenciar</th></tr></thead>
        <tbody>
          {(list||[]).map(u=> (
            <tr key={u.username}>
              <td>{u.username}</td>
              <td>{u.name||u.username}</td>
              <td>{u.role||'comum'}</td>
              <td>{u.cargo||''}</td>
              <td>
                <div className="chips">
                  {['dashboard','demandas','config','cadastros','relatorios','usuarios'].map(k=> (
                    <button key={k} className={`btn-md ${(u.pages?.[k]!==false) ? 'active' : ''}`} type="button" onClick={()=> togglePage(u, k)}><span className="icon"><Icon name={k==='dashboard'?'dashboard': k==='demandas'?'demandas': k==='config'?'config': k==='cadastros'?'cadastros': k==='relatorios'?'relatorios':'usuarios'} /></span><span>{k==='dashboard'?'Dashboard': k==='demandas'?'Demandas': k==='config'?'Configurações': k==='cadastros'?'Cadastros': k==='relatorios'?'Relatórios':'Usuários'}</span></button>
                  ))}
                </div>
              </td>
              <td>
                <div className="chips">
                  {[['criar','plus','Criar'], ['excluir','trash','Excluir'], ['visualizar','table','Visualizar']].map(([k,ico,label])=> (
                    <button key={k} className={`btn-md ${(u.actions?.[k]!==false) ? 'active' : ''}`} type="button" onClick={()=> toggleAction(u, k)}><span className="icon"><Icon name={ico} /></span><span>{label}</span></button>
                  ))}
                </div>
              </td>
              <td>
                <div className="form-row">
                  <input type="password" placeholder="Nova senha" value={pwdEdit[u.username||u.id]||''} onChange={e=> setPwdEdit(prev=> ({ ...prev, [u.username||u.id]: e.target.value }))} />
                  <button className="primary" type="button" onClick={()=>updatePwd(u)}>Salvar</button>
                </div>
              </td>
              <td>
                <button className="icon" onClick={()=>del(u)} disabled={u.username==='admin'}><span className="icon"><Icon name="trash" /></span><span>Excluir</span></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

 


function ConfigView({ themeVars, setThemeVars, onReset }) {
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
        <button className="danger" type="button" onClick={onReset}>Resetar sistema</button>
        <button className="primary" type="button" onClick={reset}>Restaurar padrão</button>
      </div>
    </div>
  )
}
function FilterBar({ filtros, setFiltros, designers, showSearch, statusCounts }) {
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
    if (period==='today') setFiltros(prev=>({ ...prev, sIni: toYMD(d), sFim: toYMD(d), cIni:'', cFim:'' }))
    if (period==='week') { const s=startOfISOWeek(d), e=endOfISOWeek(d); setFiltros(prev=>({ ...prev, sIni: toYMD(s), sFim: toYMD(e), cIni:'', cFim:'' })) }
    if (period==='month') setFiltros(prev=>({ ...prev, sIni: toYMD(startOfMonth), sFim: toYMD(endOfMonth), cIni:'', cFim:'' }))
    if (period==='lastmonth') setFiltros(prev=>({ ...prev, sIni: toYMD(startOfLastMonth), sFim: toYMD(endOfLastMonth), cIni:'', cFim:'' }))
    if (period==='last30') { const s = new Date(d); s.setDate(s.getDate()-29); setFiltros(prev=>({ ...prev, sIni: toYMD(s), sFim: toYMD(d), cIni:'', cFim:'' })) }
  },[period])
  const setDesigner = (v) => setFiltros(prev=> ({ ...prev, designer: v==='Todos'?'':v }))
  const list = ['Hoje','Semana','Mês','Mês passado','Últimos 30 dias']
  const keyOf = s => s==='Hoje'?'today': s==='Semana'?'week': s==='Mês'?'month': s==='Mês passado'?'lastmonth':'last30'
  const designersKeys = ['Todos', ...designers]
  const colorOf = (s) => {
    if (s==='Revisar') return 'red'
    if (s==='Aguardando Feedback') return 'purple'
    if (s==='Aprovada' || s==='Concluida') return 'green'
    return ''
  }
  return (
    <div className="filterbar">
      {showSearch!==false && (
        <div className="seg" style={{flex:1, minWidth:220}}>
          <input className="search" placeholder="Pesquisar demandas..." value={filtros.q||''} onChange={e=> setFiltros(prev=> ({ ...prev, q: e.target.value }))} />
        </div>
      )}
      <div className="filters-row">
        <div className="seg">
          <div className="filter-title">Período</div>
          {list.map(lbl=> (
            <button key={lbl} className={`btn-md ${period===keyOf(lbl)?'active':''}`} onClick={()=> setPeriod(keyOf(lbl))}>
              <span className="icon"><Icon name="calendar" /></span><span>{lbl}</span>
            </button>
          ))}
        </div>
        <div className="seg">
          <div className="filter-title">Designer</div>
          {designersKeys.map(d=> (
            <button key={d} className={`btn-md ${((filtros.designer||'')===d || (d==='Todos' && !filtros.designer))?'active':''}`} onClick={()=> setDesigner(d)}>
              <span className="icon"><Icon name="usuarios" /></span><span>{d}</span>
            </button>
          ))}
        </div>
        <div className="seg">
          <div className="filter-title">Status</div>
            {FIXED_STATUS.map(s=> (
              <button key={s} className={`btn-md ${colorOf(s)} ${((filtros.status||'')===s)?'active':''}`} onClick={()=> setFiltros(prev=> ({ ...prev, status: prev.status===s ? undefined : s }))}>
                <span className="icon"><Icon name="dot" /></span><span>{s}</span>{(statusCounts?.[s]>0) ? (<span className="alert-count">{statusCounts[s]}</span>) : null}
              </button>
            ))}
        </div>
        <div className="seg">
          <div className="filter-title">Data</div>
          <div className="date-pill">
            <span className="icon"><Icon name="calendar" /></span>
            <input type="date" value={filtros.cIni||''} onChange={e=> setFiltros(prev=> ({ ...prev, cIni: e.target.value }))} />
            <span style={{color:'var(--muted)'}}>—</span>
            <input type="date" value={filtros.cFim||''} onChange={e=> setFiltros(prev=> ({ ...prev, cFim: e.target.value }))} />
          </div>
        </div>
      </div>
    </div>
  )
}

function DashboardView({ demandas, items, designers, setView, onEdit, onStatus, cadStatus, onDelete, onDuplicate, compact, calRef, setCalRef }) {
  const total = items.length
  const concluidos = items.filter(x=> isDoneStatus(x.status))
  const produTotal = concluidos.length
  const backlog = items.filter(x=> !isDoneStatus(x.status)).length
  const revisoesTot = items.reduce((acc,x)=> acc + (x.revisoes||0), 0)
  const retrabalhoPct = Math.round(100 * (items.filter(x=> (x.revisoes||0)>0).length / Math.max(1,total)))
  const slaGeralPct = (()=>{ const ok = concluidos.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot = concluidos.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const daysInPeriod = (()=>{
    const toD = s=>{ if(!s) return null; const [y,m,dd]=String(s).split('-').map(Number); return new Date(y,m-1,dd) }
    const ds = items.map(x=> toD(x.dataCriacao||x.dataSolicitacao)).filter(Boolean).sort((a,b)=> a-b)
    if (!ds.length) return 0
    const start = ds[0], end = ds[ds.length-1]
    return Math.max(1, Math.round((end - start)/86400000) + 1)
  })()
  const capacityPerDay = 4
  const capacidadeIdealEquipe = designers.length * capacityPerDay * daysInPeriod
  const capacidadeUsadaPct = (()=>{ const ideal=capacidadeIdealEquipe; if(!ideal) return 0; return Math.round(100 * (produTotal/ideal)) })()
  const emProducao = items.filter(x=> isProdStatus(x.status)).length
  const pendentes = items.filter(x=> isPendingStatus(x.status)).length
  const workloadRows = (()=>{
    const per = {}
    concluidos.forEach(x=>{ const d=x.designer||'—'; per[d]=(per[d]||0)+1 })
    const ideal = capacityPerDay * daysInPeriod
    return designers.map(d=>{ const real = per[d]||0; const used = ideal ? Math.round(100*(real/ideal)) : 0; const status = ideal===0 ? 'Verde' : used<=90?'Verde': used<=110?'Amarelo':'Vermelho'; return { designer:d, ideal, real, used, status } })
  })()
  const conclPorDesigner = (()=>{ const m=new Map(); concluidos.forEach(x=> m.set(x.designer||'—',(m.get(x.designer||'—')||0)+1)); return Array.from(m.entries()).map(([designer,qty])=>({designer,qty})) })()
  const tempoEntregaStats = (()=>{
    const diffDays = (a,b)=>{ const toD = s=>{ const [y,m,dd]=String(s).split('-').map(Number); return new Date(y,m-1,dd) }; if(!a||!b) return null; return Math.max(0, Math.round((toD(b)-toD(a))/86400000)) }
    const per = {}
    items.forEach(x=>{ if (x.dataConclusao) { const d=x.designer||'—'; const t=diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao); if (t!=null) { const cur=per[d]||{cnt:0,sum:0,min:9999,max:0}; per[d]={ cnt:cur.cnt+1, sum:cur.sum+t, min:Math.min(cur.min,t), max:Math.max(cur.max,t) } } } })
    return Object.entries(per).map(([designer,v])=> ({ designer, media: (v.sum/v.cnt)||0 }))
  })()
  const slaStats = (()=>{ const per={}; items.forEach(x=>{ if (x.prazo && x.dataConclusao) { const d=x.designer||'—'; const ok=x.dataConclusao<=x.prazo; const cur=per[d]||{ok:0,total:0}; per[d]={ ok:cur.ok+(ok?1:0), total:cur.total+1 } } }); return Object.entries(per).map(([designer,v])=> ({ designer, pct: Math.round(100*((v.ok/(v.total||1)))) })) })()
  const revisoesStats = (()=>{ const per={}; items.forEach(x=>{ const d=x.designer||'—'; const r=x.revisoes||0; const cur=per[d]||{ rTot:0, cnt:0 }; per[d]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([designer,v])=> ({ designer, porPeca: +(v.rTot/(v.cnt||1)).toFixed(2) })) })()
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
    const list = names.map(n=>{ const sProd=norm(prod[n]||0,minProd,maxProd); const sSla=norm(slaM[n]||0,minSla,maxSla); const sTempoInv=1-norm(tempoM[n]||0,minTempo,maxTempo); const sRevInv=1-norm(revM[n]||0,minRev,maxRev); const score=Math.round(((sProd*0.4)+(sSla*0.3)+(sTempoInv*0.2)+(sRevInv*0.1))*100); return { designer:n, score, sla:slaM[n]||0, retrab: revM[n]||0 } }).sort((a,b)=> b.score-a.score)
    return list.slice(0,5)
  })()
  const heatmapHoras = (()=>{
    const horas = Array.from({length:11},(_,i)=> i+8)
    const per = {}
    designers.forEach(d=> per[d]=horas.map(_=>0))
    items.forEach(x=>{ if (x.startedAt) { try{ const dt=new Date(x.startedAt); const h=dt.getHours(); if(h>=8 && h<=18){ const d=x.designer||'—'; const idx=h-8; if(per[d]) per[d][idx]++ } }catch{} } })
    return { horas, per }
  })()
  return (
    <div className="dashboard">
      <div className="exec-summary">
        <div className="exec-title">RESUMO EXECUTIVO DO PERÍODO</div>
        <div className="exec-grid">
          <div className="exec-metric"><div className="exec-label">Produção total</div><div className="exec-value">{produTotal}</div></div>
          <div className="exec-metric"><div className="exec-label">SLA geral</div><div className="exec-value" style={{color: slaGeralPct>=90?'#BCD200': slaGeralPct>=70?'#FFE55C':'#FF5E5E'}}>{slaGeralPct}%</div></div>
          <div className="exec-metric"><div className="exec-label">% retrabalho</div><div className="exec-value">{retrabalhoPct}%</div></div>
          <div className="exec-metric"><div className="exec-label">Backlog atual</div><div className="exec-value">{backlog}</div></div>
          <div className="exec-metric"><div className="exec-label">Capacidade usada</div><div className="exec-value">{capacidadeUsadaPct}%</div><div className="progress"><div className="progress-fill" style={{width:`${capacidadeUsadaPct}%`, background:'#BCD200'}} /></div></div>
        </div>
      </div>
      <div className="section-grid">
        <div className="section-card">
          <div className="widget-title">PRODUÇÃO</div>
          <div className="badge-grid">
            <div className="badge blue"><div>Criadas</div><div>{total}</div></div>
            <div className="badge green"><div>Concluídas</div><div>{produTotal}</div></div>
            <div className="badge yellow"><div>Em produção</div><div>{emProducao}</div></div>
            <div className="badge"><div>Pendentes</div><div>{pendentes}</div></div>
          </div>
        </div>
        <div className="section-card">
          <div className="widget-title">QUALIDADE</div>
          <div className="badge-group">
            <div className="badge purple"><div>Revisões</div><div>{revisoesTot}</div></div>
            <div className="badge"><div>% Retrabalho</div><div>{retrabalhoPct}%</div></div>
            <div className="badge green"><div>SLA</div><div>{slaGeralPct}%</div></div>
          </div>
        </div>
        <div className="section-card">
          <div className="widget-title">PESSOAS</div>
          <table className="report-matrix">
            <thead><tr><th>#</th><th>Designer</th><th>Score</th><th>SLA%</th><th>%Retrab</th></tr></thead>
            <tbody>
              {ranking.map((r,i)=> (<tr key={r.designer}><td>{i+1}</td><td>{r.designer}</td><td>{r.score}</td><td>{r.sla}%</td><td>{Math.round((r.retrab||0)*100)/100}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="section-card">
          <div className="widget-title">OPERAÇÃO</div>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Designer</th><th>Capacidade ideal</th><th>Produção real</th><th>Capacidade usada</th><th>Status</th></tr></thead>
            <tbody>
              {workloadRows.map(r=> (<tr key={r.designer}><td>{r.designer}</td><td>{r.ideal}</td><td>{r.real}</td><td>{r.used}%</td><td style={{color:r.status==='Verde'?'#00C58E': r.status==='Amarelo'?'#FFE55C':'#FF5E5E'}}>{r.status}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="section-grid">
        <div className="section-card">
          <div className="widget-title">HEATMAP DE PRODUTIVIDADE POR HORÁRIO</div>
          <div className="heatmap">
            <div className="heat-row" style={{gap:6,color:'var(--muted)'}}>
              <div className="chart-label" style={{width:120}} />
              {heatmapHoras.horas.map(h=> (<div key={h} style={{width:24,textAlign:'center'}}>{String(h).padStart(2,'0')}h</div>))}
            </div>
            {designers.map(d=> (
              <div key={d} className="heat-row" style={{alignItems:'center'}}>
                <div className="chart-label" style={{width:120}}>{d}</div>
                {heatmapHoras.horas.map((h,idx)=> { const v=(heatmapHoras.per[d]||[])[idx]||0; const color=v===0?'#222': v<2?'#4DA3FF33':'#4DA3FF'; return (<div key={h} className="heat-cell" style={{background:color,width:24,height:24}} title={`${d} ${String(h).padStart(2,'0')}h: ${v}`} />) })}
              </div>
            ))}
          </div>
        </div>
        <div className="section-card">
          <div className="widget-title">LINHA DO TEMPO DE PRODUÇÃO MENSAL</div>
          <div className="chips">
            {conclPorDesigner.map(({designer,qty})=> (
              <div key={designer} style={{display:'inline-flex',alignItems:'center',gap:6}}><span className="chip">{designer}</span><Sparkline series={[Math.max(1,qty-1), qty, qty+1]} color="#4DA3FF" /></div>
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
  const [desA, setDesA] = useState(designers[0]||'')
  const [desB, setDesB] = useState(designers[1]||'')
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
  const tiposKeys = ['Todos', ...Array.from(new Set(demandas.map(x=>x.tipoMidia).filter(Boolean)))]
  const setTipo = (v) => setFiltros(prev=> ({ ...prev, tipoMidia: v==='Todos'?'':v }))
  const canaisKeys = ['Todos', ...ORIGENS]
  const setCanal = (v) => setFiltros(prev=> ({ ...prev, origem: v==='Todos'?'':v }))
  const campanhasKeys = ['Todos', ...Array.from(new Set(demandas.map(x=>x.campanha).filter(Boolean)))]
  const setCampanha = (v) => setFiltros(prev=> ({ ...prev, campanha: v==='Todos'?'':v }))
  const statusKeys = ['Todos', ...FIXED_STATUS]
  const setStatus = (v) => setFiltros(prev=> ({ ...prev, status: v==='Todos'?'':v }))
  const daysInPeriod = (()=>{
    const toD = s=>{ if(!s) return null; const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd) }
    const s = toD(filtros.cIni), e = toD(filtros.cFim)
    if (!s || !e) return 1
    return Math.max(1, Math.round((e - s)/86400000) + 1)
  })()
  const concluidos = items.filter(x=> isDoneStatus(x.status))
  const pendentes = items.filter(x=> isPendingStatus(x.status))
  const emProducao = items.filter(x=> isProdStatus(x.status))
  const revisoesTot = items.reduce((acc,x)=> acc + (x.revisoes||0), 0)
  const produtividadeMedia = concluidos.length / daysInPeriod
  const backlogItems = items.filter(x=> !isDoneStatus(x.status))
  const diasRestantes = (p)=>{ if(!p) return null; const [y,m,d]=String(p).split('-').map(Number); const end=new Date(y,(m||1)-1,(d||1)); const start=new Date(); start.setHours(0,0,0,0); end.setHours(0,0,0,0); return Math.round((end - start)/86400000) }
  const backlogRisco = backlogItems.filter(x=> { const dl=diasRestantes(x.prazo); return dl!=null && dl<=2 })
  const prazoMedioBacklog = (()=>{ const arr=backlogItems.map(x=> diasRestantes(x.prazo)).filter(v=> v!=null); const avg = (arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return +avg.toFixed(1) })()
  const atrasoPct = (()=>{ const overdue = backlogItems.filter(x=> { const dl=diasRestantes(x.prazo); return dl!=null && dl<0 }).length; const total=backlogItems.length||1; return Math.round(100*(overdue/total)) })()
  const estadoBacklog = atrasoPct>30 ? 'Acumulando atraso' : 'Saudável'
  const diffDays = (a,b)=>{ const toD = s=>{ const [y,m,dd]=String(s).split('-').map(Number); return new Date(y,m-1,dd) }; if(!a||!b) return null; return Math.max(0, Math.round((toD(b)-toD(a))/86400000)) }
  const leadTimes = concluidos.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null)
  const leadTimeMedio = +((leadTimes.reduce((a,b)=>a+b,0)/(leadTimes.length||1)).toFixed(1))
  const leadPorTipo = (()=>{ const per={}; concluidos.forEach(x=>{ const t=x.tipoMidia||'Outro'; const lt=diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao); if(lt!=null){ const cur=per[t]||{cnt:0,sum:0}; per[t]={ cnt:cur.cnt+1, sum:cur.sum+lt } } }); return Object.entries(per).map(([tipo,v])=> ({ tipo, media:+((v.sum/v.cnt).toFixed(1)) })) })()
  const leadPorDesigner = (()=>{ const per={}; concluidos.forEach(x=>{ const d=x.designer||'—'; const lt=diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao); if(lt!=null){ const cur=per[d]||{cnt:0,sum:0}; per[d]={ cnt:cur.cnt+1, sum:cur.sum+lt } } }); return Object.entries(per).map(([designer,v])=> ({ designer, media:+((v.sum/v.cnt).toFixed(1)) })) })()
  const mesAtual = new Date(); const mesPassado = new Date(mesAtual.getFullYear(), mesAtual.getMonth()-1, 1)
  const inMonth = (iso, m)=>{ if(!iso) return false; const [y,mm,dd]=iso.split('-').map(Number); const dt=new Date(y,mm-1,dd); return dt.getMonth()===m.getMonth() && dt.getFullYear()===m.getFullYear() }
  const ltMesAtual = concluidos.filter(x=> inMonth(x.dataConclusao, mesAtual)).map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null)
  const ltMesPassado = concluidos.filter(x=> inMonth(x.dataConclusao, mesPassado)).map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null)
  const compMesAtual = +((ltMesAtual.reduce((a,b)=>a+b,0)/(ltMesAtual.length||1)).toFixed(1))
  const compMesPassado = +((ltMesPassado.reduce((a,b)=>a+b,0)/(ltMesPassado.length||1)).toFixed(1))
  const ltDesigner = (name)=>{ const arr=concluidos.filter(x=> (x.designer||'')===name).map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); return +((arr.reduce((a,b)=>a+b,0)/(arr.length||1)).toFixed(1)) }
  const revDistrib = (()=>{ const arr=concluidos.map(x=> x.revisoes||0); const tot=arr.length||1; const z=(n)=> Math.round(100*((arr.filter(v=> v===n).length)/tot)); const g=(pred)=> Math.round(100*((arr.filter(pred).length)/tot)); return { sRev:z(0), umaRev:z(1), duasMais:g(v=> v>=2) } })()
  const retrabalhoPorDesigner = (()=>{ const per={}; items.forEach(x=>{ const d=x.designer||'—'; const r=x.revisoes||0; const cur=per[d]||{ rTot:0, cnt:0 }; per[d]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([designer,v])=> ({ designer, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const retrabalhoPorTipo = (()=>{ const per={}; items.forEach(x=>{ const t=x.tipoMidia||'Outro'; const r=x.revisoes||0; const cur=per[t]||{ rTot:0, cnt:0 }; per[t]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([tipo,v])=> ({ tipo, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const porCanal = (()=>{ const per={}; items.forEach(x=>{ const o=x.origem||'Outros'; per[o]=(per[o]||0)+1 }); const total=items.length||1; return Object.entries(per).map(([origem,q])=> ({ origem, q, pct: Math.round(100*(q/total)) })) })()
  const retrabPorCanal = (()=>{ const per={}; items.forEach(x=>{ const o=x.origem||'Outros'; const r=x.revisoes||0; const cur=per[o]||{ rTot:0, cnt:0 }; per[o]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([origem,v])=> ({ origem, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const prodPorCanal = (()=>{ const per={}; concluidos.forEach(x=>{ const o=x.origem||'Outros'; per[o]=(per[o]||0)+1 }); return Object.entries(per).map(([origem,q])=> ({ origem, q })).sort((a,b)=> b.q-a.q) })()
  const porHora = (()=>{ const per={}; concluidos.forEach(x=>{ const iso=x.finishedAt; if(!iso) return; const h=new Date(iso).getHours(); per[h]=(per[h]||0)+1 }); return per })()
  const tempoMedioReal = (()=>{ const arr=concluidos.map(x=> Number(x.tempoProducaoMs||0)).filter(v=> v>0); const avgMs=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); const toH=(ms)=> (ms/3600000); return +(toH(avgMs).toFixed(2)) })()
  const velocidadeRanking = (()=>{ const per={}; concluidos.forEach(x=>{ const d=x.designer||'—'; const ms=Number(x.tempoProducaoMs||0); const cur=per[d]||{ cnt:0, sum:0 }; per[d]={ cnt:cur.cnt+1, sum:cur.sum+ms } }); return Object.entries(per).map(([designer,v])=> ({ designer, horas: +((v.sum/(v.cnt||1)/3600000).toFixed(2)) })).sort((a,b)=> a.horas-b.horas) })()
  const qualidadeRanking = retrabalhoPorDesigner.slice().sort((a,b)=> a.porPeca-b.porPeca)
  const porCampanha = (()=>{ const per={}; items.forEach(x=>{ const c=x.campanha||'—'; per[c]=(per[c]||0)+1 }); return Object.entries(per).map(([campanha,q])=> ({ campanha, q })).sort((a,b)=> b.q-a.q) })()
  const retrabCampanha = (()=>{ const per={}; items.forEach(x=>{ const c=x.campanha||'—'; const r=x.revisoes||0; const cur=per[c]||{ rTot:0, cnt:0 }; per[c]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([campanha,v])=> ({ campanha, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const slaCampanha = (()=>{ const per={}; items.forEach(x=>{ if (x.campanha) { const c=x.campanha; const ok=!!(x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo); const tot=!!(x.prazo && x.dataConclusao); const cur=per[c]||{ ok:0, total:0 }; per[c]={ ok:cur.ok+(ok?1:0), total:cur.total+(tot?1:0) } } }); return Object.entries(per).map(([campanha,v])=> ({ campanha, sla: Math.round(100*((v.ok/(v.total||1)))) })) })()
  return (
    <div className="reports">
      <div className="reports-toolbar">
        <div className="chips">
          {periodLabel.map(lbl=> (
            <button key={lbl} className={`btn-md ${period===keyOf(lbl)?'active':''}`} onClick={()=> setPeriod(keyOf(lbl))}><span className="icon"><Icon name="calendar" /></span><span>{lbl}</span></button>
          ))}
          <div className="date-pill">
            <span className="icon"><Icon name="calendar" /></span>
            <input type="date" value={filtros.cIni||''} onChange={e=> setFiltros(prev=> ({ ...prev, cIni: e.target.value }))} />
            <span style={{color:'var(--muted)'}}>—</span>
            <input type="date" value={filtros.cFim||''} onChange={e=> setFiltros(prev=> ({ ...prev, cFim: e.target.value }))} />
          </div>
        </div>
        <div className="chips">
          {designersKeys.map(d=> (
            <button key={d} className={`btn-md ${((filtros.designer||'')===d || (d==='Todos' && !filtros.designer))?'active':''}`} onClick={()=> setDesigner(d)}><span className="icon"><Icon name="usuarios" /></span><span>{d}</span></button>
          ))}
          {tiposKeys.map(t=> (
            <button key={t} className={`btn-md ${((filtros.tipoMidia||'')===t || (t==='Todos' && !filtros.tipoMidia))?'active':''}`} onClick={()=> setTipo(t)}><span className="icon"><Icon name="tag" /></span><span>{t}</span></button>
          ))}
          {canaisKeys.map(c=> (
            <button key={c} className={`btn-md ${((filtros.origem||'')===c || (c==='Todos' && !filtros.origem))?'active':''}`} onClick={()=> setCanal(c)}><span className="icon"><Icon name="link" /></span><span>{c}</span></button>
          ))}
          {campanhasKeys.map(c=> (
            <button key={c} className={`btn-md ${((filtros.campanha||'')===c || (c==='Todos' && !filtros.campanha))?'active':''}`} onClick={()=> setCampanha(c)}><span className="icon"><Icon name="tag" /></span><span>{c}</span></button>
          ))}
          {statusKeys.map(s=> (
            <button key={s} className={`btn-md ${((filtros.status||'')===s || (s==='Todos' && !filtros.status))?'active':''}`} onClick={()=> setStatus(s)}><span className="icon"><Icon name="dot" /></span><span>{s}</span></button>
          ))}
        </div>
      </div>
      <div className="reports-grid">
        <div className="report-card">
          <div className="report-title">Relatório de Backlog</div>
          <div className="chips">
            <span className="chip">Backlog total: {backlogItems.length}</span>
            <span className="chip">Em risco (≤48h): {backlogRisco.length}</span>
            <span className="chip">Prazo médio: {prazoMedioBacklog}d</span>
            <span className="chip">Estado: {estadoBacklog}</span>
          </div>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Tipo</th><th>Qtd</th></tr></thead>
            <tbody>
              {Object.entries(backlogItems.reduce((m,x)=>{ const t=x.tipoMidia||'Outro'; m[t]=(m[t]||0)+1; return m },{})).map(([tipo,q])=> (<tr key={tipo}><td>{tipo}</td><td>{q}</td></tr>))}
            </tbody>
          </table>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Designer</th><th>Qtd</th></tr></thead>
            <tbody>
              {Object.entries(backlogItems.reduce((m,x)=>{ const d=x.designer||'—'; m[d]=(m[d]||0)+1; return m },{})).map(([designer,q])=> (<tr key={designer}><td>{designer}</td><td>{q}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Relatório de Lead Time</div>
          <div className="chips">
            <span className="chip">Médio geral: {leadTimeMedio}d</span>
            <span className="chip">Este mês: {compMesAtual}d</span>
            <span className="chip">Mês passado: {compMesPassado}d</span>
          </div>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Tipo</th><th>Lead Time médio</th></tr></thead>
            <tbody>
              {leadPorTipo.map(r=> (<tr key={r.tipo}><td>{r.tipo}</td><td>{r.media}d</td></tr>))}
            </tbody>
          </table>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Designer</th><th>Lead Time médio</th></tr></thead>
            <tbody>
              {leadPorDesigner.map(r=> (<tr key={r.designer}><td>{r.designer}</td><td>{r.media}d</td></tr>))}
            </tbody>
          </table>
          <div className="section-divider" />
          <div className="chips">
            <span className="chip">Designer A</span>
            <select value={desA} onChange={e=> setDesA(e.target.value)}>{designers.map(d=> <option key={d} value={d}>{d}</option>)}</select>
            <span className="chip">Designer B</span>
            <select value={desB} onChange={e=> setDesB(e.target.value)}>{designers.map(d=> <option key={d} value={d}>{d}</option>)}</select>
            <span className="chip">A: {ltDesigner(desA)}d</span>
            <span className="chip">B: {ltDesigner(desB)}d</span>
          </div>
        </div>
        <div className="report-card">
          <div className="report-title">Eficiência e Retrabalho</div>
          <div className="chips">
            <span className="chip">Sem revisão: {revDistrib.sRev}%</span>
            <span className="chip">1 revisão: {revDistrib.umaRev}%</span>
            <span className="chip">2+ revisões: {revDistrib.duasMais}%</span>
          </div>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Designer</th><th>Revisões/peça</th></tr></thead>
            <tbody>
              {retrabalhoPorDesigner.map(r=> (<tr key={r.designer}><td>{r.designer}</td><td>{r.porPeca}</td></tr>))}
            </tbody>
          </table>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Tipo</th><th>Revisões/peça</th></tr></thead>
            <tbody>
              {retrabalhoPorTipo.map(r=> (<tr key={r.tipo}><td>{r.tipo}</td><td>{r.porPeca}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Demanda por Canal</div>
          <div className="chips">
            {porCanal.map(c=> (<span key={c.origem} className="chip">{c.origem}: {c.pct}%</span>))}
          </div>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Canal</th><th>Revisões/peça</th></tr></thead>
            <tbody>
              {retrabPorCanal.map(c=> (<tr key={c.origem}><td>{c.origem}</td><td>{c.porPeca}</td></tr>))}
            </tbody>
          </table>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Canal</th><th>Concluídas</th></tr></thead>
            <tbody>
              {prodPorCanal.map(c=> (<tr key={c.origem}><td>{c.origem}</td><td>{c.q}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Produtividade por Hora (Avançado)</div>
          <div className="chips">
            <span className="chip">Tempo médio real/peça: {tempoMedioReal}h</span>
          </div>
          <div className="section-divider" />
          <div className="heatmap">
            <div className="heat-row" style={{gap:6,color:'var(--muted)'}}>
              {Array.from({length:11},(_,i)=> i+8).map(h=> (<div key={h} style={{width:24,textAlign:'center'}}>{String(h).padStart(2,'0')}h</div>))}
            </div>
            <div className="heat-row">
              {Array.from({length:11},(_,i)=> i+8).map(h=> { const v=porHora[h]||0; const color=v===0?'#222': v<2?'#00C58E33':'#00C58E'; return (<div key={h} className="heat-cell" style={{background:color}} title={`${String(h).padStart(2,'0')}h: ${v}`} />) })}
            </div>
          </div>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>#</th><th>Designer</th><th>Velocidade média (h)</th></tr></thead>
            <tbody>
              {velocidadeRanking.map((r,i)=> (<tr key={r.designer}><td>{i+1}</td><td>{r.designer}</td><td>{r.horas}</td></tr>))}
            </tbody>
          </table>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>#</th><th>Designer</th><th>Qualidade (menos retrabalho)</th></tr></thead>
            <tbody>
              {qualidadeRanking.map((r,i)=> (<tr key={r.designer}><td>{i+1}</td><td>{r.designer}</td><td>{r.porPeca}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="report-card">
          <div className="report-title">Relatório de Campanhas</div>
          <div className="chips">
            <span className="chip">Mais demandada: {porCampanha[0]?.campanha||'—'}</span>
            <span className="chip">Maior retrabalho: {retrabCampanha[0]?.campanha||'—'}</span>
            <span className="chip">Melhor SLA: {slaCampanha.sort((a,b)=> b.sla-a.sla)[0]?.campanha||'—'}</span>
          </div>
          <div className="section-divider" />
          <table className="report-matrix">
            <thead><tr><th>Campanha</th><th>Produção (concluídas)</th><th>SLA%</th><th>Retrabalho/peça</th></tr></thead>
            <tbody>
              {Array.from(new Set(items.map(x=> x.campanha).filter(Boolean))).map(c=> { const prod=concluidos.filter(x=> x.campanha===c).length; const sla=slaCampanha.find(x=> x.campanha===c)?.sla||0; const ret=retrabCampanha.find(x=> x.campanha===c)?.porPeca||0; return (<tr key={c}><td>{c}</td><td>{prod}</td><td style={{color:sla>=90?'#BCD200': sla>=70?'#FFE55C':'#FF5E5E'}}>{sla}%</td><td>{ret}</td></tr>) })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
