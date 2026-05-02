const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Health check — Render lo usa para saber si el servicio está vivo
app.get('/health', (req, res) => res.json({ ok: true, devices: devices.size }));

const devices = new Map();
const panels  = new Set();

wss.on('connection', (ws) => {
    let deviceId = null;
    let role = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data, isBinary) => {
        // Frame binario (imagen/audio) — reenviar a paneles directamente
        if (isBinary) {
            panels.forEach(p => { if (p.readyState === 1) p.send(data, { binary: true }); });
            return;
        }
        try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'register') {
                role     = msg.role;
                deviceId = msg.deviceId || 'device1';
                if (role === 'device') {
                    devices.set(deviceId, ws);
                    console.log(`📱 Dispositivo: ${deviceId}`);
                    panels.forEach(p => p.readyState === 1 && p.send(JSON.stringify({
                        type: 'device_connected', deviceId
                    })));
                } else {
                    panels.add(ws);
                    console.log('💻 Panel conectado');
                    ws.send(JSON.stringify({
                        type: 'device_list',
                        devices: Array.from(devices.keys())
                    }));
                }
                return;
            }

            // Panel → dispositivo (comandos)
            if (role === 'panel') {
                const target = msg.deviceId || Array.from(devices.keys())[0];
                const dev = devices.get(target);
                if (dev?.readyState === 1) dev.send(JSON.stringify(msg));
                return;
            }

            // Dispositivo → paneles (datos JSON: archivos, info, galería...)
            if (role === 'device') {
                panels.forEach(p => { if (p.readyState === 1) p.send(JSON.stringify(msg)); });
            }

        } catch(e) {}
    });

    ws.on('close', () => {
        if (role === 'device' && deviceId) {
            devices.delete(deviceId);
            panels.forEach(p => p.readyState === 1 && p.send(JSON.stringify({
                type: 'device_disconnected', deviceId
            })));
        } else if (role === 'panel') {
            panels.delete(ws);
        }
    });
});

// Keepalive — evita que Render duerma el servicio y mantiene conexiones vivas
const PING_INTERVAL = 20_000; // cada 20s
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) { ws.terminate(); return; }
        ws.isAlive = false;
        ws.ping();
    });
}, PING_INTERVAL);

// Auto-ping propio para evitar el sleep de Render (cada 10 min)
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
    setInterval(() => {
        require('https').get(`${SELF_URL}/health`, () => {}).on('error', () => {});
    }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ ConnectMe Relay :${PORT}`));
