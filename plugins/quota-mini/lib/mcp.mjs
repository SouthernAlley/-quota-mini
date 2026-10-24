import { readFile } from 'node:fs/promises';

export const UI_URI = 'ui://quota-mini/v3/panel.html';
export const MIME_TYPE = 'text/html;profile=mcp-app';
const SCHEMA = { type: 'object', properties: {}, additionalProperties: false };
const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export async function loadPanel() {
  const [html, css, js] = await Promise.all(['panel.html', 'panel.css', 'panel.js'].map(file =>
    readFile(new URL('../ui/' + file, import.meta.url), 'utf8')));
  return html.replace('/*__QUOTA_CSS__*/', css).replace('/*__QUOTA_JS__*/', js);
}

export function createMcpHandler({ getQuota, html, desktopAction }) {
  const tools = [
    {
      name: 'open_quota_panel', title: '打开额度小窗',
      description: '在 ChatGPT 内打开简洁的订阅额度面板，显示 ChatGPT Work / Codex 的短时和每周剩余百分比及重置时间。只读，不发起聊天或调用模型。',
      inputSchema: SCHEMA, annotations: ANNOTATIONS,
      _meta: {
        ui: { resourceUri: UI_URI, visibility: ['model', 'app'] },
        'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }], preferredModelDisplayMode: 'inline' },
        'openai/outputTemplate': UI_URI,
        'openai/widgetAccessible': true,
        'openai/toolInvocation/invoking': '正在读取额度…',
        'openai/toolInvocation/invoked': '额度已读取',
      },
    },
    {
      name: 'read_quota', title: '刷新额度',
      description: '只读获取现有 ChatGPT 登录账户的 Work / Codex 剩余额度与重置时间。供额度面板自动刷新使用，不返回密钥、聊天或账户身份信息。',
      inputSchema: SCHEMA, annotations: ANNOTATIONS,
      _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true },
    },
    ...[
      { name: 'open_desktop_quota', title: '打开桌面悬浮窗', description: '在 Windows 桌面打开置顶额度小窗，切换到其他软件仍可见。可拖动、每分钟刷新、关闭。使用插件附带的本机窗口组件，不另装应用，不改开机启动。' },
      { name: 'close_desktop_quota', title: '关闭桌面悬浮窗', description: '关闭额度插件的桌面悬浮窗并停止它的定时刷新。不会关闭 ChatGPT 或其他软件。' },
    ].map(tool => ({ ...tool, inputSchema: SCHEMA,
      annotations: { ...ANNOTATIONS, readOnlyHint: false },
      _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true },
    })),
  ];
  return async function handle(message) {
    if (!message || message.jsonrpc !== '2.0') return { error: { code: -32600, message: 'Invalid request' } };
    const { method, params = {} } = message;
    if (method === 'initialize') return {
      protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'quota-mini', title: '额度小窗', version: '0.2.5' },
      instructions: 'Local subscription quota reader. Never sends prompts, consumes reset credits, changes login, or exposes credentials. Use open_quota_panel for the ChatGPT panel. Use open_desktop_quota when the user wants a desktop-wide always-on-top window; close_desktop_quota closes that helper. Only window actions and saving window preferences change local UI state.',
    };
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools };
    if (method === 'resources/list') return { resources: [{ uri: UI_URI, name: '额度小窗', mimeType: MIME_TYPE }] };
    if (method === 'resources/templates/list') return { resourceTemplates: [] };
    if (method === 'resources/read') {
      if (params.uri !== UI_URI) return { error: { code: -32602, message: 'Unknown resource' } };
      return { contents: [{ uri: UI_URI, mimeType: MIME_TYPE, text: html, _meta: {
        ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
        'openai/ui': { availableDisplayModes: ['inline', 'pip', 'fullscreen'], preferredDisplayMode: 'inline' },
        'openai/widgetDescription': '只显示短时和每周剩余额度的本地只读面板。',
        'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
      } }] };
    }
    if (method === 'tools/call') {
      if (!tools.some(tool => tool.name === params.name)) return { error: { code: -32602, message: 'Unknown tool' } };
      if (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments) || Object.keys(params.arguments).length)) {
        return { error: { code: -32602, message: 'This tool accepts no arguments' } };
      }
      if (['open_desktop_quota', 'close_desktop_quota'].includes(params.name)) {
        try {
          if (typeof desktopAction !== 'function') throw new Error('Unavailable');
          const result = await desktopAction(params.name === 'open_desktop_quota' ? 'open' : 'close');
          const messages = { opened: '已打开桌面悬浮窗，切换软件仍可见。', 'already-open': '桌面悬浮窗已在运行，已将它置顶。', closed: '已请求关闭桌面悬浮窗并停止刷新。', 'not-open': '桌面悬浮窗当前没有打开。' };
          if (!messages[result.status]) throw new Error('Invalid result');
          return { content: [{ type: 'text', text: messages[result.status] }], structuredContent: { desktopWindow: result.status } };
        } catch {
          return { content: [{ type: 'text', text: '无法操作桌面悬浮窗，请确认在 Windows 本地模式中运行，并检查本机窗口组件是否可用。' }], isError: true };
        }
      }
      const snapshot = await getQuota();
      const percent = value => value ? value.remainingPercent + '%' : '未提供';
      const text = snapshot.status === 'ok'
        ? `短时剩余 ${percent(snapshot.short)}，每周剩余 ${percent(snapshot.weekly)}。`
        : snapshot.message;
      return { content: [{ type: 'text', text }], structuredContent: snapshot, isError: snapshot.status === 'error' };
    }
    return { error: { code: -32601, message: 'Method not found' } };
  };
}
