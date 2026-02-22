import { useState, useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';

const s = {
  card: {
    background: '#1a1d2e', border: '1px solid #2d3148', borderRadius: '10px',
    padding: '1.25rem 1.5rem', marginBottom: '1rem',
  },
  header: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' },
  dot: (connected) => ({
    width: '10px', height: '10px', borderRadius: '50%',
    background: connected ? '#22c55e' : '#ef4444',
    flexShrink: 0,
  }),
  title: { fontWeight: 700, color: '#a78bfa' },
  log: {
    background: '#0f1117', borderRadius: '6px', padding: '0.75rem',
    height: '180px', overflowY: 'auto', fontSize: '0.8rem',
    color: '#94a3b8', fontFamily: 'monospace',
  },
  logEntry: (type) => ({
    marginBottom: '0.25rem',
    color: type === 'error' ? '#fca5a5' : type === 'info' ? '#7dd3fc' : '#a3e635',
  }),
  row: { display: 'flex', gap: '0.5rem', marginTop: '0.75rem' },
  input: {
    flex: 1, padding: '0.5rem 0.75rem', borderRadius: '6px',
    background: '#0f1117', border: '1px solid #2d3148', color: '#e2e8f0',
    fontSize: '0.9rem', outline: 'none',
  },
  btn: (color) => ({
    padding: '0.5rem 1rem', borderRadius: '6px', background: color ?? '#7c3aed',
    color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', border: 'none',
  }),
};

export default function SignalRPanel() {
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [name, setName] = useState('');
  const connRef = useRef(null);
  const logEndRef = useRef(null);

  function addLog(msg, type = 'event') {
    setLogs((l) => [...l, { msg, type, ts: new Date().toLocaleTimeString() }]);
  }

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  async function connect() {
    const jwt = localStorage.getItem('jwt');
    if (!jwt) { addLog('No JWT found – please log in first', 'error'); return; }

    const hubUrl = `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5210'}/updates`;
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, { accessTokenFactory: () => jwt })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connection.on('ReceiveMessage', (msg) => addLog(`ReceiveMessage: ${msg}`));
    connection.on('FriendRequestReceived', (data) => addLog(`FriendRequestReceived: ${JSON.stringify(data)}`));
    connection.on('Hello', (greeting) => addLog(`Hello from server: ${greeting}`, 'success'));
    connection.on('GroupsUpdated', (groups) => addLog(`GroupsUpdated: ${JSON.stringify(groups)}`, 'info'));
    connection.on('NewMessage', (msg) => addLog(`NewMessage: ${JSON.stringify(msg)}`, 'info'));
    connection.on('NewChannel', (channel) => addLog(`NewChannel: ${JSON.stringify(channel)}`, 'info'));

    connection.onclose(() => { setConnected(false); addLog('Connection closed', 'info'); });
    connection.onreconnecting(() => addLog('Reconnecting…', 'info'));
    connection.onreconnected(() => { setConnected(true); addLog('Reconnected', 'info'); });

    try {
      await connection.start();
      connRef.current = connection;
      setConnected(true);
      addLog('Connected to /updates hub', 'info');
    } catch (err) {
      addLog(`Connection failed: ${err.message}`, 'error');
    }
  }

  async function disconnect() {
    await connRef.current?.stop();
    connRef.current = null;
  }

  async function sayHello() {
    if (!connRef.current) { addLog('Not connected', 'error'); return; }
    try {
      await connRef.current.invoke('SayHello', name || 'World');
    } catch (err) {
      addLog(`SayHello error: ${err.message}`, 'error');
    }
  }

  return (
    <div style={s.card}>
      <div style={s.header}>
        <div style={s.dot(connected)} />
        <span style={s.title}>SignalR Hub — /updates</span>
        <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: 'auto' }}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div style={s.log}>
        {logs.length === 0 && (
          <span style={{ color: '#4a5568' }}>No events yet. Connect to the hub.</span>
        )}
        {logs.map((l, i) => (
          <div key={i} style={s.logEntry(l.type)}>
            [{l.ts}] {l.msg}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      <div style={s.row}>
        {!connected ? (
          <button style={s.btn('#166534')} onClick={connect}>Connect</button>
        ) : (
          <button style={s.btn('#7f1d1d')} onClick={disconnect}>Disconnect</button>
        )}
        <input
          style={s.input}
          placeholder="Name for SayHello…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button style={s.btn()} onClick={sayHello} disabled={!connected}>
          SayHello
        </button>
      </div>
    </div>
  );
}
