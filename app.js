const estados = ["Aberta", "Em Progresso", "Concluída"]
const statusLabel = s => s === "Aberta" ? "🟢 Aberta" : s === "Em Progresso" ? "⚙️ Em Progresso" : "✅ Concluída"
const els = {
  btnNova: document.getElementById("btnNovaDemanda"),
  modal: document.getElementById("modal"),
  modalClose: document.getElementById("modalClose"),
  form: document.getElementById("formDemanda"),
  mDesigner: document.getElementById("mDesigner"),
  mTipoMidia: document.getElementById("mTipoMidia"),
  mTitulo: document.getElementById("mTitulo"),
  mLink: document.getElementById("mLink"),
  mArquivo: document.getElementById("mArquivo"),
  mDataSolic: document.getElementById("mDataSolic"),
  fDesigner: document.getElementById("fDesigner"),
  fStatus: document.getElementById("fStatus"),
  fCriacaoIni: document.getElementById("fCriacaoIni"),
  fCriacaoFim: document.getElementById("fCriacaoFim"),
  fSolicIni: document.getElementById("fSolicIni"),
  fSolicFim: document.getElementById("fSolicFim"),
  btnClearFilters: document.getElementById("btnClearFilters"),
  views: Array.from(document.querySelectorAll(".view-btn")),
  vLista: document.getElementById("view-lista"),
  vCalendario: document.getElementById("view-calendario"),
  vKanban: document.getElementById("view-kanban")
}

function hojeISO() {
  const d = new Date()
  const z = n => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`
}

function ler() {
  const raw = localStorage.getItem("demandas")
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}

function gravar(arr) {
  localStorage.setItem("demandas", JSON.stringify(arr))
}

function proxId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1
}

let estado = {
  demandas: ler(),
  view: "lista",
  modalMode: "create",
  editingId: null
}

function aplicarFiltros(items) {
  const d = els.fDesigner.value.trim()
  const s = els.fStatus.value
  const cIni = els.fCriacaoIni.value
  const cFim = els.fCriacaoFim.value
  const soIni = els.fSolicIni.value
  const soFim = els.fSolicFim.value
  return items.filter(it => {
    if (d && it.designer !== d) return false
    if (s && it.status !== s) return false
    if (cIni && it.dataCriacao < cIni) return false
    if (cFim && it.dataCriacao > cFim) return false
    if (soIni && it.dataSolicitacao < soIni) return false
    if (soFim && it.dataSolicitacao > soFim) return false
    return true
  })
}

function atualizarFiltroDesigner() {
  const opts = new Set(estado.demandas.map(x => x.designer).filter(Boolean))
  const atual = els.fDesigner.value
  els.fDesigner.innerHTML = ""
  const oAll = document.createElement("option")
  oAll.value = ""
  oAll.textContent = "Designer"
  els.fDesigner.appendChild(oAll)
  Array.from(opts).sort().forEach(v => {
    const o = document.createElement("option")
    o.value = v
    o.textContent = v
    els.fDesigner.appendChild(o)
  })
  els.fDesigner.value = atual
}

function renderLista() {
  const items = aplicarFiltros(estado.demandas)
  const table = document.createElement("table")
  const thead = document.createElement("thead")
  const trh = document.createElement("tr")
  ;["Designer","Tipo","Título","Link","Arquivo","Data Solic.","Data Criação","Status","✏️"].forEach(h => {
    const th = document.createElement("th")
    th.textContent = h
    trh.appendChild(th)
  })
  thead.appendChild(trh)
  const tbody = document.createElement("tbody")
  items.forEach(it => {
    const tr = document.createElement("tr")
    const td = txt => { const x = document.createElement("td"); x.textContent = txt || ""; return x }
    tr.appendChild(td(it.designer))
    tr.appendChild(td(it.tipoMidia))
    tr.appendChild(td(it.titulo))
    const tdLink = document.createElement("td")
    if (it.link) { const a = document.createElement("a"); a.href = it.link; a.textContent = it.link; a.target = "_blank"; tdLink.appendChild(a) }
    tr.appendChild(tdLink)
    tr.appendChild(td(it.arquivoNome || ""))
    tr.appendChild(td(it.dataSolicitacao))
    tr.appendChild(td(it.dataCriacao))
    const tdStatus = document.createElement("td")
    const span = document.createElement("span")
    span.className = "status " + (it.status === "Aberta" ? "s-aberta" : it.status === "Em Progresso" ? "s-progresso" : "s-concluida")
    span.textContent = statusLabel(it.status)
    tdStatus.appendChild(span)
    tr.appendChild(tdStatus)
    const tdEdit = document.createElement("td")
    const btn = document.createElement("button")
    btn.className = "icon-btn"
    btn.textContent = "✏️"
    btn.title = "Editar"
    btn.onclick = () => abrirEditar(it)
    tdEdit.appendChild(btn)
    tr.appendChild(tdEdit)
    tbody.appendChild(tr)
  })
  table.appendChild(thead)
  table.appendChild(tbody)
  els.vLista.innerHTML = ""
  els.vLista.appendChild(table)
}

function renderKanban() {
  const items = aplicarFiltros(estado.demandas)
  els.vKanban.innerHTML = ""
  const cols = estados.map(st => {
    const col = document.createElement("div")
    col.className = "kanban-col"
    const head = document.createElement("div")
    head.className = "col-header"
    head.textContent = statusLabel(st)
    const body = document.createElement("div")
    body.className = "col-body"
    items.filter(x => x.status === st).forEach(it => {
      const card = document.createElement("div")
      card.className = "card"
      const actions = document.createElement("div")
      actions.className = "card-actions"
      const title = document.createElement("div")
      title.className = "card-title"
      title.textContent = it.titulo
      const actWrap = document.createElement("div")
      actWrap.className = "actions"
      const editBtn = document.createElement("button")
      editBtn.className = "icon-btn"
      editBtn.textContent = "✏️"
      editBtn.title = "Editar"
      editBtn.onclick = () => abrirEditar(it)
      actWrap.appendChild(editBtn)
      actions.appendChild(title)
      actions.appendChild(actWrap)
      const meta = document.createElement("small")
      meta.textContent = `${it.designer} • ${it.tipoMidia}`
      const sel = document.createElement("select")
      estados.forEach(s => { const o = document.createElement("option"); o.value = s; o.textContent = s; sel.appendChild(o) })
      sel.value = it.status
      sel.onchange = () => {
        const arr = estado.demandas.map(x => x.id === it.id ? { ...x, status: sel.value } : x)
        estado.demandas = arr
        gravar(arr)
        render()
      }
      card.appendChild(actions)
      card.appendChild(meta)
      card.appendChild(sel)
      body.appendChild(card)
    })
    col.appendChild(head)
    col.appendChild(body)
    return col
  })
  cols.forEach(c => els.vKanban.appendChild(c))
}

function ymdToDate(s) {
  const [y,m,d] = s.split("-").map(Number)
  return new Date(y, m-1, d)
}

function inicioMes(dt) { return new Date(dt.getFullYear(), dt.getMonth(), 1) }
function fimMes(dt) { return new Date(dt.getFullYear(), dt.getMonth()+1, 0) }

let calData = { ref: new Date() }

function renderCalendario() {
  const ref = calData.ref
  const inicio = inicioMes(ref)
  const fim = fimMes(ref)
  const firstWeekday = inicio.getDay()
  const dias = fim.getDate()
  const items = aplicarFiltros(estado.demandas)
  const porDia = {}
  items.forEach(it => {
    const dt = ymdToDate(it.dataSolicitacao)
    if (dt.getMonth() === ref.getMonth() && dt.getFullYear() === ref.getFullYear()) {
      const k = it.dataSolicitacao
      if (!porDia[k]) porDia[k] = []
      porDia[k].push(it)
    }
  })
  const wrap = document.createElement("div")
  wrap.innerHTML = ""
  const header = document.createElement("div")
  header.className = "cal-header"
  const prev = document.createElement("button")
  prev.textContent = "◀"
  prev.onclick = () => { calData.ref = new Date(ref.getFullYear(), ref.getMonth()-1, 1); render() }
  const title = document.createElement("div")
  title.textContent = ref.toLocaleString("pt-BR", { month: "long", year: "numeric" })
  const next = document.createElement("button")
  next.textContent = "▶"
  next.onclick = () => { calData.ref = new Date(ref.getFullYear(), ref.getMonth()+1, 1); render() }
  header.appendChild(prev)
  header.appendChild(title)
  header.appendChild(next)
  const grid = document.createElement("div")
  grid.className = "cal-grid"
  ;["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].forEach(d => {
    const head = document.createElement("div")
    head.className = "cal-cell"
    const lab = document.createElement("div")
    lab.className = "day"
    lab.textContent = d
    head.appendChild(lab)
    grid.appendChild(head)
  })
  for (let i=0;i<firstWeekday;i++) {
    const empty = document.createElement("div")
    empty.className = "cal-cell"
    grid.appendChild(empty)
  }
  for (let d=1; d<=dias; d++) {
    const cell = document.createElement("div")
    cell.className = "cal-cell"
    const day = document.createElement("div")
    day.className = "day"
    day.textContent = String(d)
    cell.appendChild(day)
    const key = `${ref.getFullYear()}-${String(ref.getMonth()+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`
    const arr = porDia[key] || []
    arr.forEach(it => {
      const item = document.createElement("div")
      item.className = "cal-item"
      item.textContent = `${it.titulo} (${it.designer})`
      cell.appendChild(item)
    })
    grid.appendChild(cell)
  }
  els.vCalendario.innerHTML = ""
  els.vCalendario.appendChild(header)
  els.vCalendario.appendChild(grid)
}

function render() {
  atualizarFiltroDesigner()
  els.views.forEach(b => b.classList.toggle("active", b.dataset.view === estado.view))
  els.vLista.classList.toggle("hidden", estado.view !== "lista")
  els.vCalendario.classList.toggle("hidden", estado.view !== "calendario")
  els.vKanban.classList.toggle("hidden", estado.view !== "kanban")
  if (estado.view === "lista") renderLista()
  if (estado.view === "calendario") renderCalendario()
  if (estado.view === "kanban") renderKanban()
}

function abrirModal() { els.modal.classList.remove("hidden") }
function fecharModal() { els.modal.classList.add("hidden"); els.form.reset(); els.mId.value = ""; estado.modalMode = "create"; estado.editingId = null; configurarModoModal() }

function configurarModoModal() {
  const titleEl = document.getElementById("modalTitle")
  if (estado.modalMode === "create") {
    titleEl.textContent = "➕ Nova Demanda"
    els.mDataSolic.value = hojeISO()
    els.mDataSolic.disabled = true
  } else {
    titleEl.textContent = "✏️ Editar Demanda"
    els.mDataSolic.disabled = false
  }
}

function abrirEditar(it) {
  estado.modalMode = "edit"
  estado.editingId = it.id
  els.mId.value = String(it.id)
  els.mDesigner.value = it.designer
  els.mTipoMidia.value = it.tipoMidia
  els.mTitulo.value = it.titulo
  els.mLink.value = it.link || ""
  els.mDataSolic.value = it.dataSolicitacao
  abrirModal()
  configurarModoModal()
}

els.views.forEach(b => b.onclick = () => { estado.view = b.dataset.view; render() })
;[els.fDesigner, els.fStatus, els.fCriacaoIni, els.fCriacaoFim, els.fSolicIni, els.fSolicFim].forEach(el => el.oninput = () => render())
els.btnNova.onclick = () => abrirModal()
els.modalClose.onclick = () => fecharModal()
els.btnClearFilters.onclick = () => {
  els.fDesigner.value = ""
  els.fStatus.value = ""
  els.fCriacaoIni.value = ""
  els.fCriacaoFim.value = ""
  els.fSolicIni.value = ""
  els.fSolicFim.value = ""
  render()
}

configurarModoModal()

els.form.onsubmit = e => {
  e.preventDefault()
  const arr = ler()
  const arquivo = els.mArquivo.files && els.mArquivo.files[0] ? els.mArquivo.files[0].name : ""
  if (estado.modalMode === "edit" && els.mId.value) {
    const id = Number(els.mId.value)
    const atualizado = arr.map(x => x.id === id ? {
      ...x,
      designer: els.mDesigner.value.trim(),
      tipoMidia: els.mTipoMidia.value,
      titulo: els.mTitulo.value.trim(),
      link: els.mLink.value.trim(),
      arquivoNome: arquivo || x.arquivoNome,
      dataSolicitacao: els.mDataSolic.value || x.dataSolicitacao
    } : x)
    estado.demandas = atualizado
    gravar(atualizado)
  } else {
    const id = proxId(arr)
    const novo = {
      id,
      designer: els.mDesigner.value.trim(),
      tipoMidia: els.mTipoMidia.value,
      titulo: els.mTitulo.value.trim(),
      link: els.mLink.value.trim(),
      arquivoNome: arquivo,
      dataSolicitacao: hojeISO(),
      dataCriacao: hojeISO(),
      status: "Aberta"
    }
    const novoArr = [...arr, novo]
    estado.demandas = novoArr
    gravar(novoArr)
  }
  fecharModal()
  render()
}

render()
