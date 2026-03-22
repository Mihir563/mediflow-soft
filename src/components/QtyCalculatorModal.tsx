import { useState, useEffect, useRef } from 'react';
import { Calculator } from 'lucide-react';

interface QtyCalculatorRowProps {
  item: any;
  colSpan?: number; // Kept for interface compatibility but unused
  onClose: () => void;
  onConfirm: (totalQty: number, breakdownStr: string) => void;
}

export default function QtyCalculatorModal({ item, onClose, onConfirm }: QtyCalculatorRowProps) {
  const [boxes, setBoxes] = useState<number | ''>('');
  const [stripsPerBox, setStripsPerBox] = useState<number | ''>('');
  const [strips, setStrips] = useState<number | ''>('');
  const [tabsPerStrip, setTabsPerStrip] = useState<number | ''>(10);
  const [tablets, setTablets] = useState<number | ''>('');
  const [directQty, setDirectQty] = useState<number | ''>('');

  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto focus the direct quantity input for fast typers
    if (firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, []);

  const totalInTablets = 
    ((Number(boxes) || 0) * (Number(stripsPerBox) || 1) * (Number(tabsPerStrip) || 1)) +
    ((Number(strips) || 0) * (Number(tabsPerStrip) || 1)) +
    (Number(tablets) || 0);

  const finalQty = directQty !== '' ? Number(directQty) : (totalInTablets > 0 ? totalInTablets : 1);

  const handleConfirm = () => {
    let desc = [];
    if (directQty !== '') {
      onConfirm(Number(directQty), '');
      return;
    }
    if (boxes) desc.push(`${boxes} Box`);
    if (strips) desc.push(`${strips} Strip`);
    if (tablets) desc.push(`${tablets} Tab`);
    
    onConfirm(finalQty, desc.join(' + '));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  };

  return (
    <div 
      className="absolute right-0 top-[calc(100%+6px)] z-50 w-[300px] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-100 origin-top-right text-left" 
      onKeyDown={handleKeyDown}
    >
      <div className="bg-slate-50 border-b border-slate-100 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-brand">
          <Calculator size={14} />
          <span className="text-[10px] font-bold uppercase tracking-wider">{item.name}</span>
        </div>
        <div className="text-[9px] font-bold text-slate-400">ENTER TO SAVE</div>
      </div>

      <div className="p-3 space-y-3">
        {/* Bypass */}
        <div className="flex bg-blue-50/50 p-2 rounded border border-blue-100 items-center justify-between">
          <span className="text-[10px] font-bold text-blue-800 uppercase">Input Exact Qty</span>
          <input
            ref={firstInputRef}
            type="number"
            min="1"
            placeholder="Qty"
            value={directQty}
            onChange={e => {
              setDirectQty(e.target.value === '' ? '' : Number(e.target.value));
              if (e.target.value !== '') { setBoxes(''); setStrips(''); setTablets(''); }
            }}
            className="w-20 h-7 border border-blue-200 rounded px-2 text-right text-xs font-bold text-slate-800 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>

        <div className="relative flex justify-center py-1">
          <div className="absolute inset-0 flex items-center" aria-hidden="true"><div className="w-full border-t border-slate-100"></div></div>
          <span className="relative bg-white px-2 text-[9px] font-bold tracking-widest text-slate-400 uppercase">Or Multipack Calculator</span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <div>
            <label className="text-[9px] font-bold text-slate-500 uppercase block mb-0.5">Boxes</label>
            <input type="number" min="0" value={boxes} onChange={e => { setBoxes(e.target.value === '' ? '' : Number(e.target.value)); setDirectQty(''); }} className="w-full h-7 border border-slate-200 rounded px-2 text-right text-xs focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
          </div>
          <span className="text-slate-300 font-mono text-xs pt-3">×</span>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Strips/Box</label>
            <input type="number" min="1" placeholder="10" value={stripsPerBox} onChange={e => setStripsPerBox(e.target.value === '' ? '' : Number(e.target.value))} className="w-full h-7 border border-slate-200 rounded px-2 text-right text-xs bg-slate-50 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
          </div>

          <div>
            <label className="text-[9px] font-bold text-slate-500 uppercase block mb-0.5">Strips</label>
            <input type="number" min="0" value={strips} onChange={e => { setStrips(e.target.value === '' ? '' : Number(e.target.value)); setDirectQty(''); }} className="w-full h-7 border border-slate-200 rounded px-2 text-right text-xs focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
          </div>
          <span className="text-slate-300 font-mono text-xs pt-3">×</span>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Tabs/Strip</label>
            <input type="number" min="1" placeholder="10" value={tabsPerStrip} onChange={e => setTabsPerStrip(e.target.value === '' ? '' : Number(e.target.value))} className="w-full h-7 border border-slate-200 rounded px-2 text-right text-xs bg-slate-50 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
          </div>
        </div>

        <div>
          <label className="text-[9px] font-bold text-slate-500 uppercase block mb-0.5">Loose Tablets</label>
          <input type="number" min="0" value={tablets} onChange={e => { setTablets(e.target.value === '' ? '' : Number(e.target.value)); setDirectQty(''); }} className="w-full h-7 border border-slate-200 rounded px-2 text-right text-xs focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
        </div>
      </div>

      <div className="bg-green-50/50 border-t border-slate-100 flex items-center justify-between p-3 rounded-b-xl">
        <span className="text-[10px] font-bold text-green-800 uppercase tracking-widest leading-none">Total<br/>Units</span>
        <div className="flex items-center gap-3">
          <span className="text-xl font-black text-green-600 font-mono">{finalQty}</span>
          <button onClick={handleConfirm} className="bg-brand text-white px-3 h-8 rounded text-xs font-bold hover:bg-brand-hover shadow-sm transition-colors">Confirm</button>
        </div>
      </div>
    </div>
  );
}
