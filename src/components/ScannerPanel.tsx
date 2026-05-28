import { useEffect, useState, useRef } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { X, Loader2, Copy, Check, Wand2, RotateCw, Sparkles, Upload, Camera, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import ScannerQR from './ScannerQR';
import { recognizeText, initOCR } from '@/lib/ocr';
import { getDB } from '@/lib/db';

interface ScannerPanelProps {
  onClose: () => void;
  onAutoFill?: (items: any[]) => void;
  onGeminiData?: (data: GeminiBillData) => void; // full structured bill data
}

export interface GeminiBillData {
  vendor?: string;
  bill_no?: string;
  bill_date?: string;
  items: {
    name: string;
    qty: number;
    price: number;
    mrp?: number;
    batch?: string;
    expiry?: string;
    disc?: number;
    gst?: number | string;
    free?: number | string;
    scheme?: number | string;
  }[];
}

type ScanMode = 'gemini' | 'offline';

const GEMINI_PROMPT = `You are an expert at reading pharmaceutical purchase bills/invoices.

Analyze this bill image and extract ALL items. Return ONLY a valid JSON object (no markdown, no explanation) in this exact format:

{
  "vendor": "supplier/vendor company name or empty string",
  "bill_no": "invoice or bill number or empty string",
  "bill_date": "date in DD/MM/YYYY format or empty string",
  "items": [
    {
      "name": "exact medicine/product name in UPPERCASE",
      "qty": 10,
      "price": 105.50,
      "mrp": 120.00,
      "batch": "batch number or empty string",
      "expiry": "MM/YY or MM/YYYY format or empty string",
      "disc": 0,
      "gst": "2.5+2.5",
      "free": 0,
      "scheme": 0
    }
  ]
}

Rules:
- Extract every single line item you see
- qty must be a number (integer)
- price is the purchase rate/cost price per unit (number). Look for columns named "S.Rate", "Sale Rate", "Trade Rate", "Net Rate", "Net Price", "Rate", "Price", or "Price Amount". This is the base cost/purchase rate per unit before tax is applied. If both "S.Rate" and "Net Rate" are present, prefer using "S.Rate" as the base price (since our system applies row discounts separately), otherwise extract whichever represents the unit cost price. 
- mrp is the maximum retail price per unit (number, 0 if not visible)
- disc is discount percentage (number, 0 if not shown)
- gst is GST/tax percentage. It can be a number (like 5, 12, 18) or a string representing the CGST+SGST split from the bill (like "2.5+2.5", "6+6", "9+9", "9.0 + 9.0"). Extract it exactly as visible, and our system will automatically parse and sum it. Default to 0 if not shown.
- free is the free quantity of items received (number, 0 if not shown)
- scheme is the flat scheme amount discount for this item row (number, 0 if not shown)
- If any field is not clearly visible, use sensible defaults (0 for numbers, "" for strings)
- Do NOT wrap in markdown code blocks. Return raw JSON only.`;

export default function ScannerPanel({ onClose, onAutoFill, onGeminiData }: ScannerPanelProps) {
  const [image, setImage] = useState<string | null>(null);
  const [text, setText] = useState<string>('');
  const [status, setStatus] = useState<'waiting' | 'scanning' | 'done'>('waiting');
  const [copied, setCopied] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('gemini');
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiResult, setGeminiResult] = useState<GeminiBillData | null>(null);
  const [geminiError, setGeminiError] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [showRawJson, setShowRawJson] = useState(false);
  const [inputMethod, setInputMethod] = useState<'file' | 'mobile'>('mobile');
  const [dragActive, setDragActive] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep refs to prevent stale closure timing in Tauri event listeners
  const scanModeRef = useRef<ScanMode>('gemini');
  const geminiApiKeyRef = useRef<string>('');

  useEffect(() => {
    scanModeRef.current = scanMode;
  }, [scanMode]);

  useEffect(() => {
    geminiApiKeyRef.current = geminiApiKey;
  }, [geminiApiKey]);

  // Load Gemini API key from DB and init OCR
  useEffect(() => {
    initOCR().catch(console.error);
    const loadKey = async () => {
      try {
        const db = await getDB();
        const res = await db.select<{ value: string }[]>(
          `SELECT value FROM app_settings WHERE key = 'gemini_api_key'`
        );
        if (res.length > 0 && res[0].value) {
          setGeminiApiKey(res[0].value);
          geminiApiKeyRef.current = res[0].value;
        }
      } catch (e) { console.error('Failed to load Gemini key:', e); }
    };
    loadKey();

    // Listen for QR-scanned images from mobile
    let unlisten: UnlistenFn | null = null;
    listen<string>('scanned-image', async (event) => {
      setImage(event.payload);
      setStatus('waiting'); // Waiting for manual scan button click
      setGeminiResult(null);
      setGeminiError('');
    }).then(fn => { unlisten = fn; });

    return () => { if (unlisten) unlisten(); };
  }, []);

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result as string;
        setImage(src);
        setStatus('waiting'); // Waiting for manual scan button click
        setGeminiResult(null);
        setGeminiError('');
      };
      reader.readAsDataURL(file);
    }
  };

  // ── Image helpers ──────────────────────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      setImage(src);
      setStatus('waiting'); // Waiting for manual scan button click
      setGeminiResult(null);
      setGeminiError('');
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const handleRotate = () => {
    if (!image) return;
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
        setGeminiResult(null);
        setGeminiError('');
        setText('');
      }
    };
    img.src = image;
  };

  const resetScan = () => {
    setStatus('waiting');
    setImage(null);
    setText('');
    setGeminiResult(null);
    setGeminiError('');
  };

  // ── Offline Tesseract OCR ─────────────────────────────────────
  const runOfflineOCR = async (src: string) => {
    try {
      const { recognizeText } = await import('@/lib/ocr');
      const extracted = await recognizeText(src);
      setText(extracted);
      setStatus('done');
    } catch (err) {
      console.error(err);
      setText('Error extracting text. Ensure the image is clear.');
      setStatus('done');
    }
  };

  // ── Gemini AI OCR ─────────────────────────────────────────────
  const parseRobustNumber = (val: any): number => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') {
      return isNaN(val) ? 0 : val;
    }
    const str = String(val).trim();
    if (str.includes('+')) {
      const parts = str.split('+').map(p => Number(p.replace(/[^0-9.]/g, '').trim()));
      const sum = parts.reduce((acc, curr) => acc + (isNaN(curr) ? 0 : curr), 0);
      return sum;
    }
    const cleanStr = str.replace(/[^0-9.]/g, '').trim();
    const num = Number(cleanStr);
    return isNaN(num) ? 0 : num;
  };

  const runGeminiOCR = async (customImage?: any) => {
    const imageToUse = (customImage && typeof customImage === 'string') ? customImage : image;
    if (!imageToUse) return;
    
    // Use latest key from ref if state is empty in this cycle
    const activeKey = geminiApiKey || geminiApiKeyRef.current;
    if (!activeKey) {
      setGeminiError('No Gemini API key found. Go to Settings → General → Gemini AI to add your key.');
      return;
    }

    const keys = activeKey.split(',').map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) {
      setGeminiError('No Gemini API key found. Go to Settings → General → Gemini AI to add your key.');
      return;
    }

    setGeminiLoading(true);
    setGeminiError('');
    setGeminiResult(null);

    // Strip the data:image/...;base64, prefix
    const base64Data = imageToUse.includes(',') ? imageToUse.split(',')[1] : imageToUse;
    const mimeType = imageToUse.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';

    const payload = {
      contents: [{
        parts: [
          { text: GEMINI_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 1,
        maxOutputTokens: 4096,
      }
    };

    let lastError = '';
    const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];

    for (let i = 0; i < keys.length; i++) {
      const currentKey = keys[i];
      for (let j = 0; j < models.length; j++) {
        const currentModel = models[j];
        try {
          const keyLabel = keys.length > 1 ? `Key ${i + 1} of ${keys.length}` : 'Key';
          setGeminiError(`Scanning with ${currentModel} using ${keyLabel}...`);

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${currentKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }
          );

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Gemini API error ${res.status}: ${errBody.slice(0, 200)}`);
          }

          const json = await res.json();
          const rawText: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

          // Strip markdown code fences if present
          const cleaned = rawText
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();

          const parsed: GeminiBillData = JSON.parse(cleaned);
          setGeminiResult(parsed);
          setText(cleaned); // also show in textarea for manual edits
          setGeminiError(''); // Clear status/errors on success!
          
          // Auto-apply and auto-close the modal!
          await applyGeminiFill(parsed);
          onClose();
          
          // Return early on success, bypassing other models and keys!
          setGeminiLoading(false);
          return;

        } catch (e: any) {
          console.warn(`Model ${currentModel} with key index ${i} failed:`, e);
          lastError = e.message ?? 'Unknown error calling Gemini API';
          
          if (j < models.length - 1) {
            setGeminiError(`Model ${currentModel} failed. Trying alternative model ${models[j + 1]}...`);
            await new Promise(r => setTimeout(r, 800));
          } else if (i < keys.length - 1) {
            setGeminiError(`API Key ${i + 1} failed all models. Falling back to Key ${i + 2}...`);
            await new Promise(r => setTimeout(r, 800));
          }
        }
      }
    }

    // All keys & models failed
    setGeminiError(`All Gemini API keys & models failed. Last error: ${lastError}`);
    setGeminiLoading(false);
  };

  // ── Auto-fill from Gemini result ──────────────────────────────
  const applyGeminiFill = async (customResult?: any) => {
    const resultToUse = ((customResult && typeof customResult === 'object' && 'items' in customResult) ? customResult : geminiResult) as GeminiBillData | null;
    if (!resultToUse || !onAutoFill) return;
    setIsAutoFilling(true);
    try {
      const db = await getDB();
      const dbItems = await db.select<any[]>('SELECT * FROM items ORDER BY name');

      const matchName = (query: string) => {
        const q = query.toLowerCase();
        // exact match first
        let found = dbItems.find(it => it.name?.toLowerCase() === q);
        if (!found) found = dbItems.find(it => it.name && q.includes(it.name.toLowerCase()) && it.name.length > 3);
        if (!found) found = dbItems.find(it => it.name && it.name.toLowerCase().includes(q.split(' ')[0]));
        return found || null;
      };

      const filled = [];
      for (const item of resultToUse.items) {
        const cleanGst = (item.gst !== undefined && item.gst !== null) ? parseRobustNumber(item.gst) : undefined;
        const cleanPrice = parseRobustNumber(item.price);
        const cleanMrp = parseRobustNumber(item.mrp);
        const cleanQty = parseRobustNumber(item.qty);
        const cleanDisc = parseRobustNumber(item.disc);
        const cleanFree = parseRobustNumber(item.free);
        const cleanScheme = parseRobustNumber(item.scheme);

        let dbItem = matchName(item.name);
        if (!dbItem && item.name.trim()) {
          const uppercaseName = item.name.toUpperCase().trim();
          const sale_price = cleanMrp || cleanPrice || 0;
          const purchase_price = cleanPrice || 0;
          const tax_rate = cleanGst !== undefined ? cleanGst : 0;
          const unit = 'TAB';
          const tabs_per_strip = 10;
          const strips_per_box = 10;

          try {
            const res: any = await db.execute(
              `INSERT INTO items (name, hsn, unit, sale_price, purchase_price, opening_stock, current_stock, min_stock, category, tax_rate, discount, inclusive_tax, tabs_per_strip, strips_per_box)
               VALUES ($1, '', $2, $3, $4, 0, 0, 0, 'Medicines', $5, 0, 0, $6, $7)`,
              [uppercaseName, unit, sale_price, purchase_price, tax_rate, tabs_per_strip, strips_per_box]
            );
            
            dbItem = {
              id: res.lastInsertId,
              name: uppercaseName,
              sale_price,
              purchase_price,
              current_stock: 0,
              unit,
              tabs_per_strip,
              strips_per_box,
              tax_rate,
            };
            dbItems.push(dbItem); // Add so subsequent rows of the same item in the same invoice match the newly created record
          } catch (insertErr) {
            console.error('Failed to auto-insert missing item:', insertErr);
          }
        }

        filled.push({
          id: dbItem?.id ?? null,
          name: item.name || (dbItem?.name ?? ''),
          sale_price: dbItem?.sale_price ?? cleanMrp ?? 0,
          purchase_price: dbItem?.purchase_price ?? cleanPrice ?? 0,
          current_stock: dbItem?.current_stock ?? 0,
          unit: dbItem?.unit ?? 'TAB',
          tabs_per_strip: dbItem?.tabs_per_strip ?? 10,
          strips_per_box: dbItem?.strips_per_box ?? 10,
          tax_rate: cleanGst ?? dbItem?.tax_rate ?? 0,
          qty_extracted: cleanQty ?? 1,
          mrp_extracted: cleanMrp ?? 0,
          rate_extracted: cleanPrice ?? 0,
          disc_extracted: cleanDisc ?? 0,
          gst_extracted: cleanGst ?? 0,
          free_extracted: cleanFree ?? 0,
          scheme_extracted: cleanScheme ?? 0,
          exp_extracted: item.expiry ?? '',
          batch_extracted: item.batch ?? '',
        });
      }

      onAutoFill(filled);
      if (onGeminiData) onGeminiData(resultToUse);
    } catch (e) {
      console.error(e);
    }
    setIsAutoFilling(false);
  };

  // ── Offline auto-fill (existing logic) ────────────────────────
  const handleOfflineAutoFill = async () => {
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
          let exp = '', qty = 1, mrp = 0, rate = 0, disc = 0, gst = 0;
          const afterItem = line.substring(lower.indexOf(bestItem.name.toLowerCase()) + bestItem.name.length);
          const dateMatch = afterItem.match(/\b(\d{1,2}[\/\-]\d{2,4})\b/);
          if (dateMatch) {
            exp = dateMatch[1];
            const numTokens = afterItem.substring(dateMatch.index! + dateMatch[0].length).trim()
              .split(/\s+/).filter(t => /^[\d\.]+$/.test(t)).map(Number);
            if (numTokens.length >= 4) { mrp = numTokens[0]; qty = numTokens[1]; rate = numTokens[2]; disc = numTokens[3]; }
            if (numTokens.length >= 6) gst = numTokens[4] + numTokens[5];
          } else {
            const qtyMatch = line.match(/\b([1-9][0-9]*)\b/);
            if (qtyMatch) qty = parseInt(qtyMatch[1]);
          }
          matched.push({ ...bestItem, qty_extracted: qty, mrp_extracted: mrp, rate_extracted: rate, disc_extracted: disc, gst_extracted: gst, exp_extracted: exp });
        }
      }
      if (matched.length > 0) onAutoFill(matched);
      else alert('Could not recognize any items. Try Gemini AI mode or edit the text manually.');
    } catch (e) { console.error(e); }
    setIsAutoFilling(false);
  };

  const hasImage = image !== null;

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        transition: 'all 0.3s ease'
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <style>{`
        .scanner-results::-webkit-scrollbar {
          width: 6px;
        }
        .scanner-results::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.01);
          border-radius: 4px;
        }
        .scanner-results::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.3);
          border-radius: 4px;
        }
        .scanner-results::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.5);
        }
        
        .scanner-body {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }
        @media (min-width: 768px) {
          .scanner-body {
            flex-direction: row;
            overflow: hidden;
          }
        }
        .scanner-left {
          width: 100%;
          background: #f8fafc;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 340px;
          box-sizing: border-box;
        }
        @media (min-width: 768px) {
          .scanner-left {
            width: 50%;
            border-right: 1px solid #e2e8f0;
            min-height: 0;
            height: 100%;
          }
        }
        .scanner-right {
          width: 100%;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          box-sizing: border-box;
        }
        @media (min-width: 768px) {
          .scanner-right {
            width: 50%;
            height: 100%;
          }
        }
        .scanner-img-frame {
          flex: 1;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0.75rem;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 16px;
          overflow: hidden;
          min-height: 260px;
          box-sizing: border-box;
        }
        @media (min-width: 768px) {
          .scanner-img-frame {
            min-height: 0;
            height: 100%;
          }
        }
        .scanner-preview-img {
          max-width: 100%;
          max-height: 260px;
          object-fit: contain;
          border-radius: 8px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        @media (min-width: 768px) {
          .scanner-preview-img {
            max-height: calc(85vh - 12rem);
          }
        }
      `}</style>
      
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          width: '100%',
          maxWidth: '896px',
          maxHeight: '85vh',
          height: '100%',
          overflow: 'hidden',
          animation: 'fade-in 0.2s ease-out'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────── */}
        <div className="px-6 py-4 bg-white border-b border-slate-100 flex justify-between items-center flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Sparkles size={16} className="text-purple-600 animate-pulse" />
              Bill Scanner
            </h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-0.5">
              {geminiApiKey ? '✨ Gemini AI + Offline OCR' : 'Offline OCR Mode'}
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-xl transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Responsive Two-Column Body ──────────────── */}
        <div className="scanner-body">
          
          {/* ── LEFT PANEL: Image / Sync ─────────────── */}
          <div className="scanner-left">
            {!hasImage ? (
              <div className="w-full h-full flex flex-col justify-center">
                {/* Tabs Header */}
                <div className="flex bg-slate-200/60 p-1 rounded-xl mb-4 border border-slate-200/30">
                  <button
                    onClick={() => setInputMethod('file')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                      inputMethod === 'file' ? 'bg-white text-purple-700 shadow-sm border border-slate-200/30' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Upload File
                  </button>
                  <button
                    onClick={() => setInputMethod('mobile')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                      inputMethod === 'mobile' ? 'bg-white text-purple-700 shadow-sm border border-slate-200/30' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Mobile Scanner
                  </button>
                </div>

                {/* Tab content */}
                {inputMethod === 'file' ? (
                  <div
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{ minHeight: '200px' }}
                    className="flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-all duration-300 border-slate-300 hover:border-purple-400 bg-white hover:bg-slate-50/50 shadow-inner"
                  >
                    <div className="p-4 bg-purple-50 rounded-full text-purple-600 mb-3">
                      <Upload size={24} />
                    </div>
                    <p className="text-sm font-bold text-slate-700">Drag & drop your bill here</p>
                    <p className="text-xs text-slate-400 mt-1 font-semibold">or click to browse files</p>
                    <span className="text-[10px] text-slate-400 mt-4 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 font-bold font-mono">
                      PNG, JPG, JPEG
                    </span>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-200 p-4 shadow-sm relative" style={{ minHeight: '200px' }}>
                    <div className="scale-[0.85] origin-center -my-2"><ScannerQR /></div>
                    <p className="text-xs text-slate-500 text-center font-bold px-4 max-w-[280px] mt-2">
                      Scan the QR code with your phone's camera to link & sync files
                    </p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
              </div>
            ) : (
              <div className="scanner-img-frame">
                <div className="flex-1 w-full flex items-center justify-center overflow-hidden rounded-xl">
                  <img
                    ref={imgRef}
                    src={image}
                    className="scanner-preview-img"
                    alt="Bill preview"
                  />
                </div>
                
                {/* Floating pill toolbar underneath image preview */}
                <div 
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    gap: '0.5rem',
                    marginTop: '1rem',
                    padding: '0.5rem 0.875rem',
                    borderRadius: '1rem',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    flexShrink: 0,
                    zIndex: 10,
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  <button 
                    onClick={handleRotate} 
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      fontSize: '0.75rem',
                      padding: '0.375rem 0.875rem',
                      borderRadius: '0.75rem',
                      fontWeight: 'bold',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <RotateCw size={12} /> Rotate
                  </button>
                  <button 
                    onClick={() => fileInputRef.current?.click()} 
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      fontSize: '0.75rem',
                      padding: '0.375rem 0.875rem',
                      borderRadius: '0.75rem',
                      fontWeight: 'bold',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <Upload size={12} /> Change
                  </button>
                  <button 
                    onClick={resetScan} 
                    style={{
                      backgroundColor: '#ef4444',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      fontSize: '0.75rem',
                      padding: '0.375rem 0.875rem',
                      borderRadius: '0.75rem',
                      fontWeight: 'bold',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    Clear
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
              </div>
            )}
          </div>

          {/* ── RIGHT PANEL: Scan actions & Results ────── */}
          <div className="scanner-right scanner-results">
            {/* Mode selection tabs */}
            <div className="bg-slate-100 p-1 rounded-xl flex gap-1 mb-5 flex-shrink-0">
              <button
                onClick={() => setScanMode('gemini')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${scanMode === 'gemini' ? 'bg-white text-purple-700 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Sparkles size={13} className="text-purple-500" />
                Gemini AI {geminiApiKey ? '✓' : ''}
              </button>
              <button
                onClick={() => setScanMode('offline')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${scanMode === 'offline' ? 'bg-white text-blue-700 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Offline OCR
              </button>
            </div>

            {/* Inactive Gemini Warning */}
            {scanMode === 'gemini' && !geminiApiKey && (
              <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200/60 rounded-2xl flex gap-2.5 items-start">
                <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-amber-800">No Gemini API Key Available</h4>
                  <p className="text-[10px] text-amber-700 leading-normal mt-0.5">Please add your developer key in **Settings → General → Gemini AI** to enable advanced scanning features.</p>
                </div>
              </div>
            )}

            {/* Scan execute button */}
            {hasImage && (
              <div className="mb-5 flex-shrink-0">
                {scanMode === 'gemini' ? (
                  <button
                    onClick={() => runGeminiOCR()}
                    disabled={geminiLoading || !geminiApiKey}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.625rem',
                      height: '2.75rem',
                      background: 'linear-gradient(to right, #9333ea, #4f46e5, #2563eb)',
                      color: '#ffffff',
                      borderRadius: '1rem',
                      fontWeight: 'bold',
                      fontSize: '0.875rem',
                      border: 'none',
                      cursor: geminiLoading || !geminiApiKey ? 'not-allowed' : 'pointer',
                      opacity: geminiLoading || !geminiApiKey ? 0.5 : 1,
                      transition: 'all 0.2s',
                      boxShadow: '0 4px 6px -1px rgba(147, 51, 234, 0.2)'
                    }}
                  >
                    {geminiLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin text-white" />
                        Analyzing Invoice with AI...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        Scan with AI
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => { if (imgRef.current) runOfflineOCR(imgRef.current.src); }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.625rem',
                      height: '2.75rem',
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      borderRadius: '1rem',
                      fontWeight: 'bold',
                      fontSize: '0.875rem',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
                    }}
                  >
                    <Camera size={16} />
                    Run Offline OCR
                  </button>
                )}
              </div>
            )}

            {/* Gemini errors / Rotate state warnings */}
            {geminiError && (
              <div className="p-3.5 bg-red-50/80 border border-red-200/60 rounded-2xl flex gap-2.5 items-start mb-4">
                <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 leading-normal">{geminiError}</p>
              </div>
            )}

            {/* ── Gemini Scan Results ──────────────────── */}
            {geminiResult && scanMode === 'gemini' && (
              <div className="space-y-4">
                {/* Invoice Metadata Box */}
                {(geminiResult.vendor || geminiResult.bill_no || geminiResult.bill_date) && (
                  <div className="bg-purple-50/50 border border-purple-100 rounded-2xl p-4 space-y-1.5 shadow-sm font-sans">
                    <p className="text-[9px] text-purple-500 uppercase tracking-widest font-bold">Detected Vendor</p>
                    {geminiResult.vendor && <p className="text-sm font-bold text-purple-900 leading-tight">{geminiResult.vendor}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-purple-700/80 pt-1 border-t border-purple-100/50">
                      {geminiResult.bill_no && <span>Invoice #: <strong className="text-purple-900 font-mono">{geminiResult.bill_no}</strong></span>}
                      {geminiResult.bill_date && <span>Date: <strong className="text-purple-900 font-mono">{geminiResult.bill_date}</strong></span>}
                    </div>
                  </div>
                )}

                {/* Items List */}
                <div className="border border-slate-100 rounded-2xl overflow-hidden bg-white shadow-sm font-sans">
                  <div className="bg-slate-50/70 border-b border-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 flex justify-between items-center">
                    <span className="font-bold">{geminiResult.items.length} Medicine{geminiResult.items.length !== 1 ? 's' : ''} detected</span>
                    <span className="text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md flex items-center gap-1 font-bold text-[10px] uppercase tracking-wider"><Sparkles size={10} /> Gemini</span>
                  </div>
                  
                  <div className="divide-y divide-slate-100/70 max-h-[220px] overflow-y-auto">
                    {geminiResult.items.map((item, i) => (
                      <div key={i} className="px-4 py-3.5 hover:bg-slate-50/30 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs font-bold text-slate-800 leading-snug">{item.name}</p>
                          <div className="flex gap-1.5 flex-shrink-0 items-center">
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg font-mono font-bold">×{item.qty}</span>
                            <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg font-mono font-bold">₹{item.price}</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {item.batch && <span className="text-[9px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md font-semibold">B: {item.batch}</span>}
                          {item.expiry && <span className="text-[9px] font-mono bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md font-semibold">Exp: {item.expiry}</span>}
                          {(item.disc ?? 0) > 0 && <span className="text-[9px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-md font-bold">-{item.disc}%</span>}
                          {parseRobustNumber(item.gst) > 0 && <span className="text-[9px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded-md font-bold">GST {item.gst}%</span>}
                          {item.mrp && item.mrp > 0 && <span className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded-md font-medium">MRP ₹{item.mrp}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Raw JSON toggle */}
                <div className="pt-1">
                  <button
                    onClick={() => setShowRawJson(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors font-bold"
                  >
                    {showRawJson ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {showRawJson ? 'Hide' : 'Show'} raw API response
                  </button>
                  {showRawJson && (
                    <pre className="text-[10px] font-mono bg-slate-900 text-emerald-400 rounded-2xl p-4 overflow-x-auto whitespace-pre-wrap mt-2 max-h-[160px] shadow-inner">{text}</pre>
                  )}
                </div>

                {/* Apply Gemini result CTA button */}
                {onAutoFill && (
                  <button
                    onClick={() => applyGeminiFill()}
                    disabled={isAutoFilling}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      height: '2.75rem',
                      background: 'linear-gradient(to right, #059669, #0d9488)',
                      color: '#ffffff',
                      borderRadius: '1rem',
                      fontWeight: 'bold',
                      fontSize: '0.875rem',
                      border: 'none',
                      cursor: isAutoFilling ? 'not-allowed' : 'pointer',
                      opacity: isAutoFilling ? 0.5 : 1,
                      transition: 'all 0.2s',
                      boxShadow: '0 4px 6px -1px rgba(5, 150, 105, 0.2)',
                      marginTop: '0.5rem',
                      flexShrink: 0
                    }}
                  >
                    {isAutoFilling ? (
                      <>
                        <Loader2 size={16} className="animate-spin text-white" />
                        Importing and creating items...
                      </>
                    ) : (
                      <>
                        <Wand2 size={16} />
                        Fill {geminiResult.items.length} Items into Bill
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* ── Offline OCR Text Area ────────────────── */}
            {scanMode === 'offline' && (
              <div className="flex-1 flex flex-col gap-4 min-h-[220px]">
                <div className="flex justify-between items-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Extracted Text</span>
                  <div className="flex gap-2">
                    {text && onAutoFill && (
                      <button
                        onClick={handleOfflineAutoFill}
                        disabled={isAutoFilling}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          fontWeight: 'bold',
                          color: '#ffffff',
                          backgroundColor: '#2563eb',
                          padding: '0.375rem 0.875rem',
                          borderRadius: '0.75rem',
                          border: 'none',
                          cursor: isAutoFilling ? 'not-allowed' : 'pointer',
                          opacity: isAutoFilling ? 0.5 : 1,
                          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                          transition: 'background-color 0.2s'
                        }}
                      >
                        {isAutoFilling ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Wand2 size={12} className="mr-1.5" />}
                        Auto-Fill
                      </button>
                    )}
                    {text && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          fontWeight: 'bold',
                          color: '#64748b',
                          backgroundColor: '#ffffff',
                          border: '1px solid #e2e8f0',
                          padding: '0.375rem 0.75rem',
                          borderRadius: '0.75rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        {copied ? <Check size={12} className="mr-1.5 text-emerald-500" /> : <Copy size={12} className="mr-1.5" />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                </div>
                
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={hasImage ? 'Click "Run Offline OCR" to extract text...' : 'Upload or scan a bill to extract text...'}
                  className="flex-1 w-full p-4 rounded-2xl border border-slate-200 bg-white text-xs font-mono text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-inner resize-none min-h-[220px]"
                />
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
