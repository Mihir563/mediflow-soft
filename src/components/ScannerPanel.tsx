import { useEffect, useState, useRef } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { X, Loader2, Copy, Check, Wand2, RotateCw } from 'lucide-react';
import ScannerQR from './ScannerQR';
import { recognizeText, initOCR } from '@/lib/ocr';
import { getDB } from '@/lib/db';
import { convertFileSrc } from '@tauri-apps/api/core';

interface ScannerPanelProps {
  onClose: () => void;
  onAutoFill?: (items: any[]) => void;
}

export default function ScannerPanel({ onClose, onAutoFill }: ScannerPanelProps) {
  const [image, setImage] = useState<string | null>(null);
  const [text, setText] = useState<string>('');
  const [status, setStatus] = useState<'waiting' | 'scanning' | 'done'>('waiting');
  const [copied, setCopied] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // Eagerly init OCR in background
    initOCR().catch(console.error);

    let unlisten: UnlistenFn | null = null;
    listen<string>('scanned-image', async (event) => {
      setStatus('scanning');
      setImage(event.payload);
    }).then(fn => { unlisten = fn; });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (status === 'scanning' && image && imgRef.current) {
        const img = imgRef.current;
        if (img.complete) {
            runOCR(img.src);
        } else {
            img.onload = () => runOCR(img.src);
        }
    }
  }, [status, image]);

  const handleRotate = () => {
    if (!image) return;
    setStatus('scanning');
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(90 * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        setImage(canvas.toDataURL('image/jpeg', 0.9));
      }
    };
    img.src = image;
  };

  const runOCR = async (src: string) => {
      try {
        const extracted = await recognizeText(src);
        setText(extracted);
        setStatus('done');
      } catch (err) {
        console.error(err);
        setText('Error extracting text. Make sure the image is clear and you are using the correct network.');
        setStatus('done');
      }
  };

  const handleAutoFill = async () => {
    if (!text || !onAutoFill) return;
    setIsAutoFilling(true);
    try {
      const db = await getDB();
      const dbItems = await db.select<any[]>('SELECT * FROM items');
      const lines = text.split('\n');
      const matched = [];
      
      for (const line of lines) {
        const lower = line.toLowerCase();
        let bestItem = null;
        for (const it of dbItems) {
            if (it.name && lower.includes(it.name.toLowerCase()) && it.name.length > 3) {
                if (!bestItem || it.name.length > bestItem.name.length) bestItem = it;
            }
        }
        if (bestItem) {
          let exp = '';
          let qty = 1, mrp = 0, rate = 0, disc = 0, gst = 0;
          
          let afterItem = line.substring(lower.indexOf(bestItem.name.toLowerCase()) + bestItem.name.length);
          const dateMatch = afterItem.match(/\b(\d{1,2}[\/\-]\d{2,4})\b/);
          if (dateMatch) {
              exp = dateMatch[1];
              const afterDate = afterItem.substring(dateMatch.index! + dateMatch[0].length).trim();
              const numTokens = afterDate.split(/\s+/).filter(t => /^[\d\.]+$/.test(t)).map(Number);
              if (numTokens.length >= 4) {
                  mrp = numTokens[0];
                  qty = numTokens[1];
                  rate = numTokens[2];
                  disc = numTokens[3];
                  if (numTokens.length >= 6) {
                      gst = numTokens[4] + numTokens[5];
                  }
              }
          } else {
              const qtyMatch = line.match(/\b([1-9][0-9]*)\b/);
              if (qtyMatch) qty = parseInt(qtyMatch[1]);
          }
          
          matched.push({ 
            ...bestItem, 
            qty_extracted: qty, 
            mrp_extracted: mrp, 
            rate_extracted: rate, 
            disc_extracted: disc, 
            gst_extracted: gst, 
            exp_extracted: exp 
          });
        }
      }
      
      if (matched.length > 0) {
        onAutoFill(matched);
      } else {
        alert("Could not cleanly recognize any items from the text. Manually refine the text or try scanning again.");
      }
    } catch(e) { console.error(e); }
    setIsAutoFilling(false);
  };

  return (
    <div 
      className="fixed right-6 top-20 bottom-6 z-50 bg-slate-50 rounded-2xl shadow-2xl flex flex-col border border-slate-200 overflow-hidden ring-1 ring-black/5"
      style={{ width: 450, maxWidth: 'calc(100vw - 3rem)' }}
    >
      <div className="px-5 py-3 bg-white border-b border-slate-200 flex justify-between items-center shrink-0">
        <div>
          <h3 className="text-base font-bold text-slate-800">Mobile Invoice Scanner</h3>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Offline AI Extraction</p>
        </div>
        <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors">
          <X size={18} />
        </button>
      </div>
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top: QR or Web Image Preview */}
        <div 
          className="flex-none bg-white border-b border-slate-200 flex flex-col items-center justify-center p-4 relative shrink-0"
          style={{ height: 260, maxHeight: '40vh' }}
        >
          {status === 'waiting' && <ScannerQR />}
          {status !== 'waiting' && image && (
            <div className="w-full h-full relative flex items-center justify-center group">
              <img ref={imgRef} src={image} className="w-full h-full object-contain rounded-lg" />
              {status === 'scanning' && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
                  <div className="flex flex-col items-center text-brand font-bold">
                    <Loader2 size={24} className="animate-spin mb-2" />
                    <span className="text-sm">Running AI Offline...</span>
                  </div>
                </div>
              )}
              {status === 'done' && (
                <div className="absolute bottom-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={handleRotate}
                    className="bg-slate-800/80 hover:bg-slate-800 backdrop-blur text-white flex items-center gap-1 text-[10px] px-3 py-1.5 rounded-full font-semibold"
                  >
                    <RotateCw size={12} /> Rotate
                  </button>
                  <button 
                    onClick={() => { setStatus('waiting'); setImage(null); setText(''); }}
                    className="bg-slate-800/80 hover:bg-slate-800 backdrop-blur text-white text-[10px] px-3 py-1.5 rounded-full font-semibold"
                  >
                    Scan Another
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Bottom: Extracted Text Scratchpad */}
        <div className="flex-1 flex flex-col bg-slate-50 p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Extracted Text</span>
            <div className="flex gap-2">
              {text && onAutoFill && (
                <button
                  onClick={handleAutoFill}
                  disabled={isAutoFilling}
                  className="flex items-center text-[10px] uppercase tracking-wider font-bold text-white hover:bg-brand-hover transition-colors bg-brand px-3 py-1 rounded shadow-sm disabled:opacity-50"
                >
                  {isAutoFilling ? <Loader2 size={12} className="animate-spin mr-1" /> : <Wand2 size={12} className="mr-1" />}
                  Auto-Fill Items
                </button>
              )}
              {text && (
                <button
                  onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="flex items-center text-[10px] uppercase tracking-wider font-bold text-slate-600 hover:text-brand transition-colors bg-white border border-slate-200 px-2 py-1 rounded"
                >
                  {copied ? <Check size={12} className="mr-1 text-green-500" /> : <Copy size={12} className="mr-1" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Waiting for phone camera scan..."
            className="flex-1 w-full p-4 rounded-xl border border-slate-200 bg-white text-xs font-mono text-slate-700 focus:border-brand focus:ring-1 focus:ring-brand outline-none shadow-sm resize-none"
          />
        </div>
      </div>
    </div>
  );
}
