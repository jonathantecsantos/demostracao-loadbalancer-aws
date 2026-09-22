/**
 * AWS Lightsail Load Balancer Demo App - Frontend Logic
 */

// Estado da Aplicação no Navegador
const state = {
  clientRequestCount: 0,
  history: [],
  instanceCounts: {},
  currentInstanceName: null,
  autoRefreshActive: false,
  autoRefreshTimer: null,
  progressTimer: null,
  progressStartTime: null,
  progressDuration: 2000,
  appConfig: null
};

// Elementos DOM
const elements = {
  body: document.body,
  headerSubtitle: document.getElementById('headerSubtitle'),
  targetModeLabel: document.getElementById('targetModeLabel'),
  heroCard: document.getElementById('heroCard'),
  statusBadge: document.getElementById('statusBadge'),
  statusText: document.getElementById('statusText'),
  statusCode: document.getElementById('statusCode'),
  latencyBadge: document.getElementById('latencyBadge'),
  latencyText: document.getElementById('latencyText'),
  instanceName: document.getElementById('instanceName'),
  instanceIp: document.getElementById('instanceIp'),
  instanceHostname: document.getElementById('instanceHostname'),
  copyIpBtn: document.getElementById('copyIpBtn'),
  serverReqCount: document.getElementById('serverReqCount'),
  clientReqCount: document.getElementById('clientReqCount'),
  uptimeText: document.getElementById('uptimeText'),
  lastSeenTime: document.getElementById('lastSeenTime'),
  btnRequest: document.getElementById('btnRequest'),
  autoRefreshToggle: document.getElementById('autoRefreshToggle'),
  refreshInterval: document.getElementById('refreshInterval'),
  progressBarContainer: document.getElementById('progressBarContainer'),
  progressBarFill: document.getElementById('progressBarFill'),
  btnClearHistory: document.getElementById('btnClearHistory'),
  feedCountBadge: document.getElementById('feedCountBadge'),
  distributionSummary: document.getElementById('distributionSummary'),
  historyTrack: document.getElementById('historyTrack'),
  networkList: document.getElementById('networkList'),
  sysPlatform: document.getElementById('sysPlatform'),
  sysArch: document.getElementById('sysArch'),
  sysCpus: document.getElementById('sysCpus'),
  sysMemory: document.getElementById('sysMemory'),
  sysNodeVersion: document.getElementById('sysNodeVersion'),
  clientIp: document.getElementById('clientIp'),
  forwardedFor: document.getElementById('forwardedFor'),
  clientProto: document.getElementById('clientProto'),
  clientHost: document.getElementById('clientHost'),
  toast: document.getElementById('toast')
};

// Cores mapeadas para o histórico
const colorMap = {
  blue: '#38bdf8',
  green: '#10b981',
  purple: '#c084fc',
  orange: '#fb923c',
  cyan: '#22d3ee',
  pink: '#f472b6',
  red: '#f87171'
};

/**
 * Exibe notificação toast elegante
 */
function showToast(message, duration = 3000) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(elements.toast._timeout);
  elements.toast._timeout = setTimeout(() => {
    elements.toast.classList.remove('show');
  }, duration);
}

/**
 * Atualiza o tema de cor no elemento <body>
 */
function applyTheme(colorName, isHealthy) {
  elements.body.className = '';
  if (!isHealthy) {
    elements.body.classList.add('is-unhealthy');
  } else {
    elements.body.classList.add(`theme-${colorName || 'blue'}`);
  }
}

/**
 * Carrega a configuração inicial da aplicação (/api/config)
 */
async function loadAppConfig() {
  try {
    const res = await fetch('/api/config');
    state.appConfig = await res.json();

    if (state.appConfig.isProxyMode && state.appConfig.targetUrl) {
      elements.targetModeLabel.textContent = 'CONECTADO AO LOAD BALANCER';
      elements.headerSubtitle.innerHTML = `🎯 Apontando para o Load Balancer AWS: <strong>${state.appConfig.targetUrl}</strong>`;
    } else {
      elements.targetModeLabel.textContent = 'MODO LOCAL';
      elements.headerSubtitle.innerHTML = `💻 Modo Local (Defina <code>TARGET_URL</code> no arquivo <code>.env</code> para conectar ao Load Balancer AWS)`;
    }
  } catch (err) {
    console.warn('Erro ao carregar /api/config:', err);
  }
}

/**
 * Faz a requisição para /api/info e atualiza a interface
 */
async function fetchInstanceInfo() {
  const startTime = performance.now();
  state.clientRequestCount++;
  elements.clientReqCount.textContent = state.clientRequestCount;
  elements.btnRequest.classList.add('loading');

  try {
    const response = await fetch(`/api/info?t=${Date.now()}`, {
      cache: 'no-store'
    });

    const latencyMs = Math.round(performance.now() - startTime);
    elements.latencyText.textContent = `${latencyMs} ms`;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    renderInstanceData(data, latencyMs);

  } catch (error) {
    console.error('Erro ao buscar dados da instância:', error);
    renderErrorState(error);
  } finally {
    elements.btnRequest.classList.remove('loading');
  }
}

/**
 * Renderiza os dados recebidos do servidor
 */
function renderInstanceData(data, latencyMs) {
  const hasChangedInstance = state.currentInstanceName !== null && state.currentInstanceName !== data.instanceName;
  state.currentInstanceName = data.instanceName;

  // Atualiza Tema
  applyTheme(data.instanceColor, data.isHealthy !== false);

  // Animação de destaque do Card
  elements.heroCard.classList.remove('animate-update');
  void elements.heroCard.offsetWidth; // Força reflow
  elements.heroCard.classList.add('animate-update');

  // Status Badge
  elements.statusBadge.classList.remove('unhealthy');
  elements.statusText.textContent = 'ONLINE / HEALTHY';
  elements.statusCode.textContent = 'HTTP 200';

  // Nome e IPs
  elements.instanceName.textContent = data.instanceName || 'Instância AWS';
  elements.instanceIp.textContent = data.primaryIp || '0.0.0.0';
  elements.instanceHostname.textContent = data.hostname || 'aws-node';

  // Estatísticas
  elements.serverReqCount.textContent = data.serverRequestCount || 0;
  elements.uptimeText.textContent = data.uptimeFormatted || `${data.uptimeSeconds || 0}s`;
  elements.lastSeenTime.textContent = new Date().toLocaleTimeString();

  // Atualiza Lista de Interfaces de Rede
  if (data.allIps && data.allIps.length > 0) {
    elements.networkList.innerHTML = data.allIps
      .map(item => `<li><strong>${item.interface}:</strong> ${item.address} <span style="opacity:0.6">(${item.netmask})</span></li>`)
      .join('');
  } else {
    elements.networkList.innerHTML = `<li>${data.primaryIp || '127.0.0.1'}</li>`;
  }

  // Métricas do SO
  if (data.system) {
    elements.sysPlatform.textContent = `${data.system.platform} (${data.system.release})`;
    elements.sysArch.textContent = data.system.arch;
    elements.sysCpus.textContent = `${data.system.cpus} Core(s)`;
    elements.sysMemory.textContent = `${data.system.memory.freeMb} MB livres / ${data.system.memory.totalMb} MB (${data.system.memory.usagePercent}% usado)`;
    elements.sysNodeVersion.textContent = data.system.nodeVersion;
  }

  // Dados do Cliente e Load Balancer
  if (data.clientInfo) {
    elements.clientIp.textContent = data.clientInfo.clientIp || '--';
    elements.forwardedFor.textContent = data.clientInfo.forwardedFor || '(Direto sem proxy)';
    elements.clientProto.textContent = (data.clientInfo.protocol || 'HTTP').toUpperCase();
    elements.clientHost.textContent = data.clientInfo.host || '--';
  }

  // Atualizar Histórico e Distribuição
  addHistoryEntry({
    instanceName: data.instanceName,
    ip: data.primaryIp,
    color: data.instanceColor || 'blue',
    latency: latencyMs,
    time: new Date().toLocaleTimeString(),
    isHealthy: true
  });

  if (hasChangedInstance) {
    showToast(`🔄 Load Balancer alternou para: ${data.instanceName}`, 2500);
  }
}

/**
 * Renderiza estado de erro (ex: Failover em andamento ou servidor inacessível)
 */
function renderErrorState(error) {
  elements.statusBadge.classList.add('unhealthy');
  elements.statusText.textContent = 'FAILOVER / INDISPONÍVEL';
  elements.statusCode.textContent = 'AVISO';
  elements.instanceName.textContent = 'Instância Parou de Responder';
  elements.latencyText.textContent = 'TIMEOUT';
  applyTheme('red', false);
  showToast(`Aviso: ${error.message || 'Instância inacessível. O Load Balancer está desviando o tráfego...'}`, 4000);
}

/**
 * Adiciona registro ao histórico visual e recalcula proporção de distribuição
 */
function addHistoryEntry(entry) {
  state.history.unshift(entry);
  if (state.history.length > 50) {
    state.history.pop();
  }

  if (!state.instanceCounts[entry.instanceName]) {
    state.instanceCounts[entry.instanceName] = {
      count: 0,
      color: entry.color,
      ip: entry.ip
    };
  }
  state.instanceCounts[entry.instanceName].count++;
  state.instanceCounts[entry.instanceName].color = entry.color;
  state.instanceCounts[entry.instanceName].ip = entry.ip;

  renderDistributionFeed();
}

/**
 * Renderiza o sumário de proporção e a timeline de distribuição
 */
function renderDistributionFeed() {
  const total = state.history.length;
  elements.feedCountBadge.textContent = `${total} requisiç${total === 1 ? 'ão' : 'ões'} capturada${total === 1 ? '' : 's'}`;

  // 1. Proporção das Instâncias
  const totalCounts = Object.values(state.instanceCounts).reduce((acc, cur) => acc + cur.count, 0);
  let summaryHtml = '';

  for (const [name, info] of Object.entries(state.instanceCounts)) {
    const pct = totalCounts > 0 ? Math.round((info.count / totalCounts) * 100) : 0;
    const hexColor = colorMap[info.color] || '#38bdf8';

    summaryHtml += `
      <div class="dist-pill" style="border-left: 3px solid ${hexColor};">
        <div class="dist-pill-top">
          <span style="color: ${hexColor}; font-weight: 700;">${name}</span>
          <span class="dist-pill-pct">${pct}%</span>
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8;">
          ${info.count} requisiç${info.count === 1 ? 'ão' : 'ões'} • IP: ${info.ip}
        </div>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width: ${pct}%; background: ${hexColor};"></div>
        </div>
      </div>
    `;
  }
  elements.distributionSummary.innerHTML = summaryHtml;

  // 2. Timeline Flow
  if (state.history.length === 0) {
    elements.historyTrack.innerHTML = `<div class="history-placeholder">Clique em "Fazer Nova Requisição" ou ative o Auto-Refresh para visualizar a alternância de nós pelo Load Balancer.</div>`;
    return;
  }

  const trackHtml = state.history.slice(0, 20).map((item, index) => {
    const hexColor = colorMap[item.color] || '#38bdf8';
    const seqNum = state.history.length - index;
    return `
      <div class="history-item" style="border-color: ${hexColor}40;">
        <span class="item-seq">#${seqNum}</span>
        <span class="color-dot" style="background: ${hexColor}; box-shadow: 0 0 6px ${hexColor};"></span>
        <span style="color: ${hexColor}; font-weight: 700;">${item.instanceName}</span>
        <span style="font-size: 0.72rem; color: #64748b;">${item.latency}ms</span>
      </div>
    `;
  }).join('');

  elements.historyTrack.innerHTML = trackHtml;
}

/**
 * Gerencia o modo Auto-Refresh
 */
function setupAutoRefresh() {
  const toggle = elements.autoRefreshToggle;
  const intervalSelect = elements.refreshInterval;

  function updateIntervalDuration() {
    state.progressDuration = parseInt(intervalSelect.value, 10) || 2000;
  }

  function startAutoRefresh() {
    state.autoRefreshActive = true;
    updateIntervalDuration();
    elements.progressBarContainer.classList.add('active');
    
    fetchInstanceInfo();
    startProgressLoop();

    state.autoRefreshTimer = setInterval(() => {
      fetchInstanceInfo();
      startProgressLoop();
    }, state.progressDuration);
  }

  function stopAutoRefresh() {
    state.autoRefreshActive = false;
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
    cancelAnimationFrame(state.progressTimer);
    elements.progressBarContainer.classList.remove('active');
    elements.progressBarFill.style.width = '0%';
  }

  function startProgressLoop() {
    state.progressStartTime = performance.now();
    cancelAnimationFrame(state.progressTimer);

    function frame(now) {
      if (!state.autoRefreshActive) return;
      const elapsed = now - state.progressStartTime;
      const pct = Math.min(100, (elapsed / state.progressDuration) * 100);
      elements.progressBarFill.style.width = `${pct}%`;

      if (elapsed < state.progressDuration) {
        state.progressTimer = requestAnimationFrame(frame);
      }
    }
    state.progressTimer = requestAnimationFrame(frame);
  }

  toggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      startAutoRefresh();
      showToast('⚡ Auto-Refresh ativado!');
    } else {
      stopAutoRefresh();
      showToast('Auto-Refresh desativado.');
    }
  });

  intervalSelect.addEventListener('change', () => {
    if (state.autoRefreshActive) {
      stopAutoRefresh();
      toggle.checked = true;
      startAutoRefresh();
    }
  });
}

/**
 * Copia o endereço IP para a área de transferência
 */
function copyIpToClipboard() {
  const ip = elements.instanceIp.textContent;
  if (!ip || ip === '0.0.0.0') return;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ip).then(() => {
      showToast(`IP ${ip} copiado!`);
    }).catch(() => fallbackCopy(ip));
  } else {
    fallbackCopy(ip);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showToast(`IP ${text} copiado!`);
  } catch (e) {
    showToast('Não foi possível copiar o IP.');
  }
  document.body.removeChild(textarea);
}

/**
 * Limpa o histórico de requisições
 */
function clearHistory() {
  state.history = [];
  state.instanceCounts = {};
  state.clientRequestCount = 0;
  elements.clientReqCount.textContent = '0';
  renderDistributionFeed();
  showToast('Histórico limpo com sucesso.');
}

// Inicialização dos Event Listeners
function initEventListeners() {
  elements.btnRequest.addEventListener('click', fetchInstanceInfo);
  elements.copyIpBtn.addEventListener('click', copyIpToClipboard);
  elements.btnClearHistory.addEventListener('click', clearHistory);

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      fetchInstanceInfo();
    }
  });

  setupAutoRefresh();
}

// Inicializa a aplicação ao carregar o DOM
document.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  await loadAppConfig();
  fetchInstanceInfo();
});
