'use client';

import { useState } from 'react';

/**
 * Component for controlling the ESP32-CAM motors.
 * Sends POST requests to the Vercel API which proxies them to the Fly.io relay server.
 */
export function MotorControls() {
    const [activeDir, setActiveDir] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Send motor command to the local API route.
     */
    const sendCommand = async (dir: string) => {
        try {
            setLoading(true);
            const res = await fetch('/api/motor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dir }),
            });

            if (!res.ok) {
                throw new Error('Nepodařilo se odeslat příkaz');
            }

            setActiveDir(dir);
            // Optional: automatically stop after some time if it's a "pulse" motor command
            // However, usually we want it to keep moving until 'stop' is pressed.

        } catch (err: any) {
            setError(err.message);
            setTimeout(() => setError(null), 3000);
        } finally {
            setLoading(false);
        }
    };

    const buttonClasses = (dir: string) => `
    flex h-20 w-20 items-center justify-center rounded-2xl p-4 text-2xl font-bold shadow-lg transition duration-200 active:scale-95
    ${activeDir === dir ? 'bg-indigo-600 text-white ring-4 ring-indigo-300' : 'bg-slate-700 text-slate-300 hover:bg-slate-600 active:bg-indigo-600'}
  `;

    return (
        <div className="flex flex-col items-center gap-10">
            {/* Directional Pad */}
            <div className="grid grid-cols-3 gap-6 rounded-3xl bg-slate-800 p-8 shadow-inner shadow-black/20">
                <div></div>
                <button
                    onClick={() => sendCommand('forward')}
                    className={buttonClasses('forward')}
                    aria-label="Forward"
                >
                    ▲
                </button>
                <div></div>

                <button
                    onClick={() => sendCommand('left')}
                    className={buttonClasses('left')}
                    aria-label="Left"
                >
                    ◀
                </button>
                <button
                    onClick={() => sendCommand('stop')}
                    className="flex h-20 w-20 items-center justify-center rounded-2xl bg-red-600 p-4 text-white shadow-lg shadow-red-500/30 transition hover:bg-red-500 active:scale-90"
                    aria-label="Stop"
                >
                    ■
                </button>
                <button
                    onClick={() => sendCommand('right')}
                    className={buttonClasses('right')}
                    aria-label="Right"
                >
                    ▶
                </button>

                <div></div>
                <button
                    onClick={() => sendCommand('backward')}
                    className={buttonClasses('backward')}
                    aria-label="Backward"
                >
                    ▼
                </button>
                <div></div>
            </div>

            {/* Connection Indicator */}
            <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 px-6 py-2 rounded-full bg-slate-800 text-xs font-medium tracking-widest uppercase text-slate-400">
                    {loading ? (
                        <span className="flex items-center gap-2">
                            <span className="h-2 w-2 animate-ping rounded-full bg-indigo-500"></span>
                            Sending Command...
                        </span>
                    ) : error ? (
                        <span className="text-red-400">{error}</span>
                    ) : activeDir ? (
                        <span className="text-indigo-400">AKTIVNÍ: {activeDir}</span>
                    ) : (
                        'MOTOR STOPPED'
                    )}
                </div>
            </div>
        </div>
    );
}
