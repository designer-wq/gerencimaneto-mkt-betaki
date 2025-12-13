import React, { useEffect, useMemo, useState, useRef } from 'react'
import { db, isFirebaseEnabled, auth, firebaseApp } from './firebase'
import { collection, addDoc, serverTimestamp, getDocs, deleteDoc, doc, updateDoc, setDoc, getDoc, query, where, onSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable, httpsCallableFromURL } from 'firebase/functions'
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'

const ESTADOS = ["Aberta", "Em Progresso", "Concluída"]
const FIXED_STATUS = ["Pendente","Em produção","Aguardando Feedback","Aprovada","Revisar","Concluida"]
const ORIGENS = ["Instagram","Tráfego Pago","CRM","Influencers","Site","Branding","Outros"]
const DEM_COL = 'demandas_v2'
const statusLabel = s => s === "Aberta" ? "Aberta" : s === "Em Progresso" ? "Em Progresso" : s === "Concluída" ? "Concluída" : s
const statusWithDot = s => statusLabel(s)
const statusClass = s => {
  const v = (s||'').toLowerCase()
  if (v.includes('pendente') || v.includes('aberta')) return 'st-pending'
  if (v.includes('progresso') || v.includes('produção')) return 'st-progress'
  if (v.includes('feedback')) return 'st-feedback'
  if (v.includes('revisar')) return 'st-review'
  if (v.includes('aprov')) return 'st-approved'
  if (v.includes('conclu')) return 'st-concluded'
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
const extractMentions = (texto) => {
  const m = String(texto||'').match(/@([a-zA-Z0-9_]+)/g)
  return m ? m.map(x=> x.slice(1)) : []
}
const formatMinutes = (mins) => {
  if (mins==null) return ''
  const m = Math.max(0, Math.round(mins))
  const h = Math.floor(m/60)
  const mm = m%60
  return h>0 ? `${h}h ${mm}m` : `${mm}m`
}
const calcPrevisaoIA = (allItems, it) => {
  const concluidos = allItems.filter(x=> (String(x.status||'').toLowerCase().includes('conclu')) || x.status==='Concluída')
  const byDesigner = concluidos.filter(x=> (x.designer||'')===(it.designer||''))
  const byTipo = concluidos.filter(x=> (x.tipoMidia||'')===(it.tipoMidia||''))
  const byCanal = concluidos.filter(x=> (x.origem||'')===(it.origem||''))
  const byPlataforma = concluidos.filter(x=> (x.plataforma||'')===(it.plataforma||''))
  const diffDays = (a,b)=>{ const toD = s=>{ const [y,m,dd]=String(s||'').split('-').map(Number); if(!y) return null; return new Date(y,m-1,dd) }; const da=toD(a), db=toD(b); if(!da||!db) return null; return Math.max(0, Math.round((db-da)/86400000)) }
  const leadGeral = (()=>{ const arr=concluidos.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return Math.max(1, Math.round(avg)) })()
  const leadDesigner = (()=>{ const arr=byDesigner.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return arr.length? Math.max(1, Math.round(avg)) : null })()
  const leadTipo = (()=>{ const arr=byTipo.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return arr.length? Math.max(1, Math.round(avg)) : null })()
  const leadCanal = (()=>{ const arr=byCanal.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return arr.length? Math.max(1, Math.round(avg)) : null })()
  const leadPlataforma = (()=>{ const arr=byPlataforma.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return arr.length? Math.max(1, Math.round(avg)) : null })()
  const revisoesMed = (()=>{ const arr=byDesigner.map(x=> x.revisoes||0); const avg=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return Math.round(avg) })()
  const ativosDoDesigner = allItems.filter(x=> (x.designer||'')===(it.designer||'') && !(/conclu/i.test(String(x.status||'')))).length
  const capacidadeTeoricaDia = 4
  const cargaPct = Math.min(100, Math.round((ativosDoDesigner/capacidadeTeoricaDia)*100))
  const base = leadDesigner ?? leadTipo ?? leadPlataforma ?? leadCanal ?? leadGeral
  const ajuste = (cargaPct>=80?1:0) + (revisoesMed>=2?1:0)
  const estim = Math.max(1, base + ajuste)
  const frases = []
  frases.push(`Estimativa: ${estim} dia${estim>1?'s':''} úteis`)
  if (cargaPct>=80) frases.push('Alta probabilidade de atraso devido à carga acima de 80%')
  if (estim===1) frases.push('Peça deve ser concluída ainda hoje • Hoje até às 17h')
  if (revisoesMed>=2) frases.push('Revisões esperadas acima da média para este designer')
  return frases.join(' • ')
}
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
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' })
    return fmt.format(new Date())
  } catch {
    const d = new Date(); const z = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`
  }
}
/* Listas locais de demandas removidas: carregadas via Firestore */
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

function Sparkline({ series, color='#BCD200', avg=null, meta=null, labels=null }) {
  const w = 120, h = 30
  const max = Math.max(...series, 1)
  const step = series.length > 1 ? w/(series.length-1) : w
  const pts = series.map((v,i)=> ({ x:i*step, y: h - (v/max)*h }))
  const points = pts.map(p=> `${p.x},${p.y}`).join(' ')
  const avgVal = avg!=null ? avg : Math.round(series.reduce((a,b)=> a+b, 0)/(series.length||1))
  const avgY = h - (avgVal/Math.max(max,1))*h
  const maxIdx = series.indexOf(Math.max(...series))
  const minIdx = series.indexOf(Math.min(...series))
  return (
    <svg width={w} height={h} className="sparkline" viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id="sgArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#sgArea)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
      <line x1="0" y1={avgY} x2={w} y2={avgY} stroke={color} strokeOpacity="0.35" strokeDasharray="3 3" strokeWidth="1.5" />
      {meta!=null && (
        <line x1="0" y1={h - (meta/Math.max(max,1))*h} x2={w} y2={h - (meta/Math.max(max,1))*h} stroke="#888" strokeOpacity="0.5" strokeDasharray="2 2" strokeWidth="1" />
      )}
      {pts.map((p,i)=> (
        <circle key={i} cx={p.x} cy={p.y} r={(i===maxIdx||i===minIdx)?3.5:2.5} fill={color}>
          <title>{labels? labels[i] : `Valor: ${series[i]}`}</title>
        </circle>
      ))}
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
  if (name==='alert') return (<svg {...s}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>)
  if (name==='trash') return (<svg {...s}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><rect x="5" y="6" width="14" height="14" rx="2"/></svg>)
  if (name==='logout') return (<svg {...s}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>)
  if (name==='link') return (<svg {...s}><path d="M10 13a5 5 0 0 0 7.07 0l3.54-3.54a5 5 0 1 0-7.07-7.07L10 4"/><path d="M14 11a5 5 0 0 1-7.07 0L3.39 7.46a5 5 0 1 1 7.07-7.07L14 4"/></svg>)
  if (name==='tag') return (<svg {...s}><path d="M20 10V4H14L4 14l6 6 10-10Z"/><circle cx="16.5" cy="7.5" r="1.5"/></svg>)
  if (name==='edit') return (<svg {...s}><path d="M4 13v4h4"/><path d="M14.5 3.5l6 6"/><path d="M12 6l6 6L9 21H4v-5z"/></svg>)
  if (name==='minus') return (<svg {...s}><path d="M5 12h14"/></svg>)
  return null
}

function Header({ onNew, view, setView, showNew, user, onLogout, mentions, onOpenDemanda }) {
  const [notifOpen, setNotifOpen] = useState(false)
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="team">Equipe de Marketing</div>
      </div>
      <div className="topbar-right">
        {user ? (
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span className="chip">{user.name||user.username}</span>
            <button className="icon notif-btn" onClick={()=> setNotifOpen(o=> !o)} title="Menções">
              <span className="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2Z"/><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z"/></svg></span>
              {Array.isArray(mentions) && mentions.length>0 ? (<span className="notif-dot">{mentions.length}</span>) : null}
            </button>
            {notifOpen ? (
              <div className="notif-dropdown" onMouseLeave={()=> setNotifOpen(false)}>
                {(mentions||[]).slice(0,6).map(m=> (
                  <button key={`${m.id}-${m.quando||''}`} className="notif-item" type="button" onClick={()=>{ onOpenDemanda && onOpenDemanda(m.id); setNotifOpen(false) }}>
                    <span className="title">{m.titulo}</span>
                    <span className="msg">{m.msg}</span>
                  </button>
                ))}
                {(!mentions || mentions.length===0) ? (<div className="notif-empty">Sem menções</div>) : null}
              </div>
            ) : null}
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
      <button className={`tab-btn ${view==='calendar'?'active':''}`} onClick={()=>setView('calendar')}><span className="icon"><Icon name="calendar" /></span><span>Calendar</span></button>
    </div>
  )
}

function LoginView({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e)=>{ e.preventDefault(); if (loading) return; setError(''); setLoading(true); try { await onLogin(username, password) } catch (err) { const code=String(err?.code||''); const msg = code==='auth/operation-not-allowed' ? 'Domínio não autorizado no Firebase Auth. Adicione o domínio do site nas configurações.' : (err && (err.code || err.message)) || 'Falha ao entrar'; setError(String(msg)) } finally { setLoading(false) } }
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

function FilterModal({ open, filtros, setFiltros, designers, onClose, cadStatus, cadTipos, origens, campanhas }) {
  const set = (k,v)=>setFiltros(prev=>({ ...prev, [k]: v }))
  const clear = ()=>setFiltros({designer:'',status:'',cIni:'',cFim:'',sIni:'',sFim:''})
  if (!open) return null
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-dialog" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div className="title"><span className="icon"><Icon name="filter" /></span><span>Filtros</span></div>
          <button className="icon" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="report-card">
          <div className="report-title">Comparativo Mensal</div>
          <div className="chips"><span className="chip">Produção</span></div>
          {(()=>{ const prodA = concluidos.filter(x=> inMonth(x.dataConclusao, mesAtual)).length; const prodB = concluidos.filter(x=> inMonth(x.dataConclusao, mesPassado)).length; const max = Math.max(prodA, prodB, 1); const w=220; const h=80; const bar = (v,c)=> (<rect x={c} y={h - (v/max)*h} width="40" height={(v/max)*h} rx="6" />); return (
            <svg width={w} height={h} className="bar-compare">
              <g fill="#BCD200">{bar(prodA, 40)}</g>
              <g fill="#4DA3FF">{bar(prodB, 140)}</g>
            </svg>
          ) })()}
          <div className="chips"><span className="chip">Qualidade (retrabalho)</span></div>
          {(()=>{ const arrA = concluidos.filter(x=> inMonth(x.dataConclusao, mesAtual)).map(x=> x.revisoes||0); const arrB = concluidos.filter(x=> inMonth(x.dataConclusao, mesPassado)).map(x=> x.revisoes||0); const qa = +(arrA.reduce((a,b)=>a+b,0)/(arrA.length||1)).toFixed(2); const qb = +(arrB.reduce((a,b)=>a+b,0)/(arrB.length||1)).toFixed(2); const max = Math.max(qa, qb, 1); const w=220; const h=80; const bar = (v,c)=> (<rect x={c} y={h - (v/max)*h} width="40" height={(v/max)*h} rx="6" />); return (
            <svg width={w} height={h} className="bar-compare">
              <g fill="#BCD200">{bar(qa, 40)}</g>
              <g fill="#FF5E5E">{bar(qb, 140)}</g>
            </svg>
          ) })()}
          <div className="chips"><span className="chip">Lead-time</span></div>
          {(()=>{ const a=compMesAtual, b=compMesPassado; const max=Math.max(a,b,1); const w=220; const h=80; const bar = (v,c)=> (<rect x={c} y={h - (v/max)*h} width="40" height={(v/max)*h} rx="6" />); return (
            <svg width={w} height={h} className="bar-compare">
              <g fill="#BCD200">{bar(a, 40)}</g>
              <g fill="#9B59B6">{bar(b, 140)}</g>
            </svg>
          ) })()}
        </div>
        <div className="report-card">
          <div className="report-title">Insights Automáticos</div>
          <div className="insights-grid">
            {(()=>{ const bestSla = (()=>{ const per={}; concluidos.forEach(x=>{ const d=x.designer||'—'; const ok=x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo; const tot=x.prazo && x.dataConclusao; const cur=per[d]||{ok:0,total:0}; per[d]={ ok:cur.ok+(ok?1:0), total:cur.total+(tot?1:0) } }); const arr=Object.entries(per).map(([designer,v])=> ({designer, pct: Math.round(100*((v.ok/(v.total||1)))) })); return arr.sort((a,b)=> b.pct-a.pct)[0] })(); const canalMais = (()=>{ const m={}; items.forEach(x=>{ const o=x.origem||'Outros'; m[o]=(m[o]||0)+1 }); const arr=Object.entries(m).map(([origem,q])=>({origem,q})).sort((a,b)=> b.q-a.q); return arr[0] })(); const semRetrab = concluidos.filter(x=> (x.revisoes||0)===0).length===concluidos.length; const ltMelhorou = compMesAtual<=compMesPassado; const retrabStories = (()=>{ const arr=concluidos.filter(x=> /stor/i.test(String(x.tipoMidia||''))); const avg=+(arr.reduce((a,b)=> a+(b.revisoes||0),0)/(arr.length||1)).toFixed(2); return { qtd: arr.length, avg } })(); const msgs = []; if (bestSla) msgs.push(`O designer ${bestSla.designer} teve o melhor SLA do mês (${bestSla.pct}%)`); if (canalMais) msgs.push(`${canalMais.origem} foi o canal mais solicitado`); if (semRetrab) msgs.push('Nenhuma demanda apresentou retrabalho neste mês'); if (ltMelhorou) msgs.push('Seu lead-time melhorou em relação ao mês anterior'); if (retrabStories.qtd>0) msgs.push('A categoria Stories teve o maior retrabalho do mês'); return msgs })().map((t,i)=> (
              <div key={i} className="insight-card"><div className="insight-ico">★</div><div className="insight-text">{t}</div></div>
            ))}
          </div>
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
  const low = s=> String(s||'').toLowerCase()
  const matchesStatus = (itemStatus, filterStatus)=>{
    if (!filterStatus) return true
    const fs = String(filterStatus)
    if (fs==='Pendente') return isPendingStatus(itemStatus)
    if (fs==='Em produção') return isProdStatus(itemStatus)
    if (fs==='Aguardando Feedback') return low(itemStatus).includes('feedback')
    if (fs==='Revisar') return low(itemStatus).includes('revisar')
    if (fs==='Aprovada') return low(itemStatus).includes('aprov')
    if (fs==='Concluida' || fs==='Concluída') return low(itemStatus).includes('conclu') || itemStatus==='Concluída'
    return String(itemStatus)===fs
  }
  return items.filter(it => {
    if (f.q && !(it.titulo||'').toLowerCase().includes(f.q.toLowerCase())) return false
    if (f.designer && it.designer !== f.designer) return false
    if (f.status && !matchesStatus(it.status, f.status)) return false
    if (f.tipoMidia && it.tipoMidia !== f.tipoMidia) return false
    if (f.plataforma && (it.plataforma||'') !== f.plataforma) return false
    if (f.origem && (it.origem||'') !== f.origem) return false
    if (f.campanha && (it.campanha||'') !== f.campanha) return false
    if (f.cIni && it.prazo && it.prazo < f.cIni) return false
    if (f.cFim && it.prazo && it.prazo > f.cFim) return false
    if (f.sIni && it.prazo && it.prazo < f.sIni) return false
    if (f.sFim && it.prazo && it.prazo > f.sFim) return false
    return true
  })
}

function TableView({ items, onEdit, onStatus, cadStatus, cadTipos, cadOrigens, designers, onBulkUpdate, onDelete, onDuplicate, hasMore, showMore, canCollapse, showLess, shown, total, compact, canEdit, canChangeStatus, loading }) {
  const [menuOpen, setMenuOpen] = useState(null)
  const toggleMenu = (id) => setMenuOpen(prev => prev===id ? null : id)
  const pad = n => String(n).padStart(2,'0')
  const isoWeek = d => { const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dayNum = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - dayNum); const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1)); const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7); return `${date.getUTCFullYear()}-W${pad(weekNo)}` }
  const thisWeek = isoWeek(new Date())
  const fmtDM = (s)=>{ if(!s) return ''; const [y,m,d]=String(s).split('-').map(Number); const dd=String(d).padStart(2,'0'); const ab=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Math.max(0,Math.min(11,(m-1)||0))]; return `${dd}.${ab}` }
  const [sortKey, setSortKey] = useState('created')
  const [sortDir, setSortDir] = useState('desc')
  const [selected, setSelected] = useState(()=> new Set())
  const [bulk, setBulk] = useState({ status:'', tipoMidia:'', origem:'', designer:'', dataCriacao:'' })
  const [saving, setSaving] = useState(false)
  const valOf = (it, k)=>{
    if (k==='created') { const ca=it.createdAt; const t=(ca&&typeof ca==='object' && ('seconds' in ca)) ? ((ca.seconds||0)*1000 + ((ca.nanoseconds||0)/1e6)) : (ca ? Date.parse(ca) : 0); const d1=Date.parse(it.dataCriacao||'')||0; const d2=Date.parse(it.dataSolicitacao||'')||0; return t||d1||d2||0 }
    if (k==='prazo' || k==='dataCriacao' || k==='dataSolicitacao') return Date.parse(it[k]||'')||0
    if (k==='drive') return it.linkDrive ? 1 : 0
    const v = it[k]
    return typeof v==='string' ? v.toLowerCase() : (v||'')
  }
  const sortedItems = useMemo(()=> {
    const arr = Array.isArray(items) ? items.slice() : []
    return arr.sort((a,b)=>{ const va=valOf(a, sortKey), vb=valOf(b, sortKey); if (typeof va==='number' && typeof vb==='number') return sortDir==='desc' ? (vb - va) : (va - vb); const c = String(vb||'').localeCompare(String(va||'')); return sortDir==='desc' ? c : -c })
  }, [items, sortKey, sortDir])
  const hdr = (label, key)=> (<th onClick={()=>{ if (sortKey===key) setSortDir(d=> d==='desc'?'asc':'desc'); else { setSortKey(key); setSortDir('desc') } }}>{label} {sortKey===key ? (sortDir==='desc'?'▼':'▲') : ''}</th>)
  const isAllSelected = sortedItems.length>0 && sortedItems.every(it=> selected.has(String(it.id)))
  const toggleAll = ()=> setSelected(prev=>{ const n=new Set(prev); if (isAllSelected) { sortedItems.forEach(it=> n.delete(String(it.id))) } else { sortedItems.forEach(it=> n.add(String(it.id))) } return n })
  const toggleRow = (id)=> setSelected(prev=>{ const n=new Set(prev); const k=String(id); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const clearSel = ()=> setSelected(new Set())
  const doBulkSave = async ()=>{
    if (saving) return
    setSaving(true)
    const ids = Array.from(selected)
    const patch = {}; Object.entries(bulk).forEach(([k,v])=>{ if (v) patch[k]=v })
    if (ids.length && Object.keys(patch).length && onBulkUpdate) {
      await onBulkUpdate(ids, patch)
      clearSel(); setBulk({ status:'', tipoMidia:'', origem:'', designer:'', dataCriacao:'' })
    }
    setSaving(false)
  }
  if (loading) {
    return (
      <div className={`table ${compact?'compact':''}`}>
        <div className="skeleton row" style={{width:'60%'}}></div>
        {Array.from({length:8}).map((_,i)=> (<div key={i} className="skeleton row" style={{width:`${90 - i*6}%`}}></div>))}
      </div>
    )
  }
  return (
    <div className={`table ${compact?'compact':''}`} style={selected.size>0 ? { paddingBottom: 80 } : undefined}>
      {selected.size>0 && (
        <div className="bulk-bar" style={{position:'fixed',left:0,right:0,bottom:0,display:'flex',gap:12,alignItems:'center',padding:'10px 16px',background:'#fff',boxShadow:'0 -8px 24px rgba(0,0,0,0.12)',borderTop:'1px solid #e5e7eb',zIndex:999}}>
          <span style={{color:'var(--muted)'}}>Selecionadas: {selected.size}</span>
          <select value={bulk.status} onChange={e=> setBulk(prev=> ({ ...prev, status: e.target.value }))}>
            <option value="">Status</option>
            {FIXED_STATUS.map(s=> <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={bulk.tipoMidia} onChange={e=> setBulk(prev=> ({ ...prev, tipoMidia: e.target.value }))}>
            <option value="">Tipo</option>
            {(cadTipos||[]).map(t=> <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={bulk.origem} onChange={e=> setBulk(prev=> ({ ...prev, origem: e.target.value }))}>
            <option value="">Origem</option>
            {(cadOrigens||[]).map(o=> <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={bulk.designer} onChange={e=> setBulk(prev=> ({ ...prev, designer: e.target.value }))}>
            <option value="">Designer</option>
            {(designers||[]).map(d=> <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="date" value={bulk.dataCriacao||''} onChange={e=> setBulk(prev=> ({ ...prev, dataCriacao: e.target.value }))} />
          <button className="primary" type="button" onClick={doBulkSave} disabled={!canEdit || saving}>Salvar</button>
          <button className="tertiary" type="button" onClick={clearSel}>Limpar seleção</button>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" checked={isAllSelected} onChange={toggleAll} /></th>
            {hdr('Nome','titulo')}
            {hdr('Designer','designer')}
            {hdr('Status','status')}
            {hdr('Data de Solicitação','dataSolicitacao')}
            {hdr('Data de Criação','created')}
            {hdr('Prazo','prazo')}
            {hdr('Tipo','tipoMidia')}
            {hdr('Origem','origem')}
            {hdr('Drive','drive')}
          </tr>
        </thead>
        <tbody>
          {sortedItems.map(it => (
            <tr key={it.id} className="row-clickable" onClick={()=>onEdit(it)}>
              <td><input type="checkbox" checked={selected.has(String(it.id))} onClick={e=> e.stopPropagation()} onChange={()=> toggleRow(it.id)} /></td>
              <td className="name">{it.titulo}</td>
              <td>
                <div>{it.designer}</div>
              </td>
              <td>
                <select className={`status-select ${statusClass(it.status)}`} value={it.status} onChange={e=>onStatus(it.id, e.target.value)} onClick={e=>e.stopPropagation()} disabled={!canChangeStatus}>
                  {FIXED_STATUS.map(s=> <option key={s} value={s}>{statusWithDot(s)}</option>)}
                </select>
              </td>
              <td>{fmtDM(it.dataSolicitacao)}</td>
              <td>{fmtDM(it.dataCriacao)}</td>
              <td>{fmtDM(it.prazo)}</td>
              <td>{it.tipoMidia}</td>
              <td>{it.origem || ''}</td>
              <td>{it.linkDrive ? <a href={it.linkDrive} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>Abrir Drive</a> : ''}</td>
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
        {canCollapse && <button className="tertiary" onClick={showLess}>Mostrar menos demandas</button>}
      </div>
    </div>
  )
}

function BoardView({ items, onEdit, onStatus, onMoveToGroup, cadStatus, onDelete, compact, groupBy, loading }) {
  const mondayCols = [
    { name:'Pendente', map:'Aberta' },
    { name:'Em produção', map:'Em Progresso' },
    { name:'Aguardando feedback', map:'Aguardando feedback' },
    { name:'Aprovada', map:'Concluída' },
    { name:'Concluída', map:'Concluída' },
  ]
  const available = new Set(cadStatus)
  const targetFor = (col) => available.has(col.map) ? col.map : (col.name==='Aguardando feedback' ? (available.has('Em Progresso')?'Em Progresso': cadStatus[0]) : (available.has('Concluída')?'Concluída': cadStatus[0]))
  const groupCols = (()=>{
    if (groupBy==='status') return mondayCols
    const vals = Array.from(new Set(items.map(x=> x[groupBy] || '—'))).sort()
    return vals.map(v=> ({ name: v, map: v }))
  })()
  const isInCol = (it, col) => {
    if (groupBy==='status') {
      const s = String(it.status||'')
      const v = s.toLowerCase()
      if (col.name==='Pendente') return v.includes('pendente') || s==='Aberta' || s==='Pendente'
      if (col.name==='Em produção') return v.includes('produção') || s==='Em Progresso' || s==='Em produção'
      if (col.name==='Aguardando feedback') return v.includes('feedback') || s==='Aguardando feedback' || s==='Aguardando Feedback' || v.includes('revisar')
      if (col.name==='Aprovada') return v.includes('aprov') || s==='Aprovada'
      if (col.name==='Concluída') return s==='Concluída' || v.includes('concluida')
      return s===col.map
    }
    const val = it[groupBy] || '—'
    return val===col.map
  }
  const onDropCol = (e, col) => {
    e.preventDefault()
    const idRaw = e.dataTransfer.getData('id')
    if (!idRaw) return
    const id = (/^\d+$/.test(String(idRaw)) ? Number(idRaw) : idRaw)
    if (groupBy==='status') {
      const t = targetFor(col)
      if (t) onStatus(id, t)
    } else {
      onMoveToGroup(id, groupBy, col.map)
    }
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
  if (loading) {
    return (
      <div className="board">
        {Array.from({length:4}).map((_,c)=> (
          <div key={c} className="column">
            <div className="col-head"><div>Carregando…</div></div>
            <div className="col-body">
              {Array.from({length:3}).map((_,j)=> (<div key={j} className="skeleton card"></div>))}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="board">
      {groupCols.map(col => (
        <div key={col.name} className="column">
          <div className="col-head">
            <div>{col.name}</div>
            <button className="action-btn" type="button">⋯</button>
          </div>
          <div className="col-body dropzone" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={e=> onDropCol(e, col)}>
            {items.filter(it=> isInCol(it, col)).slice().sort((a,b)=>{ const da=a.prazo?new Date(a.prazo):null; const db=b.prazo?new Date(b.prazo):null; if(!da&&!db) return 0; if(!da) return 1; if(!db) return -1; return da-db }).map(it => (
              <div key={it.id} className={`card kanban-card ${/revisar/i.test(String(it.status||''))?'fx-revisar':''} ${it.fxDeleting?'fx-delete':''} ${(()=>{ const h=it.historico||[]; const today=hojeISO(); const has=h.find(x=> x.tipo==='alerta' && x.data===today); return has?'fx-notify':'' })()} ${(()=>{ const t=it.fxBounceAt||0; return (Date.now()-t)<400?'fx-bounce':'' })()}`} draggable onDragStart={e=>{ e.dataTransfer.setData('id', String(it.id)); e.currentTarget.classList.add('dragging') }} onDragEnd={e=> e.currentTarget.classList.remove('dragging')} onClick={()=>onEdit(it)}>
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
                  {it.prazo && !isDoneStatus(it.status) && (()=>{ const [y,m,d]=String(it.prazo).split('-').map(Number); const end=new Date(y,(m||1)-1,(d||1)); end.setHours(0,0,0,0); const start=new Date(); start.setHours(0,0,0,0); const near=(end-start)<=86400000; return near ? (<div className="deadline-pill" style={{background:'#ef4444',borderColor:'#ef4444',color:'#fff'}}><span className="icon"><Icon name="alert" /></span><span>Prazo &lt; 24h</span></div>) : null })()}
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

function Modal({ open, mode, onClose, onSubmit, initial, cadTipos, designers, cadPlataformas, onDelete, userLabel, canDelete, onAddComment, cadOrigens, currentUser, usersAll, canEdit, canChangeStatus, displayUser, onStatus }) {
  const [designer, setDesigner] = useState(initial?.designer || currentUser || '')
  const [tipoMidia, setTipoMidia] = useState(initial?.tipoMidia || 'Post')
  const [titulo, setTitulo] = useState(initial?.titulo || '')
  const [link, setLink] = useState(initial?.link || '')
  const [linkDrive, setLinkDrive] = useState(initial?.linkDrive || '')
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
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionList, setMentionList] = useState([])
  const commentRef = useRef(null)
  const [commentsExpanded, setCommentsExpanded] = useState(false)
  const [historico, setHistorico] = useState(initial?.historico || [])
  const [origem, setOrigem] = useState(initial?.origem || '')
  const [campanha, setCampanha] = useState(initial?.campanha || '')
  const [modelo, setModelo] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(()=>{
    setDesigner(initial?.designer || currentUser || '')
    setTipoMidia(initial?.tipoMidia || 'Post')
    setTitulo(initial?.titulo || '')
    setLink(initial?.link || '')
    setLinkDrive(initial?.linkDrive || '')
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
  },[initial, open, designers, cadTipos, cadPlataformas, cadOrigens])
  const addDaysISO = (iso, days) => { try{ const [y,m,d]=String(iso||hojeISO()).split('-').map(Number); const dt=new Date(y,(m||1)-1,(d||1)); dt.setDate(dt.getDate()+days); const z=n=>String(n).padStart(2,'0'); return `${dt.getFullYear()}-${z(dt.getMonth()+1)}-${z(dt.getDate())}` }catch{ return iso } }
  const applyModelo = (name) => {
    if (!name) return
    if (name==='Post IG - Feed') { setTipoMidia('Post'); setPlataforma('Instagram'); setPrazo(addDaysISO(hojeISO(),2)); setTitulo(t=> t||'Post IG Feed') }
    else if (name==='Story IG') { setTipoMidia('Story'); setPlataforma('Instagram'); setPrazo(addDaysISO(hojeISO(),1)); setTitulo(t=> t||'Story IG') }
    else if (name==='Banner Ads') { setTipoMidia('Banner'); setPlataforma('Tráfego Pago'); setPrazo(addDaysISO(hojeISO(),3)); setTitulo(t=> t||'Banner Ads') }
    else if (name==='Vídeo Motion') { setTipoMidia('Vídeo'); setPlataforma('YouTube'); setPrazo(addDaysISO(hojeISO(),5)); setTitulo(t=> t||'Vídeo Motion') }
  }
  const submit = e => { e.preventDefault(); onSubmit({ designer, tipoMidia, titulo, link, linkDrive, arquivoNome, dataSolic, dataCriacao, dataFeedback, plataforma, arquivos, descricao, prazo, comentarios, historico, origem, campanha }) }
  const addComentario = () => { const v = novoComentario.trim(); if (!v) return; const men = extractMentions(v); const c = { texto: v, data: hojeISO(), mentions: men, autor: userLabel }; const h = { tipo:'comentario', autor:userLabel, data: c.data, texto: v, mentions: men }; setComentarios(prev=> [c, ...prev]); setHistorico(prev=> [h, ...prev]); setNovoComentario(''); try { onAddComment && onAddComment(initial?.id, c, h) } catch {}
  }
  const fmtDT = (s)=>{ if(!s) return ''; try{ return new Date(s).toLocaleString('pt-BR',{ timeZone:'America/Sao_Paulo', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) }catch{return s} }
  const [nowTs, setNowTs] = useState(Date.now())
  useEffect(()=>{ const id = setInterval(()=> setNowTs(Date.now()), 1000); return ()=> clearInterval(id) },[])
  const fmtHMS = (ms)=>{ if(!ms||ms<=0) return '00:00:00'; const s = Math.floor(ms/1000); const hh = String(Math.floor(s/3600)).padStart(2,'0'); const mm = String(Math.floor((s%3600)/60)).padStart(2,'0'); const ss = String(s%60).padStart(2,'0'); return `${hh}:${mm}:${ss}` }
  const baseMs = Number(initial?.tempoProducaoMs||0)
  const startedAtMs = initial?.startedAt ? Date.parse(initial.startedAt) : null
  const isProdNow = /produ|progresso/i.test(String(initial?.status||''))
  const fallbackStartRef = useRef(null)
  useEffect(()=>{ if (!startedAtMs && isProdNow && !fallbackStartRef.current) { fallbackStartRef.current = Date.now() } if (startedAtMs || !isProdNow) { fallbackStartRef.current = null } }, [startedAtMs, isProdNow])
  const effectiveStart = startedAtMs ?? fallbackStartRef.current
  const totalMs = baseMs + (effectiveStart ? Math.max(0, nowTs - effectiveStart) : 0)
  const [openStep, setOpenStep] = useState(null)
  const linkifyHtml = (s)=>{
    const t = String(s||'')
    const esc = t.replace(/[&<>]/g, m=> (m==='&'?'&amp;': m==='<'?'&lt;':'&gt;'))
    const withLinks = esc.replace(/((https?:\/\/|www\.)[^\s]+)/gi, m=>{ const url = /^https?:\/\//i.test(m) ? m : `https://${m}`; return `<a href="${url}" target="_blank" rel="noreferrer">${m}</a>` })
    return withLinks.replace(/\n/g,'<br/>')
  }
  if (!open) return null
  return (
    <div className="modal">
      <div className={`modal-dialog ${mode!=='create'?'tall':''}`} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              {mode==='create' ? (
                <div className="title"><span className="icon"><Icon name="plus" /></span><span>Nova demanda</span></div>
              ) : (
                <input className="title editable" type="text" dir="ltr" placeholder="Sem título" value={titulo} onChange={e=> setTitulo(e.target.value)} />
              )}
              <button className="icon" onClick={onClose}><Icon name="close" /></button>
            </div>
            <div className="modal-actions-inline">
              <button className="action-btn" type="button" onClick={()=> setMenuOpen(v=> !v)}>⋯</button>
              {menuOpen && (
                <div className="context-menu" onClick={e=> e.stopPropagation()}>
                  {mode==='edit' && canDelete && (
                    <button className="tertiary" type="button" onClick={()=>{ setMenuOpen(false); if (window.confirm('Confirmar exclusão desta demanda?')) { onDelete(initial.id); onClose() } }}>Excluir demanda</button>
                  )}
                </div>
              )}
            </div>
        
        <div className={`status-bar ${statusClass(initial?.status || 'Aberta')}`}>
          <div>{initial?.status || 'Aberta'}</div>
          {mode!=='create' && (
            <select value={initial?.status||'Aberta'} onChange={e=>{ try{ onStatus && onStatus(initial?.id, e.target.value) }catch{} }} disabled={!canChangeStatus} style={{marginLeft:8}}>
              {FIXED_STATUS.map(s=> <option key={s} value={s}>{statusWithDot(s)}</option>)}
            </select>
          )}
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
              {mode==='create' && (
                <div className="form-row"><label>Link de Referência</label><input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://" /></div>
              )}
              <div className="form-row"><label>Origem da Demanda</label>
                <select value={origem} onChange={e=>setOrigem(e.target.value)} required>
                  <option value="">Origem</option>
                  {(cadOrigens||ORIGENS).map(o=> <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-row"><label>Campanha</label>
                <input value={campanha} onChange={e=>setCampanha(e.target.value)} placeholder="Ex: Black Friday" />
              </div>
              {mode!=='create' && (
                <div className="form-row"><label>Link de Referência</label><input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://" />{link ? (<div style={{marginTop:6}}><a href={link} target="_blank" rel="noreferrer">Abrir link</a></div>) : null}</div>
              )}
              {mode!=='create' && (
                <div className="form-row"><label>Link do Drive</label><input type="url" value={linkDrive} onChange={e=>setLinkDrive(e.target.value)} placeholder="https://" />{linkDrive ? (<div style={{marginTop:6}}><a href={linkDrive} target="_blank" rel="noreferrer">Abrir Drive</a></div>) : null}</div>
              )}
              {mode==='create' ? (
                <div className="row-2">
                  <div className="form-row"><label>Data de Solicitação</label><input type="date" value={dataSolic} onChange={e=> setDataSolic(e.target.value)} /></div>
                  <div className="form-row"><label>Prazo</label><input type="date" value={prazo} onChange={e=>setPrazo(e.target.value)} /></div>
                </div>
              ) : (
                <div className="form-row"><label>Arquivo</label>
                  <input type="file" multiple accept="image/*" onChange={e=>{
                    const max = 1024*1024
                    const files = Array.from(e.target.files||[]).filter(f=> (f.size||0) <= max).slice(0,5)
                    const now = new Date().toISOString()
                    const readers = files.map(f => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve({ name: f.name, url: r.result, addedBy: userLabel, addedAt: now }); r.readAsDataURL(f) }))
                    Promise.all(readers).then(arr => {
                      setArquivos(arr)
                      setHistorico(prev=> [{ tipo:'arquivo', autor:userLabel, data: hojeISO(), arquivos: arr }, ...prev])
                      const nomes = arr.map(a=>a.name).join(', ')
                      setComentarios(prev=> [{ texto: `Arquivos anexados: ${nomes||arr.length}`, data: hojeISO() }, ...prev])
                    })
                  }} />
                  {Array.isArray(arquivos) && arquivos.length>0 && (
                    <div className="thumbs">
                      {arquivos.map((f,idx)=> (
                        <div key={f.name+idx} className="file-item">
                          <img className="file-thumb" src={f.url} alt={f.name} />
                          <div className="file-meta">{f.name}{f.addedBy?` • ${f.addedBy}`:''}</div>
                          <div className="file-actions">
                            <a href={f.url} download target="_blank" rel="noreferrer">Baixar</a>
                            <label className="replace-btn">Substituir<input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{ const nf=e.target.files?.[0]; if(!nf) return; const r=new FileReader(); const now=new Date().toISOString(); r.onload=()=>{ const rep={ name: nf.name, url: r.result, addedBy: userLabel, addedAt: now }; setArquivos(prev=> prev.map((x,i)=> i===idx? rep: x)) }; r.readAsDataURL(nf) }} /></label>
                            <button type="button" onClick={()=> setArquivos(prev=> prev.filter((_,i)=> i!==idx))}>Excluir</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              
              </div>
            {mode==='create' && (
              <div className="form-row"><label>Descrição</label><textarea rows={8} className="desc-input" value={descricao} onChange={e=> setDescricao(e.target.value)} />{/(https?:\/\/|www\.)/i.test(String(descricao||'')) ? (<div className="desc-preview" dangerouslySetInnerHTML={{ __html: linkifyHtml(descricao) }} />) : null}</div>
              )}
              {mode==='create' && (
                <div className="activity">
                  <div className="form-row"><label>Comentários</label>
                    <input ref={commentRef} placeholder="Escreva um comentário… use @ para mencionar" value={novoComentario} onChange={e=>{ const v=e.target.value; const pos=e.target.selectionStart||v.length; setNovoComentario(v); const idx=v.lastIndexOf('@', (pos||v.length)-1); if(idx>=0){ const rest=v.slice(idx+1); const endSpace=rest.indexOf(' '); const endNl=rest.indexOf('\n'); const end=(endSpace>=0 && endNl>=0) ? Math.min(endSpace,endNl) : (endSpace>=0? endSpace : (endNl>=0? endNl : -1)); const q=end>=0? rest.slice(0,end) : rest.slice(0, pos-(idx+1)); const qq=String(q||'').trim(); setMentionQuery(qq); if(qq.length>0){ const ql=qq.toLowerCase(); const list=(usersAll||[]).filter(u=> (String(u.username||'').toLowerCase().includes(ql)) || (String(u.name||'').toLowerCase().includes(ql))).slice(0,6); setMentionList(list); setMentionOpen(list.length>0) } else { setMentionOpen(false); setMentionList([]) } } else { setMentionOpen(false); setMentionList([]) } }} onBlur={()=> setTimeout(()=> setMentionOpen(false), 80)} />
                    {mentionOpen && mentionList.length>0 && (
                      <div className="mentions-suggest">
                        {mentionList.map(u=> (
                          <div key={u.id||u.username} className="suggest-item" onMouseDown={e=>{ e.preventDefault(); const el=commentRef.current; const v=String(novoComentario||''); const pos=el? el.selectionStart||v.length : v.length; const idx=v.lastIndexOf('@', (pos||v.length)-1); const prefix=v.slice(0, idx); const rest=v.slice(idx+1); const endSpace=rest.indexOf(' '); const endNl=rest.indexOf('\n'); const end=(endSpace>=0 && endNl>=0) ? Math.min(endSpace,endNl) : (endSpace>=0? endSpace : (endNl>=0? endNl : -1)); const endIdx=end>=0? idx+1+end : pos; const suffix=v.slice(endIdx); const handle=`@${u.username||u.name}`; const nv=`${prefix}${handle} ${suffix}`; setNovoComentario(nv); setMentionOpen(false); setMentionList([]); setMentionQuery(''); setTimeout(()=>{ try{ const el2=commentRef.current; if(el2){ const caret=(prefix.length+handle.length+1); el2.focus(); el2.setSelectionRange(caret, caret) } }catch{} }, 0) }}>@{u.username||''} — {u.name||u.username}</div>
                        ))}
                      </div>
                    )}
                    {novoComentario.trim().length>0 && (
                      <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
                        <button className="primary" type="button" onClick={addComentario}>Adicionar</button>
                      </div>
                    )}
                  </div>
                  <div className="activity-list">
                    {(comentarios||[]).length===0 ? <div className="empty">Sem comentários</div> : (
                      ((commentsExpanded? (comentarios||[]) : (comentarios||[]).slice(0,2))).map((ev,i)=> (
                        <div key={i} className="activity-item">
                          <div className="activity-entry">
                            <div className="avatar">V</div>
                            <div className="entry-content">
                              <div className="entry-title">
                                <span><strong>{displayUser(ev.autor||'—')}</strong> comentou: {ev.texto}</span>
                              </div>
                              <div className="entry-time">{fmtDT(ev.data)}</div>
                              {Array.isArray(ev.mentions) && ev.mentions.length>0 && (
                                <div className="mentions-row">
                                  {ev.mentions.map(m=> (
                                    <span key={m} className={`mention-pill ${String(userLabel||'').toLowerCase()===String(m||'').toLowerCase()?'you':''}`}>@{m}{String(userLabel||'').toLowerCase()===String(m||'').toLowerCase()? ' • Você foi mencionado':''}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    {(comentarios||[]).length>2 && (
                      <div style={{display:'flex',justifyContent:'center',marginTop:8}}>
                        <button className="tertiary" type="button" onClick={()=> setCommentsExpanded(v=> !v)}>{commentsExpanded? 'Mostrar menos' : `Ver todos os comentários (${(comentarios||[]).length-2} mais)`}</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
            </div>
            {mode!=='create' && (
              <div className="modal-center">
                <div className="date-row">
                  <div className="form-row"><label>Data de Solicitação</label><input type="date" value={dataSolic} onChange={e=> setDataSolic(e.target.value)} disabled={!canEdit} /></div>
                  <div className="form-row"><label>Data de Criação</label><input type="date" value={dataCriacao} onChange={e=> setDataCriacao(e.target.value)} disabled={!canEdit} /></div>
                  <div className="form-row"><label>Prazo</label><input type="date" value={prazo} onChange={e=>setPrazo(e.target.value)} /></div>
                  {String(initial?.status||'').toLowerCase().includes('feedback') && (
                    <div className="form-row"><label>Data de Feedback</label><input type="date" value={dataFeedback} onChange={e=> setDataFeedback(e.target.value)} disabled={!canEdit} /></div>
                  )}
                </div>
                <div className="form-row"><label>Descrição</label><textarea rows={12} className="desc-input" value={descricao} onChange={e=> setDescricao(e.target.value)} />{/(https?:\/\/|www\.)/i.test(String(descricao||'')) ? (<div className="desc-preview" dangerouslySetInnerHTML={{ __html: linkifyHtml(descricao) }} />) : null}</div>
                <div className="activity">
                  <div className="form-row"><label>Comentários</label>
                    <input ref={commentRef} placeholder="Escreva um comentário… use @ para mencionar" value={novoComentario} onChange={e=>{ const v=e.target.value; const pos=e.target.selectionStart||v.length; setNovoComentario(v); const idx=v.lastIndexOf('@', (pos||v.length)-1); if(idx>=0){ const rest=v.slice(idx+1); const endSpace=rest.indexOf(' '); const endNl=rest.indexOf('\n'); const end=(endSpace>=0 && endNl>=0) ? Math.min(endSpace,endNl) : (endSpace>=0? endSpace : (endNl>=0? endNl : -1)); const q=end>=0? rest.slice(0,end) : rest.slice(0, pos-(idx+1)); const qq=String(q||'').trim(); setMentionQuery(qq); if(qq.length>0){ const ql=qq.toLowerCase(); const list=(usersAll||[]).filter(u=> (String(u.username||'').toLowerCase().includes(ql)) || (String(u.name||'').toLowerCase().includes(ql))).slice(0,6); setMentionList(list); setMentionOpen(list.length>0) } else { setMentionOpen(false); setMentionList([]) } } else { setMentionOpen(false); setMentionList([]) } }} onBlur={()=> setTimeout(()=> setMentionOpen(false), 80)} />
                    {mentionOpen && mentionList.length>0 && (
                      <div className="mentions-suggest">
                        {mentionList.map(u=> (
                          <div key={u.id||u.username} className="suggest-item" onMouseDown={e=>{ e.preventDefault(); const el=commentRef.current; const v=String(novoComentario||''); const pos=el? el.selectionStart||v.length : v.length; const idx=v.lastIndexOf('@', (pos||v.length)-1); const prefix=v.slice(0, idx); const rest=v.slice(idx+1); const endSpace=rest.indexOf(' '); const endNl=rest.indexOf('\n'); const end=(endSpace>=0 && endNl>=0) ? Math.min(endSpace,endNl) : (endSpace>=0? endSpace : (endNl>=0? endNl : -1)); const endIdx=end>=0? idx+1+end : pos; const suffix=v.slice(endIdx); const handle=`@${u.username||u.name}`; const nv=`${prefix}${handle} ${suffix}`; setNovoComentario(nv); setMentionOpen(false); setMentionList([]); setMentionQuery(''); setTimeout(()=>{ try{ const el2=commentRef.current; if(el2){ const caret=(prefix.length+handle.length+1); el2.focus(); el2.setSelectionRange(caret, caret) } }catch{} }, 0) }}>@{u.username||''} — {u.name||u.username}</div>
                        ))}
                      </div>
                    )}
                    {novoComentario.trim().length>0 && (
                      <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
                        <button className="primary" type="button" onClick={addComentario}>Adicionar</button>
                      </div>
                    )}
                  </div>
                  <div className="activity-list">
                    {(comentarios||[]).length===0 ? <div className="empty">Sem comentários</div> : (
                      ((commentsExpanded? (comentarios||[]) : (comentarios||[]).slice(0,2))).map((ev,i)=> (
                        <div key={i} className="activity-item">
                          <div className="activity-entry">
                            <div className="avatar">V</div>
                            <div className="entry-content">
                              <div className="entry-title">
                                <span><strong>{displayUser(ev.autor||'—')}</strong> comentou: {ev.texto}</span>
                              </div>
                              <div className="entry-time">{fmtDT(ev.data)}</div>
                              {Array.isArray(ev.mentions) && ev.mentions.length>0 && (
                                <div className="mentions-row">
                                  {ev.mentions.map(m=> (
                                    <span key={m} className={`mention-pill ${String(userLabel||'').toLowerCase()===String(m||'').toLowerCase()?'you':''}`}>@{m}{String(userLabel||'').toLowerCase()===String(m||'').toLowerCase()? ' • Você foi mencionado':''}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    {(comentarios||[]).length>2 && (
                      <div style={{display:'flex',justifyContent:'center',marginTop:8}}>
                        <button className="tertiary" type="button" onClick={()=> setCommentsExpanded(v=> !v)}>{commentsExpanded? 'Mostrar menos' : `Ver todos os comentários (${(comentarios||[]).length-2} mais)`}</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {mode!=='create' && (
              <div className="modal-side">
          
                <div className="timeline">
                  <div className="form-row"><label>Linha do tempo</label></div>
                  {['Criado','Em produção','Aguardando Feedback','Revisar','Aprovada','Concluída','Postado'].map(step=>{
                      const match = (h, s)=>{
                        const val = String((h.status_novo||h.para||'')||'').toLowerCase()
                        if (s==='Criado') return val==='aberta'
                        if (s==='Em produção') return val.includes('produ') || val.includes('progresso')
                        if (s==='Aguardando Feedback') return val.includes('feedback')
                        if (s==='Revisar') return val.includes('revisar')
                        if (s==='Aprovada') return val.includes('aprov')
                        if (s==='Concluída') return val.includes('conclu')
                        return false
                      }
                      const evs = step==='Postado' ? (historico||[]).filter(h=> h.tipo==='mlabs') : (historico||[]).filter(h=> h.tipo==='status' && match(h, step))
                      let list = evs
                      if (step==='Concluída' && (!list || list.length===0) && String(initial?.status||'').toLowerCase().includes('conclu')) {
                        const whenIso = initial?.finishedAt || (initial?.dataConclusao ? `${initial.dataConclusao}T00:00:00Z` : null)
                        const fake = { tipo:'status', autor: initial?.autor||userLabel, data_hora_evento: whenIso, data: initial?.dataConclusao, status_novo:'Concluída', responsavel: initial?.designer||'' }
                        list = [fake]
                      }
                      const last = list && list.length ? list[list.length-1] : null
                      const dur = last?.duracao_em_minutos!=null ? formatMinutes(last.duracao_em_minutos) : ''
                      const when = last?.data_hora_evento ? fmtDT(last.data_hora_evento) : fmtDT(last?.data)
                      const resp = displayUser(last?.responsavel || last?.autor || '')
                      const count = list.length
                      const isOpen = openStep===step
                      return (
                        <div key={step} className="timeline-item" onClick={()=> setOpenStep(p=> p===step? null : step)}>
                          <div className="timeline-left"><span className="timeline-icon">●</span></div>
                          <div className="timeline-body">
                            <div className="timeline-title">{step}{count>1?` • ${count}`:''}</div>
                            <div className="timeline-meta">{when}{resp?` • ${resp}`:''}{dur?` • ${dur}`:''}</div>
                            {isOpen && count>0 && (
                              <div className="timeline-details">
                                {list.map((e,idx)=> (
                                  <div key={idx} className="timeline-detail-row">
                                    <div>{e?.data_hora_evento ? fmtDT(e.data_hora_evento) : fmtDT(e?.data)}</div>
                                    <div>{displayUser(e?.responsavel || e?.autor || '')}</div>
                                    <div>{e?.duracao_em_minutos!=null ? formatMinutes(e.duracao_em_minutos) : ''}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                
              </div>
            )}
          </div>
        </form>
        <div className="modal-actions">
          <button className="primary" type="submit" form="modalForm">Salvar</button>
        </div>
      </div>
    </div>
  )
}

function CadastrosView({ cadStatus, setCadStatus, cadTipos, setCadTipos, cadPlataformas, setCadPlataformas, cadOrigens, setCadOrigens, cadStatusColors, setCadStatusColors }) {
  const [tab, setTab] = useState('tipo')
  const [novo, setNovo] = useState('')
  const [novoCor, setNovoCor] = useState('#f59e0b')
  const lista = tab==='status' ? cadStatus : tab==='tipo' ? cadTipos : tab==='plataforma' ? cadPlataformas : cadOrigens
  const setLista = (arr) => {
    if (tab==='status') setCadStatus(arr)
    else if (tab==='tipo') setCadTipos(arr)
    else if (tab==='plataforma') setCadPlataformas(arr)
    else setCadOrigens(arr)
  }
  const [editVals, setEditVals] = useState({})
  const startEdit = (v) => setEditVals(prev=> ({ ...prev, [v]: v }))
  const cancelEdit = (v) => setEditVals(prev=> { const n={...prev}; delete n[v]; return n })
  const saveEdit = async (v) => {
    const newV = String(editVals[v]||'').trim()
    if (!newV || newV===v) { cancelEdit(v); return }
    const arr = lista.map(x=> x===v ? newV : x)
    setLista(arr)
    if (tab==='status') {
      const color = cadStatusColors[v]
      setCadStatusColors(prev=> { const m={...prev}; if (color) { delete m[v]; m[newV]=color } return m })
    }
    if (db) {
      const col = tab==='status'?'cad_status':tab==='tipo'?'cad_tipos':tab==='plataforma'?'cad_plataformas':'cad_origens'
      try {
        await setDoc(doc(db, col, newV), { name: newV, active: true }, { merge: true })
        try { await deleteDoc(doc(db, col, v)) } catch {}
      } catch (e) { try { window.alert(String(e?.code||e?.message||'Falha ao renomear')) } catch {} }
    }
    cancelEdit(v)
  }
  const addItem = async () => { const v = novo.trim(); if (!v) return; if (lista.includes(v)) return; const arr = [...lista, v]; setLista(arr); setNovo(''); if (tab==='status') setCadStatusColors(prev=> ({ ...prev, [v]: novoCor })); if (db) { const col = tab==='status'?'cad_status':tab==='tipo'?'cad_tipos':tab==='plataforma'?'cad_plataformas':'cad_origens'; try { await setDoc(doc(db, col, v), { name: v, active: true }) } catch (e) { try { window.alert(String(e?.code||e?.message||'Falha ao gravar cadastro')) } catch {} } } }
  const removeItem = async (v) => { const arr = lista.filter(x=>x!==v); setLista(arr); if (db) { const col = tab==='status'?'cad_status':tab==='tipo'?'cad_tipos':tab==='plataforma'?'cad_plataformas':'cad_origens'; try { await deleteDoc(doc(db, col, v)) } catch (e) { try { window.alert(String(e?.code||e?.message||'Falha ao remover cadastro')) } catch {} } } }
  const toggleActive = async (v) => { if (!db) return; const col = tab==='status'?'cad_status':tab==='tipo'?'cad_tipos':tab==='plataforma'?'cad_plataformas':'cad_origens'; try { await setDoc(doc(db, col, v), { active: false }, { merge: true }) } catch (e) { try { window.alert(String(e?.code||e?.message||'Falha ao desativar cadastro')) } catch {} } }
  return (
    <div className="panel">
      <div className="tabs">
        <button className={`tab ${tab==='tipo'?'active':''}`} onClick={()=>setTab('tipo')}>Tipo</button>
        <button className={`tab ${tab==='origem'?'active':''}`} onClick={()=>setTab('origem')}>Origem</button>
      </div>
      <div className="form-row" style={{marginTop:10}}>
        <label>{tab==='status'?'Novo Status':tab==='tipo'?'Novo Tipo':'Nova Origem'}</label>
        <div style={{display:'flex', gap:8}}>
          <input value={novo} onChange={e=>setNovo(e.target.value)} />
          {tab==='status' && <input type="color" value={novoCor} onChange={e=>setNovoCor(e.target.value)} title="Cor" />}
          <button className="primary" onClick={addItem}>Adicionar</button>
        </div>
      </div>
      <div className="form-row" style={{marginTop:10}}>
        <select>
          {lista.map(v => (<option key={v} value={v}>{v}</option>))}
        </select>
      </div>
      <div className="list" style={{marginTop:12}}>
        {lista.length===0 ? <div className="empty">Sem itens</div> : (
          lista.map(v => (
            <div key={v} className="list-item" style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px',border:'1px solid var(--border)',borderRadius:8,background:'#0b0e12',marginBottom:6}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {tab==='status' && <span className="status-dot" style={{background: cadStatusColors[v] || '#3b82f6'}} />}
                {editVals[v]!=null ? (
                  <input value={editVals[v]} onChange={e=> setEditVals(prev=> ({ ...prev, [v]: e.target.value }))} />
                ) : (
                  <div>{v}</div>
                )}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {tab==='status' && <input type="color" value={cadStatusColors[v] || '#3b82f6'} onChange={e=> setCadStatusColors(prev=> ({ ...prev, [v]: e.target.value }))} />}
                {editVals[v]==null ? (
                  <button className="icon" onClick={()=>startEdit(v)} title="Editar"><Icon name="edit" /></button>
                ) : (
                  <>
                    <button className="icon" onClick={()=>saveEdit(v)} title="Salvar"><Icon name="check" /></button>
                    <button className="icon" onClick={()=>cancelEdit(v)} title="Cancelar"><Icon name="close" /></button>
                  </>
                )}
                <button className="icon" onClick={()=>toggleActive(v)} title="Desativar"><Icon name="minus" /></button>
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

function AppInner() {
  const [user, setUser] = useState(null)
  const [demandas, setDemandas] = useState([])
  const pendingRef = useRef({})
  const [demCols, setDemCols] = useState({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('table')
  const [compact, setCompact] = useState(false)
  const [route, setRoute] = useState('dashboard')
  const [filtros, setFiltros] = useState({designer:'',status:'',plataforma:'',tipoMidia:'',origem:'',campanha:'',cIni:'',cFim:'',sIni:'',sFim:''})
  const [filterOpen, setFilterOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [editing, setEditing] = useState(null)
  const [themeVars, setThemeVars] = useState(defaultTheme)
  const [appSettings, setAppSettings] = useState({ autoPostMLabs:false })
  
  const [cadStatus, setCadStatus] = useState(["Aberta","Em Progresso","Concluída"]) 
  const [cadTipos, setCadTipos] = useState(["Post","Story","Banner","Vídeo","Outro"]) 
  const [cadPlataformas, setCadPlataformas] = useState([])
  const [cadOrigens, setCadOrigens] = useState([])
  const [usersAll, setUsersAll] = useState([])
  const userIndex = useMemo(()=>{ const m={}; (usersAll||[]).forEach(u=>{ const uname=String(u.username||'').toLowerCase(); const email=String(u.email||'').toLowerCase(); const name=(u.name||uname||''); if(uname) m[uname]=name; if(email) m[email]=name }); return m },[usersAll])
  const displayUser = (v)=>{ const s=String(v||'').toLowerCase(); return userIndex[s] || (v||'') }
  const [cadStatusColors, setCadStatusColors] = useState({ Aberta:'#f59e0b', "Em Progresso":"#3b82f6", "Concluída":"#10b981" })
  const designersFromDemandas = useMemo(()=> Array.from(new Set(demandas.map(x=>x.designer).filter(Boolean))).sort(), [demandas])
  const designersFromUsers = useMemo(()=> usersAll.filter(u=> (u.cargo||'')==='Designer').map(u=> u.username).filter(Boolean).sort(), [usersAll])
  const designers = useMemo(()=> Array.from(new Set([...designersFromUsers, ...designersFromDemandas])).sort(), [designersFromUsers, designersFromDemandas])
  const campanhas = useMemo(()=> Array.from(new Set(demandas.map(x=>x.campanha).filter(Boolean))).sort(), [demandas])
  const role = user?.role||'comum'
  const items = useMemo(()=> aplicarFiltros(demandas, filtros), [demandas, filtros])
  const dashItems = useMemo(()=> demandas, [demandas])
  const dashDesigners = useMemo(()=> Array.isArray(designers) ? designers : [], [designers])
  const itemsSorted = useMemo(()=> Array.isArray(items) ? items.slice().sort((a,b)=>{
    const ts = (x)=>{ try{ const ca=x.createdAt; const t=(ca&&typeof ca==='object' && ('seconds' in ca)) ? ((ca.seconds||0)*1000 + ((ca.nanoseconds||0)/1e6)) : (ca ? Date.parse(ca) : 0); const d1=Date.parse(x.dataCriacao||'')||0; const d2=Date.parse(x.dataSolicitacao||'')||0; const d3=Date.parse(x.prazo||'')||0; const idn=Number(x.id)||0; return t||d1||d2||d3||idn }catch{return Number(x.id)||0} }
    const ta = ts(a), tb = ts(b); if (tb!==ta) return tb - ta; return String(b.id||'').localeCompare(String(a.id||''))
  }) : [], [items])
  const designersVisible = useMemo(()=> Array.isArray(designers) ? designers : [], [designers])
  const itemsVisible = useMemo(()=> Array.isArray(itemsSorted) ? itemsSorted : [], [itemsSorted])
  const myMentions = useMemo(()=>{
    try {
      if (!user) return []
      const keys = new Set([String(user.username||'').toLowerCase(), String(user.name||'').toLowerCase()])
      const list = []
      (demandas||[]).forEach(it=>{
        (it.historico||[]).forEach(h=>{
          const has = (h.tipo==='notificacao') && Array.isArray(h.mentions) && h.mentions.some(m=> keys.has(String(m||'').toLowerCase()))
          if (has) list.push({ id: it.id, titulo: it.titulo||'(sem título)', quando: h.data_hora_evento||h.data||'', msg: h.mensagem||'Você foi mencionado' })
        })
      })
      return list.sort((a,b)=> String(b.quando||'').localeCompare(String(a.quando||'')))
    } catch { return [] }
  }, [demandas, user])
  useEffect(()=>{
    try {
      const raw = localStorage.getItem('mk_filtros')
      if (raw) {
        const obj = JSON.parse(raw)
        if (obj && typeof obj==='object') setFiltros(prev=> ({ ...prev, ...obj }))
      }
    } catch {}
  }, [])
  useEffect(()=>{
    try { localStorage.setItem('mk_filtros', JSON.stringify(filtros)) } catch {}
  }, [filtros])
  const revisarCount = useMemo(()=> itemsVisible.filter(x=> /revisar/i.test(String(x.status||''))).length, [itemsVisible])
  const aprovadaCount = useMemo(()=> itemsVisible.filter(x=> /aprovada/i.test(String(x.status||''))).length, [itemsVisible])
  const revisarDesigners = useMemo(()=> Array.from(new Set(itemsVisible.filter(x=> /revisar/i.test(String(x.status||''))).map(x=> displayUser(x.designer||'')))).filter(Boolean), [itemsVisible, displayUser])
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
  const [groupBy, setGroupBy] = useState('status')
  const userLabel = useMemo(()=> user?.name || user?.username || 'Você', [user])
  const allRoutes = ['executivo','dashboard','demandas','config','cadastros','relatorios','usuarios']
  const allowedRoutes = useMemo(()=> {
    const pages = user?.pages
    const roleCur = user?.role || 'comum'
    if (pages && typeof pages==='object') {
      const list = Object.keys(pages).filter(k=> pages[k])
      return Array.isArray(list) ? (roleCur==='admin' ? allRoutes : list) : (roleCur==='admin' ? allRoutes : ['dashboard','demandas'])
    }
    return roleCur==='admin' ? allRoutes : ['dashboard','demandas']
  }, [user])

  useEffect(()=>{ /* Firebase somente: sem persistência local */ },[demandas, db])
  useEffect(()=>{ if (!db) setLoading(false) },[db])
  useEffect(()=>{
    const run = async ()=>{
      try {
        const flag = ((import.meta.env && import.meta.env.VITE_PURGE_FIREBASE==='1') || (typeof window!=='undefined' && new URLSearchParams(window.location.search).get('purge')==='1'))
        if (!db || !flag || (typeof window!=='undefined' && window.__PURGED__)) return
        if (typeof window!=='undefined') window.__PURGED__ = true
        if (auth) {
          try { await signInWithEmailAndPassword(auth, 'purger@betaki.bet.br', 'purge12345') }
          catch (e) { try { await createUserWithEmailAndPassword(auth, 'purger@betaki.bet.br', 'purge12345'); await signInWithEmailAndPassword(auth, 'purger@betaki.bet.br', 'purge12345') } catch {} }
        }
        const cols = ['demandas_v2','demandas','cad_status','cad_tipos','cad_designers','cad_plataformas','cad_origens','historico_status','usuarios']
        for (const name of cols) {
          try {
            const snap = await getDocs(collection(db, name))
            const tasks = []
            snap.forEach(d=> tasks.push(deleteDoc(doc(db, name, d.id))))
            if (tasks.length) await Promise.all(tasks)
          } catch {}
        }
        try { window.alert('Purge Firebase concluído') } catch {}
      } catch {}
    }
    run()
  },[db, auth])
  useEffect(()=>{
    if (!db) {
      /* Firebase requerido: não carregar usuário local */
    }
  },[db])
  useEffect(()=>{
    if (!auth) return
    const unsub = onAuthStateChanged(auth, async (cur)=>{
      if (cur) {
        let meta = null
        const email = cur.email||''
        const uname = (email.split('@')[0]||'').trim()
        if (db && uname) {
          try { const snap = await getDoc(doc(db,'usuarios', uname)); meta = snap.exists() ? snap.data() : null } catch {}
        }
        const u = { username: meta?.username || uname, name: meta?.name || email, role: meta?.role || 'comum', pages: meta?.pages || null, actions: meta?.actions || null, cargo: meta?.cargo || '' }
        setUser(u)
        setLoading(false)
      } else {
        setUser(null)
        setLoading(false)
      }
    })
    return ()=>{ try{unsub()}catch{} }
  },[auth, db])
  useEffect(()=>{
    Object.entries(themeVars||{}).forEach(([k,v])=>{
      try { document.documentElement.style.setProperty(`--${k}`, v) } catch {}
    })
  },[themeVars])
  useEffect(()=>{
    if (!db || !user) return
    const u1 = onSnapshot(collection(db, DEM_COL), s=>{ const arr=[]; s.forEach(d=> arr.push({ id: d.data().id || d.id, ...d.data() })); const merged = arr.map(x=> ({ ...x, ...(pendingRef.current[String(x.id)]||{}) })); setDemandas(merged); setLoading(false) })
    const u2 = onSnapshot(collection(db,'usuarios'), s=>{ const arr=[]; s.forEach(d=> arr.push({ id:d.id, ...d.data() })); setUsersAll(arr) })
    const u3 = onSnapshot(collection(db,'cad_status'), s=> setCadStatus(s.docs.map(d=> d.data().name || d.id)))
    const u4 = onSnapshot(collection(db,'cad_tipos'), s=> setCadTipos(s.docs.filter(d=> (d.data().active!==false)).map(d=> d.data().name || d.id)))
    const u5 = onSnapshot(collection(db,'cad_plataformas'), s=> setCadPlataformas(s.docs.filter(d=> (d.data().active!==false)).map(d=> d.data().name || d.id)))
    const u6 = onSnapshot(collection(db,'cad_origens'), s=> setCadOrigens(s.docs.filter(d=> (d.data().active!==false)).map(d=> d.data().name || d.id)))
    return ()=>{ try{u1()}catch{}; try{u2()}catch{}; try{u3()}catch{}; try{u4()}catch{}; try{u5()}catch{}; try{u6()}catch{} }
  },[db, user])
  useEffect(()=>{
    if (user && !allowedRoutes.includes(route)) {
      setRoute(allowedRoutes[0] || 'dashboard')
    }
    if (!user && route!=='dashboard' && route!=='demandas' && route!=='config' && route!=='cadastros' && route!=='relatorios' && route!=='usuarios') {
      setRoute('dashboard')
    }
  },[user, allowedRoutes, route])
  useEffect(()=>{
    if (!modalOpen || !editing) return
    const found = demandas.find(x=> String(x.id)===String(editing.id))
    if (found) {
      try { setEditing(found) } catch {}
    }
  }, [demandas, modalOpen, editing])

  const logout = async ()=>{ try { await signOut(auth) } catch {} setUser(null) }
  const login = async (username, password) => {
    const uname = String(username||'').trim()
    if (!uname || !password) throw new Error('Credenciais ausentes')
    if (!auth) { throw new Error('Firebase não configurado') }
    const email = /@/.test(uname) ? uname : `${uname}@betaki.bet.br`
    try { await signInWithEmailAndPassword(auth, email, password) }
    catch (err) {
      await createUserWithEmailAndPassword(auth, email, password)
      await signInWithEmailAndPassword(auth, email, password)
      if (db) { try { await setDoc(doc(db,'usuarios', uname), { username: uname, email, name: uname, role: 'comum', cargo: '', pages: null, actions: null }) } catch {} }
    }
  }

  const isAdmin = (user?.role==='admin')
  const isDesigner = (user?.cargo==='Designer')
  const canCreate = isAdmin || isDesigner || (user?.actions?.criar !== false)
  const canDelete = isAdmin || isDesigner || (user?.actions?.excluir !== false)
  const canView = isAdmin || isDesigner || (user?.actions?.visualizar !== false)
  const onNew = ()=>{ if (!user || !canCreate) return; setModalMode('create'); setEditing(null); setModalOpen(true) }
  const onEdit = it => { if (!user || !canView) return; setModalMode('edit'); setEditing(it); setModalOpen(true) }
  const onDuplicate = async (it) => {
    const base = { ...it, status: 'Aberta', dataSolicitacao: hojeISO(), dataCriacao: null }
    if (db) {
      try { const newId = String(Date.now()); await addDoc(collection(db, DEM_COL), { ...base, id: newId, createdAt: serverTimestamp() }) } catch {}
    }
  }
  const onStatus = async (id, status) => {
    const today = hojeISO()
    let nextItem = null
    pendingRef.current[String(id)] = { ...(pendingRef.current[String(id)]||{}), status }
    setDemandas(prev=> prev.map(x=> {
      if (String(x.id)!==String(id)) return x
      const changed = x.status !== status
      const wasProd = String(x.status||'').toLowerCase().includes('produ') || String(x.status||'').toLowerCase().includes('progresso')
      const isProd = String(status||'').toLowerCase().includes('produ') || String(status||'').toLowerCase().includes('progresso')
      const nowMs = Date.now()
      let tempoProducaoMs = Number(x.tempoProducaoMs||0)
      let startedAt = x.startedAt || null
      let finishedAt = x.finishedAt || null
      const isFeedback = String(status||'').toLowerCase().includes('feedback')
      const wasFeedback = String(x.status||'').toLowerCase().includes('feedback')
      let slaStartAt = x.slaStartAt || null
      let slaStopAt = x.slaStopAt || null
      let slaPauseMs = Number(x.slaPauseMs||0)
      let pauseStartedAt = x.pauseStartedAt || null
      if (changed) {
        if (wasProd && !isProd && startedAt) {
          const startedMs = Date.parse(startedAt)
          if (!isNaN(startedMs)) tempoProducaoMs += Math.max(0, nowMs - startedMs)
          startedAt = null
        }
        if (!wasProd && isProd && !startedAt) {
          startedAt = new Date(nowMs).toISOString()
          if (!slaStartAt) slaStartAt = startedAt
        }
        if (!wasFeedback && isFeedback && !pauseStartedAt) {
          pauseStartedAt = new Date(nowMs).toISOString()
        }
        if (wasFeedback && !isFeedback && pauseStartedAt) {
          const pms = Date.parse(pauseStartedAt)
          if (!isNaN(pms)) slaPauseMs += Math.max(0, nowMs - pms)
          pauseStartedAt = null
        }
      }
      const isRev = String(status||'').toLowerCase().includes('revisar')
      const revisoes = changed && isRev ? (x.revisoes||0)+1 : (x.revisoes||0)
      const isDone = String(status||'').toLowerCase().includes('concluida') || status==='Concluída'
      const dataConclusao = isDone ? (x.dataConclusao||today) : x.dataConclusao
      const dataCriacao = (changed && ((isFeedback || isDone) && !x.dataCriacao)) ? today : x.dataCriacao
      if (changed && isDone) { finishedAt = new Date(nowMs).toISOString(); slaStopAt = finishedAt }
      const prevStatusEvent = (x.historico||[]).find(ev=> ev.tipo==='status')
      const prevTs = prevStatusEvent?.data_hora_evento ? Date.parse(prevStatusEvent.data_hora_evento) : (prevStatusEvent?.data ? Date.parse(`${prevStatusEvent.data}T00:00:00Z`) : null)
      const nowIso = new Date(nowMs).toISOString()
      const durMin = changed && prevTs ? Math.round((nowMs - prevTs)/60000) : null
      const histItem = changed ? { tipo:'status', autor: userLabel, data: today, data_hora_evento: nowIso, status_anterior: x.status, status_novo: status, duracao_em_minutos: durMin, responsavel: userLabel, id_demanda: x.id, de: x.status, para: status } : null
      const prazoMs = (()=>{ if(!x.prazo) return null; const [y,m,d]=String(x.prazo).split('-').map(Number); const end=new Date(y,(m||1)-1,(d||1)); end.setHours(0,0,0,0); const start=new Date(); start.setHours(0,0,0,0); return end - start })()
      const nearDeadline = !!(x.prazo && !isDone && typeof prazoMs==='number' && prazoMs<=86400000)
      const histAlert = (changed && nearDeadline) ? { tipo:'alerta', autor: userLabel, data: today, data_hora_evento: nowIso, mensagem: 'Prazo menor que 24h', id_demanda: x.id } : null
      const shouldAutoPost = !!(changed && ((String(status||'').toLowerCase().includes('aprov')) || (String(status||'').toLowerCase().includes('conclu'))) && appSettings.autoPostMLabs)
      const histMlabs = shouldAutoPost ? { tipo:'mlabs', autor: userLabel, data: today, data_hora_evento: nowIso, mensagem: 'Postagem agendada via mLabs', id_demanda: x.id } : null
      const historico = histItem ? [
        histItem,
        ...(histAlert ? [histAlert] : []),
        ...(histMlabs ? [histMlabs] : []),
        ...(x.historico||[])
      ] : (x.historico||[])
      const nextFeedback = (changed && isFeedback && !x.dataFeedback) ? today : x.dataFeedback
      const leadTotalMin = (historico||[]).filter(h=> h.tipo==='status' && h.duracao_em_minutos!=null).reduce((a,b)=> a + (b.duracao_em_minutos||0), 0)
      const leadPorFase = (()=>{ const acc={}; (historico||[]).forEach(h=>{ if(h.tipo==='status' && h.duracao_em_minutos!=null){ const k=(h.status_anterior||h.de||'Aberta')||'Aberta'; acc[k]=(acc[k]||0)+(h.duracao_em_minutos||0) } }); return acc })()
      const slaNetMs = (()=>{ if(!slaStartAt) return 0; const end = (slaStopAt ? Date.parse(slaStopAt) : nowMs); const start = Date.parse(slaStartAt); if(isNaN(start)||isNaN(end)) return 0; return Math.max(0, end - start - slaPauseMs) })()
      const slaOk = (()=>{ if(!dataConclusao || !x.prazo) return null; try { return String(dataConclusao) <= String(x.prazo) } catch { return null } })()
      const previsaoIA = calcPrevisaoIA(prev, { ...x, status })
      nextItem = { ...x, status, revisoes, dataConclusao, dataCriacao, dataFeedback: nextFeedback, historico, tempoProducaoMs, startedAt, finishedAt, previsaoIA, fxBounceAt: changed ? nowMs : (x.fxBounceAt||0), slaStartAt, slaStopAt, slaPauseMs, pauseStartedAt, slaNetMs, slaOk, leadTotalMin, leadPorFase }
      return nextItem
    }))
    if (editing && String(editing.id)===String(id) && nextItem) {
      try { setEditing(nextItem) } catch {}
    }
    const found = nextItem
    if (db && found) {
      try {
        const prevStatusEvent = (found.historico||[]).find(ev=> ev.tipo==='status')
        const prevTs = prevStatusEvent?.data_hora_evento ? Date.parse(prevStatusEvent.data_hora_evento) : (prevStatusEvent?.data ? Date.parse(`${prevStatusEvent.data}T00:00:00Z`) : null)
        const nowIso = new Date().toISOString()
        const durMin = (found.status!==status && prevTs) ? Math.round((Date.now() - prevTs)/60000) : null
        const prazoMs = (()=>{ if(!found.prazo) return null; const [y,m,d]=String(found.prazo).split('-').map(Number); const end=new Date(y,(m||1)-1,(d||1)); end.setHours(0,0,0,0); const start=new Date(); start.setHours(0,0,0,0); return end - start })()
        const nearDeadline = !!(found.prazo && !(String(status||'').toLowerCase().includes('concluida') || status==='Concluída') && typeof prazoMs==='number' && prazoMs<=86400000)
        const histItem = { tipo:'status', autor: userLabel, data: today, data_hora_evento: nowIso, status_anterior: found.status, status_novo: status, duracao_em_minutos: durMin, responsavel: userLabel, id_demanda: found.id, de: found.status, para: status }
        const histAlert = nearDeadline ? { tipo:'alerta', autor: userLabel, data: today, data_hora_evento: nowIso, mensagem: 'Prazo menor que 24h', id_demanda: found.id } : null
        const shouldAutoPost = !!(((String(status||'').toLowerCase().includes('aprov')) || (String(status||'').toLowerCase().includes('conclu'))) && appSettings.autoPostMLabs)
        const histMlabs = shouldAutoPost ? { tipo:'mlabs', autor: userLabel, data: today, data_hora_evento: nowIso, mensagem: 'Postagem agendada via mLabs', id_demanda: found.id } : null
        const histArr = [ histItem, ...(histAlert ? [histAlert] : []), ...(histMlabs ? [histMlabs] : []), ...(found.historico||[]) ]
        const qd = query(collection(db, DEM_COL), where('id','==', String(id)))
        const snap = await getDocs(qd)
        const patch = { ...found, status, dataCriacao: ((found.status!==status && ((String(status||'').toLowerCase().includes('feedback')) || (String(status||'').toLowerCase().includes('conclu'))) && !found.dataCriacao) ? today : (found.dataCriacao??null)), dataConclusao: (String(status||'').toLowerCase().includes('concluida') || status==='Concluída') ? (found.dataConclusao||today) : (found.dataConclusao||null), dataFeedback: (((found.status!==status && String(status||'').toLowerCase().includes('feedback')) && !found.dataFeedback) ? today : (found.dataFeedback??null)), revisoes: (found.revisoes||0) + ((found.status!==status && String(status||'').toLowerCase().includes('revisar'))?1:0), historico: histArr, tempoProducaoMs: found.tempoProducaoMs, startedAt: found.startedAt, finishedAt: (String(status||'').toLowerCase().includes('concluida') || status==='Concluída') ? new Date().toISOString() : (found.finishedAt||null), slaStartAt: found.slaStartAt, slaStopAt: (String(status||'').toLowerCase().includes('concluida') || status==='Concluída') ? new Date().toISOString() : (found.slaStopAt||null), slaPauseMs: found.slaPauseMs, pauseStartedAt: found.pauseStartedAt, slaNetMs: found.slaNetMs, slaOk: (found.slaOk??null), leadTotalMin: found.leadTotalMin, leadPorFase: found.leadPorFase }
        const tasks = []
        snap.forEach(d=> tasks.push(updateDoc(doc(db, DEM_COL, d.id), patch)))
        if (tasks.length) await Promise.all(tasks)
        try { await addDoc(collection(db,'historico_status'), histItem) } catch {}
      } catch {}
    }
  }
  const onAddComment = async (id, c, h) => {
    setDemandas(prev=> prev.map(x=> {
      if (String(x.id)!==String(id)) return x
      const comentarios = [c, ...(x.comentarios||[])]
      const notif = (Array.isArray(c.mentions) && c.mentions.length>0) ? { tipo:'notificacao', autor: userLabel, data: c.data, data_hora_evento: new Date().toISOString(), mensagem: 'Você foi mencionado', mentions: c.mentions, id_demanda: x.id } : null
      const historico = notif ? [notif, h, ...(x.historico||[])] : [h, ...(x.historico||[])]
      return { ...x, comentarios, historico, fxSavedAt: Date.now() }
    }))
    setEditing(prev=> (prev && String(prev.id)===String(id)) ? ({ ...prev, comentarios: [c, ...(prev.comentarios||[])], historico: [h, ...(prev.historico||[])] }) : prev)
    const found = demandas.find(x=> String(x.id)===String(id))
    if (db && found) {
      try {
        const notif = (Array.isArray(c.mentions) && c.mentions.length>0) ? { tipo:'notificacao', autor: userLabel, data: c.data, data_hora_evento: new Date().toISOString(), mensagem: 'Você foi mencionado', mentions: c.mentions, id_demanda: found.id } : null
        const histArr = notif ? [notif, h, ...(found.historico||[])] : [h, ...(found.historico||[])]
        const qd = query(collection(db, DEM_COL), where('id','==', String(id)))
        const snap = await getDocs(qd)
        const tasks = []
        snap.forEach(d=> tasks.push(updateDoc(doc(db, DEM_COL, d.id), { comentarios: [c, ...(found.comentarios||[])], historico: histArr })))
        if (tasks.length) await Promise.all(tasks)
        try { const cur=pendingRef.current[String(id)]||{}; delete cur.status; pendingRef.current[String(id)] = cur } catch {}
      } catch {}
    }
  }
  const onMoveToGroup = async (id, campo, valor) => {
    const today = hojeISO()
    setDemandas(prev=> prev.map(x=> {
      if (String(x.id)!==String(id)) return x
      const histItem = { tipo:'grupo', autor: userLabel, data: today, campo: campo, valor: valor, id_demanda: x.id }
      const historico = [histItem, ...(x.historico||[])]
      return { ...x, [campo]: valor, historico }
    }))
    const found = demandas.find(x=> String(x.id)===String(id))
    if (db && found) {
      try {
        const histItem = { tipo:'grupo', autor: userLabel, data: today, campo: campo, valor: valor, id_demanda: found.id }
        const qd = query(collection(db, DEM_COL), where('id','==', String(id)))
        const snap = await getDocs(qd)
        const tasks = []
        snap.forEach(d=> tasks.push(updateDoc(doc(db, DEM_COL, d.id), { ...found, [campo]: valor, historico: [histItem, ...(found.historico||[])] })))
        if (tasks.length) await Promise.all(tasks)
      } catch {}
    }
  }
  const onBulkUpdate = async (ids, patch) => {
    try {
      const isAdmin = (user?.role==='admin')
      const isDesigner = (user?.cargo==='Designer')
      if (!isAdmin && !isDesigner) return
      const arrIds = Array.isArray(ids) ? ids.map(String) : []
      const p = patch || {}
      const today = hojeISO()
      for (const id of arrIds) {
        if (p.status) {
          pendingRef.current[String(id)] = { ...(pendingRef.current[String(id)]||{}), status: p.status }
          try { await onStatus(id, p.status) } catch {}
        }
        for (const k of ['tipoMidia','origem','designer','dataCriacao']) {
          if (p[k]) {
            try {
              pendingRef.current[String(id)] = { ...(pendingRef.current[String(id)]||{}), [k]: p[k] }
              setDemandas(prev=> prev.map(x=> {
                if (String(x.id)!==String(id)) return x
                const histItem = { tipo:'grupo', autor: userLabel, data: today, campo: k, valor: p[k], id_demanda: x.id }
                return { ...x, [k]: p[k], historico: [histItem, ...(x.historico||[])] }
              }))
              if (db) {
                const found = demandas.find(x=> String(x.id)===String(id))
                const histItem = { tipo:'grupo', autor: userLabel, data: today, campo: k, valor: p[k], id_demanda: id }
                const qd = query(collection(db, DEM_COL), where('id','==', String(id)))
                const snap = await getDocs(qd)
                const tasks = []
                snap.forEach(d=> tasks.push(updateDoc(doc(db, DEM_COL, d.id), { [k]: p[k], historico: [histItem, ...((found?.historico)||[])] })))
                if (tasks.length) await Promise.all(tasks)
                try { const cur=pendingRef.current[String(id)]||{}; delete cur[k]; pendingRef.current[String(id)] = cur } catch {}
              }
            } catch {}
          }
        }
      }
    } catch {}
  }
  const onDelete = async (id) => {
    setDemandas(prev=> prev.map(x=> x.id===id ? ({ ...x, fxDeleting:true }) : x))
    setTimeout(()=>{ setDemandas(prev=> prev.filter(x=> x.id!==id)) }, 180)
    if (db) {
      try {
        const qd = query(collection(db, DEM_COL), where('id','==', String(id)))
        const snap = await getDocs(qd)
        const tasks = []
        snap.forEach(d=> tasks.push(deleteDoc(doc(db, DEM_COL, d.id))))
        if (tasks.length) await Promise.all(tasks)
      } catch {}
    }
  }

  const pushAlert = async (id, mensagem) => {
    const today = hojeISO()
    let updatedItem = null
    setDemandas(prev=> prev.map(x=>{
      if (x.id!==id) return x
      const exists = (x.historico||[]).some(h=> h.tipo==='alerta' && h.data===today && h.mensagem===mensagem)
      if (exists) { updatedItem = x; return x }
      const hist = { tipo:'alerta', autor: userLabel, data: today, data_hora_evento: new Date().toISOString(), mensagem, id_demanda: x.id }
      const next = { ...x, historico: [hist, ...(x.historico||[])] }
      updatedItem = next
      return next
    }))
    const found = updatedItem || demandas.find(x=> x.id===id)
    if (!found) return
    if (db) {
      try {
        const hist = { tipo:'alerta', autor: userLabel, data: today, data_hora_evento: new Date().toISOString(), mensagem, id_demanda: found.id }
        const qd = query(collection(db, DEM_COL), where('id','==', String(id)))
        const snap = await getDocs(qd)
        const tasks = []
        snap.forEach(d=> tasks.push(updateDoc(doc(db, DEM_COL, d.id), { ...found, historico: [hist, ...(found.historico||[])] })))
        if (tasks.length) await Promise.all(tasks)
      } catch {}
    }
  }

  useEffect(()=>{
    const timer = setInterval(()=>{
      const today = hojeISO()
      const active = demandas.filter(x=> !isDoneStatus(x.status))
      const porDesigner = active.reduce((m,x)=>{ const d=x.designer||'—'; m[d]=(m[d]||0)+1; return m }, {})
      active.forEach(x=>{
        if (x.prazo) {
          try {
            const [y,m,d]=String(x.prazo).split('-').map(Number)
            const end=new Date(y,(m||1)-1,(d||1)); end.setHours(0,0,0,0)
            const start=new Date(); start.setHours(0,0,0,0)
            if ((end-start)<=86400000) pushAlert(x.id, 'Prazo menor que 24h')
          } catch {}
        }
        const lastStatus = (x.historico||[]).find(h=> h.tipo==='status')
        if (lastStatus?.data_hora_evento || lastStatus?.data) {
          const ts = lastStatus.data_hora_evento ? Date.parse(lastStatus.data_hora_evento) : Date.parse(`${lastStatus.data}T00:00:00Z`)
          if (!isNaN(ts) && (Date.now()-ts)>= (48*3600000)) pushAlert(x.id, 'Demanda estagnada há 48h')
        }
        const dname = x.designer||'—'
        const ativos = porDesigner[dname]||0
        const capPct = Math.min(100, Math.round((ativos/4)*100))
        if (capPct>=100) pushAlert(x.id, `Capacidade 100% para ${dname} • Risco máximo`)
        else if (capPct>=85) pushAlert(x.id, `Designer ${dname} está com ${capPct}% da capacidade utilizada. Risco de atraso.`)
        if ((x.revisoes||0)>=2) pushAlert(x.id, 'Retrabalho acima do limite')
      })
      const concluidos = demandas.filter(x=> isDoneStatus(x.status))
      const slaOk = concluidos.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length
      const slaTot = concluidos.filter(x=> x.prazo && x.dataConclusao).length
      const slaPct = Math.round(100 * (slaOk/Math.max(1, slaTot)))
      if (slaPct<80) active.forEach(x=> pushAlert(x.id, 'SLA geral abaixo de 80%'))
    }, 60000)
    return ()=> clearInterval(timer)
  }, [demandas])
  const onSubmit = async ({ designer, tipoMidia, titulo, link, linkDrive, arquivoNome, dataSolic, dataCriacao, dataFeedback, plataforma, arquivos, descricao, prazo, comentarios, historico, origem, campanha }) => {
    const ensureCad = async () => {
      if (!db) return
      const up = async (coll, name)=>{ if (!name) return; try { await setDoc(doc(db, coll, String(name)), { name, active: true }, { merge: true }) } catch {} }
      try { await up('cad_tipos', tipoMidia) } catch {}
      try { await up('cad_plataformas', plataforma) } catch {}
      try { await up('cad_origens', origem) } catch {}
      try { if (historico && Array.isArray(historico)) { const last = historico[0]; const st = last?.para || last?.de || 'Aberta'; await up('cad_status', st) } } catch {}
    }
    if (modalMode==='edit' && editing) {
      const updated = { ...editing, designer, tipoMidia, titulo, link, linkDrive, descricao, comentarios: comentarios ?? editing.comentarios, historico: historico ?? editing.historico, arquivos: (arquivos && arquivos.length ? arquivos : editing.arquivos), arquivoNome: arquivoNome || editing.arquivoNome, dataSolicitacao: dataSolic || editing.dataSolicitacao, dataCriacao: dataCriacao || editing.dataCriacao, dataFeedback: dataFeedback || editing.dataFeedback, plataforma, prazo, origem, campanha }
      const updatedView = { ...updated, fxSavedAt: Date.now() }
      setDemandas(prev=> prev.map(x=> x.id===editing.id ? updatedView : x))
      if (db) { try { const qd=query(collection(db, DEM_COL), where('id','==', String(editing.id))); const snap=await getDocs(qd); const tasks=[]; snap.forEach(d=> tasks.push(updateDoc(doc(db, DEM_COL, d.id), updated))); if (tasks.length) await Promise.all(tasks) } catch {} }
      await ensureCad()
      try { await pushAlert(editing.id, 'Demanda salva') } catch {}
      try { window.alert('Demanda salva com sucesso!') } catch {}
    } else {
      const hoje = hojeISO()
      const nowIso = new Date().toISOString()
      const designerFinal = designer || user?.username || ''
      const inicial = { tipo:'status', autor: userLabel, data: hoje, data_hora_evento: nowIso, status_anterior: '', status_novo: 'Aberta', duracao_em_minutos: null, responsavel: designerFinal, id_demanda: null, de: '', para: 'Aberta' }
      const previsaoIA = calcPrevisaoIA(demandas, { designer: designerFinal, tipoMidia, prazo, revisoes: 0, plataforma, origem })
      const tmpId = `tmp-${Date.now()}`
      const novo = { id: tmpId, designer: designerFinal, tipoMidia, titulo, link, linkDrive, descricao, comentarios: [], historico: [inicial], arquivos: (arquivos||[]), arquivoNome, plataforma, origem, campanha, dataSolicitacao: dataSolic, dataCriacao: undefined, dataFeedback: undefined, status: 'Aberta', prazo, tempoProducaoMs: 0, startedAt: null, finishedAt: null, revisoes: 0, createdBy: userLabel, previsaoIA, slaStartAt: null, slaStopAt: null, slaPauseMs: 0, pauseStartedAt: null, slaNetMs: 0, slaOk: null, leadTotalMin: 0, leadPorFase: {} }
      setDemandas(prev=> [novo, ...prev])
      if (db) {
        try {
          const store = { ...novo, id: String(tmpId), createdAt: serverTimestamp() }
          if (store.dataSolicitacao === undefined) store.dataSolicitacao = null
          if (store.dataCriacao === undefined) store.dataCriacao = null
          if (store.dataFeedback === undefined) store.dataFeedback = null
          if (store.arquivoNome === undefined) store.arquivoNome = null
          await addDoc(collection(db, DEM_COL), store)
          const histFirst = { ...inicial, id_demanda: tmpId }
          try { await addDoc(collection(db,'historico_status'), histFirst) } catch {}
        } catch (e) {
          const msg = e?.code || e?.message || 'Falha ao gravar'
          try { window.alert(String(msg)) } catch {}
        }
      }
      await ensureCad()
      try { await pushAlert(tmpId, 'Demanda salva') } catch {}
      try { window.alert('Demanda salva com sucesso!') } catch {}
    }
    setModalOpen(false)
    setRoute('demandas')
  }

  const onResetSystem = async () => {
    if (!window.confirm('Confirmar: apagar TODAS as demandas e limpar relatórios?')) return
    setDemandas([])
    try { setFiltros({designer:'',status:'',plataforma:'',tipoMidia:'',origem:'',campanha:'',cIni:'',cFim:'',sIni:'',sFim:''}) } catch {}
    if (db) {
      try {
        const snap = await getDocs(collection(db, DEM_COL))
        const tasks = []
        snap.forEach(d=> tasks.push(deleteDoc(doc(db, DEM_COL, d.id))))
        if (tasks.length) await Promise.all(tasks)
      } catch {}
    }
  }

  

  return (
    <div className="layout">
      {user ? <Sidebar route={route} setRoute={setRoute} allowedRoutes={allowedRoutes} /> : null}
      <div className={`content ${user?'':'no-sidebar'} page`}>
        <div className="app">
          {user ? <Header onNew={onNew} view={view} setView={setView} showNew={!!user} user={user} onLogout={logout} mentions={myMentions} onOpenDemanda={(id)=>{ const found=demandas.find(x=> String(x.id)===String(id)); if(found){ setRoute('demandas'); onEdit(found) } }} /> : null}
          
          {!user && (
            <LoginView onLogin={login} />
          )}
          {user && route==='executivo' && allowedRoutes.includes('executivo') && (
            <ExecutiveDashboardView demandas={demandas} designers={designersVisible} filtros={filtros} setFiltros={setFiltros} loading={loading} user={user} onEdit={onEdit} setRoute={setRoute} setView={setView} />
          )}
          {user && route==='dashboard' && allowedRoutes.includes('dashboard') && (
            <DashboardView demandas={demandas} items={dashItems} designers={dashDesigners} setView={setView} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} onDelete={onDelete} onDuplicate={onDuplicate} compact={compact} calRef={calRef} setCalRef={setCalRef} loading={loading} setRoute={setRoute} setFiltros={setFiltros} user={user} />
          )}
          {user && route==='demandas' && allowedRoutes.includes('demandas') && (
            <div className="demandas-layout">
          <div className="content-col">
          <div className="top-filters">
            <FilterBar filtros={filtros} setFiltros={setFiltros} designers={designersVisible} showSearch={false} statusCounts={statusCounts} />
          </div>
          <div className="top-search">
            <input className="search" placeholder="Pesquisar demandas..." value={filtros.q||''} onChange={e=> setFiltros(prev=> ({ ...prev, q: e.target.value }))} />
            <button className="primary" onClick={onNew} disabled={!canCreate}><span className="icon"><Icon name="plus" /></span><span>Nova demanda</span></button>
            <div style={{display:'flex',alignItems:'center',gap:8,marginLeft:'auto'}}>
              <ViewButtonsInner view={view} setView={setView} />
            </div>
          </div>
          {revisarCount>0 && (
            <div className="alert-banner" title="Demandas em revisão">
              {(()=>{ const names=revisarDesigners; const namesStr = names.length<=2 ? names.join(' e ') : `${names.slice(0, names.length-1).join(', ')} e ${names[names.length-1]}`; const temStr = (names.length>1) ? 'têm' : 'tem'; const demStr = revisarCount>1 ? 'demandas' : 'demanda'; const msg = names.length ? `Atenção ${namesStr} ${temStr} ${revisarCount} ${demStr} com status para revisar — verifique e priorize` : `Atenção: ${revisarCount} ${demStr} com status para revisar — verifique e priorize`; return (<div className="alert-text">{msg}</div>) })()}
            </div>
          )}
          {view==='table' && (
              <div className="table-scroll">
                <TableView items={itemsVisible.slice(0, tableLimit)} onEdit={onEdit} onStatus={onStatus} cadStatus={cadStatus} cadTipos={cadTipos} cadOrigens={cadOrigens} designers={designersVisible} onBulkUpdate={onBulkUpdate} onDelete={onDelete} onDuplicate={onDuplicate} hasMore={itemsVisible.length>tableLimit} showMore={()=>setTableLimit(l=> Math.min(l+10, itemsVisible.length))} canCollapse={tableLimit>10} showLess={()=>setTableLimit(10)} shown={Math.min(tableLimit, itemsVisible.length)} total={itemsVisible.length} compact={compact} canEdit={((user?.role==='admin') || (user?.cargo==='Designer'))} canChangeStatus={!!user} loading={loading} />
              </div>
            )}
            {view==='calendar' && (
            <CalendarView items={itemsVisible} refDate={calRef} />
            )}
            <Modal open={modalOpen} mode={modalMode} onClose={()=>setModalOpen(false)} onSubmit={onSubmit} initial={editing} cadTipos={cadTipos} designers={designersVisible} cadPlataformas={cadPlataformas} onDelete={onDelete} userLabel={userLabel} canDelete={canDelete} onAddComment={onAddComment} cadOrigens={cadOrigens} currentUser={user?.username||''} usersAll={usersAll} canEdit={((user?.role==='admin') || (user?.cargo==='Designer'))} canChangeStatus={!!user} displayUser={displayUser} onStatus={onStatus} />
            <FilterModal open={filterOpen} filtros={filtros} setFiltros={setFiltros} designers={designersVisible} onClose={()=>setFilterOpen(false)} cadStatus={cadStatus} cadTipos={cadTipos} origens={cadOrigens} campanhas={campanhas} />
          </div>
            </div>
          )}
          {user && route==='config' && allowedRoutes.includes('config') && (
            <ConfigView themeVars={themeVars} setThemeVars={setThemeVars} onReset={onResetSystem} appSettings={appSettings} setAppSettings={setAppSettings} />
          )}
          {user && route==='cadastros' && allowedRoutes.includes('cadastros') && (
            <CadastrosView cadStatus={cadStatus} setCadStatus={setCadStatus} cadTipos={cadTipos} setCadTipos={setCadTipos} cadPlataformas={cadPlataformas} setCadPlataformas={setCadPlataformas} cadOrigens={cadOrigens} setCadOrigens={setCadOrigens} cadStatusColors={cadStatusColors} setCadStatusColors={setCadStatusColors} />
          )}
          {user && route==='relatorios' && allowedRoutes.includes('relatorios') && (
            <ReportsView demandas={demandas} items={itemsVisible} designers={designersVisible} filtros={filtros} setFiltros={setFiltros} loading={loading} onEdit={onEdit} setRoute={setRoute} setView={setView} />
          )}
          {user && route==='usuarios' && allowedRoutes.includes('usuarios') && (
            <UsersView role={role} />
          )}
          
        </div>
      </div>
    </div>
  )
}

class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={ hasError:false } }
  static getDerivedStateFromError(error){ return { hasError:true } }
  componentDidCatch(error, info){ try{ console.error(error, info) }catch{} }
  render(){ if(this.state.hasError){ return (
    <div className="page" style={{padding:20}}>
      <div className="panel" role="alert">Ocorreu um erro na aplicação.</div>
      <button className="primary" onClick={()=>{ try{ window.location.reload() }catch{} }}>Recarregar</button>
    </div>
  ) } return this.props.children }
}

export default function App(){
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}
function Sidebar({ route, setRoute, allowedRoutes }) {
  return (
    <aside className="sidebar">
      <nav>
        <ul className="nav-list">
          {allowedRoutes.map(r=> (
            <li key={r}><a href="#" className={`nav-link ${route===r?'active':''}`} onClick={e=>{ e.preventDefault(); setRoute(r) }}>
              <span className="nav-ico">{r==='executivo'?<Icon name="dashboard" />: r==='dashboard'?<Icon name="dashboard" />: r==='demandas'?<Icon name="demandas" />: r==='config'?<Icon name="config" />: r==='cadastros'?<Icon name="cadastros" />: r==='relatorios'?<Icon name="relatorios" />:<Icon name="usuarios" />}</span>
              <span>{r==='executivo'?'Executivo': r==='dashboard'?'Dashboard': r==='demandas'?'Demandas': r==='config'?'Configurações': r==='cadastros'?'Cadastros': r==='relatorios'?'Relatórios':'Usuários'}</span>
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
  const fns = useMemo(()=> (firebaseApp ? getFunctions(firebaseApp, 'us-central1') : null), [])
  const [pwdEdit, setPwdEdit] = useState({})
  useEffect(()=>{ if (db) { const unsub = onSnapshot(collection(db,'usuarios'), s=>{ const arr=[]; s.forEach(d=> arr.push({ id:d.id, ...d.data() })); setList(arr) }); return ()=>{ try{unsub()}catch{} } } else { setList([]) } },[])
  const [pages, setPages] = useState({ dashboard:true, demandas:true, config:true, cadastros:true, relatorios:true, usuarios:true })
  const [actions, setActions] = useState({ criar:true, excluir:true, visualizar:true })
  const toggle = (objSetter, key) => objSetter(prev=> ({ ...prev, [key]: !prev[key] }))
  const create = async ()=>{ if (role!=='admin') { try { window.alert('Apenas usuários com perfil admin podem criar novos usuários.') } catch {} ; return } const u=username.trim(); const em=(email.trim()||`${u}@betaki.bet.br`); if(!u||!password) return; const profile={ name: name||u, role: urole, cargo, pages, actions }; try { if (fns) { const call = httpsCallable(fns, 'createUser'); await call({ username: u, password, email: em, profile }); try { window.alert('Usuário criado com sucesso!') } catch {} } } catch (e) { try { if (fns) { const url = 'https://us-central1-mkt-betaki.cloudfunctions.net/createUser'; const call2 = httpsCallableFromURL(fns, url); await call2({ username: u, password, email: em, profile }); try { window.alert('Usuário criado com sucesso!') } catch {} } else { throw e } } catch (e2) { try { window.alert(String(e2?.code||e2?.message||'Falha ao criar usuário')) } catch {} } } setUsername(''); setName(''); setPassword(''); setEmail(''); setUrole('comum'); setCargo('Designer'); setPages({ dashboard:true, demandas:true, config:true, cadastros:true, relatorios:true, usuarios:true }); setActions({ criar:true, excluir:true, visualizar:true }) }
  const del = async (u)=>{
    if ((u.username||u.id)==='admin') return
    if (db) {
      try { await deleteDoc(doc(db,'usuarios', u.username||u.id)); setList(prev=> prev.filter(x=> (x.username||x.id)!==(u.username||u.id))) } catch {}
    }
  }
  const updatePwd = async (u)=>{
    const newPwd = String(pwdEdit[u.username||u.id]||'').trim()
    if (!newPwd) return
    if (fns) {
      try { const call = httpsCallable(fns, 'updateUserPassword'); await call({ username: u.username||u.id, password: newPwd, email: u.email||undefined }); setPwdEdit(prev=> ({ ...prev, [u.username||u.id]: '' })); try { window.alert('Senha atualizada com sucesso!') } catch {} } catch (e) { try { window.alert(String(e?.code||e?.message||'Falha ao atualizar senha')) } catch {} }
    }
  }
  const togglePage = async (u, key)=>{ const cur=u.pages||{}; const patch = { pages: { ...cur, [key]: !Boolean(cur[key]) } }; if (db) { try { await updateDoc(doc(db,'usuarios', u.username||u.id), patch); setList(prev=> prev.map(x=> (x.username===u.username||x.id===u.id) ? { ...x, ...patch } : x)) } catch {} } }
  const toggleAction = async (u, key)=>{ const cur=u.actions||{}; const patch = { actions: { ...cur, [key]: !Boolean(cur[key]) } }; if (db) { try { await updateDoc(doc(db,'usuarios', u.username||u.id), patch); setList(prev=> prev.map(x=> (x.username===u.username||x.id===u.id) ? { ...x, ...patch } : x)) } catch {} } }
  const updateCargo = async (u, value)=>{ const patch = { cargo: value }; if (db) { try { await updateDoc(doc(db,'usuarios', u.username||u.id), patch); setList(prev=> prev.map(x=> (x.username===u.username||x.id===u.id) ? { ...x, ...patch } : x)) } catch {} } }
  const updateRole = async (u, value)=>{ const patch = { role: value }; if (db) { try { await updateDoc(doc(db,'usuarios', u.username||u.id), patch); setList(prev=> prev.map(x=> (x.username===u.username||x.id===u.id) ? { ...x, ...patch } : x)) } catch {} } }
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
        <div className="modal-actions"><button className="primary" type="button" onClick={create} disabled={role!=='admin'}>Criar usuário</button></div>
      </div>
      <div className="section-divider" />
      <table className="report-matrix">
        <thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>Cargo</th><th>Páginas</th><th>Ações</th><th>Senha</th><th>Gerenciar</th></tr></thead>
        <tbody>
          {(list||[]).map(u=> (
            <tr key={u.username}>
              <td>{u.username}</td>
              <td>{u.name||u.username}</td>
              <td>
                {role==='admin' ? (
                  <select value={u.role||'comum'} onChange={e=> updateRole(u, e.target.value)}>
                    <option value="comum">Comum</option>
                    <option value="gerente">Gerente</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (u.role||'comum')}
              </td>
              <td>
                <select value={u.cargo||''} onChange={e=> updateCargo(u, e.target.value)}>
                  <option value="">Selecione</option>
                  <option value="Designer">Designer</option>
                  <option value="Social Media">Social Media</option>
                  <option value="Gerente">Gerente</option>
                  <option value="Externo">Externo</option>
                </select>
              </td>
              <td>
                <div className="chips">
                  {['dashboard','demandas','config','cadastros','relatorios','usuarios'].map(k=> (
                    <button key={k} className={`btn-md ${(u.pages?.[k]===true) ? 'active' : ''}`} type="button" onClick={()=> togglePage(u, k)} disabled={role!=='admin'}><span className="icon"><Icon name={k==='dashboard'?'dashboard': k==='demandas'?'demandas': k==='config'?'config': k==='cadastros'?'cadastros': k==='relatorios'?'relatorios':'usuarios'} /></span><span>{k==='dashboard'?'Dashboard': k==='demandas'?'Demandas': k==='config'?'Configurações': k==='cadastros'?'Cadastros': k==='relatorios'?'Relatórios':'Usuários'}</span></button>
                  ))}
                </div>
              </td>
              <td>
                <div className="chips">
                  {[['criar','plus','Criar'], ['excluir','trash','Excluir'], ['visualizar','table','Visualizar']].map(([k,ico,label])=> (
                    <button key={k} className={`btn-md ${(u.actions?.[k]===true) ? 'active' : ''}`} type="button" onClick={()=> toggleAction(u, k)} disabled={role!=='admin'}><span className="icon"><Icon name={ico} /></span><span>{label}</span></button>
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

 


function ConfigView({ themeVars, setThemeVars, onReset, appSettings, setAppSettings }) {
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
        <div className="card" style={{gridColumn:'1 / -1'}}>
          <div className="title">Integrações</div>
          <div className="form-row"><label>Auto‑post via mLabs</label>
            <input type="checkbox" checked={!!appSettings.autoPostMLabs} onChange={e=> setAppSettings(prev=> ({ ...prev, autoPostMLabs: e.target.checked }))} />
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
  const [advOpen, setAdvOpen] = useState(false)
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
    if (period==='nextweek') { const s=startOfISOWeek(d); s.setDate(s.getDate()+7); const e=endOfISOWeek(s); setFiltros(prev=>({ ...prev, sIni: toYMD(s), sFim: toYMD(e), cIni:'', cFim:'' })) }
    if (period==='month') setFiltros(prev=>({ ...prev, sIni: toYMD(startOfMonth), sFim: toYMD(endOfMonth), cIni:'', cFim:'' }))
    if (period==='lastmonth') setFiltros(prev=>({ ...prev, sIni: toYMD(startOfLastMonth), sFim: toYMD(endOfLastMonth), cIni:'', cFim:'' }))
    if (period==='last30') { const s = new Date(d); s.setDate(s.getDate()-29); setFiltros(prev=>({ ...prev, sIni: toYMD(s), sFim: toYMD(d), cIni:'', cFim:'' })) }
    if (period==='custom') { /* datas serão definidas pelo usuário via cIni/cFim; não alterar aqui */ }
  },[period])
  const setDesigner = (v) => setFiltros(prev=> ({ ...prev, designer: v==='Todos'?'':v }))
  const list = ['Hoje','Semana','Próxima semana','Mês','Mês passado','Período customizado']
  const keyOf = s => s==='Hoje'?'today': s==='Semana'?'week': s==='Próxima semana'?'nextweek': s==='Mês'?'month': s==='Mês passado'?'lastmonth':'custom'
  const designersKeys = ['Todos', ...designers]
  const colorOf = (s) => {
    if (s==='Pendente') return 'gray'
    if (s==='Em produção') return 'yellow'
    if (s==='Revisar') return 'red'
    if (s==='Aguardando Feedback') return 'purple'
    if (s==='Aprovada') return 'green-approve'
    if (s==='Concluida' || s==='Concluída') return 'green-dark'
    return ''
  }
  const emojiOf = (s) => {
    if (s==='Pendente') return '⏳'
    if (s==='Em produção') return '🎨'
    if (s==='Aguardando Feedback') return '💬'
    if (s==='Revisar') return '🛠'
    if (s==='Aprovada') return '✅'
    if (s==='Concluida' || s==='Concluída') return '🔒'
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
            lbl==='Período customizado' ? (
              <div key={lbl} className="date-pill" title="Período customizado">
                <span className="icon"><Icon name="calendar" /></span>
                <input type="date" value={filtros.cIni||''} onChange={e=> { setFiltros(prev=> ({ ...prev, cIni: e.target.value })); setPeriod('custom') }} />
                <span style={{color:'var(--muted)'}}>—</span>
                <input type="date" value={filtros.cFim||''} onChange={e=> { setFiltros(prev=> ({ ...prev, cFim: e.target.value })); setPeriod('custom') }} />
              </div>
            ) : (
              <button key={lbl} className={`btn-md ${period===keyOf(lbl)?'active':''}`} onClick={()=> setPeriod(keyOf(lbl))}>
                <span className="icon"><Icon name="calendar" /></span><span>{lbl}</span>
              </button>
            )
          ))}
        </div>
        <div className="seg">
          <div className="filter-title">Status</div>
            {FIXED_STATUS.map(s=> (
              <button key={s} className={`btn-md ${colorOf(s)} ${((filtros.status||'')===s)?'active':''}`} onClick={()=> setFiltros(prev=> ({ ...prev, status: prev.status===s ? undefined : s }))}>
                <span className="emoji">{emojiOf(s)}</span><span>{s}</span>{(statusCounts?.[s]>0) ? (<span className="alert-count">{statusCounts[s]}</span>) : null}
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
        <div className="seg" style={{marginLeft:'auto'}}>
          <button className="tertiary" type="button" onClick={()=> setAdvOpen(v=> !v)}>{advOpen? 'Ocultar Filtros Avançados' : 'Filtros Avançados'}</button>
        </div>
      </div>
    </div>
  )
}

function DashboardView({ demandas, items: itemsParam, designers, setView, onEdit, onStatus, cadStatus, onDelete, onDuplicate, compact, calRef, setCalRef, loading, setRoute, setFiltros, user }) {
  const isAdmin = (user?.role==='admin')
  const username = user?.username||''
  const items = !isAdmin ? (itemsParam||[]).filter(x=> {
    const d = String(x.designer||'').toLowerCase()
    const un = String(username||'').toLowerCase()
    const nm = String(user?.name||'').toLowerCase()
    return d===un || d===nm
  }) : (itemsParam||[])
  const total = items.length
  const concluidos = items.filter(x=> isDoneStatus(x.status))
  const produTotal = concluidos.length
  const backlog = items.filter(x=> isProdStatus(x.status)).length
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
  const designersList = !isAdmin ? [username] : designers
  const workloadRows = (()=>{
    const per = {}
    concluidos.forEach(x=>{ const d=x.designer||'—'; per[d]=(per[d]||0)+1 })
    const ideal = capacityPerDay * daysInPeriod
    return designersList.map(d=>{ const real = per[d]||0; const used = ideal ? Math.round(100*(real/ideal)) : 0; const status = ideal===0 ? 'Verde' : used<=90?'Verde': used<=110?'Amarelo':'Vermelho'; return { designer:d, ideal, real, used, status } })
  })()
  const ativosPorDesigner = (()=>{ const per={}; items.forEach(x=>{ if (!isDoneStatus(x.status)) { const d=x.designer||'—'; per[d]=(per[d]||0)+1 } }); return per })()
  
  const mensagensIA = (()=>{
    const msgs = []
    workloadRows.forEach(r=>{
      if (r.used>=110) msgs.push(`Designer ${r.designer} sobrecarregado (${r.used}%) • risco de atraso`)
      else if (r.used>=90) msgs.push(`Designer ${r.designer} com carga alta (${r.used}%) • monitorar prazos`)
      const ativos = ativosPorDesigner[r.designer]||0
      if (ativos >= (capacityPerDay*2)) msgs.push(`Designer ${r.designer} com ${ativos} demandas ativas • priorizar distribuição`)
    })
    const criticos = items.filter(x=> { if (isDoneStatus(x.status)) return false; if(!x.prazo) return false; const [y,m,d]=String(x.prazo).split('-').map(Number); const end=new Date(y,(m||1)-1,(d||1)); const start=new Date(); start.setHours(0,0,0,0); end.setHours(0,0,0,0); return (end-start)<=86400000 })
    criticos.slice(0,5).forEach(x=> msgs.push(`Prazo crítico: ${x.titulo} (${x.designer||'—'})`))
    if (msgs.length===0) {
      if (capacidadeUsadaPct<=70) msgs.push('Bom momento para antecipar demandas futuras.')
      msgs.push('Capacidade disponível para novos projetos.')
    }
    return msgs
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
  const now = new Date()
  const startM = new Date(now.getFullYear(), now.getMonth(), 1)
  const endM = new Date(now.getFullYear(), now.getMonth()+1, 0)
  const startPrev = new Date(now.getFullYear(), now.getMonth()-1, 1)
  const endPrev = new Date(now.getFullYear(), now.getMonth(), 0)
  const toD = s=>{ if(!s) return null; const [y,m,dd]=String(s).split('-').map(Number); if(!y) return null; return new Date(y,m-1,dd) }
  const inMonth = (dt, start, end)=>{ if(!dt) return false; dt.setHours(0,0,0,0); return dt>=start && dt<=end }
  const conclThis = items.filter(x=> isDoneStatus(x.status) && inMonth(toD(x.dataConclusao), startM, endM))
  const conclPrev = items.filter(x=> isDoneStatus(x.status) && inMonth(toD(x.dataConclusao), startPrev, endPrev))
  const createdThis = items.filter(x=> inMonth(toD(x.dataCriacao||x.dataSolicitacao), startM, endM))
  const createdPrev = items.filter(x=> inMonth(toD(x.dataCriacao||x.dataSolicitacao), startPrev, endPrev))
  const atrasadas = items.filter(x=> { if (isDoneStatus(x.status)) return false; if (!x.prazo) return false; const d=toD(x.prazo); const today=new Date(); today.setHours(0,0,0,0); return d && d<today })
  const backlogRisco = items.filter(x=> { if (isDoneStatus(x.status)) return false; if (!x.prazo) return false; const d=toD(x.prazo); const today=new Date(); today.setHours(0,0,0,0); if(!d) return false; const near=(d - today)<=86400000; return near }).length
  const slaPctThis = (()=>{ const ok=conclThis.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=conclThis.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const slaPctPrev = (()=>{ const ok=conclPrev.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=conclPrev.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const diffDays = (a,b)=>{ const da=toD(a), db=toD(b); if(!da||!db) return null; return Math.max(0, Math.round((db-da)/86400000)) }
  const leadAvg = arr=>{ const vals=arr.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) }
  const leadThis = leadAvg(conclThis)
  const leadPrev = leadAvg(conclPrev)
  const retrabThis = (()=>{ const tot=conclThis.length; const com=conclThis.filter(x=> (x.revisoes||0)>0).length; return Math.round(100*(com/Math.max(1,tot))) })()
  const retrabPrev = (()=>{ const tot=conclPrev.length; const com=conclPrev.filter(x=> (x.revisoes||0)>0).length; return Math.round(100*(com/Math.max(1,tot))) })()
  const prodThis = conclThis.length
  const prodPrev = conclPrev.length
  const criadasThis = createdThis.length
  const criadasPrev = createdPrev.length
  const dailySeries = (days, fn) => { const s=[]; const today=new Date(); for(let i=days-1;i>=0;i--){ const d=new Date(today); d.setDate(d.getDate()-i); const ymd=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; s.push(fn(ymd,d)) } return s }
  const seriesSla30 = dailySeries(30,(ymd,dt)=>{ const list=items.filter(x=> String(x.dataConclusao||'')===String(ymd)); const ok=list.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=list.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })
  const seriesLead30 = dailySeries(30,(ymd,dt)=>{ const list=items.filter(x=> String(x.dataConclusao||'')===String(ymd)); const vals=list.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return Math.round(avg||0) })
  const seriesProd30 = dailySeries(30,(ymd,dt)=> items.filter(x=> String(x.dataConclusao||'')===String(ymd)).length)
  const avgSla30 = Math.round(seriesSla30.reduce((a,b)=>a+b,0)/(seriesSla30.length||1))
  const avgLead30 = Math.round(seriesLead30.reduce((a,b)=>a+b,0)/(seriesLead30.length||1))
  const avgProd30 = Math.round(seriesProd30.reduce((a,b)=>a+b,0)/(seriesProd30.length||1))
  const labels30 = dailySeries(30,(ymd,dt)=> dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }))
  const attCard = (()=>{
    if (atrasadas.length>0) return { text:`⚠️ Existem ${atrasadas.length} demandas atrasadas hoje.`, tone:'alert', onClick:()=> goList({ sFim: (()=>{ const t=new Date(); t.setDate(t.getDate()-1); const p=n=>String(n).padStart(2,'0'); return `${t.getFullYear()}-${p(t.getMonth()+1)}-${p(t.getDate())}` })(), status:'' }) }
    const overList = designersList.map(d=>{ const ativos=ativosPorDesigner[d]||0; const used = Math.min(100, Math.round(100 * (ativos/(capacityPerDay*2||1)))); return { d, used } }).sort((a,b)=> b.used-a.used)
    const over = overList.find(x=> x.used>=80)
    if (over) return { text:`⚠️ ${over.d} está acima da capacidade ideal.`, tone:'warn', onClick:()=> goList({ designer: over.d }) }
    return { text:'✅ Nenhuma ação necessária hoje.', tone:'ok', onClick:null }
  })()
  const goList = (f)=>{ setRoute && setRoute('demandas'); setView && setView('table'); setFiltros && setFiltros(prev=> ({ ...prev, ...f })) }
  const funilExec = (()=>{ const tot=items.length||1; const criadas=items.length; const emProd=items.filter(x=> isProdStatus(x.status)).length; const revis=items.filter(x=> String(x.status||'').toLowerCase().includes('revis')).length; const concl=concluidos.length; const pct=n=> Math.round(100*(n/Math.max(1,tot))); return [
    { label:'Criadas', q: criadas, pct: pct(criadas), color:'#4DA3FF' },
    { label:'Em Produção', q: emProd, pct: pct(emProd), color:'#9AA0A6' },
    { label:'Em Revisão', q: revis, pct: pct(revis), color:'#FFE55C' },
    { label:'Concluídas', q: concl, pct: pct(concl), color:'#00C58E' },
  ] })()
  const scorecardData = designersList.map(d=> { const mine = items.filter(x=> (x.designer||'—')===d); const concl = concluidos.filter(x=> (x.designer||'—')===d); const conclCnt = concl.length; const sla = (()=>{ const ok=concl.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=concl.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })(); const lead = (()=>{ const vals=concl.map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })(); const ret = (()=>{ const tot=mine.length||1; const withRev=mine.filter(x=> (x.revisoes||0)>0).length; return Math.round(100*(withRev/Math.max(1,tot))) })(); const ideal=capacityPerDay*daysInPeriod; const ativos=ativosPorDesigner[d]||0; const used = ideal ? Math.min(100, Math.round(100*(ativos/ideal))) : 0; return { designer:d, concl:conclCnt, sla, lead, ret, used } })
  const sortedScore = scorecardData.slice().sort((a,b)=> b.sla!==a.sla? (b.sla-a.sla) : b.concl!==a.concl? (b.concl-a.concl) : b.ret!==a.ret? (a.ret-b.ret) : (a.lead-b.lead))
  const topAtraso = (()=>{ const map={}; items.forEach(x=>{ if(!isDoneStatus(x.status) && x.prazo && String(x.prazo)<String(hojeISO())){ const d=x.designer||'—'; map[d]=(map[d]||0)+1 } }); const arr=Object.entries(map).map(([designer,q])=>({designer,q})).sort((a,b)=> b.q-a.q); return arr[0]||null })()
  const topLead = (()=>{ const per={}; designersList.forEach(d=>{ const vals=concluidos.filter(x=> (x.designer||'—')===d).map(x=> diffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg = vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : null; if(avg!=null) per[d]=avg }); const arr=Object.entries(per).map(([designer,lead])=>({designer,lead})).sort((a,b)=> b.lead-a.lead); return arr[0]||null })()
  const topRet = (()=>{ const per={}; designersList.forEach(d=>{ const mine = items.filter(x=> (x.designer||'—')===d); const avg = mine.length ? +(mine.reduce((a,x)=> a+(x.revisoes||0),0)/mine.length).toFixed(2) : null; if(avg!=null) per[d]=avg }); const arr=Object.entries(per).map(([designer,ret])=>({designer,ret})).sort((a,b)=> b.ret-a.ret); return arr[0]||null })()
  if (loading) {
    return (
      <div className="dashboard">
        <div className="exec-summary">
          {Array.from({length:5}).map((_,i)=> (<div key={i} className="skeleton row"></div>))}
        </div>
        <div className="section-grid">
          {Array.from({length:2}).map((_,i)=> (<div key={i} className="skeleton card" style={{height:160}}></div>))}
        </div>
      </div>
    )
  }
  return (
    <div className="reports" data-loading={loading?'true':'false'}>
      <div className="reports-stack" style={{display:'block'}}>
        <div className="report-card" style={{padding:24,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.2)',marginBottom:32}}>
          <div className="report-title">Resumo Pessoal</div>
          <div className="kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(4, minmax(180px, 1fr))',gap:16}}>
            <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
              <div className="kpi-subtext" style={{color:'var(--muted)',marginBottom:6}}>Demandas atribuídas</div>
              <div className="kpi-number" style={{fontSize:32,fontWeight:800}}><CountUp value={total} /></div>
            </div>
            <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
              <div className="kpi-subtext" style={{color:'var(--muted)',marginBottom:6}}>Demandas concluídas</div>
              <div className="kpi-number" style={{fontSize:32,fontWeight:800}}><CountUp value={produTotal} /></div>
            </div>
            <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
              <div className="kpi-subtext" style={{color:'var(--muted)',marginBottom:6}}>Demandas em andamento</div>
              <div className="kpi-number" style={{fontSize:32,fontWeight:800}}><CountUp value={items.filter(x=> isProdStatus(x.status)).length} /></div>
            </div>
            <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
              <div className="kpi-subtext" style={{color:'var(--muted)',marginBottom:6}}>SLA pessoal</div>
              {(()=>{ const slaColor = slaGeralPct>=90? 'var(--status-success)' : (slaGeralPct>=70? 'var(--status-warning)' : 'var(--status-danger)'); const slaState = slaGeralPct>=90? 'ok' : (slaGeralPct>=70? 'warn' : 'danger'); return (
                <div className={`progress sla ${slaState}`} style={{height:16,background:'var(--bg-secondary)',borderRadius:10,overflow:'hidden'}} title="SLA pessoal">
                  <div className="progress-fill" style={{width:`${slaGeralPct}%`,height:'100%',background:slaColor}} />
                </div>
              ) })()}
            </div>
          </div>
        </div>
        <div className="report-card" style={{padding:24,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.2)',marginBottom:32}}>
          <div className="report-title">Funil Pessoal</div>
          <div className="section-divider" />
          {(()=>{ const tot=items.length||1; const criadas=items.length; const emProd=items.filter(x=> isProdStatus(x.status)).length; const revis=items.filter(x=> String(x.status||'').toLowerCase().includes('revis')).length; const concl=concluidos.length; const pct=n=> Math.round(100*(n/Math.max(1,tot))); const segs=
            [
            { label:'Criadas', q: criadas, pct: pct(criadas), color:'var(--status-info)' },
            { label:'Em produção', q: emProd, pct: pct(emProd), color:'var(--text-muted)' },
            { label:'Em revisão', q: revis, pct: pct(revis), color:'var(--status-warning)' },
            { label:'Concluídas', q: concl, pct: pct(concl), color:'var(--status-success)' },
          ]; return (
            <div>
              {segs.map((s,i)=> (
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,margin:'10px 0'}}>
                  <div style={{minWidth:160,color:'var(--muted)'}}>{s.label}</div>
                  <div style={{flex:1,background:'var(--bg-secondary)',borderRadius:10,overflow:'hidden'}} title={`${s.label}: ${s.q}`}>
                    <BarFill pct={s.pct} color={s.color} height={18} />
                  </div>
                  <div style={{minWidth:80,textAlign:'right'}}>{s.q}</div>
                </div>
              ))}
            </div>
          ) })()}
        </div>
        <div className="report-card" style={{padding:24,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.2)',marginBottom:32}}>
          <div className="report-title">Progresso Pessoal</div>
          <div className="section-divider" />
          {(()=>{ const totalMes = createdThis.length||1; const taxaConclusao = Math.round(100*((prodThis)/(Math.max(1,totalMes)))); const retrab = retrabThis; const metaSla=90; const slaColor = slaPctThis>=metaSla? 'var(--status-success)' : (slaPctThis>=70? 'var(--status-warning)' : 'var(--status-danger)'); const taxaColor = taxaConclusao>=70? 'var(--status-success)' : taxaConclusao>=40? 'var(--status-warning)' : 'var(--status-danger)'; const retrabColor = retrab<=15? 'var(--status-success)' : retrab<=30? 'var(--status-warning)' : 'var(--status-danger)'; return (
            <div className="kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(3, minmax(220px, 1fr))',gap:16}}>
              <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
                <div style={{color:'var(--muted)',marginBottom:6}}>Taxa de conclusão no período</div>
                <div className="progress" style={{height:16,background:'var(--bg-secondary)',borderRadius:10,overflow:'hidden'}}>
                  <div className="progress-fill" style={{width:`${taxaConclusao}%`,height:'100%',background:taxaColor}} />
                </div>
              </div>
              <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
                <div style={{color:'var(--muted)',marginBottom:6}}>Retrabalho pessoal</div>
                <div className="progress" style={{height:16,background:'var(--bg-secondary)',borderRadius:10,overflow:'hidden'}}>
                  <div className="progress-fill" style={{width:`${retrab}%`,height:'100%',background:retrabColor}} />
                </div>
              </div>
              <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
                <div style={{color:'var(--muted)',marginBottom:6}}>SLA pessoal vs meta</div>
                <div className="progress" style={{height:16,background:'var(--bg-secondary)',borderRadius:10,overflow:'hidden'}}>
                  <div className="progress-fill" style={{width:`${slaPctThis}%`,height:'100%',background:slaColor}} />
                </div>
              </div>
            </div>
          ) })()}
        </div>
        <div className="report-card" style={{padding:24,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.2)'}}>
          <div className="report-title">Minhas Demandas</div>
          <div className="section-divider" />
          {items.length===0 ? (
            <div className="empty-state"><span className="icon"><Icon name="table" /></span><span>Nenhuma demanda atribuída.</span></div>
          ) : (
          <table className="report-matrix" style={{whiteSpace:'nowrap',tableLayout:'fixed',width:'100%'}}>
            <thead><tr><th>Demanda</th><th>Status</th><th>Tipo</th><th>Prazo</th><th>SLA</th></tr></thead>
            <tbody>
              {items.map(it=>{ const okSla = !!(it.prazo && it.dataConclusao && it.dataConclusao<=it.prazo); const slaText = isDoneStatus(it.status) ? (okSla?'No prazo':'Estourado') : (it.prazo? '—':'—'); return (
                <tr key={it.id} className="row-clickable" onClick={()=> onEdit && onEdit(it)}>
                  <td>{it.titulo||'(sem título)'}</td>
                  <td>{it.status||'—'}</td>
                  <td>{it.tipoMidia||'—'}</td>
                  <td>{it.prazo||'—'}</td>
                  <td style={{color: (isDoneStatus(it.status)? (okSla?'#00C58E':'#FF5E5E') : 'var(--muted)')}}>{slaText}</td>
                </tr>
              ) })}
            </tbody>
          </table>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportsView({ demandas, items, designers, filtros, setFiltros, loading, onEdit, setRoute, setView }) {
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
  
  const [anaLimit, setAnaLimit] = useState(10)
  const toD = (s)=>{ if(!s) return null; const [y,m,d]=String(s).split('-').map(Number); if(!y) return null; return new Date(y,m-1,d) }
  const anaDiffDays = (a,b)=>{ const da=toD(a), db=toD(b); if(!da||!db) return null; return Math.max(0, Math.round((db-da)/86400000)) }
  const BASE_DEMANDAS_GLOBAL = useMemo(()=> Array.isArray(demandas) ? demandas : [], [demandas])
  const baseTotal = BASE_DEMANDAS_GLOBAL.length
  const anaConcl = BASE_DEMANDAS_GLOBAL.filter(x=> isDoneStatus(x.status))
  const slaPct = (()=>{ const ok=anaConcl.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=anaConcl.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const atrasadasList = BASE_DEMANDAS_GLOBAL.filter(x=> { if (isDoneStatus(x.status)) return false; if (!x.prazo) return false; const d=toD(x.prazo); const today=new Date(); today.setHours(0,0,0,0); return d && d<today })
  const atrasadasPct = Math.round(100*(atrasadasList.length/Math.max(1,baseTotal)))
  const leadMedio = (()=>{ const vals=anaConcl.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })()
  const retrabalhoMedio = (()=>{ const arr=anaConcl.map(x=> x.revisoes||0); const avg=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return +(avg||0).toFixed(2) })()
  const capacityPerDay = 4
  const designersCount = designers.length||1
  const anaDaysInPeriod = (()=>{ const ds=BASE_DEMANDAS_GLOBAL.map(x=> toD(x.dataCriacao||x.dataSolicitacao)).filter(Boolean).sort((a,b)=> a-b); if(!ds.length) return 1; return Math.max(1, Math.round((ds[ds.length-1]-ds[0])/86400000)+1) })()
  const capacidadeMedia = (()=>{ const ideal=designersCount*capacityPerDay*anaDaysInPeriod; const conclQt=anaConcl.length; return Math.round(100*(conclQt/Math.max(1,ideal))) })()
  const distPorDesigner = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const d=x.designer||'—'; per[d]=(per[d]||0)+1 }); const tot=baseTotal||1; return Object.entries(per).map(([designer,q])=> ({ designer, q, pct: Math.round(100*(q/tot)) })).sort((a,b)=> b.q-a.q) })()
  const distPorStatus = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const s=x.status||'—'; per[s]=(per[s]||0)+1 }); return Object.entries(per).map(([status,q])=> ({ status, q })).sort((a,b)=> b.q-a.q) })()
  const distPorTipo = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const t=x.tipoMidia||'Outro'; per[t]=(per[t]||0)+1 }); return Object.entries(per).map(([tipo,q])=> ({ tipo, q })).sort((a,b)=> b.q-a.q) })()
  const distPorCanal = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const o=x.origem||'Outros'; per[o]=(per[o]||0)+1 }); return Object.entries(per).map(([origem,q])=> ({ origem, q })).sort((a,b)=> b.q-a.q) })()
  const leadPorDesignerA = (()=>{ const per={}; anaConcl.forEach(x=>{ const d=x.designer||'—'; const t=anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao); if (t!=null) { const cur=per[d]||{cnt:0,sum:0}; per[d]={ cnt:cur.cnt+1, sum:cur.sum+t } } }); return Object.entries(per).map(([designer,v])=> ({ designer, media:+((v.sum/(v.cnt||1)).toFixed(1)) })).sort((a,b)=> a.media-b.media) })()
  const retrabPorTipoA = (()=>{ const per={}; anaConcl.forEach(x=>{ const t=x.tipoMidia||'Outro'; const r=x.revisoes||0; const cur=per[t]||{ rTot:0, cnt:0 }; per[t]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([tipo,v])=> ({ tipo, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const topAtraso = atrasadasList.map(x=>{ const dd=toD(x.prazo); const today=new Date(); today.setHours(0,0,0,0); const late = dd? Math.max(0, Math.round((today-dd)/86400000)) : 0; return { ...x, atrasoDias: late } }).sort((a,b)=> b.atrasoDias-a.atrasoDias).slice(0,5)
  const topLead = anaConcl.map(x=>{ const lt=anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)||0; return { ...x, leadDias: lt } }).sort((a,b)=> b.leadDias-a.leadDias).slice(0,5)
  const topRev = anaConcl.slice().sort((a,b)=> (b.revisoes||0)-(a.revisoes||0)).slice(0,5)
  const daysInPeriod = (()=>{
    const toD2 = s=>{ if(!s) return null; const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd) }
    const s = toD2(filtros.cIni), e = toD2(filtros.cFim)
    if (!s || !e) return 1
    return Math.max(1, Math.round((e - s)/86400000) + 1)
  })()
  const concluidos = BASE_DEMANDAS_GLOBAL.filter(x=> isDoneStatus(x.status))
  const pendentes = BASE_DEMANDAS_GLOBAL.filter(x=> isPendingStatus(x.status))
  const emProducao = BASE_DEMANDAS_GLOBAL.filter(x=> isProdStatus(x.status))
  const revisoesTot = BASE_DEMANDAS_GLOBAL.reduce((acc,x)=> acc + (x.revisoes||0), 0)
  const produtividadeMedia = concluidos.length / daysInPeriod
  const backlogItems = BASE_DEMANDAS_GLOBAL.filter(x=> !isDoneStatus(x.status))
  const diasRestantes = (p)=>{ if(!p) return null; const [y,m,d]=String(p).split('-').map(Number); const end=new Date(y,(m||1)-1,(d||1)); const start=new Date(); start.setHours(0,0,0,0); end.setHours(0,0,0,0); return Math.round((end - start)/86400000) }
  const backlogRisco = backlogItems.filter(x=> { const dl=diasRestantes(x.prazo); return dl!=null && dl<=2 })
  const prazoMedioBacklog = (()=>{ const arr=backlogItems.map(x=> diasRestantes(x.prazo)).filter(v=> v!=null); const avg = (arr.reduce((a,b)=>a+b,0)/(arr.length||1)); return +avg.toFixed(1) })()
  const atrasoPct = (()=>{ const overdue = backlogItems.filter(x=> { const dl=diasRestantes(x.prazo); return dl!=null && dl<0 }).length; const total=backlogItems.length||1; return Math.round(100*(overdue/total)) })()
  const estadoBacklog = atrasoPct>30 ? 'Acumulando atraso' : 'Saudável'
  const leadTimes = concluidos.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null)
  const leadTimeMedio = +((leadTimes.reduce((a,b)=>a+b,0)/(leadTimes.length||1)).toFixed(1))
  const leadPorTipo = (()=>{ const per={}; concluidos.forEach(x=>{ const t=x.tipoMidia||'Outro'; const lt=anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao); if(lt!=null){ const cur=per[t]||{cnt:0,sum:0}; per[t]={ cnt:cur.cnt+1, sum:cur.sum+lt } } }); return Object.entries(per).map(([tipo,v])=> ({ tipo, media:+((v.sum/v.cnt).toFixed(1)) })) })()
  const leadPorDesigner = (()=>{ const per={}; concluidos.forEach(x=>{ const d=x.designer||'—'; const lt=anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao); if(lt!=null){ const cur=per[d]||{cnt:0,sum:0}; per[d]={ cnt:cur.cnt+1, sum:cur.sum+lt } } }); return Object.entries(per).map(([designer,v])=> ({ designer, media:+((v.sum/v.cnt).toFixed(1)) })) })()
  const mesAtual = new Date(); const mesPassado = new Date(mesAtual.getFullYear(), mesAtual.getMonth()-1, 1)
  const inMonth = (iso, m)=>{ if(!iso) return false; const [y,mm,dd]=iso.split('-').map(Number); const dt=new Date(y,mm-1,dd); return dt.getMonth()===m.getMonth() && dt.getFullYear()===m.getFullYear() }
  const ltMesAtual = concluidos.filter(x=> inMonth(x.dataConclusao, mesAtual)).map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null)
  const ltMesPassado = concluidos.filter(x=> inMonth(x.dataConclusao, mesPassado)).map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null)
  const compMesAtual = +((ltMesAtual.reduce((a,b)=>a+b,0)/(ltMesAtual.length||1)).toFixed(1))
  const compMesPassado = +((ltMesPassado.reduce((a,b)=>a+b,0)/(ltMesPassado.length||1)).toFixed(1))
  const ltDesigner = (name)=>{ const arr=concluidos.filter(x=> (x.designer||'')===name).map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); return +((arr.reduce((a,b)=>a+b,0)/(arr.length||1)).toFixed(1)) }
  const revDistrib = (()=>{ const arr=concluidos.map(x=> x.revisoes||0); const tot=arr.length||1; const z=(n)=> Math.round(100*((arr.filter(v=> v===n).length)/tot)); const g=(pred)=> Math.round(100*((arr.filter(pred).length)/tot)); return { sRev:z(0), umaRev:z(1), duasMais:g(v=> v>=2) } })()
  const retrabalhoPorDesigner = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const d=x.designer||'—'; const r=x.revisoes||0; const cur=per[d]||{ rTot:0, cnt:0 }; per[d]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([designer,v])=> ({ designer, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const retrabalhoPorTipo = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const t=x.tipoMidia||'Outro'; const r=x.revisoes||0; const cur=per[t]||{ rTot:0, cnt:0 }; per[t]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([tipo,v])=> ({ tipo, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const porCanal = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const o=x.origem||'Outros'; per[o]=(per[o]||0)+1 }); const total=baseTotal||1; return Object.entries(per).map(([origem,q])=> ({ origem, q, pct: Math.round(100*(q/total)) })) })()
  const retrabPorCanal = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const o=x.origem||'Outros'; const r=x.revisoes||0; const cur=per[o]||{ rTot:0, cnt:0 }; per[o]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([origem,v])=> ({ origem, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const prodPorCanal = (()=>{ const per={}; anaConcl.forEach(x=>{ const o=x.origem||'Outros'; per[o]=(per[o]||0)+1 }); return Object.entries(per).map(([origem,q])=> ({ origem, q })).sort((a,b)=> b.q-a.q) })()
  const porHora = (()=>{ const per={}; concluidos.forEach(x=>{ const iso=x.finishedAt; if(!iso) return; const h=new Date(iso).getHours(); per[h]=(per[h]||0)+1 }); return per })()
  const tempoMedioReal = (()=>{ const arr=concluidos.map(x=> Number(x.tempoProducaoMs||0)).filter(v=> v>0); const avgMs=(arr.reduce((a,b)=>a+b,0)/(arr.length||1)); const toH=(ms)=> (ms/3600000); return +(toH(avgMs).toFixed(2)) })()
  const velocidadeRanking = (()=>{ const per={}; concluidos.forEach(x=>{ const d=x.designer||'—'; const ms=Number(x.tempoProducaoMs||0); const cur=per[d]||{ cnt:0, sum:0 }; per[d]={ cnt:cur.cnt+1, sum:cur.sum+ms } }); return Object.entries(per).map(([designer,v])=> ({ designer, horas: +((v.sum/(v.cnt||1)/3600000).toFixed(2)) })).sort((a,b)=> a.horas-b.horas) })()
  const qualidadeRanking = retrabalhoPorDesigner.slice().sort((a,b)=> a.porPeca-b.porPeca)
  const porCampanha = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const c=x.campanha||'—'; per[c]=(per[c]||0)+1 }); return Object.entries(per).map(([campanha,q])=> ({ campanha, q })).sort((a,b)=> b.q-a.q) })()
  const retrabCampanha = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ const c=x.campanha||'—'; const r=x.revisoes||0; const cur=per[c]||{ rTot:0, cnt:0 }; per[c]={ rTot:cur.rTot+r, cnt:cur.cnt+1 } }); return Object.entries(per).map(([campanha,v])=> ({ campanha, porPeca:+((v.rTot/(v.cnt||1)).toFixed(2)) })).sort((a,b)=> b.porPeca-a.porPeca) })()
  const slaCampanha = (()=>{ const per={}; BASE_DEMANDAS_GLOBAL.forEach(x=>{ if (x.campanha) { const c=x.campanha; const ok=!!(x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo); const tot=!!(x.prazo && x.dataConclusao); const cur=per[c]||{ ok:0, total:0 }; per[c]={ ok:cur.ok+(ok?1:0), total:cur.total+(tot?1:0) } } }); return Object.entries(per).map(([campanha,v])=> ({ campanha, sla: Math.round(100*((v.ok/(v.total||1)))) })) })()
  const inRange = (iso) => { if(!iso) return false; const [y,m,d]=String(iso).split('-').map(Number); if(!y) return false; const dt=new Date(y,m-1,d); const s=toD(filtros.cIni), e=toD(filtros.cFim); if(!s||!e) return true; dt.setHours(0,0,0,0); s.setHours(0,0,0,0); e.setHours(0,0,0,0); return dt>=s && dt<=e }
  const createdInPeriod = BASE_DEMANDAS_GLOBAL.filter(x=> inRange(x.prazo))
  const totalCriadas = createdInPeriod.filter(x=> isPendingStatus(x.status)).length
  const totalAndamento = createdInPeriod.filter(x=> isProdStatus(x.status)).length
  const totalRevisao = createdInPeriod.filter(x=> { const v=String(x.status||'').toLowerCase(); return v.includes('revisar') }).length
  const totalConcluidas = BASE_DEMANDAS_GLOBAL.filter(x=> isDoneStatus(x.status) && inRange(x.prazo)).length
  const kpiInconsistencia = (baseTotal>0) && ([totalCriadas,totalAndamento,totalRevisao,totalConcluidas].some(v=> v===0))
  const statusPeriod = (()=>{ const per={}; createdInPeriod.forEach(x=>{ const s=x.status||'—'; per[s]=(per[s]||0)+1 }); const tot=createdInPeriod.length||1; return Object.entries(per).map(([status,q])=> ({ status, q, pct: Math.round(100*(q/tot)) })).sort((a,b)=> b.q-a.q) })()
  const designerPeriod = (()=>{ const per={}; createdInPeriod.forEach(x=>{ const d=x.designer||'—'; per[d]=(per[d]||0)+1 }); const tot=createdInPeriod.length||1; return Object.entries(per).map(([designer,q])=> ({ designer, q, pct: Math.round(100*(q/tot)) })).sort((a,b)=> b.q-a.q) })()
  const tipoPeriod = (()=>{ const per={}; createdInPeriod.forEach(x=>{ const t=x.tipoMidia||'Outro'; per[t]=(per[t]||0)+1 }); const tot=createdInPeriod.length||1; return Object.entries(per).map(([tipo,q])=> ({ tipo, q, pct: Math.round(100*(q/tot)) })).sort((a,b)=> b.q-a.q) })()
  const funil = (()=>{ const tot=createdInPeriod.length||1; const criadas=totalCriadas; const emProd=totalAndamento; const revis=totalRevisao; const concl=BASE_DEMANDAS_GLOBAL.filter(x=> isDoneStatus(x.status) && inRange(x.prazo)).length; const pct = (n)=> Math.round(100*(n/Math.max(1,tot))); return [
    { label:'Criadas', q: criadas, pct: pct(criadas), color:'#4DA3FF' },
    { label:'Em produção', q: emProd, pct: pct(emProd), color:'#3b82f6' },
    { label:'Em revisão', q: revis, pct: pct(revis), color:'#9B59B6' },
    { label:'Concluídas', q: concl, pct: pct(concl), color:'#10b981' },
  ] })()
  const topAtrasoPeriod = (()=>{ const today=new Date(); today.setHours(0,0,0,0); return createdInPeriod.filter(x=> { if (isDoneStatus(x.status)) return false; if (!x.prazo) return false; const [y,m,d]=String(x.prazo).split('-').map(Number); const dd=new Date(y,m-1,d); dd.setHours(0,0,0,0); return dd<today }).map(x=>{ const [y,m,d]=String(x.prazo).split('-').map(Number); const dd=new Date(y,m-1,d); dd.setHours(0,0,0,0); const late=Math.max(0, Math.round((today-dd)/86400000)); return { ...x, atrasoDias: late } }).sort((a,b)=> b.atrasoDias-a.atrasoDias).slice(0,5) })()
  const topLeadPeriod = (()=>{ const arr=createdInPeriod.filter(x=> isDoneStatus(x.status)).map(x=> ({ ...x, leadDias: anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)||0 })); return arr.sort((a,b)=> b.leadDias-a.leadDias).slice(0,5) })()
  const topRevPeriod = createdInPeriod.slice().sort((a,b)=> (b.revisoes||0)-(a.revisoes||0)).slice(0,5)
  const conclMesAtual = BASE_DEMANDAS_GLOBAL.filter(x=> isDoneStatus(x.status) && inMonth(x.dataConclusao, mesAtual))
  const conclMesPassado = BASE_DEMANDAS_GLOBAL.filter(x=> isDoneStatus(x.status) && inMonth(x.dataConclusao, mesPassado))
  const prodAtual = conclMesAtual.length
  const prodPassado = conclMesPassado.length
  const slaAtual = (()=>{ const ok=conclMesAtual.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=conclMesAtual.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const slaPassado = (()=>{ const ok=conclMesPassado.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=conclMesPassado.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const leadAtual = (()=>{ const vals=conclMesAtual.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })()
  const leadPassado = (()=>{ const vals=conclMesPassado.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })()
  const retAtual = (()=>{ const tot=conclMesAtual.length||1; const sum=conclMesAtual.reduce((a,x)=> a + (x.revisoes||0), 0); return +(sum/tot).toFixed(2) })()
  const retPassado = (()=>{ const tot=conclMesPassado.length||1; const sum=conclMesPassado.reduce((a,x)=> a + (x.revisoes||0), 0); return +(sum/tot).toFixed(2) })()
  const seriesProdPeriod = (()=>{ const days=14; const s=[]; const today=new Date(); for(let i=days-1;i>=0;i--){ const d=new Date(today); d.setDate(d.getDate()-i); const ymd=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; s.push(BASE_DEMANDAS_GLOBAL.filter(x=> String(x.dataConclusao||'')===ymd).length) } return s })()
  const goDetail = (id)=>{ try{ const found=demandas.find(x=> String(x.id)===String(id)); if(found){ setRoute && setRoute('demandas'); setView && setView('table'); onEdit && onEdit(found) } }catch{} }
  
  const daysInPeriodRep = (()=>{ const s=toD(filtros.cIni), e=toD(filtros.cFim); if(!s||!e) return 1; return Math.max(1, Math.round((e - s)/86400000) + 1) })()
  const ativosPorDesignerPeriod = (()=>{ const per={}; createdInPeriod.forEach(x=>{ if(!isDoneStatus(x.status)){ const d=x.designer||'—'; per[d]=(per[d]||0)+1 } }); return per })()
  const scorecardData = designers.map(d=> { const mine = createdInPeriod.filter(x=> (x.designer||'—')===d); const concl = mine.filter(x=> isDoneStatus(x.status)); const conclCnt = concl.length; const sla = (()=>{ const ok=concl.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=concl.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })(); const lead = (()=>{ const vals=concl.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })(); const ret = (()=>{ const tot=mine.length||1; const withRev=mine.filter(x=> (x.revisoes||0)>0).length; return Math.round(100*(withRev/Math.max(1,tot))) })(); const ideal=capacityPerDay*daysInPeriodRep; const ativos=ativosPorDesignerPeriod[d]||0; const used = ideal ? Math.min(100, Math.round(100*(ativos/ideal))) : 0; return { designer:d, concl:conclCnt, sla, lead, ret, used } })
  const [scoreSort, setScoreSort] = useState('concl')
  const sortedScore = scorecardData.slice().sort((a,b)=> scoreSort==='sla'? (b.sla-a.sla) : scoreSort==='lead'? (a.lead-b.lead) : scoreSort==='ret'? (a.ret-b.ret) : (b.concl-a.concl))
  if (loading) {
    return (
      <div className="reports">
        <div className="reports-toolbar">
          <div className="skeleton row" style={{width:'50%'}}></div>
        </div>
  <div className="reports-grid" id="master-report">
        <div className="report-card">
          <div className="report-title">Dashboard Analítico 360°</div>
          <div className="chips">
            <span className="chip">Total: {total}</span>
            <span className="chip">SLA: {slaPct}%</span>
            <span className="chip">Atrasadas: {atrasadasPct}%</span>
            <span className="chip">Lead médio: {leadMedio}d</span>
            <span className="chip">Retrabalho médio: {retrabahoMedio ?? retrabalhoMedio}</span>
            <span className="chip">Capacidade média: {capacidadeMedia}%</span>
          </div>
          <div className="section-divider" />
          <div className="reports-grid">
            <div className="report-card">
              <div className="report-title">Distribuições</div>
              <div className="chips">
                {distPorDesigner.slice(0,6).map(d=> (<span key={d.designer} className="chip">{d.designer}: {d.pct}%</span>))}
              </div>
              <div className="chips">
                {distPorStatus.slice(0,6).map(s=> (<span key={s.status} className="chip">{s.status}: {s.q}</span>))}
              </div>
              <div className="chips">
                {distPorTipo.slice(0,6).map(t=> (<span key={t.tipo} className="chip">{t.tipo}: {t.q}</span>))}
              </div>
              <div className="chips">
                {distPorCanal.slice(0,6).map(c=> (<span key={c.origem} className="chip">{c.origem}: {c.q}</span>))}
              </div>
              <div className="chips">
                {leadPorDesignerA.slice(0,6).map(r=> (<span key={r.designer} className="chip">{r.designer}: {r.media}d</span>))}
              </div>
              <div className="chips">
                {retrabPorTipoA.slice(0,6).map(r=> (<span key={r.tipo} className="chip">{r.tipo}: {r.porPeca}</span>))}
              </div>
            </div>
            <div className="report-card">
              <div className="report-title">Alertas Operacionais</div>
              <div className="section-divider" />
              <table className="report-matrix">
                <thead><tr><th>Mais atrasadas</th><th>Designer</th><th>Atraso(d)</th></tr></thead>
                <tbody>
                  {topAtraso.map(x=> (<tr key={x.id}><td>{x.titulo}</td><td>{x.designer||'—'}</td><td style={{color:'#FF5E5E'}}>{x.atrasoDias}</td></tr>))}
                </tbody>
              </table>
              <div className="section-divider" />
              <table className="report-matrix">
                <thead><tr><th>Maiores lead times</th><th>Designer</th><th>Lead(d)</th></tr></thead>
                <tbody>
                  {topLead.map(x=> (<tr key={x.id}><td>{x.titulo}</td><td>{x.designer||'—'}</td><td>{x.leadDias}</td></tr>))}
                </tbody>
              </table>
              <div className="section-divider" />
              <table className="report-matrix">
                <thead><tr><th>Mais revisões</th><th>Designer</th><th>Revisões</th></tr></thead>
                <tbody>
                  {topRev.map(x=> (<tr key={x.id}><td>{x.titulo}</td><td>{x.designer||'—'}</td><td>{x.revisoes||0}</td></tr>))}
                </tbody>
              </table>
            </div>
            <div className="report-card">
              <div className="report-title">Tabela Resumida</div>
              <div className="section-divider" />
              <table className="report-matrix">
                <thead><tr><th>Título</th><th>Designer</th><th>Status</th><th>Prazo</th><th>Atraso(d)</th><th>Lead(d)</th><th>Revisões</th></tr></thead>
                <tbody>
                  {items.slice(0, anaLimit).map(it=>{ const atraso = (!isDoneStatus(it.status) && it.prazo && String(it.prazo)<String(hojeISO())) ? (Math.max(0, Math.round((new Date().setHours(0,0,0,0) - toD(it.prazo).setHours(0,0,0,0))/86400000))) : 0; const lead = (isDoneStatus(it.status) ? (anaDiffDays(it.dataCriacao||it.dataSolicitacao, it.dataConclusao)||0) : null); return (
                    <tr key={it.id} className="row-clickable" onClick={()=>{ try{ document.getElementById('master-report')?.scrollIntoView({ behavior:'smooth' }) }catch{} }}>
                      <td>{it.titulo||'(sem título)'}</td>
                      <td>{it.designer||'—'}</td>
                      <td>{it.status||'—'}</td>
                      <td>{it.prazo||'—'}</td>
                      <td style={{color: atraso>0?'#FF5E5E':'var(--muted)'}}>{atraso||0}</td>
                      <td>{lead!=null?lead:'—'}</td>
                      <td>{it.revisoes||0}</td>
                    </tr>
                  ) })}
                </tbody>
              </table>
              <div className="table-footer">
                {items.length>anaLimit && <button className="primary" type="button" onClick={()=> setAnaLimit(l=> Math.min(l+10, items.length))}>Mostrar mais</button>}
                {anaLimit>10 && <button className="tertiary" type="button" onClick={()=> setAnaLimit(10)}>Mostrar menos</button>}
              </div>
            </div>
          </div>
        </div>
          {Array.from({length:3}).map((_,i)=> (<div key={i} className="skeleton card" style={{height:180}}></div>))}
        </div>
      </div>
    )
  }
  const inconsistencia = (baseTotal>0 && items.length===0)
  return (
    <div className="reports" data-loading={loading?'true':'false'}>
      <div className="reports-toolbar">
        <div className="chips">
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
        </div>
      </div>
      
      <div className="reports-stack" style={{display:'block'}}>
        <div className="report-card">
          <div className="report-title">Resumo Geral das Demandas</div>
          <div className="kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(6, minmax(160px, 1fr))',gap:16}}>
            <div className="kpi-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
              <div className="icon" style={{fontSize:20}}>📌</div>
              <div className="kpi-number" style={{fontSize:28,fontWeight:700}}><CountUp value={totalCriadas} /></div>
              <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>Criadas</div>
            </div>
            <div className="kpi-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
              <div className="icon" style={{fontSize:20}}>⏳</div>
              <div className="kpi-number" style={{fontSize:28,fontWeight:700}}><CountUp value={totalAndamento} /></div>
              <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>Em produção</div>
            </div>
            <div className="kpi-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
              <div className="icon" style={{fontSize:20}}>🛠</div>
              <div className="kpi-number" style={{fontSize:28,fontWeight:700}}><CountUp value={totalRevisao} /></div>
              <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>Em revisão</div>
            </div>
            <div className="kpi-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
              <div className="icon" style={{fontSize:20}}>✅</div>
              <div className="kpi-number" style={{fontSize:28,fontWeight:700}}><CountUp value={totalConcluidas} /></div>
              <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>Concluídas</div>
            </div>
            <div className="kpi-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
              <div className="icon" style={{fontSize:20}}>📈</div>
              <div className="kpi-number" style={{fontSize:28,fontWeight:700}}><CountUp value={slaPct} suffix="%" /></div>
              <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>SLA geral</div>
            </div>
            <div className="kpi-card" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
              <div className="icon" style={{fontSize:20}}>⏱</div>
              <div className="kpi-number" style={{fontSize:28,fontWeight:700}}><CountUp value={leadMedio} suffix="d" /></div>
              <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>Lead Time médio</div>
            </div>
          </div>

        </div>
        <div className="report-card" style={{gridColumn:'1',padding:24,borderRadius:8,boxShadow:'0 6px 16px rgba(0,0,0,0.12)'}}>
          <div className="report-title">Funil de Status</div>
          <div className="section-divider" />
          <div>
            {funil.map((s,i)=> (
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,margin:'6px 0'}}>
                <div style={{minWidth:140,color:'var(--muted)'}}>{s.label}</div>
                <div style={{flex:1,background:'#222',borderRadius:6,overflow:'hidden'}} title={`${s.label}: ${s.q} (${s.pct}%)`}>
                  <BarFill pct={s.pct} color={s.color} height={14} />
                </div>
                <div style={{minWidth:80,textAlign:'right'}}>{s.q} • {s.pct}%</div>
              </div>
            ))}
          </div>
        </div>
        <div className="report-card" style={{gridColumn:'2',padding:24,borderRadius:8,boxShadow:'0 6px 16px rgba(0,0,0,0.12)'}}>
          <div className="report-title">Scorecard por Designer</div>
          <div className="section-divider" />
          <table className="report-matrix" style={{whiteSpace:'nowrap',tableLayout:'fixed',width:'100%'}}>
            <thead><tr><th>Designer</th><th>Concluídas</th><th>SLA %</th><th>Lead Time(d)</th><th>Retrabalho %</th></tr></thead>
            <tbody>
              {sortedScore.map(r=> (
                <tr key={r.designer}><td>{r.designer}</td><td>{r.concl}</td><td style={{color:r.sla>=90?'#00C58E': r.sla>=70?'#FFE55C':'#FF5E5E'}}>{r.sla}</td><td style={{color:r.lead<=2?'#00C58E':'var(--muted)'}}>{r.lead}</td><td>{r.ret>=30? (<span style={{background:'#FF5E5E22',color:'#FF5E5E',padding:'2px 6px',borderRadius:8}}>{r.ret}%</span>) : (<span>{r.ret}%</span>)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        
        
        
        
        <div className="report-card" style={{gridColumn:'2',padding:24,borderRadius:8,boxShadow:'0 6px 16px rgba(0,0,0,0.12)'}}>
          <div className="report-title">Visualizações</div>
          <div className="section-divider" />
          <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:16}}>
            <div>
              <div className="widget-title">Demandas por Status</div>
              {(()=>{ const segs = statusPeriod.slice(0,6).map(s=> { const v=String(s.status||'').toLowerCase(); const color = v.includes('pendente')||v.includes('aberta')?'#f59e0b': v.includes('progresso')||v.includes('produção')?'#3b82f6': v.includes('feedback')?'#FFE55C': v.includes('revis')?'#9B59B6': v.includes('aprov')||v.includes('conclu')?'#10b981':'#4DA3FF'; return { pct:s.pct, color, label:`${s.status} ${s.q}` } }); return (
                <div>
                  <div className="stacked-bar" style={{display:'flex',height:18,overflow:'hidden',borderRadius:6}}>
                    {segs.map((s,i)=> (<div key={i} style={{width:`${s.pct}%`,background:s.color}} title={s.label} />))}
                  </div>
                  <div className="pie-legend" style={{marginTop:8}}>
                    {segs.map((s,i)=> (<div key={i} className="legend-item"><span className="legend-dot" style={{background:s.color}} />{s.label}</div>))}
                  </div>
                </div>
              ) })()}
            </div>
            <div>
              <div className="widget-title">Demandas por Designer</div>
              <div>
                {designerPeriod.slice(0,6).map(d=> (
                  <div key={d.designer} className="bar-row" style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <div style={{minWidth:80,color:'var(--muted)'}}>{d.designer}</div>
                    <div style={{flex:1,background:'#222',borderRadius:6,overflow:'hidden'}} title={`${d.designer}: ${d.q}`}>
                      <div style={{width:`${d.pct}%`,height:12,background:'#4DA3FF'}} />
                    </div>
                    <div style={{minWidth:28,textAlign:'right'}}>{d.q}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="widget-title">Demandas por Tipo</div>
              <div>
                {tipoPeriod.slice(0,6).map(t=> (
                  <div key={t.tipo} className="bar-row" style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <div style={{minWidth:80,color:'var(--muted)'}}>{t.tipo}</div>
                    <div style={{flex:1,background:'#222',borderRadius:6,overflow:'hidden'}} title={`${t.tipo}: ${t.q}`}>
                      <div style={{width:`${t.pct}%`,height:12,background:'#9B59B6'}} />
                    </div>
                    <div style={{minWidth:28,textAlign:'right'}}>{t.q}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="report-card" style={{padding:24,borderRadius:8,boxShadow:'0 6px 16px rgba(0,0,0,0.12)'}}>
          <div className="report-title">Relatório de Backlog</div>
          <div className="section-divider" />
          {(()=>{ const emAndamento = backlogItems.filter(x=> isProdStatus(x.status)).length; const emRevisao = backlogItems.filter(x=> String(x.status||'').toLowerCase().includes('revis')).length; const slaEstourado = backlogItems.filter(x=> { const dl=diasRestantes(x.prazo); return dl!=null && dl<0 }).length; return (
            <div className="kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(3, minmax(160px, 1fr))',gap:16}}>
              <div className="kpi-card" style={{padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
                <div className="kpi-number" style={{fontSize:28,fontWeight:700}}>{emAndamento}</div>
                <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>Em andamento</div>
                <div style={{marginTop:8,color: emAndamento===0?'var(--status-success)':'var(--status-warning)'}}>{emAndamento===0?'Controlado':'Atenção'}</div>
              </div>
              <div className="kpi-card" style={{padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
                <div className="kpi-number" style={{fontSize:28,fontWeight:700}}>{emRevisao}</div>
                <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>Em revisão</div>
                <div style={{marginTop:8,color: emRevisao===0?'var(--status-success)':'var(--status-warning)'}}>{emRevisao===0?'Controlado':'Atenção'}</div>
              </div>
              <div className="kpi-card" style={{padding:24,border:'1px solid var(--border)',borderRadius:12,height:160,overflow:'hidden',whiteSpace:'nowrap'}}>
                <div className="kpi-number" style={{fontSize:28,fontWeight:700}}>{slaEstourado}</div>
                <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:12}}>SLA estourado</div>
                <div style={{marginTop:8,color: slaEstourado===0?'var(--status-success)':'var(--status-danger)'}}>{slaEstourado===0?'Controlado':'Crítico'}</div>
              </div>
            </div>
          ) })()}
        </div>
        <div className="report-card">
          <div className="report-title">O que aprendemos neste período</div>
          <div className="insights-grid">
            {(()=>{ const now=new Date(); const start=new Date(now.getFullYear(), now.getMonth(), 1); const end=new Date(now.getFullYear(), now.getMonth()+1, 0); const toD=s=>{ if(!s) return null; const [y,m,d]=String(s).split('-').map(Number); if(!y) return null; return new Date(y,m-1,d) }; const inM=dt=>{ if(!dt) return false; dt.setHours(0,0,0,0); return dt>=start && dt<=end }; const concl = items.filter(x=> isDoneStatus(x.status) && inM(toD(x.dataConclusao))); const bestSla = (()=>{ const per={}; concl.forEach(x=>{ const d=x.designer||'—'; const ok=x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo; const tot=x.prazo && x.dataConclusao; const cur=per[d]||{ok:0,total:0}; per[d]={ ok:cur.ok+(ok?1:0), total:cur.total+(tot?1:0) } }); const arr=Object.entries(per).map(([designer,v])=> ({designer, pct: Math.round(100*((v.ok/(v.total||1)))) })); return arr.sort((a,b)=> b.pct-a.pct)[0] })(); const tipagem=(()=>{ const m={}; items.forEach(x=>{ const t=x.tipoMidia||'—'; m[t]=(m[t]||0)+1 }); const arr=Object.entries(m).map(([tipo,q])=>({tipo,q})).sort((a,b)=> b.q-a.q); const tot=arr.reduce((a,b)=>a+b.q,0)||1; const top=arr[0]; return top? { tipo: top.tipo, pct: Math.round(100*(top.q/tot)) } : null })(); const semAtraso = items.filter(x=> !isDoneStatus(x.status) && x.prazo && String(x.prazo)< String(hojeISO())).length===0; const capacidadeMedia = (()=>{ const capacityPerDay=4; const designersCount=designers.length||1; const ds = items.map(x=> toD(x.dataCriacao||x.dataSolicitacao)).filter(Boolean).sort((a,b)=> a-b); const days = ds.length? Math.max(1, Math.round((ds[ds.length-1]-ds[0])/86400000)+1) : 1; const ideal=designersCount*capacityPerDay*days; const conclQt=items.filter(x=> isDoneStatus(x.status)).length; return Math.round(100*(conclQt/Math.max(1,ideal))) })(); const list=[]; if (capacidadeMedia>=80) list.push({ msg:`Capacidade média do time está em ${capacidadeMedia}%`, act:'Considere redistribuir demandas.' }); else list.push({ msg:`Capacidade média do time está em ${capacidadeMedia}%`, act:'Antecipe demandas futuras.' }); if(semAtraso) list.push({ msg:'Nenhuma demanda apresentou atraso.', act:'Mantenha o ritmo atual de capacidade.' }); if(bestSla) list.push({ msg:`O designer ${bestSla.designer} teve o melhor SLA do período.`, act:'Priorize peças complexas com ele.' }); if(tipagem) list.push({ msg:`${tipagem.tipo} representa ${tipagem.pct}% das demandas.`, act:`Ajuste prioridades para ${tipagem.tipo}.` }); return list.slice(0,3) })().map((t,i)=> (
              <div key={i} className="insight-card"><div className="insight-ico">★</div><div className="insight-text">{t.msg}</div><div className="insight-text" style={{color:'var(--muted)'}}>👉 {t.act}</div></div>
            ))}
          </div>
        </div>
        
        
      </div>
    </div>
  )
}

function CountUp({ value, duration=200, suffix='' }) {
  const [display, setDisplay] = React.useState(0)
  React.useEffect(()=>{
    const start = Number(display)||0
    const end = Number(value)||0
    const delta = end - start
    const t0 = performance.now()
    let raf
    const step = (ts)=>{
      const p = Math.min(1, (ts - t0)/(duration||200))
      const v = start + (delta * p)
      setDisplay(v)
      if (p<1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return ()=>{ try{ cancelAnimationFrame(raf) }catch{} }
  },[value,duration])
  const shown = Math.round(Number(display)||0)
  return React.createElement('span', null, `${shown}${suffix}`)
}

function BarFill({ pct, color, height=18 }) {
  const [w, setW] = React.useState(0)
  React.useEffect(()=>{ const id=setTimeout(()=> setW(Math.max(0,Math.min(100, pct||0))), 10); return ()=> clearTimeout(id) },[pct])
  return (<div style={{width:`${w}%`,height,background:color}} />)
}

function ExecutiveDashboardView({ demandas, designers, filtros, setFiltros, loading, user, onEdit, setRoute, setView }) {
  const isAdmin = (user?.role==='admin')
  const username = user?.username||''
  const BASE_DEMANDAS_GLOBAL = useMemo(()=> Array.isArray(demandas) ? demandas : [], [demandas])
  const designersKeys = ['Todos', ...designers]
  const statusKeys = useMemo(()=> ['Todos', ...Array.from(new Set(BASE_DEMANDAS_GLOBAL.map(x=> x.status||'—'))).filter(Boolean)], [BASE_DEMANDAS_GLOBAL])
  const tipoKeys = useMemo(()=> ['Todos', ...Array.from(new Set(BASE_DEMANDAS_GLOBAL.map(x=> x.tipoMidia||'—'))).filter(Boolean)], [BASE_DEMANDAS_GLOBAL])
  const setDesigner = (v) => setFiltros(prev=> ({ ...prev, designer: v==='Todos'?'':v }))
  const setStatus = (v) => setFiltros(prev=> ({ ...prev, status: v==='Todos'?'':v }))
  const setTipo = (v) => setFiltros(prev=> ({ ...prev, tipoMidia: v==='Todos'?'':v }))
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
  const toD = (s)=>{ if(!s) return null; const [y,m,d]=String(s).split('-').map(Number); if(!y) return null; return new Date(y,m-1,d) }
  const inRange = (iso) => { if(!iso) return false; const [y,m,d]=String(iso).split('-').map(Number); if(!y) return false; const dt=new Date(y,m-1,d); const s=toD(filtros.cIni), e=toD(filtros.cFim); if(!s||!e) return true; dt.setHours(0,0,0,0); s.setHours(0,0,0,0); e.setHours(0,0,0,0); return dt>=s && dt<=e }
  const passesFilters = (x)=> inRange(x.prazo)
  const arr = BASE_DEMANDAS_GLOBAL.filter(passesFilters)
  const createdInPeriod = arr
  const totalCriadas = createdInPeriod.length
  const totalAndamento = createdInPeriod.filter(x=> { const v=String(x.status||'').toLowerCase(); return isPendingStatus(x.status) || isProdStatus(x.status) || v.includes('feedback') }).length
  const totalRevisao = createdInPeriod.filter(x=> { const v=String(x.status||'').toLowerCase(); return v.includes('revisar') }).length
  const totalConcluidas = BASE_DEMANDAS_GLOBAL.filter(x=> isDoneStatus(x.status) && inRange(x.prazo)).length
  const diasRestantes = (p)=>{ if(!p) return null; const [y,m,d]=String(p).split('-').map(Number); const end=new Date(y,(m||1)-1,(d||1)); const start=new Date(); start.setHours(0,0,0,0); end.setHours(0,0,0,0); return Math.round((end - start)/86400000) }
  const backlogRisco = createdInPeriod.filter(x=> { const dl=diasRestantes(x.prazo); return !isDoneStatus(x.status) && dl!=null && dl<=2 }).length
  const anaDiffDays = (a,b)=>{ const da=toD(a), db=toD(b); if(!da||!db) return null; return Math.max(0, Math.round((db-da)/86400000)) }
  const concluidos = BASE_DEMANDAS_GLOBAL.filter(x=> passesFilters(x) && isDoneStatus(x.status))
  const slaGeralPct = (()=>{ const ok=concluidos.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=concluidos.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const leadMedio = (()=>{ const vals=concluidos.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })()
  const retrabalhoPct = (()=>{ const tot=concluidos.length||1; const com=concluidos.filter(x=> (x.revisoes||0)>0).length; return Math.round(100*(com/Math.max(1,tot))) })()
  const funil = (()=>{ const tot=createdInPeriod.length||1; const criadas=totalCriadas; const emProd=totalAndamento; const revis=totalRevisao; const concl=totalConcluidas; const pct = (n)=> Math.round(100*(n/Math.max(1,tot))); return [
    { label:'Criadas', q: criadas, pct: pct(criadas), color:'var(--status-info)' },
    { label:'Em Produção', q: emProd, pct: pct(emProd), color:'var(--text-muted)' },
    { label:'Em Revisão', q: revis, pct: pct(revis), color:'var(--status-warning)' },
    { label:'Concluídas', q: concl, pct: pct(concl), color:'var(--status-success)' },
  ] })()
  const capacityPerDay = 4
  const daysInPeriod = (()=>{ const s=toD(filtros.cIni), e=toD(filtros.cFim); if(!s||!e) return 1; return Math.max(1, Math.round((e - s)/86400000) + 1) })()
  const ativosPorDesigner = (()=>{ const per={}; createdInPeriod.forEach(x=>{ if(!isDoneStatus(x.status)){ const d=x.designer||'—'; per[d]=(per[d]||0)+1 } }); return per })()
  const designersCount = isAdmin ? (designers.length||1) : 1
  const ativosTotal = createdInPeriod.filter(x=> !isDoneStatus(x.status)).length
  const idealTotal = capacityPerDay * daysInPeriod * designersCount
  const teamUsedPct = idealTotal ? Math.min(100, Math.round(100*(ativosTotal/idealTotal))) : 0
  const scorecardData = (isAdmin? designers : [username]).map(d=> { const mine = createdInPeriod.filter(x=> (x.designer||'—')===d); const concl = concluidos.filter(x=> (x.designer||'—')===d); const conclCnt = concl.length; const sla = (()=>{ const ok=concl.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=concl.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })(); const lead = (()=>{ const vals=concl.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })(); const ret = (()=>{ const tot=mine.length||1; const withRev=mine.filter(x=> (x.revisoes||0)>0).length; return Math.round(100*(withRev/Math.max(1,tot))) })(); const ideal=capacityPerDay*daysInPeriod; const ativos=ativosPorDesigner[d]||0; const used = ideal ? Math.min(100, Math.round(100*(ativos/ideal))) : 0; return { designer:d, concl:conclCnt, sla, lead, ret, used } })
  const sortedScore = scorecardData.slice().sort((a,b)=> b.sla!==a.sla? (b.sla-a.sla) : b.concl!==a.concl? (b.concl-a.concl) : b.ret!==a.ret? (a.ret-b.ret) : (a.lead-b.lead))
  const designerKeysForPeriod = isAdmin ? designers : [username]
  const topAtraso = (()=>{ const map={}; createdInPeriod.forEach(x=>{ if(!isDoneStatus(x.status) && x.prazo && String(x.prazo)<String(hojeISO())){ const d=x.designer||'—'; map[d]=(map[d]||0)+1 } }); const arr=Object.entries(map).map(([designer,q])=>({designer,q})).sort((a,b)=> b.q-a.q); return arr[0]||null })()
  const topLead = (()=>{ const per={}; designerKeysForPeriod.forEach(d=>{ const concl = concluidos.filter(x=> (x.designer||'—')===d && inRange(x.prazo)); const vals=concl.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg = vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : null; if(avg!=null) per[d]=avg }); const arr=Object.entries(per).map(([designer,lead])=>({designer,lead})).sort((a,b)=> b.lead-a.lead); return arr[0]||null })()
  const topRet = (()=>{ const per={}; designerKeysForPeriod.forEach(d=>{ const mine = createdInPeriod.filter(x=> (x.designer||'—')===d); const avg = mine.length ? +(mine.reduce((a,x)=> a+(x.revisoes||0),0)/mine.length).toFixed(2) : null; if(avg!=null) per[d]=avg }); const arr=Object.entries(per).map(([designer,ret])=>({designer,ret})).sort((a,b)=> b.ret-a.ret); return arr[0]||null })()
  const noDateFilter = (x)=> (
    (isAdmin ? (filtros.designer? (x.designer||'')===filtros.designer : true) : ((x.designer||'')===username)) &&
    (filtros.status? (x.status||'')===filtros.status : true) &&
    (filtros.tipoMidia? (x.tipoMidia||'')===filtros.tipoMidia : true) &&
    (filtros.origem? (x.origem||'')===filtros.origem : true) &&
    (filtros.campanha? (x.campanha||'')===filtros.campanha : true)
  )
  const itemsCmp = BASE_DEMANDAS_GLOBAL.filter(noDateFilter)
  const curStart = toD(filtros.cIni), curEnd = toD(filtros.cFim)
  const daysRange = (curStart && curEnd) ? (Math.max(1, Math.round((curEnd - curStart)/86400000) + 1)) : 0
  const prevStart = curStart ? new Date(curStart) : null
  const prevEnd = curEnd ? new Date(curEnd) : null
  if (prevStart) prevStart.setDate(prevStart.getDate() - daysRange)
  if (prevEnd) prevEnd.setDate(prevEnd.getDate() - daysRange)
  const inBetween = (dt, s, e)=>{ if(!dt||!s||!e) return false; dt.setHours(0,0,0,0); s.setHours(0,0,0,0); e.setHours(0,0,0,0); return dt>=s && dt<=e }
  const conclCur = itemsCmp.filter(x=> isDoneStatus(x.status) && inBetween(toD(x.prazo), curStart, curEnd))
  const conclPrev = itemsCmp.filter(x=> isDoneStatus(x.status) && inBetween(toD(x.prazo), prevStart, prevEnd))
  const prodCur = conclCur.length
  const prodPrev = conclPrev.length
  const slaCur = (()=>{ const ok=conclCur.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=conclCur.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const slaPrev = (()=>{ const ok=conclPrev.filter(x=> x.prazo && x.dataConclusao && x.dataConclusao<=x.prazo).length; const tot=conclPrev.filter(x=> x.prazo && x.dataConclusao).length; return Math.round(100*(ok/Math.max(1,tot))) })()
  const leadCur = (()=>{ const vals=conclCur.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })()
  const leadPrev = (()=>{ const vals=conclPrev.map(x=> anaDiffDays(x.dataCriacao||x.dataSolicitacao, x.dataConclusao)).filter(v=> v!=null); const avg=(vals.reduce((a,b)=>a+b,0)/(vals.length||1)); return +(avg||0).toFixed(1) })()
  const createdCur = itemsCmp.filter(x=> inBetween(toD(x.prazo), curStart, curEnd))
  const createdPrev = itemsCmp.filter(x=> inBetween(toD(x.prazo), prevStart, prevEnd))
  const retCur = +(createdCur.reduce((a,x)=> a+(x.revisoes||0),0)/Math.max(1,createdCur.length)).toFixed(2)
  const retPrev = +(createdPrev.reduce((a,x)=> a+(x.revisoes||0),0)/Math.max(1,createdPrev.length)).toFixed(2)
  const goDetail = (id)=>{ try{ const found=demandas.find(x=> String(x.id)===String(id)); if(found){ setRoute && setRoute('demandas'); setView && setView('table'); onEdit && onEdit(found) } }catch{} }
  const [anaLimit, setAnaLimit] = useState(10)
  if (loading) {
    return (
      <div className="dashboard">
        <div className="exec-summary">
          {Array.from({length:6}).map((_,i)=> (<div key={i} className="skeleton row"></div>))}
        </div>
      </div>
    )
  }
  return (
    <div className="reports" data-loading={loading?'true':'false'}>
      <div className="reports-toolbar">
        <div className="chips">
          <div className="date-pill">
            <span className="icon"><Icon name="calendar" /></span>
            <input type="date" value={filtros.cIni||''} onChange={e=> setFiltros(prev=> ({ ...prev, cIni: e.target.value }))} />
            <span style={{color:'var(--muted)'}}>—</span>
            <input type="date" value={filtros.cFim||''} onChange={e=> setFiltros(prev=> ({ ...prev, cFim: e.target.value }))} />
          </div>
        </div>
        
        
      </div>
      <div className="reports-stack" style={{display:'block'}}>
        <div className="report-card" style={{padding:24,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.2)',marginBottom:32}}>
          <div className="report-title">Saúde Geral</div>
          {(()=>{ const leadDelta = +(leadCur - leadPrev).toFixed(1); const leadUp = leadDelta>0; const leadDown = leadDelta<0; const leadColor = leadDown? 'var(--status-success)' : (leadUp? 'var(--status-danger)' : 'var(--muted)'); const slaColor = slaGeralPct>=90? 'var(--status-success)' : (slaGeralPct>=70? 'var(--status-warning)' : 'var(--status-danger)'); const slaState = slaGeralPct>=90? 'ok' : (slaGeralPct>=70? 'warn' : 'danger'); return (
            <div className="kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(4, minmax(220px, 1fr))',gap:20}}>
              <div className="kpi-card" style={{padding:28,border:'1px solid var(--border)',borderRadius:16,height:180,overflow:'hidden',whiteSpace:'nowrap'}}>
                <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:13,marginBottom:8}}>Concluídas</div>
                <div className="kpi-number" style={{fontSize:40,fontWeight:800}}><CountUp value={totalConcluidas} /></div>
              </div>
              <div className="kpi-card" style={{padding:28,border:'1px solid var(--border)',borderRadius:16,height:180,overflow:'hidden',whiteSpace:'nowrap'}}>
                <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:13,marginBottom:8}}>SLA geral</div>
                <div className={`progress sla ${slaState}`} style={{height:18,background:'var(--bg-secondary)',borderRadius:10,overflow:'hidden'}} title="Percentual de entregas no prazo">
                  <div className="progress-fill" style={{width:`${slaGeralPct}%`,height:'100%',background:slaColor}} />
                </div>
                {slaState==='danger' ? (<div style={{display:'flex',alignItems:'center',gap:6,color:'var(--status-danger)'}}><span className="icon"><Icon name="alert" /></span><span>SLA em risco</span></div>) : null}
              </div>
              <div className="kpi-card" style={{padding:28,border:'1px solid var(--border)',borderRadius:16,height:180,overflow:'hidden',whiteSpace:'nowrap'}}>
                <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:13,marginBottom:8}}>Lead Time médio</div>
                <div style={{display:'flex',alignItems:'baseline',gap:10}}>
                  <div className="kpi-number" style={{fontSize:40,fontWeight:800}}><CountUp value={leadMedio} suffix="d" /></div>
                  <div style={{fontSize:16,color:leadColor}}>{leadUp?'\u2191': (leadDown?'\u2193':'\u2192')}</div>
                </div>
              </div>
              <div className="kpi-card" style={{padding:28,border:'1px solid var(--border)',borderRadius:16,height:180,overflow:'hidden',whiteSpace:'nowrap'}}>
                <div className="kpi-subtext" style={{color:'var(--muted)',fontSize:13,marginBottom:8}}>Backlog em risco</div>
                <div className="kpi-number" style={{fontSize:32,fontWeight:800,color: backlogRisco>0?'var(--status-danger)':'var(--status-success)'}}>{backlogRisco>0? (<CountUp value={backlogRisco} />) : 'Nenhum risco'}</div>
              </div>
            </div>
          ) })()}
        </div>
        <div className="report-card" style={{padding:24,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.2)',marginBottom:32,minHeight:140}}>
          <div className="report-title">Funil de Status</div>
          <div className="section-divider" />
          <div>
            {funil.map((s,i)=> (
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,margin:'10px 0'}}>
                <div style={{minWidth:160,color:'var(--muted)'}}>{s.label}</div>
                <div style={{flex:1,background:'var(--bg-secondary)',borderRadius:10,overflow:'hidden'}} title={`${s.label}: ${s.q}`}>
                  <BarFill pct={s.pct} color={s.color} height={18} />
                </div>
                <div style={{minWidth:80,textAlign:'right'}}>{s.q}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="report-card" style={{padding:24,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.2)',marginBottom:32,minHeight:140}}>
          <div className="report-title">Prioridades do Período</div>
          <div className="section-divider" />
          <div style={{display:'grid',gridTemplateColumns:'repeat(3, minmax(220px, 1fr))',gap:16}}>
            <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
              <div style={{color:'var(--muted)',marginBottom:6}}>Risco atual</div>
              <div style={{fontSize:18,fontWeight:700,color: backlogRisco>0?'#FF5E5E':'#00C58E'}}>{backlogRisco>0? `${backlogRisco} demandas em risco` : 'Nenhuma demanda crítica'}</div>
            </div>
            <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
              <div style={{color:'var(--muted)',marginBottom:6}}>Maior retrabalho</div>
              <div style={{fontSize:18,fontWeight:700}}>{topRet? topRet.designer : 'Nenhum'}</div>
            </div>
            {(()=>{ const stages=[{k:'Em Produção',q:totalAndamento},{k:'Revisão',q:totalRevisao},{k:'Criadas',q:totalCriadas}]; const top=stages.sort((a,b)=> b.q-a.q)[0]; const has=top.q>0; return (
              <div className="kpi-card" style={{padding:20,border:'1px solid var(--border)',borderRadius:12}}>
                <div style={{color:'var(--muted)',marginBottom:6}}>Gargalo atual</div>
                <div style={{fontSize:18,fontWeight:700}}>{has? `Foco em ${top.k}` : 'Nenhum gargalo'}</div>
              </div>
            ) })()}
          </div>
        </div>
        <div className="report-card" style={{padding:24,borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.2)',marginBottom:32}}>
          <div className="report-title">O que aprendemos neste período</div>
          <div className="section-divider" />
          <div className="insights-grid" style={{display:'grid',gridTemplateColumns:'repeat(3, minmax(220px, 1fr))',gap:16}}>
            {(()=>{ const metaSla=90; const ins=[]; const capMsg = teamUsedPct>=110 ? 'Redistribuir cargas para aliviar capacidade.' : teamUsedPct>=90 ? 'Monitorar capacidade e priorizar entregas.' : 'Aproveitar capacidade para antecipar demandas.'; ins.push({ t: teamUsedPct>=90 ? `Ajustar capacidade (${teamUsedPct}%)` : `Planejar capacidade (${teamUsedPct}%)`, a: capMsg }); const qualMsg = retrabalhoPct>=30 ? 'Padronizar revisões e reduzir retrabalho.' : retrabalhoPct>=15 ? 'Refinar briefing para diminuir revisões.' : 'Manter qualidade consistente.'; ins.push({ t: retrabalhoPct>=15 ? `Reduzir retrabalho (${retrabalhoPct}%)` : `Manter qualidade (${retrabalhoPct}%)`, a: qualMsg }); const ritmoDelta = prodCur - prodPrev; const ritmoUp = ritmoDelta>0; const ritmoDown = ritmoDelta<0; const ritmoMsg = ritmoDown ? 'Remover bloqueios e acelerar fluxo.' : ritmoUp ? 'Manter ritmo e consolidar ganhos.' : 'Estabilizar fluxo de produção.'; ins.push({ t: ritmoDown ? 'Acelerar ritmo' : ritmoUp ? 'Sustentar ritmo' : 'Estabilizar ritmo', a: ritmoMsg }); return ins.slice(0,3).map((x,i)=> (
              <div key={i} className="insight-card" style={{padding:18,border:'1px solid var(--border)',borderRadius:12}}>
                <div className="insight-text" style={{fontSize:16,fontWeight:700}}>{x.t}</div>
                <div className="insight-text" style={{color:'var(--muted)'}}>👉 {x.a}</div>
              </div>
            )) })()}
          </div>
        </div>
        
        
        
      </div>
    </div>
  )
}
