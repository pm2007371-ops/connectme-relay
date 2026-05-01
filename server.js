const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Estado de dispositivos conectados
const devices = new Map(); // deviceId → ws
const panels  = new Set(); // PCs controladores

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API para obtener dispositivos activos
app.get('/api/devices', (req, res) => {
    const list = Array.from(devices.keys()).map(id => ({
        id,
        connected: devices.get(id).readyState === 1
    }));
    res.json(list);
});

wss.on('connection', (ws, req) => {
    let deviceId = null;
    let role = null; // 'device' o 'panel'

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            // Registro inicial
            if (msg.type === 'register') {
                role     = msg.role;     // 'device' o 'panel'
                deviceId = msg.deviceId || 'default';

                if (role === 'device') {
                    devices.set(deviceId, ws);
                    console.log(`📱 Dispositivo conectado: ${deviceId}`);
                    // Notificar a todos los paneles
                    broadcast(panels, JSON.stringify({
                        type: 'device_connected', deviceId
                    }));
                } else if (role === 'panel') {
                    panels.add(ws);
                    console.log('💻 Panel conectado');
                    // Enviar lista de dispositivos activos
                    ws.send(JSON.stringify({
                        type: 'device_list',
                        devices: Array.from(devices.keys())
                    }));
                }
                return;
            }

            // Reenviar datos del dispositivo → panel
            if (role === 'device') {
                broadcast(panels, data.toString());
                return;
            }

            // Reenviar comandos del panel → dispositivo
            if (role === 'panel') {
                const target = msg.deviceId || Array.from(devices.keys())[0];
                const dev = devices.get(target);
                if (dev?.readyState === 1) {
                    dev.send(data.toString());
                }
            }

        } catch(e) {
            // Datos binarios (frames de cámara/pantalla) → reenviar a paneles
            if (role === 'device') {
                panels.forEach(p => {
                    if (p.readyState === 1) p.send(data);
                });
            }
        }
    });

    ws.on('close', () => {
        if (role === 'device' && deviceId) {
            devices.delete(deviceId);
            console.log(`📱 Dispositivo desconectado: ${deviceId}`);
            broadcast(panels, JSON.stringify({ type: 'device_disconnected', deviceId }));
        } else if (role === 'panel') {
            panels.delete(ws);
        }
    });

    // Keepalive
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

// Ping cada 30s para mantener conexiones vivas
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) { ws.terminate(); return; }
        ws.isAlive = false;
        ws.ping();
    });
}, 30_000);

function broadcast(clients, msg) {
    clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ ConnectMe Relay en puerto ${PORT}`));
