// script.js
document.addEventListener('DOMContentLoaded', () => {
  const palette       = document.getElementById('palette');
  const canvas        = document.getElementById('canvas');
  const container     = document.getElementById('canvasContainer');
  const propsPan      = document.getElementById('propertiesPanel');
  const btnMove       = document.getElementById('btnMove');
  const btnConn       = document.getElementById('btnConnect');
  const btnDel        = document.getElementById('btnDelete');
  const saveBtn       = document.getElementById('saveNodeData');
  const canvasTitle   = document.getElementById('canvasTitle');
  const planViewer    = document.getElementById('planViewer');
  const planContainer = document.getElementById('planTableContainer');
  const closePlanBtn  = document.getElementById('closePlanViewer');
  const savePlanBtn   = document.getElementById('savePlan');
  const printPlanBtn  = document.getElementById('printPlan');
  const saveConfigBtn = document.getElementById('saveConfig');
  const uploadPlan    = document.getElementById('uploadPlan');

  // Nuevo botón para abrir en pestaña
  const openNewTabBtn = document.createElement('button');
  openNewTabBtn.id = 'openNewTab';
  openNewTabBtn.innerText = '🌐 Abrir en nueva pestaña';
  openNewTabBtn.style.marginLeft = '8px';
  document.querySelector('.planViewerHeader').appendChild(openNewTabBtn);

  // IA panel elements
  const iaPanel       = document.getElementById('ia-panel');
  const iaCounterEl   = document.getElementById('iaCount');
  const iaStatusEl    = document.getElementById('iaStatus');
  const iaProgress    = document.getElementById('iaProgress');
  const iaSteps       = Array.from(document.querySelectorAll('#ia-steps li'));
  const sendToIA      = document.getElementById('sendToIA');
  const vizPlanBtn    = document.getElementById('visualizarPlanPanel');

  let meta            = { fases: [], campos: [] };
  let mode            = 'move';
  let idCnt           = 0;
  let currentNode     = null;
  let latestIAPlan    = '';

  // IA request counter reset logic
  const today = new Date().toISOString().slice(0,10);
  if (localStorage.getItem('iaRequestDate') !== today) {
    localStorage.setItem('iaRequestDate', today);
    localStorage.setItem('iaRequestCount', '0');
  }
  function updateCounterUI() {
    const count = parseInt(localStorage.getItem('iaRequestCount') || '0',10);
    iaCounterEl.textContent = count;
    sendToIA.disabled = count >= 10;
  }
  updateCounterUI();

  // Tooltip element
  const tooltip = document.createElement('div');
  tooltip.id = 'tooltip';
  Object.assign(tooltip.style, {
    position: 'absolute', background: 'rgba(0,0,0,0.75)',
    color: '#fff', padding: '4px 8px', borderRadius: '4px',
    fontSize: '12px', pointerEvents: 'none',
    display: 'none', zIndex: '3000'
  });
  document.body.appendChild(tooltip);

  const typeEmojis = {
    'Entrada': '📝','Campos Formativos': '🎓','Fase': '🔄',
    'Contenido': '📚','PDA': '✔️','Metodología': '🛠️',
    'Nodo IA': '🤖','Nota': '💡'
  };
  const campoColors = {
    'Lenguajes': 'orange','De lo humano': 'red',
    'Etica Naturaleza': 'green','Saberes y Pensamiento Científico': 'blue'
  };

  // 1) Load metadata
  fetch('/api/meta')
    .then(r => r.json())
    .then(j => meta = j);

  // 2) Initialize jsPlumb
  const instance = jsPlumb.getInstance({
    Connector: ["Bezier", { curviness: 50 }],
    Anchors: ["AutoDefault"],
    PaintStyle: { stroke: "#0077cc", strokeWidth: 2 },
    Endpoint: ["Dot", { radius: 3 }],
    ConnectionOverlays: [["Arrow", { width: 10, length: 10, location: 1 }]]
  });

  // 3) Allowed connections
  const allowedConnections = {
    'Entrada': ['Nodo IA'],
    'Fase': ['Campos Formativos', 'PDA'],
    'Campos Formativos': ['Contenido'],
    'Contenido': ['Fase'],
    'PDA': ['Nodo IA'],
    'Metodología': ['Nodo IA'],
    'Nodo IA': []
  };

  // 4) Change mode
  function setMode(m) {
    mode = m;
    document.body.className = `mode-${m}`;
    [btnMove, btnConn, btnDel].forEach(b =>
      b.classList.toggle('active',
        b.id === 'btn' + m.charAt(0).toUpperCase() + m.slice(1)
      )
    );
    canvasTitle.contentEditable = m === 'move';
    canvasTitle.style.cursor    = m === 'move' ? 'text' : 'default';
  }
  btnMove.onclick = () => setMode('move');
  btnConn.onclick = () => setMode('connect');
  btnDel.onclick  = () => setMode('delete');
  setMode('move');

  // 5) Connection control
  instance.bind('beforeStartConnect', info => {
    if (mode !== 'connect') return false;
    const cnt = instance.getConnections({ source: info.source }).length;
    const h   = info.source.querySelector('.conn-handle');
    if (h) h.style.top = 50 + cnt * 15 + '%';
    return true;
  });
  instance.bind('beforeDrop', info => {
    const src = info.source.dataset.type;
    const tgt = info.target.dataset.type;
    if (info.source === info.target) return false;
    if (!allowedConnections[src]?.includes(tgt)) return false;
    const single = ['Campos Formativos','Contenido','PDA'];
    if (single.includes(tgt)) {
      instance.getConnections({ target: info.target })
        .forEach(conn => instance.deleteConnection(conn));
    }
    return true;
  });
  instance.bind('connection', info => {
    info.connection.getConnector().canvas.classList.add('transfer');
    ['fase','campo','contenido','pdas','value','text','campoFile'].forEach(k => {
      if (info.source.dataset[k] !== undefined) {
        info.target.dataset[k] = info.source.dataset[k];
      }
    });
    updateNodeIAStatus();
  });
  instance.bind('connectionDetached', info => {
    const tgtEl = info.connection.target;
    tgtEl.classList.remove('completed');
    delete tgtEl.dataset.color;
    updateNodeIAStatus();
  });

  // 7) Drag & drop from palette
  palette.querySelectorAll('.palette-item').forEach(it => {
    it.addEventListener('dragstart', e =>
      e.dataTransfer.setData('type', it.dataset.type)
    );
  });
  container.addEventListener('dragover', e => e.preventDefault());
  container.addEventListener('drop', e => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type');
    if (type === 'Nodo IA' && canvas.querySelector('[data-type="Nodo IA"]')) {
      alert('Solo puede existir un Nodo IA');
      return;
    }
    const r    = canvas.getBoundingClientRect();
    const grid = 20;
    const x    = Math.round((e.clientX - r.left) / grid) * grid;
    const y    = Math.round((e.clientY - r.top)  / grid) * grid;
    createNode(type, x, y);
  });

  // 8) Create node
  function createNode(type, x, y) {
    const el = document.createElement('div');
    el.className    = 'node';
    el.id           = `n${idCnt++}`;
    el.dataset.type = type;
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
    el.innerHTML    =
      `<span class="handle">☰</span>` +
      (type !== 'Nota' ? `<span class="conn-handle"></span>` : '') +
      `<span class="emoji" style="left:20px;">${typeEmojis[type]||''}</span>` +
      `<div class="label">${type}</div>`;
    canvas.appendChild(el);

    instance.draggable(el, {
      handle: '.handle',
      containment: true,
      grid: [20,20],
      stop() {
        const L = Math.round(parseInt(el.style.left)/20)*20;
        const T = Math.round(parseInt(el.style.top)/20)*20;
        el.style.left = L+'px';
        el.style.top  = T+'px';
      }
    });
    if (type !== 'Nota') {
      instance.makeSource(el, {
        filter: '.conn-handle',
        anchor: 'ContinuousRight',
        maxConnections: -1
      });
      instance.makeTarget(el, { anchor: 'ContinuousLeft' });
    }

    el.addEventListener('dblclick', e => {
      if (mode !== 'delete') { e.stopPropagation(); openProperties(el); }
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (mode !== 'delete') openProperties(el);
    });
    el.addEventListener('click', e => {
      if (mode === 'delete') {
        instance.getConnections({ source: el })
          .concat(instance.getConnections({ target: el }))
          .forEach(c => instance.deleteConnection(c));
        el.remove();
        updateNodeIAStatus();
      }
    });

    let hoverTimer;
    el.addEventListener('mouseenter', () => {
      if (!el.dataset.color) return;
      hoverTimer = setTimeout(() => {
        const info = [];
        if (el.dataset.text)      info.push(`${el.dataset.type}: ${el.dataset.text}`);
        if (el.dataset.fase)      info.push(`Fase: ${el.dataset.fase}`);
        if (el.dataset.campo)     info.push(`Campo: ${el.dataset.campo}`);
        if (el.dataset.contenido) info.push(`Contenido: ${el.dataset.contenido}`);
        if (el.dataset.pdas)      info.push(`PDA: ${el.dataset.pdas}`);
        if (el.dataset.value)     info.push(`Metodología: ${el.dataset.value}`);
        tooltip.innerHTML = info.join('<br>');
        const rect = el.getBoundingClientRect();
        tooltip.style.top     = (rect.bottom + window.scrollY + 5) + 'px';
        tooltip.style.left    = (rect.left   + window.scrollX)     + 'px';
        tooltip.style.display = 'block';
      }, 1000);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      tooltip.style.display = 'none';
    });
  }

  // 9) Properties panel
  function openProperties(node) {
    currentNode = node;
    const type = node.dataset.type;
    document.getElementById('propTitle').innerText = type;
    const div = document.getElementById('propContent');
    div.innerHTML = '';

    const hints = {
      'Entrada': 'Texto libre de entrada para el plan.',
      'Fase': 'Selecciona la fase didáctica.',
      'Campos Formativos': 'Elige el campo y hereda su color.',
      'Contenido': 'Selecciona un contenido.',
      'PDA': 'Escoge un único PDA; para más, crea otro nodo PDA.',
      'Metodología': 'Selecciona la metodología.',
      'Nodo IA': 'Aquí puedes enviar los datos a la IA.',
      'Nota': 'Redacta aquí tu nota o explicación libre.'
    };
    const pInfo = document.createElement('p');
    pInfo.className = 'info';
    pInfo.textContent = hints[type] || '';
    div.appendChild(pInfo);

    let sel1, sel2, sel3, ta;
    if (type==='Nota' || type==='Entrada') {
      ta = document.createElement('textarea');
      ta.value = node.dataset.text || '';
      div.appendChild(ta);
    }
    if (type==='Fase') {
      sel1 = document.createElement('select');
      sel1.append(new Option('Elige fase',''));
      meta.fases.forEach(f=> sel1.append(new Option(f,f)));
      sel1.value = node.dataset.fase || '';
      div.appendChild(sel1);
    }
    if (type==='Campos Formativos') {
      sel1 = document.createElement('select');
      sel1.append(new Option('Elige fase',''));
      meta.fases.forEach(f=> sel1.append(new Option(f,f)));
      sel1.value = node.dataset.fase || '';
      div.appendChild(sel1);

      sel2 = document.createElement('select');
      sel2.append(new Option('Elige campo',''));
      div.appendChild(sel2);

      sel1.onchange = () => {
        sel2.innerHTML = '<option>Elige campo</option>';
        meta.campos.filter(c=>c.fase===sel1.value)
          .forEach(c=>{
            const o = new Option(c.label,c.label);
            o.dataset.file = c.file;
            sel2.append(o);
          });
      };
      if (node.dataset.fase) {
        sel1.onchange();
        sel2.value = node.dataset.campo || '';
      }
    }
    if (type==='Contenido') {
      ['Fase: '+node.dataset.fase,'Campo: '+node.dataset.campo]
        .forEach(txt=> div.append(Object.assign(document.createElement('p'),{textContent:txt})));
      sel3 = document.createElement('select');
      sel3.append(new Option('Elige contenido',''));
      div.appendChild(sel3);
      if (node.dataset.campoFile) {
        fetch(`/api/fileContent?name=${node.dataset.campoFile}`)
          .then(r=> r.json())
          .then(j=>{
            const d = parseTxt(j.content);
            Object.keys(d).forEach(k=> sel3.append(new Option(k,k)));
            sel3.value = node.dataset.contenido || '';
          });
      }
    }
    if (type==='PDA') {
      ['Fase: '+node.dataset.fase,'Campo: '+node.dataset.campo,'Contenido: '+node.dataset.contenido]
        .forEach(txt=> div.append(Object.assign(document.createElement('p'),{textContent:txt})));
      sel3 = document.createElement('select');
      sel3.append(new Option('Elige PDA',''));
      div.appendChild(sel3);
      if (node.dataset.campoFile && node.dataset.contenido) {
        fetch(`/api/fileContent?name=${node.dataset.campoFile}`)
          .then(r=> r.json())
          .then(j=>{
            const d = parseTxt(j.content)[node.dataset.contenido] || {};
            Object.values(d).flat().forEach(p=> sel3.append(new Option(p,p)));
            sel3.value = node.dataset.pdas || '';
          });
      }
    }
    if (type==='Metodología') {
      sel1 = document.createElement('select');
      ['Aprendizaje Basado en Projectos','Aprendizaje basado en indagación','Aprendizaje basado en problemas','Aprendizaje servicio']
        .forEach(m=> sel1.append(new Option(m,m)));
      sel1.value = node.dataset.value || '';
      div.appendChild(sel1);
    }

    // Nodo IA: setup panel
    if (type==='Nodo IA') {
      iaPanel.classList.remove('hidden');
      iaStatusEl.textContent = '—';
      iaProgress.value = 0;
      iaSteps.forEach(li => li.classList.remove('completed'));
      vizPlanBtn.disabled = true;
      updateCounterUI();
    } else {
      iaPanel.classList.add('hidden');
    }

    saveBtn.onclick = () => {
      if (ta)                     node.dataset.text   = ta.value;
      if (sel1 && type==='Fase')  node.dataset.fase   = sel1.value;
      if (sel1 && sel2 && type==='Campos Formativos') {
        node.dataset.fase      = sel1.value;
        const opt = sel2.selectedOptions[0];
        node.dataset.campo     = opt.value;
        node.dataset.campoFile = opt.dataset.file;
      }
      if (sel3 && type==='Contenido') node.dataset.contenido = sel3.value;
      if (sel3 && type==='PDA')       node.dataset.pdas      = sel3.value;
      if (sel1 && type==='Metodología') node.dataset.value    = sel1.value;
      if (type==='Nota') node.querySelector('.label').innerText = ta.value;

      let color;
      if (['Entrada','Fase','Metodología'].includes(type)) {
        color = getComputedStyle(document.documentElement)
                  .getPropertyValue('--success').trim();
      } else if (type==='Campos Formativos') {
        color = campoColors[node.dataset.campo];
      } else if (['Contenido','PDA'].includes(type)) {
        const inc = instance.getConnections({ target: node });
        if (inc.length) color = inc[0].source.dataset.color;
      }
      if (color) {
        node.dataset.color = color;
        markNetwork(node, color);
        propagateProps(node);
        propagateData(node);
      }
      propsPan.classList.add('hidden');
      updateNodeIAStatus();
    };

    propsPan.classList.remove('hidden');
  }

  document.addEventListener('click', e => {
    if (!propsPan.contains(e.target) && !currentNode?.contains(e.target)) {
      propsPan.classList.add('hidden');
    }
  });

  // Helpers
  function parseTxt(text) {
    const lines = text.trim().split('\n').filter(l=>l.trim());
    const hdr   = lines[0].split('|').map(h=>h.trim()).slice(1);
    const out   = {}, rows = lines.slice(1);
    let key;
    rows.forEach(r=>{
      const p = r.split('|').map(x=>x.trim());
      if (p[1]) { key = p[1]; out[key] = {}; }
      hdr.forEach((g,i)=>{
        const v = p[i+2];
        if (v) (out[key][g]||(out[key][g]=[])).push(v);
      });
    });
    return out;
  }

  function propagateProps(node) {
    instance.getConnections({ source: node }).forEach(c => {
      const tgt = c.target;
      if (node.dataset.color) {
        tgt.dataset.color = node.dataset.color;
        markNetwork(tgt, node.dataset.color);
      }
      propagateProps(tgt);
    });
  }

  function propagateData(node) {
    instance.getConnections({ source: node }).forEach(c => {
      const tgt = c.target;
      ['fase','campo','contenido','pdas','value','text','campoFile'].forEach(k => {
        if (node.dataset[k] !== undefined) {
          tgt.dataset[k] = node.dataset[k];
        }
      });
      propagateData(tgt);
    });
  }

  function markNetwork(node, color) {
    node.classList.add('completed');
    node.style.setProperty('--aura-color', color);
  }

  function updateNodeIAStatus() {
    const nodeIA = document.querySelector('.node[data-type="Nodo IA"]');
    if (!nodeIA) return;
    const conns = instance.getConnections({ target: nodeIA });
    const types = new Set(conns.map(c => c.source.dataset.type));
    const ready = ['Entrada','PDA','Metodología'].every(r => types.has(r));
    if (ready) {
      markNetwork(nodeIA,
        getComputedStyle(document.documentElement).getPropertyValue('--success').trim()
      );
    } else {
      nodeIA.classList.remove('completed');
      nodeIA.style.setProperty('--aura-color',
        getComputedStyle(document.documentElement).getPropertyValue('--purple').trim()
      );
    }
  }

  // 10) Deletion gesture
  let deleting = false, startX, startY, deleteCanvas, dcCtx;
  container.addEventListener('mousedown', e => {
    if (mode==='delete') {
      deleting = true;
      startX = e.clientX; startY = e.clientY;
      deleteCanvas = document.createElement('canvas');
      deleteCanvas.width  = container.scrollWidth;
      deleteCanvas.height = container.scrollHeight;
      Object.assign(deleteCanvas.style, {
        position: 'absolute', top: '0', left: '0',
        width: container.scrollWidth + 'px',
        height: container.scrollHeight + 'px',
        pointerEvents: 'none', zIndex: '5000'
      });
      container.appendChild(deleteCanvas);
      dcCtx = deleteCanvas.getContext('2d');
      dcCtx.strokeStyle = 'red'; dcCtx.lineWidth = 2;
    }
  });
  container.addEventListener('mousemove', e => {
    if (!deleting) return;
    dcCtx.clearRect(0, 0, deleteCanvas.width, deleteCanvas.height);
    dcCtx.beginPath();
    const r = container.getBoundingClientRect();
    const x1 = startX - r.left + container.scrollLeft;
    const y1 = startY - r.top + container.scrollTop;
    const x2 = e.clientX - r.left + container.scrollLeft;
    const y2 = e.clientY - r.top + container.scrollTop;
    dcCtx.moveTo(x1, y1); dcCtx.lineTo(x2, y2); dcCtx.stroke();
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const sx = startX + (e.clientX - startX) * (i/steps);
      const sy = startY + (e.clientY - startY) * (i/steps);
      const el = document.elementFromPoint(sx, sy);
      if (el && el.tagName==='path' && el.closest('.jtk-connector')) {
        instance.getAllConnections().forEach(conn => {
          if (conn.getConnector().canvas.contains(el)) {
            instance.deleteConnection(conn);
            updateNodeIAStatus();
          }
        });
      }
    }
  });
  document.addEventListener('mouseup', () => {
    if (deleting) {
      deleting = false;
      deleteCanvas.remove();
    }
  });

  // 11) Generate regular plan (sin IA)
  document.getElementById('generarPlan').onclick = async () => {
    const nodes = [...canvas.querySelectorAll('.node')].map(el => ({
      id: el.id,
      type: el.dataset.type,
      data: el.dataset.text || el.dataset.value || el.dataset.pdas || ''
    }));
    const resp = await fetch('/api/generatePlan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nodes)
    }).then(r => r.json());
    document.getElementById('verPlan').classList.remove('hidden');
    document.getElementById('verPlan').onclick = () =>
      window.open(`/api/downloadPlan?id=${resp.id}`, '_blank');
  };

  // 12) Edit canvas title
  canvasTitle.addEventListener('dblclick', () => {
    if (mode==='move') {
      canvasTitle.contentEditable = true;
      canvasTitle.focus();
    }
  });
  canvasTitle.addEventListener('blur', () => {
    canvasTitle.contentEditable = false;
  });
  canvasTitle.addEventListener('keydown', e => {
    if (e.key==='Enter') {
      e.preventDefault();
      canvasTitle.blur();
    }
  });

  // 13) Send to IA (con colección de todos los PDAs, entradas, metodologías…)
  sendToIA.onclick = async () => {
    iaStatusEl.textContent = 'Enviando…';
    iaSteps[0].classList.add('completed');
    iaProgress.value = 1;

    // Recolectar datos de todos los nodos conectados al Nodo IA
    const conns = instance.getConnections({ target: currentNode });
    const entradas     = conns.filter(c => c.source.dataset.type==='Entrada').map(c=>c.source.dataset.text).join('; ');
    const pdasList     = conns.filter(c => c.source.dataset.type==='PDA').map(c=>c.source.dataset.pdas).join('; ');
    const metodologias = conns.filter(c => c.source.dataset.type==='Metodología').map(c=>c.source.dataset.value).join('; ');
    const campos       = conns.filter(c => c.source.dataset.type==='Campos Formativos').map(c=>c.source.dataset.campo).join('; ');
    const contenidos    = conns.filter(c => c.source.dataset.type==='Contenido').map(c=>c.source.dataset.contenido).join('; ');

    const prompt = `
Desarrolla un plan didáctico interdisciplinar que resuelva la problemática descrita en la(s) entrada(s): "${entradas}".
Considera los Campos Formativos: "${campos}", Contenidos: "${contenidos}", y PDAs: "${pdasList}",
aplicando Metodologías: "${metodologias}".
Incluye conexiones interdisciplinares y la mejor solución pedagógica para el Plan Didáctico.
Devuelve la respuesta en formato Markdown, usando tablas donde cada columna sea Entrada,  
Campo Formativo, Contenido, PDA, Metodología, Actividades y Evaluación.
`;

    try {
      const resp = await fetch('/api/ia/generatePlan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      iaStatusEl.textContent = 'Recibiendo…';
      iaSteps[1].classList.add('completed');
      iaProgress.value = 2;

      const json = await resp.json();
      latestIAPlan = json.response || '';
      iaStatusEl.textContent = 'Parseando…';
      iaSteps[2].classList.add('completed');
      iaProgress.value = 3;

      iaStatusEl.textContent = 'Finalizado';
      iaSteps[3].classList.add('completed');
      iaProgress.value = 4;
      vizPlanBtn.disabled = false;

      let cnt = parseInt(localStorage.getItem('iaRequestCount') || '0', 10) + 1;
      localStorage.setItem('iaRequestCount', cnt);
      updateCounterUI();
    } catch (e) {
      iaStatusEl.textContent = 'Error';
      console.error(e);
    }
  };

  // 14) Visualizar plan desde panel (Markdown tablas)
  vizPlanBtn.onclick = () => {
    planContainer.innerHTML = '';
    const content = latestIAPlan.trim();
    const lines = content.split('\n');
    let tableEl;

    // Detectar tabla Markdown
    if (lines[0].startsWith('|') && /^\s*\|[-\s|]+\|/.test(lines[1] || '')) {
      tableEl = document.createElement('table');
      const [hdr, , ...rows] = lines;
      const headers = hdr.split('|').filter(s=>s.trim()).map(s=>s.trim());
      const trH = document.createElement('tr');
      headers.forEach(h => {
        const th = document.createElement('th');
        th.innerText = h;
        trH.appendChild(th);
      });
      tableEl.appendChild(trH);

      rows.forEach(r => {
        if (!r.startsWith('|')) return;
        const cols = r.split('|').filter(s=>s.trim()).map(s=>s.trim());
        const tr = document.createElement('tr');
        cols.forEach(c => {
          const td = document.createElement('td');
          td.innerText = c;
          tr.appendChild(td);
        });
        tableEl.appendChild(tr);
      });
    } else {
      // Fallback TSV
      tableEl = document.createElement('table');
      content.split('\n').forEach((line,i) => {
        const tr = document.createElement('tr');
        line.split('\t').forEach(cell => {
          const el = document.createElement(i===0 ? 'th' : 'td');
          el.innerText = cell;
          tr.appendChild(el);
        });
        tableEl.appendChild(tr);
      });
    }

    planContainer.appendChild(tableEl);
    planViewer.classList.remove('hidden');
  };

  // Abrir en nueva pestaña
  openNewTabBtn.onclick = () => {
    const w = window.open('', '_blank');
    w.document.write(`
      <!DOCTYPE html>
      <html><head>
        <meta charset="UTF-8"/>
        <title>Vista Plan Didáctico</title>
      </head>
      <body contenteditable="true" style="font-family:sans-serif;padding:20px;">
        ${planContainer.innerHTML}
      </body></html>
    `);
    w.document.close();
  };

  // Modal controls
  closePlanBtn.onclick = () => planViewer.classList.add('hidden');
  printPlanBtn.onclick = () => window.print();

  // Guardar plan + proyecto completo
  savePlanBtn.onclick = () => {
    // 1) HTML del plan
    const blobHtml = new Blob([planContainer.innerHTML], { type: 'text/html' });
    const aHtml = document.createElement('a');
    aHtml.href = URL.createObjectURL(blobHtml);
    aHtml.download = 'plan-ia.html';
    aHtml.click();

    // 2) Proyecto completo: plan + canvas + conexiones
    const nodes = [...canvas.querySelectorAll('.node')].map(el => ({
      id: el.id,
      type: el.dataset.type,
      x: parseInt(el.style.left),
      y: parseInt(el.style.top),
      data: { ...el.dataset }
    }));
    const connections = instance.getAllConnections().map(c => ({
      sourceId: c.source.id,
      targetId: c.target.id
    }));
    const project = {
      planMarkdown: latestIAPlan,
      nodes,
      connections
    };
    const blobJson = new Blob([JSON.stringify(project,null,2)], { type: 'application/json' });
    const aJson = document.createElement('a');
    aJson.href = URL.createObjectURL(blobJson);
    aJson.download = 'proyecto-completo.json';
    aJson.click();
  };

  // 15) Guardar configuración canvas (sin IA)
  saveConfigBtn.onclick = () => {
    const nodes = [...canvas.querySelectorAll('.node')].map(el => ({
      id: el.id,
      type: el.dataset.type,
      x: parseInt(el.style.left),
      y: parseInt(el.style.top),
      data: { ...el.dataset }
    }));
    const connections = instance.getAllConnections().map(c => ({
      sourceId: c.source.id,
      targetId: c.target.id
    }));
    const cfg = { nodes, connections };
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'canvas-config.json';
    a.click();
  };

  // 16) Carga configuración o plan
  uploadPlan.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (file.name.endsWith('.json')) {
        const cfg = JSON.parse(text);
        instance.deleteEveryConnection();
        canvas.innerHTML = '<h1 id="canvasTitle" contenteditable="false">Plan Didáctico</h1>';
        idCnt = 0;
        cfg.nodes.forEach(n => {
          createNode(n.type, n.x, n.y);
          const el = document.getElementById(`n${idCnt-1}`);
          el.id = n.id;
          Object.assign(el.dataset, n.data);
        });
        setTimeout(() => {
          cfg.connections.forEach(c => {
            const s = document.getElementById(c.sourceId);
            const t = document.getElementById(c.targetId);
            if (s && t) instance.connect({ source: s, target: t });
          });
        }, 50);
      } else if (file.name.endsWith('.html')) {
        planContainer.innerHTML = text;
        planViewer.classList.remove('hidden');
      }
    };
    reader.readAsText(file);
  });
});
