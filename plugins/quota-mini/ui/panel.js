(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const pending = new Map();
  let nextId = 0;
  let ready = false;
  let busy = false;
  let latest = null;
  let hostContext = {};
  let interval;
  let clock;

  function notify(method, params = {}) {
    window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
  }
  function request(method, params, timeoutMs = 24000) {
    return new Promise((resolve, reject) => {
      const id = 'quota-mini-' + (++nextId);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Host request timed out'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  function notice(message = '') {
    $('notice').textContent = message;
    $('notice').hidden = !message;
    reportHeight();
  }
  function reportHeight() {
    if (window.parent !== window) {
      notify('ui/notifications/size-changed', { height: Math.ceil(document.querySelector('.card').getBoundingClientRect().height) });
    }
  }
  function validPercent(window) {
    const value = window?.remainingPercent;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  }
  function resetText(window) {
    if (!window) return '账户未提供此项额度';
    const reset = window.resetsAt;
    if (typeof reset !== 'number' || !Number.isFinite(new Date(reset * 1000).getTime())) return '暂未提供重置时间';
    const remaining = reset * 1000 - Date.now();
    if (remaining <= 0) return '重置时间已到，等待更新';
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(reset * 1000);
    if (remaining < 24 * 3600000) return time + ' 重置';
    const date = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(reset * 1000);
    return date + ' ' + time + ' 重置';
  }
  function drawWindow(prefix, rowId, value) {
    const valid = validPercent(value);
    $(prefix + '-value').textContent = valid ? value.remainingPercent.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '%' : '—';
    $(prefix + '-bar').style.width = valid ? value.remainingPercent + '%' : '0%';
    const meter = $(prefix + '-meter');
    if (valid) meter.setAttribute('aria-valuenow', String(value.remainingPercent));
    else meter.removeAttribute('aria-valuenow');
    $(prefix + '-reset').textContent = resetText(valid ? value : null);
    $(rowId).dataset.low = String(valid && value.remainingPercent <= 15);
  }
  function render(snapshot) {
    if (!snapshot || !['ok', 'stale', 'error'].includes(snapshot.status)) return;
    // An error response can never make old values look current.
    latest = snapshot;
    drawWindow('short', 'short-row', snapshot.short);
    drawWindow('week', 'week-row', snapshot.weekly);
    const minutes = snapshot.short?.windowMinutes;
    $('short-label').textContent = minutes === 300 ? '5 小时' : minutes ? (minutes >= 60 ? (minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' 小时' : minutes + ' 分钟') : '短时';
    $('dot').dataset.status = snapshot.status;
    notice(snapshot.status === 'ok' ? '' : snapshot.message || '暂未更新，正在重试。');
    updateAge();
  }
  function updateAge() {
    if (!latest?.updatedAt) {
      $('updated').textContent = latest?.status === 'error' ? '暂时无法读取' : '正在读取…';
      return;
    }
    const timestamp = Date.parse(latest.updatedAt);
    if (!Number.isFinite(timestamp)) { $('updated').textContent = '更新时间不可用'; return; }
    const age = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    const text = age < 1 ? '刚刚更新' : age + ' 分钟前更新';
    $('updated').textContent = latest.status === 'ok' ? text + ' · 每分钟刷新' : '上次成功：' + text;
    $('updated').title = new Date(timestamp).toLocaleString('zh-CN');
  }
  function updateContext(context = {}) {
    hostContext = { ...hostContext, ...context };
    const theme = hostContext.theme ?? window.openai?.theme;
    if (theme === 'dark' || theme === 'light') document.body.dataset.theme = theme;
    const mode = hostContext.displayMode ?? window.openai?.displayMode;
    if (mode) document.body.dataset.mode = mode;
    // The compatibility API exists even when the host has not enabled PiP.
    // Only the host's advertised modes can authorize offering this control.
    const canFloat = hostContext.availableDisplayModes?.includes('pip') === true || mode === 'pip';
    $('float').hidden = !canFloat;
    $('float').disabled = !ready || !canFloat;
    $('float').title = mode === 'pip' ? '收回到对话内' : '悬浮显示';
    $('float').setAttribute('aria-label', mode === 'pip' ? '收回到对话内' : '悬浮显示');
  }
  async function refresh() {
    if (!ready || busy || document.hidden && hostContext.displayMode !== 'pip') return;
    busy = true;
    $('refresh').disabled = true;
    try {
      const result = ready === 'standard'
        ? await request('tools/call', { name: 'read_quota', arguments: {} })
        : await window.openai.callTool('read_quota', {});
      const snapshot = result?.structuredContent ?? result;
      if (!snapshot || !['ok', 'stale', 'error'].includes(snapshot.status)) throw new Error('Invalid result');
      render(snapshot);
    } catch {
      render({ ...(latest ?? {}), status: latest?.updatedAt ? 'stale' : 'error', message: '暂时无法更新额度，稍后会自动重试。' });
    } finally {
      busy = false;
      $('refresh').disabled = false;
    }
  }
  function start() {
    $('refresh').disabled = false;
    $('desktop').disabled = false;
    updateContext();
    clearInterval(interval);
    clearInterval(clock);
    interval = setInterval(refresh, 60000);
    clock = setInterval(updateAge, 15000);
    void refresh();
    reportHeight();
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) {
        const error = new Error('Host request failed');
        error.code = typeof message.error.code === 'number' ? message.error.code : null;
        entry.reject(error);
      } else entry.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/tool-result') render(message.params?.structuredContent);
    if (message.method === 'ui/notifications/host-context-changed') updateContext(message.params?.hostContext ?? message.params);
    if (message.method === 'ui/resource-teardown' && message.id !== undefined) {
      clearInterval(interval); clearInterval(clock);
      window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
    }
  });
  window.addEventListener('openai:set_globals', event => {
    const globals = event.detail?.globals;
    if (globals?.toolOutput) render(globals.toolOutput);
    updateContext(globals ?? {});
  });
  $('refresh').addEventListener('click', refresh);
  $('desktop').addEventListener('click', async () => {
    if (!ready) return;
    $('desktop').disabled = true;
    try {
      const result = ready === 'standard'
        ? await request('tools/call', { name: 'open_desktop_quota', arguments: {} })
        : await window.openai.callTool('open_desktop_quota', {});
      const state = result?.structuredContent?.desktopWindow;
      if (result?.isError || !['opened', 'already-open'].includes(state)) throw new Error('Window not confirmed');
      notice('桌面悬浮窗已打开，可拖动位置；点小窗的 × 关闭。');
    } catch { notice('未能打开桌面悬浮窗，请对我说“打开桌面额度悬浮窗”重试。'); }
    finally { $('desktop').disabled = false; }
  });
  $('float').addEventListener('click', async () => {
    if ($('float').hidden) return;
    const mode = (hostContext.displayMode ?? window.openai?.displayMode) === 'pip' ? 'inline' : 'pip';
    $('float').disabled = true;
    try {
      let response;
      if (ready === 'standard') {
        try { response = await request('ui/request-display-mode', { mode }, 8000); }
        catch (error) {
          if (error.code !== -32601 || typeof window.openai?.requestDisplayMode !== 'function') throw error;
          response = await window.openai.requestDisplayMode({ mode });
        }
      } else { response = await window.openai.requestDisplayMode({ mode }); }
      const actualMode = response?.mode ?? hostContext.displayMode;
      if (['inline', 'fullscreen', 'pip'].includes(actualMode)) updateContext({ displayMode: actualMode });
      if (actualMode !== mode) throw new Error('Mode not confirmed');
      notice(latest?.status === 'ok' ? '' : latest?.message);
    } catch { notice('显示方式切换未成功，已保留原视图。'); }
    finally { updateContext(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('pagehide', () => {
    clearInterval(interval); clearInterval(clock);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('UI closed')); }
    pending.clear();
  });
  async function initialize() {
    if (window.parent === window) {
      $('updated').textContent = '请从 ChatGPT 插件中打开';
      return;
    }
    try {
      const response = await request('ui/initialize', {
        appInfo: { name: 'quota-mini', title: '额度小窗', version: '0.2.5' },
        appCapabilities: { availableDisplayModes: ['inline', 'pip', 'fullscreen'] },
        protocolVersion: '2026-01-26',
      }, 5000);
      ready = 'standard';
      notify('ui/notifications/initialized');
      updateContext(response?.hostContext ?? {});
    } catch {
      if (typeof window.openai?.callTool !== 'function') {
        $('updated').textContent = '未能连接插件';
        notice('请从已安装的“额度小窗”插件打开此面板。');
        return;
      }
      ready = 'legacy';
    }
    if (window.openai?.toolOutput) render(window.openai.toolOutput);
    start();
  }
  void initialize();
})();
