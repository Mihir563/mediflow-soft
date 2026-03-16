'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { getDB } from '@/lib/db';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function FastBilling() {
  const [items, setItems] = useState<any[]>([]);
  const [cart, setCart] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [dbInfo, setDbInfo] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
    checkDB();
  }, []);

  const checkDB = async () => {
    try {
      const db = await getDB();
      const result = await db.select<any[]>('SELECT COUNT(*) as cnt FROM items');
      const cnt = result?.[0]?.cnt ?? 'N/A';
      setDbInfo(`DB: ${cnt} items`);
    } catch (e: any) {
      setDbInfo(`DB error: ${e.message}`);
    }
  };

  const searchItems = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 1) {
      setItems([]);
      setIsSearchOpen(false);
      return;
    }
    try {
      const db = await getDB();
      const result = await db.select(
        `SELECT * FROM items WHERE name LIKE $1 LIMIT 15`,
        [`%${q}%`]
      );
      setItems(result as any[]);
      setIsSearchOpen(true);
    } catch (e: any) {
      console.error('Search error:', e);
    }
  };

  const handleSelect = (item: any) => {
    const existing = cart.find(c => c.id === item.id);
    if (existing) {
      setCart(cart.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c));
    } else {
      setCart([...cart, { ...item, qty: 1 }]);
    }
    setIsSearchOpen(false);
    setSearchQuery('');
    // Keep focus on search input
    setTimeout(() => searchInputRef.current?.focus(), 10);
  };

  const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const total = cart.reduce((sum, item) => sum + (item.sale_price || 0) * item.qty, 0);

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-slate-950 p-4 gap-4">
      {/* Left side: Cart List */}
      <div className="flex-1 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Fast Billing POS</h1>
          <div className="flex items-center gap-2">
            {dbInfo && (
              <span className={`text-xs px-3 py-1 rounded-full font-mono font-bold ${
                dbInfo.includes('error') ? 'bg-red-100 text-red-700' : 
                dbInfo === 'DB: 0 items' ? 'bg-yellow-100 text-yellow-700' :
                'bg-green-100 text-green-700'
              }`}>{dbInfo}</span>
            )}
            <Button variant="outline" size="sm" onClick={checkDB} className="text-xs">🔍 Check DB</Button>
          </div>
        </div>
        <div className="flex gap-2 relative">
          <Popover open={isSearchOpen} onOpenChange={setIsSearchOpen}>
            {/* @ts-ignore */}
            <PopoverTrigger render={<div className="w-full relative" />} nativeButton={false}>
                <Input
                  ref={searchInputRef}
                  placeholder="Press F2 or start typing medicine name..."
                  value={searchQuery}
                  onChange={(e) => searchItems(e.target.value)}
                  className="w-full text-lg p-6 bg-white dark:bg-slate-900 shadow-sm border-2 focus-visible:ring-primary"
                />
            </PopoverTrigger>
            <PopoverContent className="w-[800px] p-0" align="start" sideOffset={8}>
              <Command>
                <CommandList>
                  {items.length === 0 ? (
                    <CommandEmpty>No results found.</CommandEmpty>
                  ) : (
                    <CommandGroup heading="Search Results (Use ↑/↓ and Enter)">
                      {items.map((item) => (
                        <CommandItem
                          key={item.id}
                          onSelect={() => handleSelect(item)}
                          className="flex justify-between items-center px-4 py-3 cursor-pointer text-base"
                        >
                          <div>
                            <p className="font-semibold">{item.name}</p>
                            <p className="text-xs text-muted-foreground mr-4">Stock: {item.current_stock}</p>
                          </div>
                          <div className="font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                            ₹{item.sale_price}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <Card className="flex-1 mt-4 overflow-hidden border-2 shadow-sm">
          <ScrollArea className="h-full">
            <Table>
              <TableHeader className="bg-slate-100 dark:bg-slate-900 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead className="w-[100px]">Stock</TableHead>
                  <TableHead className="w-[120px] text-right">Qty</TableHead>
                  <TableHead className="w-[120px] text-right">Price</TableHead>
                  <TableHead className="w-[120px] text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cart.map((item, index) => (
                  <TableRow key={item.id} className="text-base group">
                    <TableCell className="font-medium text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="font-semibold">{item.name}</TableCell>
                    <TableCell>
                      <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-sm">
                        {item.current_stock}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="1"
                        value={item.qty}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 1;
                          setCart(cart.map(c => c.id === item.id ? { ...c, qty: val } : c));
                        }}
                        className="w-20 text-right ml-auto bg-transparent border-slate-200 dark:border-slate-800 h-8"
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono">₹{item.sale_price}</TableCell>
                    <TableCell className="text-right font-bold font-mono">₹{(item.sale_price * item.qty).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {cart.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-64 text-center text-muted-foreground">
                      No items in cart. Start typing to add items.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </Card>
      </div>

      {/* Right side: Summary & Controls */}
      <Card className="w-80 flex flex-col bg-white dark:bg-slate-950 border-2 shadow-sm">
        <CardHeader className="bg-slate-50 dark:bg-slate-900">
          <CardTitle>Bill Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col pt-6">
          <div className="space-y-4 flex-1">
            <div className="flex justify-between text-lg text-muted-foreground">
              <span>Items Total ({cart.length})</span>
              <span>₹{total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg text-muted-foreground">
              <span>Discount</span>
              <span>₹0.00</span>
            </div>
            <div className="flex justify-between text-lg text-muted-foreground">
              <span>Tax</span>
              <span>₹0.00</span>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t font-bold text-3xl flex justify-between mb-8">
            <span>Payable</span>
            <span className="text-green-600 dark:text-green-400">₹{total.toFixed(2)}</span>
          </div>
          
          <div className="space-y-3 mt-auto">
            <Button className="w-full h-14 text-lg bg-green-600 hover:bg-green-700">
              Save & Print (F10)
            </Button>
            <Button variant="outline" className="w-full h-12 text-muted-foreground" onClick={() => setCart([])}>
              Clear (Alt+C)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
