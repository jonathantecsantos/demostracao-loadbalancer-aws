const express = require('express');
const cors = require('cors');
const os = require('os');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// URL do Load Balancer ou Servidor Alvo configurado no .env
const RAW_TARGET_URL = process.env.TARGET_URL || process.env.LOAD_BALANCER_URL || '';
const TARGET_URL = RAW_TARGET_URL ? RAW_TARGET_URL.trim().replace(/\/+$/, '') : null;
const IS_PROXY_MODE = Boolean(TARGET_URL);

// Estado interno da instância local
const serverStartTime = Date.now();
let serverRequestCount = 0;
let isHealthy = true; // Flag para simulação de Failover na instância

// Middlewares - CORS totalmente aberto para evitar bloqueios
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Detecta as interfaces de rede locais da máquina/instância
 */
function getNetworkIps() {
  const interfaces = os.networkInterfaces();
  const detectedIps = [];

  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      const isIpv4 = iface.family === 'IPv4' || iface.family === 4;
      if (isIpv4 && !iface.internal) {
        detectedIps.push({
          interface: interfaceName,
          address: iface.address,
          netmask: iface.netmask,
          mac: iface.mac
        });
      }
    }
  }

  const primaryIp = detectedIps.length > 0 ? detectedIps[0].address : '127.0.0.1';
  return { primaryIp, allIps: detectedIps };
}

/**
 * Mapeamento determinístico de cores
 */
function resolveInstanceColor(name, configuredColor) {
  if (configuredColor) return configuredColor.toLowerCase();
  const colorPalette = ['blue', 'green', 'purple', 'orange', 'cyan', 'pink'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colorPalette[Math.abs(hash) % colorPalette.length];
}

/**
 * Formata o uptime
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// Configurações da Instância
const hostname = os.hostname();
const instanceName = process.env.INSTANCE_NAME || `Instância (${hostname})`;
const instanceColor = resolveInstanceColor(instanceName, process.env.INSTANCE_COLOR);

/**
 * Endpoint de Configuração da Aplicação
 * Rota: GET /api/config
 */
app.get('/api/config', (req, res) => {
  res.json({
    isProxyMode: IS_PROXY_MODE,
    targetUrl: TARGET_URL || null,
    localPort: PORT,
    instanceName: IS_PROXY_MODE ? null : instanceName,
    hostname: IS_PROXY_MODE ? null : hostname
  });
});

/**
 * Endpoint de Health Check padrão (Usado pelo AWS Lightsail Load Balancer)
 * Rota: GET /healthz ou GET /health
 */
const healthHandler = (req, res) => {
  if (!isHealthy) {
    return res.status(503).json({
      status: 'unhealthy',
      message: 'Instância em modo de falha para testes de Failover',
      instanceName,
      hostname,
      timestamp: new Date().toISOString()
    });
  }

  const uptimeSec = Math.floor(process.uptime());
  return res.status(200).json({
    status: 'healthy',
    instanceName,
    hostname,
    uptimeSeconds: uptimeSec,
    uptimeFormatted: formatUptime(uptimeSec),
    timestamp: new Date().toISOString()
  });
};

app.get('/healthz', healthHandler);
app.get('/health', healthHandler);

/**
 * Endpoint de Informações da Instância / Proxy do Load Balancer
 * Rota: GET /api/info
 */
app.get('/api/info', async (req, res) => {
  serverRequestCount++;

  // SE TARGET_URL estiver configurado no .env, repassa a requisição para o Load Balancer da AWS
  if (IS_PROXY_MODE) {
    const fetchStart = Date.now();
    try {
      const urlToFetch = `${TARGET_URL}/api/info?client_req=${serverRequestCount}&t=${Date.now()}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

      const remoteResponse = await fetch(urlToFetch, {
        method: 'GET',
        headers: {
          'User-Agent': 'LoadBalancer-Local-Client',
          'X-Forwarded-From-Student': req.socket.remoteAddress || 'localhost'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const roundTripMs = Date.now() - fetchStart;

      if (!remoteResponse.ok) {
        return res.status(remoteResponse.status).json({
          error: true,
          statusText: remoteResponse.statusText,
          statusCode: remoteResponse.status,
          targetUrl: TARGET_URL,
          message: `O Load Balancer ou Instância remota respondeu com HTTP ${remoteResponse.status}`
        });
      }

      const remoteData = await remoteResponse.json();
      
      // Adiciona metadados da conexão do aluno
      remoteData.proxyMode = true;
      remoteData.targetUrl = TARGET_URL;
      remoteData.localClientRequestCount = serverRequestCount;
      remoteData.remoteRoundTripMs = roundTripMs;

      return res.json(remoteData);

    } catch (err) {
      console.error(`❌ Erro ao conectar ao Load Balancer (${TARGET_URL}):`, err.message);
      return res.status(502).json({
        error: true,
        isHealthy: false,
        instanceName: 'Load Balancer / Instância Inacessível',
        targetUrl: TARGET_URL,
        message: `Falha ao alcançar a URL configurada no .env (${TARGET_URL}): ${err.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  // MODO INSTÂNCIA LOCAL / NÓ NA AWS (quando TARGET_URL não está preenchido)
  const { primaryIp, allIps } = getNetworkIps();
  const uptimeSec = Math.floor(process.uptime());
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);

  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedProto = req.headers['x-forwarded-proto'] || req.protocol;
  const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;

  res.json({
    proxyMode: false,
    instanceName,
    hostname,
    primaryIp,
    allIps,
    instanceColor,
    isHealthy,
    serverRequestCount,
    serverStartTime: new Date(serverStartTime).toISOString(),
    uptimeSeconds: uptimeSec,
    uptimeFormatted: formatUptime(uptimeSec),
    system: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memory: {
        freeMb: freeMemMb,
        totalMb: totalMemMb,
        usagePercent: Math.round(((totalMemMb - freeMemMb) / totalMemMb) * 100)
      },
      nodeVersion: process.version
    },
    clientInfo: {
      clientIp,
      forwardedFor: forwardedFor || null,
      protocol: forwardedProto,
      host: req.headers.host || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown'
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * Endpoint para simulação de failover
 * Rota: POST /api/toggle-health
 */
app.post('/api/toggle-health', async (req, res) => {
  if (IS_PROXY_MODE) {
    try {
      const remoteResponse = await fetch(`${TARGET_URL}/api/toggle-health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await remoteResponse.json();
      return res.json(data);
    } catch (err) {
      return res.status(502).json({ error: true, message: `Erro ao repassar failover: ${err.message}` });
    }
  }

  isHealthy = !isHealthy;
  res.json({
    isHealthy,
    status: isHealthy ? 'healthy' : 'unhealthy',
    message: isHealthy
      ? 'Instância marcada como SAUDÁVEL (Health Check retornará 200 OK).'
      : 'Instância marcada como INDISPONÍVEL (Health Check retornará 503 Service Unavailable).'
  });
});

// Fallback para SPA / index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(`🚀 [AWS Lightsail Load Balancer Demo App]`);
  console.log(`⚡ Servidor escutando na porta: ${PORT}`);
  
  if (IS_PROXY_MODE) {
    console.log(`🎯 MODO: CLIENTE / FRONTEND LOCAL (ALUNO)`);
    console.log(`🔗 Alvo do Load Balancer (.env): ${TARGET_URL}`);
    console.log(`🌐 Acesse seu painel em:         http://localhost:${PORT}/`);
  } else {
    const { primaryIp } = getNetworkIps();
    console.log(`☁️  MODO: INSTÂNCIA BACKEND (AWS LIGHTSAIL)`);
    console.log(`📌 Nome da Instância:            ${instanceName}`);
    console.log(`🎨 Cor Temática:                ${instanceColor}`);
    console.log(`🌐 IP Detectado:                 ${primaryIp}`);
    console.log(`🩺 Health Check:                 http://localhost:${PORT}/healthz`);
  }
  console.log('================================================================');
});
