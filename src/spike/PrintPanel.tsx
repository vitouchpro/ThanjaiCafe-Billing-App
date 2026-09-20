import { useState } from 'react';
import { printBrowserTest, printViaWebSerial, printViaWebUsb } from './print';

export function PrintPanel() {
  const [result, setResult] = useState('');
  const run = (fn: () => Promise<string> | string | void) => async () => {
    try { setResult((await fn()) ?? 'done'); } catch (e) { setResult(`FAILED: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <section>
      <h3>Printing (tests 6 and 7)</h3>
      <button onClick={run(() => printBrowserTest())}>Browser print (for --kiosk-printing test)</button>{' '}
      <button onClick={run(() => printViaWebUsb(false))}>WebUSB print</button>{' '}
      <button onClick={run(() => printViaWebUsb(true))}>WebUSB print + kick drawer</button>{' '}
      <button onClick={run(() => printViaWebSerial(true))}>Web Serial print + kick drawer</button>
      <pre>{result}</pre>
    </section>
  );
}
