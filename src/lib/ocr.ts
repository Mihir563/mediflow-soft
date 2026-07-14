import { createWorker, Worker } from 'tesseract.js';

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;

export async function initOCR() {
  if (worker) return;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const w = await createWorker('eng');
        worker = w;
        console.log('[OCR] Tesseract Worker ready.');
      } catch (err) {
        console.error('[OCR] Failed to init worker:', err);
        throw err;
      }
    })();
  }
  return initPromise;
}

export async function recognizeText(imageSrc: string): Promise<string> {
  if (!worker) await initOCR();
  if (!worker) throw new Error("OCR Worker failed to initialize.");
  
  const { data: { text } } = await worker.recognize(imageSrc);
  return text;
}

export async function terminateOCR() {
  if (worker) {
    await worker.terminate();
    worker = null;
    initPromise = null;
  }
}
