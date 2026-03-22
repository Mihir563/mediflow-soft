import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { invoke } from '@tauri-apps/api/core';

export default function ScannerQR() {
  const [ipUrl, setIpUrl] = useState('');

  useEffect(() => {
    invoke<string>('get_local_ip')
      .then(ip => setIpUrl(`http://${ip}:3030`))
      .catch(err => {
        console.error('Failed to get IP:', err);
        setIpUrl('http://192.168.x.x:3030');
      });
  }, []);

  if (!ipUrl) {
    return <div className="animate-pulse bg-slate-100 h-[220px] w-full max-w-[200px] rounded-xl"></div>;
  }

  return (
    <div className="flex flex-col items-center justify-center p-5 bg-white rounded-xl border-2 border-slate-200 border-dashed hover:border-brand/40 transition-colors">
      <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-100 mb-3">
        <QRCodeSVG value={ipUrl} size={130} level="M" />
      </div>
      <p className="text-sm font-bold text-slate-700 text-center leading-tight mb-1">
        Mobile Scanner
      </p>
      <p className="text-[11px] font-medium text-slate-500 text-center leading-tight">
        Scan with your phone's<br/>camera to snap a bill.
      </p>
      <code className="mt-3 text-[10px] text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded">{ipUrl}</code>
    </div>
  );
}
