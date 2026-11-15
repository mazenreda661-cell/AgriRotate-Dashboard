// AgriRotate server: serves the dashboard + bridges Arduino serial -> WebSocket
const express = require('express'), http = require('http');
const { WebSocketServer } = require('ws');
const app = express(), server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.static('public')); app.use(express.json());

let SP = null;
try { SP = require('serialport'); } catch { console.log('serialport not installed'); }
let cfg = { port: 'COM3', baud: 9600 }, serial = null, status = 'waiting', last = null, timer = null;
const bc = o => wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(o)));
const setStatus = (s, error) => { status = s; bc({ type: 'status', status: s, error }); };

// Accepts JSON line {"moisture":41,"temp":24.5,"n":30,"p":20,"k":150} or "moisture=41,temp=24.5,n=30"
function parse(line) {
  line = line.trim(); if (!line) return null;
  let o = null;
  try { o = JSON.parse(line); } catch {
    o = {}; line.split(/[,;]/).forEach(p => { const [k, v] = p.split(/[=:]/); if (k && v !== undefined) o[k.trim().toLowerCase()] = parseFloat(v); });
  }
  const g = k => (typeof o[k] === 'number' && !isNaN(o[k])) ? o[k] : null;
  const d = { moisture: g('moisture'), temp: g('temp'), n: g('n'), p: g('p'), k: g('k'), t: Date.now() };
  return Object.values(d).slice(0, 5).some(v => v !== null) ? d : null;
}
function connect() {
  clearTimeout(timer);
  if (serial) { try { serial.close(); } catch {} serial = null; }
  if (!SP) return setStatus('no-module');
  try {
    serial = new SP.SerialPort({ path: cfg.port, baudRate: cfg.baud }, err => {
      if (err) { setStatus('waiting', err.message); timer = setTimeout(connect, 5000); }
    });
    const parser = serial.pipe(new SP.ReadlineParser({ delimiter: '\n' }));
    serial.on('open', () => setStatus('connected'));
    serial.on('close', () => { setStatus('waiting'); timer = setTimeout(connect, 5000); });
    serial.on('error', () => {});
    parser.on('data', l => { const d = parse(l); if (d) { last = d; bc({ type: 'reading', data: d }); } });
  } catch (e) { setStatus('waiting', e.message); timer = setTimeout(connect, 5000); }
}
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'status', status, cfg }));
  if (last) ws.send(JSON.stringify({ type: 'reading', data: last }));
});
app.get('/api/ports', async (req, res) => {
  try { res.json((await SP.SerialPort.list()).map(p => p.path)); } catch { res.json([]); }
});
app.post('/api/serial', (req, res) => {
  cfg = { port: req.body.port || cfg.port, baud: +req.body.baud || 9600 };
  connect(); res.json({ ok: true, cfg });
});
server.listen(process.env.PORT || 3000, () => { console.log('AgriRotate: http://localhost:' + (process.env.PORT || 3000)); connect(); });