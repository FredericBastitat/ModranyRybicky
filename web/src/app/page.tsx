'use client';

import { useState, useEffect } from 'react';
import { VideoStream } from '@/components/VideoStream';
import { MotorControls } from '@/components/MotorControls';

/**
 * Main application page for the ESP32-CAM Control Panel.
 * Features a minimalist, premium dark design with a glassmorphism feel.
 */
export default function Home() {
  const [status, setStatus] = useState<{
    online: boolean;
    esp32Connected?: boolean;
    viewers?: number;
    fps?: number;
  }>({ online: false, esp32Connected: false });

  const [loading, setLoading] = useState(true);

  // Poll for status every 5 seconds
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        setStatus({ online: false, esp32Connected: false });
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const isActuallyOnline = status.online && status.esp32Connected;

  return (
    <main className="min-h-screen bg-slate-950 font-sans text-slate-100">
      {/* Header section with branding */}
      <header className="fixed top-0 z-10 w-full border-b border-slate-800/50 bg-slate-900/60 p-4 backdrop-blur-xl md:p-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-600/30">
              <span className="text-xl font-black">📷</span>
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-white md:text-2xl">
                ESP32-CAM <span className="text-indigo-500">RELAY</span>
              </h1>
              <p className="hidden text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 md:block">
                Remote Video Control Panel
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`hidden h-3 w-3 rounded-full shadow-md sm:block ${isActuallyOnline ? 'bg-green-500 shadow-green-500/50 animate-pulse' : 'bg-red-500 shadow-red-500/50'}`}></div>
            <span className={`hidden text-[10px] font-black uppercase tracking-[0.2em] sm:block ${isActuallyOnline ? 'text-slate-400' : 'text-red-400'}`}>
              {isActuallyOnline ? 'Connection Online' : 'System Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Main content grid */}
      <section className="mx-auto flex max-w-7xl flex-col gap-12 px-4 pb-20 pt-32 lg:flex-row lg:items-start lg:px-8">

        {/* VIDEO STREAM CONTAINER (LEFT) */}
        <div className="flex flex-1 flex-col gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-2xl">
            <VideoStream />
          </div>

          <div className="hidden grid-cols-3 gap-4 lg:grid">
            <div className="flex flex-col gap-1 rounded-xl bg-slate-900/50 p-4 text-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">FPS</span>
              <span className="text-xl font-bold text-slate-200">{status.fps || 0}</span>
            </div>
            <div className="flex flex-col gap-1 rounded-xl bg-slate-900/50 p-4 text-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Viewers</span>
              <span className="text-xl font-bold text-slate-200">{status.viewers || 0}</span>
            </div>
            <div className="flex flex-col gap-1 rounded-xl bg-slate-900/50 p-4 text-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</span>
              <span className={`text-xl font-bold capitalize ${isActuallyOnline ? 'text-green-400' : 'text-red-400'}`}>
                {status.online ? (status.esp32Connected ? 'Ready' : 'Waiting CAM') : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* MOTOR CONTROLS CONTAINER (RIGHT) */}
        <aside className="w-full shrink-0 lg:w-[400px]">
          <div className="flex flex-col gap-8">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-black uppercase tracking-tighter text-slate-500">Overland Controls</h2>
              <div className="h-px flex-1 bg-slate-800"></div>
            </div>

            <MotorControls />

            <div className="mt-8 rounded-2xl bg-gradient-to-br from-indigo-900/20 to-slate-900 p-6 text-sm text-slate-400 ring-1 ring-slate-800/50">
              <h3 className="mb-2 font-bold text-slate-200">💡 Instrukce:</h3>
              <p>Používejte šipky k ovládání pohybu kamery / motoru. Červený čtverec uprostřed okamžitě zastaví veškerý pohyb (Emergency Stop).</p>
            </div>
          </div>
        </aside>

      </section>

      {/* Background decoration elements */}
      <div className="pointer-events-none fixed -left-[10%] -top-[10%] h-[40%] w-[40%] rounded-full bg-indigo-600/10 blur-[120px]"></div>
      <div className="pointer-events-none fixed -bottom-[10%] -right-[10%] h-[40%] w-[40%] rounded-full bg-indigo-900/10 blur-[120px]"></div>
    </main>
  );
}
