const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

const devices = new Map(); // deviceId → ws
const panels  = new Set();

wss.on('connection', (ws) => {
    let deviceId = null;
    let role = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data, isBinary) => {
        // Frame binario (JPEG) del dispositivo → reenviar a paneles
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

            // Dispositivo → paneles (datos JSON: archivos, info, etc.)
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

// Keepalive
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 25000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ ConnectMe Relay :${PORT}`));
