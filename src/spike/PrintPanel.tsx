import { useState } from 'react';
import { printBrowserTest, printViaWebSerial, printViaWebUsb } from './print';

export function PrintPanel() {
  const [result, setResult] = useState('');
  const [baud, setBaud] = useState(9600);
  const run = (fn: () => Promise<string> | string | void) => async () => {
    try { setResult((await fn()) ?? 'done'); } catch (e) { setResult(`FAILED: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <section>
      <h3>Printing (tests 6 and 7)</h3>
      <button onClick={run(() => printBrowserTest())}>Browser print (for --kiosk-printing test)</button>{' '}
      <button onClick={run(() => printViaWebUsb(false))}>WebUSB print</button>{' '}
      <button onClick={run(() => printViaWebUsb(true))}>WebUSB print + kick drawer</button>{' '}
      <label>
        Serial baud{' '}
        <select value={baud} onChange={(e) => setBaud(Number(e.target.value))}>
          {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>{' '}
      <button onClick={run(() => printViaWebSerial(true, baud))}>Web Serial print + kick drawer</button>
      <pre>{result}</pre>
    </section>
  );
}
