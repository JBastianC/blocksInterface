const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const cors      = require('cors');
const bodyParser= require('body-parser');
const axios     = require('axios');
const https     = require('https');
const multer    = require('multer');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_DIR    = path.join(__dirname, 'public','baseDatos');
const PLANS_DIR = path.join(__dirname, 'plans');
if(!fs.existsSync(PLANS_DIR)) fs.mkdirSync(PLANS_DIR);

// NGROK QWEN IA
const IA_BASE_URL = 'https://b195-34-125-42-73.ngrok-free.app/';
const iaClient = axios.create({
  baseURL: IA_BASE_URL,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  headers: { 'Content-Type': 'application/json' },
  timeout: 60000
});
function callIA(endpoint, prompt) {
  return new Promise((resolve,reject)=>{
    iaClient.post(endpoint,{ model:'qwen2.5-coder:7b', prompt, stream:true },{ responseType:'stream' })
      .then(resp => {
        let full=''; 
        resp.data.on('data',chunk=>{
          chunk.toString().split('\n').forEach(l=>{
            if(l.trim()) {
              try {
                const j = JSON.parse(l);
                if(j.response) full += j.response;
              } catch{}
            }
          });
        });
        resp.data.on('end',()=>resolve(full||'❌ Sin respuesta válida.'));
        resp.data.on('error',err=>reject(err));
      })
      .catch(err=>reject(err));
  });
}

// LISTAR txt
app.get('/api/listFiles',(req,res)=>{
  fs.readdir(DB_DIR,(e,files)=>{
    if(e) return res.status(500).json({error:e.message});
    res.json(files.filter(f=>f.endsWith('.txt')));
  });
});
// META
app.get('/api/meta',(req,res)=>{
  fs.readdir(DB_DIR,(e,files)=>{
    if(e) return res.status(500).json({error:e.message});
    const fases = new Set(), campos=[];
    files.filter(f=>f.endsWith('.txt')).forEach(f=>{
      const m = f.match(/^(.+)_F(\d)\.txt$/);
      if(m){
        const label = m[1].replace(/_/g,' ');
        const fase = `Fase ${m[2]}`;
        fases.add(fase);
        campos.push({ label, fase, file: f });
      }
    });
    res.json({ fases:Array.from(fases), campos });
  });
});
// CONTENIDO
app.get('/api/fileContent',(req,res)=>{
  const p = path.join(DB_DIR, req.query.name);
  fs.readFile(p,'utf8',(e,d)=>{
    if(e) return res.status(404).json({error:'No encontrado.'});
    res.json({ content: d });
  });
});
// GENERAR PLAN LOCAL
app.post('/api/generatePlan', async (req,res)=>{
  const payload = req.body;
  try {
    const llm = await axios.post('http://localhost:5000/generate', payload);
    const id  = Date.now().toString();
    fs.writeFileSync(path.join(PLANS_DIR,id+'.html'), llm.data.html,'utf8');
    res.json({ id, html: llm.data.html });
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});
// DESCARGAR
app.get('/api/downloadPlan',(req,res)=>{
  const f = path.join(PLANS_DIR, req.query.id+'.html');
  if(fs.existsSync(f)) res.download(f,`plan_${req.query.id}.html`);
  else res.status(404).send('No existe.');
});
// SUBIR
const upload = multer({ dest: PLANS_DIR });
app.post('/api/uploadPlan', upload.single('plan'), (req,res)=>{
  res.json({ message:'Recibido', filename:req.file.filename });
});
// IA GENERATE
app.post('/api/ia/generatePlan', async (req,res)=>{
  try {
    const { prompt } = req.body;
    if(!prompt) return res.status(400).json({ error:'Prompt obligatorio.' });
    const iaResp = await callIA('/api/generate', prompt);
    res.json({ response: iaResp });
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

// catch-all
app.get('*',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});
const PORT = 3000;
app.listen(PORT,()=>console.log(`Servidor en http://localhost:${PORT}`));
