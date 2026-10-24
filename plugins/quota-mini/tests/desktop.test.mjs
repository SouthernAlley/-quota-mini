import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { desktopAction } from '../lib/desktop.mjs';
import { createMcpHandler } from '../lib/mcp.mjs';

test('desktop launch is fixed, hidden, acknowledged, and detached from the MCP server', async () => {
  const child = new EventEmitter();
  let disconnected = false, unreferenced = false;
  child.connected = true;
  child.disconnect = () => { disconnected = true; child.connected = false; };
  child.unref = () => { unreferenced = true; };
  child.kill = () => assert.fail('Successful window must stay open');
  const spawnProcess = (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.match(args[0], /desktop[\\/]runner\.mjs$/);
    assert.equal(args[1], 'open');
    assert.equal(args.length, 2);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.detached, true);
    assert.deepEqual(options.stdio, ['ignore', 'ignore', 'ignore', 'ipc']);
    queueMicrotask(() => child.emit('message', { ok: true, status: 'opened', token: 'PRIVATE' }));
    return child;
  };
  assert.deepEqual(await desktopAction('open', { spawnProcess, platform: 'win32' }), { status: 'opened' });
  assert.ok(disconnected && unreferenced);
});

test('failed desktop startup is reported safely rather than claiming a window opened', async () => {
  const child = new EventEmitter();
  let killed = false;
  child.unref = () => {};
  child.kill = () => { killed = true; };
  await assert.rejects(desktopAction('open', {
    platform: 'win32', timeoutMs: 30,
    spawnProcess: () => { queueMicrotask(() => child.emit('error', new Error('Authorization: SECRET'))); return child; },
  }), error => error.message === 'Desktop window could not start');
  assert.ok(killed);
});

test('desktop tools accept no commands or paths and never call the quota reader to change window state', async () => {
  const actions = [];
  const handler = createMcpHandler({ html: '', getQuota: async () => assert.fail('No model/quota request needed'),
    desktopAction: async action => { actions.push(action); return { status: action === 'open' ? 'opened' : 'closed' }; },
  });
  const call = (name, args = {}) => handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  assert.equal((await call('open_desktop_quota', { command: 'anything' })).error.code, -32602);
  assert.equal((await call('open_desktop_quota')).structuredContent.desktopWindow, 'opened');
  assert.equal((await call('close_desktop_quota')).structuredContent.desktopWindow, 'closed');
  assert.deepEqual(actions, ['open', 'close']);
  const failed = createMcpHandler({ html: '', desktopAction: async () => { throw new Error('Bearer SECRET'); } });
  const response = await failed({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_desktop_quota' } });
  assert.equal(response.isError, true);
  assert.doesNotMatch(JSON.stringify(response), /SECRET|Bearer/);
});
