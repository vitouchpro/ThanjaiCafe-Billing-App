import { useEffect, useRef, useState } from 'react';
import { PowerSyncContext, useQuery } from '@powersync/react';
import type { SyncStatus } from '@powersync/web';
import { connector, db } from './powersync/db';
import { createBill } from './createBill';
import { deviceClaims, type DeviceClaims } from './jwt';
import { PerfPanel } from './PerfPanel';
import { PrintPanel } from './PrintPanel';

function StoragePanel() {
  const [info, setInfo] = useState('');
  async function check() {
    const persisted = await navigator.storage.persisted();
    const granted = persisted ? true : await navigator.storage.persist();
    const est = await navigator.storage.estimate();
    setInfo(`persisted=${persisted} persistAfterRequest=${granted} usage=${est.usage} quota=${est.quota}`);
  }
  return (
    <section>
      <h3>Storage (test 2)</h3>
      <button onClick={() => void check()}>Check / request persistent storage</button>
      <pre>{info}</pre>
      <pre>{navigator.userAgent}</pre>
    </section>
  );
}

function Panel() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [claims, setClaims] = useState<DeviceClaims | null>(null);
  const [status, setStatus] = useState<SyncStatus>(db.currentStatus);
  const [queue, setQueue] = useState<{ count: number; size: number | null }>({ count: 0, size: null });
  const [message, setMessage] = useState('');
  const [syncMs, setSyncMs] = useState<number | null>(null);
  const [uploadInfo, setUploadInfo] = useState({
    discarded: connector.discardedTransactions,
    lastError: connector.lastUploadError,
    lastOkAt: connector.lastUploadOkAt,
  });
  const connectedAt = useRef<number | null>(null);

  const bills = useQuery<{ id: string; invoice_no: string; total_paise: number; created_at: string }>(
    'SELECT id, invoice_no, total_paise, created_at FROM bills ORDER BY created_at DESC LIMIT 20',
  );
  const counts = useQuery<{ shops: number; devices: number; bills: number; lines: number; products: number }>(
    'SELECT (SELECT COUNT(*) FROM shops) AS shops, (SELECT COUNT(*) FROM devices) AS devices, (SELECT COUNT(*) FROM bills) AS bills, (SELECT COUNT(*) FROM bill_lines) AS lines, (SELECT COUNT(*) FROM products) AS products',
  );
  const codeRow = useQuery<{ code: string }>('SELECT code FROM devices WHERE id = ?', [claims?.deviceId ?? '']);

  useEffect(() => {
    const dispose = db.registerListener({
      statusChanged: (s) => {
        setStatus(s);
        if (s.hasSynced && connectedAt.current !== null) {
          setSyncMs(Math.round(performance.now() - connectedAt.current));
          connectedAt.current = null;
        }
      },
    });
    const timer = setInterval(() => {
      void db.getUploadQueueStats().then(setQueue);
      setUploadInfo({
        discarded: connector.discardedTransactions,
        lastError: connector.lastUploadError,
        lastOkAt: connector.lastUploadOkAt,
      });
    }, 1000);
    return () => { dispose(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    void (async () => {
      const { data } = await connector.client.auth.getSession();
      if (data.session) {
        setClaims(deviceClaims(data.session.access_token));
        connectedAt.current = performance.now();
        await db.connect(connector);
      }
    })().catch((e) => setMessage(String(e)));
  }, []);

  async function signIn() {
    try {
      await connector.login(email, password);
      const { data } = await connector.client.auth.getSession();
      setClaims(deviceClaims(data.session!.access_token));
      connectedAt.current = performance.now();
      await db.connect(connector);
      setMessage('Connected');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function signOut() {
    const stats = await db.getUploadQueueStats();
    if (stats.count > 0) {
      setMessage(`Refusing to wipe local data: ${stats.count} upload(s) not yet on the server. Wait for the upload queue to reach 0.`);
      return;
    }
    await db.disconnectAndClear();
    setSyncMs(null);
    connectedAt.current = null;
    await connector.logout();
    setClaims(null);
    setMessage('Signed out; local data wiped');
  }

  async function addBills(n: number) {
    const code = codeRow.data[0]?.code;
    if (!claims || !code) { setMessage('Device code not synced yet'); return; }
    try {
      for (let i = 0; i < n; i++) {
        await createBill(db, { shopId: claims.shopId, deviceId: claims.deviceId, deviceCode: code });
      }
      setMessage(`Created ${n} bill(s)`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui', maxWidth: 720 }}>
      <h2>PowerSync spike</h2>
      <section>
        <h3>Device login</h3>
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />{' '}
        <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />{' '}
        <button onClick={() => void signIn()}>Sign in and connect</button>{' '}
        <button onClick={() => void signOut()}>Sign out and wipe local data</button>
        <pre>{claims ? JSON.stringify({ ...claims, code: codeRow.data[0]?.code }) : 'not signed in'}</pre>
      </section>
      <section>
        <h3>Sync</h3>
        <pre>
          connected={String(status.connected)} hasSynced={String(status.hasSynced)}{'\n'}
          uploading={String(status.dataFlowStatus?.uploading)} downloading={String(status.dataFlowStatus?.downloading)}{'\n'}
          upload queue={queue.count} first sync took={syncMs === null ? 'n/a' : `${syncMs} ms`}{'\n'}
          local rows={JSON.stringify(counts.data[0] ?? {})}{'\n'}
          {uploadInfo.discarded > 0 ? '!!! ' : ''}discarded uploads={uploadInfo.discarded}{'\n'}
          {uploadInfo.lastError ? '!!! ' : ''}last upload error={uploadInfo.lastError
            ? `${uploadInfo.lastError.table} ${uploadInfo.lastError.op} ${uploadInfo.lastError.code} ${uploadInfo.lastError.message} discarded=${uploadInfo.lastError.discarded} at ${uploadInfo.lastError.at}`
            : 'none'}{'\n'}
          last upload ok={uploadInfo.lastOkAt ?? 'never'}
        </pre>
        <p>{message}</p>
      </section>
      <section>
        <h3>Bills</h3>
        <button onClick={() => void addBills(1)}>New bill</button>{' '}
        <button onClick={() => void addBills(5)}>New 5 bills</button>{' '}
        <button onClick={() => void addBills(2000)}>Create 2000 real bills</button>
        <ul>{bills.data.map((b) => <li key={b.id}>{b.invoice_no} - {b.total_paise / 100} - {b.created_at}</li>)}</ul>
      </section>
      <PerfPanel ctx={claims && codeRow.data[0]?.code ? { shopId: claims.shopId, deviceId: claims.deviceId, deviceCode: codeRow.data[0].code } : null} />
      <PrintPanel />
      <StoragePanel />
    </div>
  );
}

export function SpikePage() {
  return (
    <PowerSyncContext.Provider value={db}>
      <Panel />
    </PowerSyncContext.Provider>
  );
}
