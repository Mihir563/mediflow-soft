import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getDB } from '@/lib/db';
import { Bookmark, Search, Trash2, Package, Plus, CheckCircle2, History, Clock, Store, X, Send } from 'lucide-react';

interface OrderItem {
  id: number;
  item_id: number;
  item_name: string;
  quantity: number;
  status: 'pending' | 'ordered' | 'arrived';
  ordered_at: string | null;
  last_vendor_id: number | null;
  last_vendor_name: string | null;
  last_vendor_phone: string | null;
  last_purchase_price: number | null;
}

interface ItemOption {
  id: number;
  name: string;
}

export default function OrderBook() {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ItemOption[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [stagedItems, setStagedItems] = useState<{ id: number, name: string, quantity: number }[]>([]);
  
  // WhatsApp Flow States
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneVendorId, setPhoneVendorId] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(''); 
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const bookItems = await db.select<any[]>(
        `SELECT * FROM order_book ORDER BY id DESC`
      );

      const enrichedOrders: OrderItem[] = [];

      for (const item of bookItems) {
        const lastPurchaseQuery = `
          SELECT t.party_id, p.name as party_name, p.phone as party_phone, ti.price 
          FROM transaction_items ti
          JOIN transactions t ON t.id = ti.txn_id
          LEFT JOIN parties p ON p.id = t.party_id
          WHERE ti.item_id = $1 AND t.type = 'purchase'
          ORDER BY t.date DESC, t.id DESC
          LIMIT 1
        `;
        const lastPurchases = await db.select<{party_id: number, party_name: string, party_phone: string, price: number}[]>(lastPurchaseQuery, [item.item_id]);

        let vendorId = null;
        let vendorName = 'Unknown Vendor';
        let vendorPhone = null;
        let vendorPrice = null;

        if (lastPurchases.length > 0) {
          vendorId = lastPurchases[0].party_id;
          vendorName = lastPurchases[0].party_name || 'Cash Vendor';
          vendorPhone = lastPurchases[0].party_phone || null;
          vendorPrice = lastPurchases[0].price;
        }

        enrichedOrders.push({
          ...item,
          status: item.status || 'pending',
          last_vendor_id: vendorId,
          last_vendor_name: vendorName,
          last_vendor_phone: vendorPhone,
          last_purchase_price: vendorPrice
        });
      }

      setOrders(enrichedOrders);

      // Auto-select first pending vendor or fallback to history
      if (!activeTab && enrichedOrders.length > 0) {
         const uniqueVendors = Array.from(new Set(enrichedOrders.filter(o => o.status === 'pending').map(o => o.last_vendor_name || 'Unknown Vendor')));
         if (uniqueVendors.length > 0) setActiveTab(uniqueVendors[0]);
         else setActiveTab('history');
      }
    } catch (e) {
      console.error('Failed to load order book:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (q: string) => {
    setSearch(q);
    setSelectedIndex(0);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const db = await getDB();
      const res = await db.select<ItemOption[]>(
        `SELECT id, name FROM items WHERE name LIKE $1 LIMIT 10`, 
        [`%${q}%`]
      );
      setSearchResults(res);
    } catch {}
  };

  const handleStageItem = (item: ItemOption) => {
    setStagedItems(prev => {
      const exists = prev.find(p => p.id === item.id);
      if (exists) {
        return prev.map(p => p.id === item.id ? { ...p, quantity: p.quantity + 1 } : p);
      }
      return [{ id: item.id, name: item.name, quantity: 1 }, ...prev];
    });
    setSearch('');
    setSearchResults([]);
    
    // Keep focus on input for rapid sequential entry
    setTimeout(() => {
       if (searchInputRef.current) searchInputRef.current.focus();
    }, 10);
  };
  
  const updateStagedQuantity = (id: number, qty: number | '') => {
    setStagedItems(prev => prev.map(p => p.id === id ? { ...p, quantity: Number(qty) || 0 } : p));
  };
  
  const removeStagedItem = (id: number) => {
    setStagedItems(prev => prev.filter(p => p.id !== id));
  };

  const commitStagedItems = async () => {
    if (stagedItems.length === 0) return;
    try {
      const db = await getDB();
      for (const item of stagedItems) {
         if (item.quantity <= 0) continue;
         const existing = await db.select<{id: number}[]>(`SELECT id FROM order_book WHERE item_id = $1 AND status = 'pending' LIMIT 1`, [item.id]);
         if (existing.length > 0) {
           await db.execute(`UPDATE order_book SET quantity = quantity + $1 WHERE id = $2`, [item.quantity, existing[0].id]);
         } else {
           await db.execute(
             `INSERT INTO order_book (item_id, item_name, quantity, status) VALUES ($1, $2, $3, 'pending')`,
             [item.id, item.name, item.quantity]
           );
         }
      }
      setStagedItems([]);
      setShowAddModal(false);
      loadOrders();
    } catch (e) {
      console.error('Failed to commit staged items:', e);
    }
  };

  const updateQuantity = async (id: number, qty: number | '') => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, quantity: Number(qty) || 0 } : o));
    if (qty === '') return;
    try {
      const db = await getDB();
      await db.execute(`UPDATE order_book SET quantity = $1 WHERE id = $2`, [Number(qty), id]);
    } catch (e) {
      console.error('Failed to update qty:', e);
    }
  };

  const removeItem = async (id: number) => {
    try {
      const db = await getDB();
      await db.execute(`DELETE FROM order_book WHERE id = $1`, [id]);
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch (e) {
      console.error('Failed to remove item:', e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showAddModal) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchResults.length > 0 && selectedIndex >= 0 && selectedIndex < searchResults.length) {
        handleStageItem(searchResults[selectedIndex]);
      } else if (search.trim() === '' && searchResults.length === 0 && stagedItems.length > 0) {
        // Double enter to commit if search is empty
        commitStagedItems();
      }
    } else if (e.key === 'Escape') {
       setShowAddModal(false);
       setSearch('');
       setSearchResults([]);
       setStagedItems([]);
    }
  };

  // WhatsApp Workflow
  const openWhatsAppUrl = async (phone: string, vendorName: string, items: OrderItem[]) => {
    // Format the phone number (strip whitespace/dashes, ensure country code)
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone; // Fallback assume India

    let messageText = `Order List:\n\n`;
    items.forEach((item, index) => {
       messageText += `${index + 1}. ${item.item_name} - Qty: ${item.quantity}\n`;
    });
    messageText += `\nThank you!`;

    const encodedMessage = encodeURIComponent(messageText);
    const url = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } catch (e) {
      console.error('Failed to open Tauri shell, falling back to window.open', e);
      window.open(url, '_blank');
    }
  };

  const markVendorAsOrdered = async (vendorName: string) => {
    const itemsToUpdate = orders.filter(o => (o.last_vendor_name || 'Unknown Vendor') === vendorName && o.status === 'pending');
    if (itemsToUpdate.length === 0) return;

    try {
      const db = await getDB();
      const timestamp = new Date().toISOString();
      for (const item of itemsToUpdate) {
         await db.execute(`UPDATE order_book SET status='ordered', ordered_at=$1 WHERE id=$2`, [timestamp, item.id]);
      }
      loadOrders(); // Refresh table
    } catch (e) {
      console.error('Failed to mark as ordered:', e);
    }
  };

  const markAsArrived = async (item: OrderItem) => {
    try {
      const db = await getDB();
      // Update order_book status
      await db.execute(`UPDATE order_book SET status = 'arrived' WHERE id = $1`, [item.id]);
      // Update main items table stock safely!
      await db.execute(`UPDATE items SET current_stock = current_stock + $1 WHERE id = $2`, [item.quantity, item.item_id]);
      
      // Force local optimistic UI change
      setOrders(prev => prev.map(o => o.id === item.id ? { ...o, status: 'arrived' } : o));
    } catch (e) {
      console.error('Failed to mark as arrived:', e);
    }
  };

  const initiateWhatsAppOrder = async () => {
    const items = activeVendorPending;
    if (items.length === 0) return;

    const vendorPhone = items[0].last_vendor_phone;
    const vendorId = items[0].last_vendor_id;

    if (!vendorPhone || vendorPhone.trim() === '') {
       // Prompt for phone number
       setPhoneVendorId(vendorId);
       setPhoneInput('');
       setShowPhoneModal(true);
       return;
    }

    // Direct WhatsApp send
    await openWhatsAppUrl(vendorPhone, activeTab, items);
    markVendorAsOrdered(activeTab);
  };

  const handleSavePhoneAndOrder = async () => {
    if (!phoneInput.trim()) return;
    
    // Save to Database parties table
    if (phoneVendorId) {
       try {
         const db = await getDB();
         await db.execute(`UPDATE parties SET phone = $1 WHERE id = $2`, [phoneInput.trim(), phoneVendorId]);
       } catch (e) {
         console.error('Failed to update phone:', e);
       }
    }

    // Proceed to open WhatsApp & Mark Ordered
    await openWhatsAppUrl(phoneInput, activeTab, activeVendorPending);
    markVendorAsOrdered(activeTab);
    setShowPhoneModal(false);
  };


  // Derive active states
  const uniqueVendors = useMemo(() => {
    const list = Array.from(new Set(orders.map(o => o.last_vendor_name || 'Unknown Vendor')));
    return list.sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const activeVendorPending = useMemo(() => {
    return orders.filter(o => (o.last_vendor_name || 'Unknown Vendor') === activeTab && o.status === 'pending');
  }, [orders, activeTab]);

  // Global history grouped by Vendor
  const globalHistoryForTab = useMemo(() => {
    const hist = orders.filter(o => o.status === 'ordered' || o.status === 'arrived');
    hist.sort((a, b) => new Date(b.ordered_at || 0).getTime() - new Date(a.ordered_at || 0).getTime());
    
    // Group them by Vendor
    return hist.reduce((acc, order) => {
      const vendorName = order.last_vendor_name || 'Unknown Vendor';
      if (!acc[vendorName]) acc[vendorName] = [];
      acc[vendorName].push(order);
      return acc;
    }, {} as Record<string, OrderItem[]>);
  }, [orders]);

  const pendingCountByVendor = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => {
      if (o.status === 'pending') {
        const v = o.last_vendor_name || 'Unknown Vendor';
        counts[v] = (counts[v] || 0) + 1;
      }
    });
    return counts;
  }, [orders]);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="flex items-center justify-between p-4 bg-white border-b border-slate-200">
        <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
          <Bookmark className="text-brand" /> Order Book
        </h1>
        
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-brand hover:bg-brand-hover text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-all text-sm"
        >
          <Plus size={16} /> Add Order
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
         {/* Left Sidebar Pane */}
         <div className="w-64 bg-white border-r border-slate-200 flex flex-col z-10">
            <div className="p-3 border-b border-slate-100 bg-slate-50">
               <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vendors</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
               {uniqueVendors.length === 0 && !loading && (
                 <div className="text-center text-sm text-slate-400 mt-6 px-4 py-4 italic">
                   No vendors found. Try adding some items.
                 </div>
               )}
               {uniqueVendors.map(vendor => {
                  const pendingCount = pendingCountByVendor[vendor] || 0;
                  return (
                    <button
                        key={vendor}
                        onClick={() => setActiveTab(vendor)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === vendor ? 'bg-brand text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
                    >
                        <div className="flex items-center gap-2 truncate">
                          <Store size={16} className={activeTab === vendor ? 'text-white' : 'text-slate-400'} />
                          <span className="truncate">{vendor}</span>
                        </div>
                        {pendingCount > 0 && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${activeTab === vendor ? 'bg-white/20' : 'bg-slate-200 text-slate-500'}`}>
                            {pendingCount}
                          </span>
                        )}
                    </button>
                  );
               })}
               
               <div className="my-2 border-t border-slate-100"></div>

               <button
                  onClick={() => setActiveTab('history')}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'history' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
               >
                  <History size={16} className={activeTab === 'history' ? 'text-white' : 'text-slate-400'} />
                  Global History
               </button>

            </div>
         </div>

         {/* Right Detail Pane */}
         <div className="flex-1 bg-slate-50 overflow-y-auto p-6 scroll-smooth pb-20">
            {loading ? (
                <div className="flex justify-center items-center h-full text-slate-500">Loading Order Book...</div>
            ) : !activeTab ? (
               <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <Bookmark size={48} className="mb-4 opacity-20" />
                  <p className="text-lg font-medium text-slate-500">Order Book is empty</p>
                  <p className="text-sm">Add items above to start building a restock list.</p>
               </div>
            ) : activeTab === 'history' ? (
                // View Global History
                <div className="max-w-4xl mx-auto">
                   <div className="mb-6">
                      <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                         <History className="text-slate-400" /> Past Orders Log
                      </h2>
                      <p className="text-slate-500 text-sm">A timeline tracking of all fulfilled purchase orders.</p>
                   </div>
                   
                   {Object.keys(globalHistoryForTab).length === 0 ? (
                       <div className="flex flex-col items-center justify-center p-12 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">
                           <Clock size={48} className="mb-4 opacity-20" />
                           <p className="text-lg font-medium text-slate-500">No History Found</p>
                           <p className="text-sm">You haven't fulfilled any pending orders yet.</p>
                       </div>
                   ) : (
                       <div className="space-y-6 flex flex-col pb-8">
                          {Object.entries(globalHistoryForTab).map(([vendorName, items]) => (
                             <div key={vendorName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                   <h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
                                      {vendorName} 
                                      <span className="bg-slate-200 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-mono">
                                         {items.length} ITEMS
                                      </span>
                                   </h3>
                                </div>
                                <table className="w-full text-sm">
                                   <thead className="bg-white border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wider">
                                     <tr>
                                       <th className="px-5 py-3 text-left font-semibold w-2/5">Item Description</th>
                                       <th className="px-5 py-3 text-left font-semibold">Date Ordered</th>
                                       <th className="px-5 py-3 text-center font-semibold">Status</th>
                                       <th className="px-5 py-3 text-right font-semibold">Req Qty</th>
                                       <th className="px-5 py-3 w-28"></th>
                                     </tr>
                                   </thead>
                                   <tbody>
                                     {items.map((item, idx) => {
                                        const dateStr = item.ordered_at ? new Date(item.ordered_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
                                        return (
                                           <tr key={item.id} className={`${idx !== items.length - 1 ? 'border-b border-slate-50' : ''} bg-white opacity-80 cursor-default hover:opacity-100 transition-opacity`}>
                                             <td className="px-5 py-3 font-semibold text-slate-800 break-words">{item.item_name}</td>
                                             <td className="px-5 py-3 text-slate-500 font-medium">{dateStr}</td>
                                             <td className="px-5 py-3 text-center">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${item.status === 'ordered' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200 shadow-sm'}`}>
                                                  {item.status}
                                                </span>
                                             </td>
                                             <td className="px-5 py-3 text-right font-mono font-bold text-slate-700">{item.quantity}</td>
                                             <td className="px-5 py-2 text-right">
                                              <div className="flex items-center justify-end gap-1">
                                                {item.status === 'ordered' && (
                                                  <button
                                                      onClick={() => markAsArrived(item)}
                                                      className="h-8 px-2 rounded text-emerald-600 hover:bg-emerald-50 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center transition-colors border border-transparent hover:border-emerald-200"
                                                      title="Mark as Arrived (Instantly adds quantity to stock)"
                                                  >
                                                      ✓ Arrived
                                                  </button>
                                                )}
                                                <button
                                                    onClick={() => removeItem(item.id)}
                                                    className="w-8 h-8 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors shrink-0"
                                                    title="Delete record vertically from history"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                              </div>
                                            </td>
                                           </tr>
                                        );
                                     })}
                                   </tbody>
                                </table>
                             </div>
                          ))}
                       </div>
                   )}
                </div>
            ) : (
                // View Pending for Active Vendor Tab
                <div className="max-w-4xl mx-auto">
                    {/* Header and Pending Orders */}
                    <div className="mb-6 flex items-center justify-between">
                       <div>
                          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                             <Store className="text-brand" /> {activeTab}
                          </h2>
                          <p className="text-slate-500 mt-1">Send your pending restocks to the supplier directly via WhatsApp.</p>
                       </div>
                       
                       {activeVendorPending.length > 0 && (
                         <div className="flex flex-col gap-2">
                            <button
                               onClick={initiateWhatsAppOrder}
                               className="flex items-center justify-center gap-2 bg-[#128C7E] hover:bg-[#075E54] text-primary px-5 py-2.5 rounded-lg font-bold shadow-sm transition-all"
                            >
                               <Send size={16} /> Order via WhatsApp
                            </button>
                            <button
                                onClick={() => markVendorAsOrdered(activeTab)}
                                className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors mx-auto"
                            >
                               Mark Ordered manually
                            </button>
                         </div>
                       )}
                    </div>

                    {/* Pending Table */}
                    {activeVendorPending.length > 0 ? (
                      <div className="bg-white rounded-xl shadow-sm border border-brand/20 overflow-hidden mb-12 relative overflow-visible ring-4 ring-brand/5">
                          <div className="absolute -top-3 left-4 bg-brand text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm z-10 flex items-center gap-1.5">
                            PENDING RESTOCK LIST
                          </div>
                          <table className="w-full text-sm mt-2">
                            <thead className="bg-white border-b border-slate-100 text-slate-400 text-xs">
                                <tr>
                                <th className="px-5 py-4 text-left font-semibold w-2/3">Item Description</th>
                                <th className="px-5 py-4 text-right font-semibold">Last Rate</th>
                                <th className="px-5 py-4 text-right font-semibold w-32">Req. Qty</th>
                                <th className="px-5 py-4 w-16"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeVendorPending.map((item, idx) => (
                                <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${idx !== activeVendorPending.length - 1 ? 'border-b border-slate-50' : ''}`}>
                                    <td className="px-5 py-3">
                                    <span className="font-bold text-slate-700">{item.item_name}</span>
                                    </td>
                                    <td className="px-5 py-3 text-right font-mono text-slate-500">
                                    {item.last_purchase_price ? `₹${item.last_purchase_price.toFixed(2)}` : '--'}
                                    </td>
                                    <td className="px-5 py-2 text-right">
                                    <input
                                        type="text"
                                        value={item.quantity}
                                        onChange={(e) => updateQuantity(item.id, e.target.value === '' ? '' : Number(e.target.value))}
                                        className="w-20 h-9 border border-slate-200 rounded-md px-2 text-right font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand bg-white font-bold text-slate-800 shadow-sm"
                                    />
                                    </td>
                                    <td className="px-5 py-2 text-center">
                                    <button
                                        onClick={() => removeItem(item.id)}
                                        className="w-8 h-8 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                    </td>
                                </tr>
                                ))}
                            </tbody>
                          </table>
                      </div>
                    ) : (
                      <div className="bg-slate-100 border border-slate-200 border-dashed rounded-xl p-8 text-center mb-12">
                        <CheckCircle2 size={32} className="mx-auto text-brand opacity-50 mb-3" />
                        <h4 className="text-slate-600 font-bold">All caught up</h4>
                        <p className="text-slate-400 text-sm mt-1">There are no pending restocks needed for {activeTab}.</p>
                      </div>
                    )}
                </div>
            )}
         </div>
      </div>

      {/* Add Order Search Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/80">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                 <Package className="text-brand" size={18} /> Add to Order Book
              </h2>
              <button onClick={() => { setShowAddModal(false); setSearch(''); setSearchResults([]); setStagedItems([]); }} className="text-slate-400 hover:text-slate-600 bg-white hover:bg-slate-100 p-1.5 rounded-lg transition-colors border border-transparent hover:border-slate-200 outline-none focus:ring-2 focus:ring-brand">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 flex-1 overflow-hidden flex flex-col">
              <div className="relative mb-3 flex-shrink-0">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                <input
                  ref={searchInputRef}
                  autoFocus
                  type="text"
                  placeholder="Search Meds to request restock..."
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full h-12 pl-12 pr-4 border border-slate-200 rounded-xl text-base outline-none focus:ring-2 focus:ring-brand focus:border-brand transition-all shadow-sm bg-slate-50 focus:bg-white"
                />
              </div>
              
              <div className={`flex-1 overflow-y-auto border border-slate-100 rounded-xl bg-slate-50/50 relative ${stagedItems.length > 0 ? 'min-h-[140px] mb-4' : 'min-h-[220px]'}`}>
                {searchResults.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {searchResults.map((item, idx) => (
                      <button
                        key={item.id}
                        onClick={() => handleStageItem(item)}
                        className={`w-full text-left px-4 py-3.5 flex items-center gap-3 transition-colors text-sm group ${idx === selectedIndex ? 'bg-brand/10 shadow-[inset_2px_0_0_0_var(--brand)]' : 'hover:bg-brand/5'}`}
                      >
                        <Package size={16} className={idx === selectedIndex ? 'text-brand' : 'text-slate-400'} />
                        <span className={`font-semibold ${idx === selectedIndex ? 'text-brand' : 'text-slate-700'}`}>{item.name}</span>
                        <div className="ml-auto hidden group-hover:block md:block">
                           <kbd className="hidden lg:inline-block bg-white border border-slate-200 text-slate-400 text-[10px] px-1.5 rounded mr-2 font-mono shadow-sm">Enter</kbd>
                           <Plus size={16} className={idx === selectedIndex ? 'text-brand inline-block' : 'text-slate-300 inline-block'} />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : search.trim() ? (
                   <div className="h-full flex flex-col items-center justify-center text-sm text-slate-400 p-8 text-center italic space-y-2">
                     <Package size={32} className="opacity-20" />
                     <span>No medicines found matching "{search}"</span>
                   </div>
                ) : (
                   <div className="h-full flex flex-col items-center justify-center text-sm text-slate-400 p-8 text-center">
                     <Search size={32} className="opacity-20 mb-3" />
                     Type a medicine name above to add it to your pending orders
                     <div className="mt-4 flex gap-2">
                        <kbd className="bg-white border border-slate-200 text-slate-400 text-xs px-2 py-0.5 rounded shadow-sm">↑ ↓</kbd>
                        <kbd className="bg-white border border-slate-200 text-slate-400 text-xs px-2 py-0.5 rounded shadow-sm">↵ Enter</kbd>
                     </div>
                   </div>
                )}
              </div>

              {stagedItems.length > 0 && (
                <div className="flex-shrink-0 border-t border-slate-100 pt-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <h3 className="font-bold text-slate-700 text-xs uppercase tracking-wider mb-2 flex items-center justify-between">
                     Staged Items
                     <span className="bg-slate-200 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-mono">{stagedItems.length}</span>
                  </h3>
                   <div className="max-h-48 overflow-y-auto space-y-1.5 bg-slate-50 border border-slate-200/60 rounded-xl p-2">
                       {stagedItems.map(item => (
                          <div key={item.id} className="flex justify-between items-center bg-white p-2 pl-3 rounded-lg shadow-sm border border-slate-100">
                              <span className="font-bold text-slate-800 text-sm truncate pr-2">{item.name}</span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Qty:</label>
                                <input 
                                  type="text" 
                                  value={item.quantity} 
                                  onChange={(e) => updateStagedQuantity(item.id, e.target.value === '' ? '' : Number(e.target.value))} 
                                  className="w-12 h-8 border border-slate-200 bg-slate-50 rounded text-center text-sm font-bold text-slate-700 focus:border-brand focus:ring-1 focus:ring-brand outline-none" 
                                />
                                <button onClick={() => removeStagedItem(item.id)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors ml-1">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                          </div>
                       ))}
                   </div>
                   <div className="mt-4">
                     <button onClick={commitStagedItems} className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-hover text-white py-3 rounded-xl font-bold transition-all shadow-sm">
                        <CheckCircle2 size={18} /> Confirm & Add {stagedItems.length} {stagedItems.length === 1 ? 'item' : 'items'} to Order Book
                     </button>
                   </div>
                </div>
             )}
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Missing Phone Modal */}
      {showPhoneModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
           <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 p-6">
              <div className="flex items-center gap-3 mb-2">
                 <div className="w-10 h-10 rounded-full bg-[#128C7E]/10 flex items-center justify-center">
                    <Send className="text-[#128C7E]" size={20} />
                 </div>
                 <h2 className="font-bold text-slate-800 text-lg">Enter Phone Number</h2>
              </div>
              <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                 There is no phone number registered for <strong className="text-slate-700">{activeTab}</strong>. Enter it below to save it and open WhatsApp.
              </p>
              
              <div className="mb-6">
                 <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">WhatsApp Number</label>
                 <input
                    autoFocus
                    type="text"
                    placeholder="e.g. 9876543210"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className="w-full h-12 px-4 border border-slate-200 rounded-lg text-lg font-mono focus:ring-2 focus:ring-[#128C7E]/20 focus:border-[#128C7E] transition-all bg-slate-50 focus:bg-white"
                 />
              </div>

              <div className="flex items-center justify-end gap-3 mt-auto">
                 <button
                    onClick={() => setShowPhoneModal(false)}
                    className="px-4 py-2 rounded-lg font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                 >
                    Cancel
                 </button>
                 <button
                    onClick={handleSavePhoneAndOrder}
                    disabled={phoneInput.trim().length < 10}
                    className="bg-[#128C7E] hover:bg-[#075E54] text-white px-5 py-2 rounded-lg font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                 >
                    Save & Send <Send size={14} />
                 </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}
