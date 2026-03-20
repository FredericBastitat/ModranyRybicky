'use client';

import { useState, useEffect } from 'react';

/**
 * Component to display the MJPEG stream from the Fly.io relay server.
 * Includes status monitoring to show connectivity of both the relay and ESP32.
 */
export function VideoStream() {
    const [error, setError] = useState<string | null>(null);
    const [relayStatus, setRelayStatus] = useState<{
        esp32Connected: boolean;
        framesReceived: number;
        mjpegViewers: number;
    } | null>(null);

    const baseStreamUrl = process.env.NEXT_PUBLIC_STREAM_URL || 'https://rybicky-cloud.fly.dev/stream';
    const streamToken = process.env.NEXT_PUBLIC_STREAM_TOKEN || 'zmen-me-prosim';

    // Status URL is based on the relay host. 
    // We use a separate env var if available to avoid string manipulation issues.
    const relayBaseUrl = process.env.NEXT_PUBLIC_RELAY_URL || baseStreamUrl.replace('/stream', '');
    const statusUrl = `${relayBaseUrl}/status`;

    // Debug log to help identify why env vars are missing
    useEffect(() => {
        console.log('VideoStream Config:', { baseStreamUrl, statusUrl, hasToken: !!streamToken });
    }, [baseStreamUrl, statusUrl, streamToken]);

    // Add token if exists and not already in URL
    const streamUrl = streamToken && !baseStreamUrl.includes('token=')
        ? `${baseStreamUrl}${baseStreamUrl.includes('?') ? '&' : '?'}token=${streamToken}`
        : baseStreamUrl;

    // Poll status from the relay server
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch(statusUrl);
                if (res.ok) {
                    const data = await res.json();
                    setRelayStatus(data);
                    if (data.esp32Connected) setError(null);
                }
            } catch (err) {
                console.error('Failed to fetch relay status:', err);
            }
        };

        const interval = setInterval(fetchStatus, 3000);
        fetchStatus();
        return () => clearInterval(interval);
    }, [statusUrl]);

    return (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 shadow-2xl transition-all duration-300 hover:shadow-indigo-500/10 border border-slate-800">
            {/* MJPEG Stream directly from the relay */}
            <img
                src={streamUrl}
                alt="ESP32-CAM Video Stream"
                className={`h-full w-full object-contain transition-opacity duration-700 ${(!relayStatus?.esp32Connected || error) ? 'opacity-20 grayscale' : 'opacity-100'}`}
                onError={() => setError('Nepodařilo se připojit k Fly.io serveru.')}
                onLoad={() => setError(null)}
            />

            {/* Loading / Status Overlay */}
            {(!relayStatus?.esp32Connected && !error) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white bg-slate-950/40 backdrop-blur-sm">
                    <div className="mb-4 animate-pulse text-4xl">🐠</div>
                    <h3 className="text-xl font-medium text-slate-200">Čekám na signál z rybiček</h3>
                    <p className="max-w-md mt-2 text-slate-400 text-sm">
                        Relay server běží, ale ESP32-CAM v akváriu není připojena.
                    </p>
                </div>
            )}

            {/* Error Overlay */}
            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white bg-red-950/20 backdrop-blur-md">
                    <div className="mb-4 text-4xl">🔌</div>
                    <p className="max-w-md text-red-200 font-medium">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 rounded-full bg-red-600 px-6 py-2 text-sm transition hover:bg-red-500 active:scale-95 shadow-lg shadow-red-900/20"
                    >
                        Restartovat aplikaci
                    </button>
                </div>
            )}

            {/* Badges UI */}
            <div className="absolute left-4 top-4 flex flex-col gap-2">
                {/* Live Badge */}
                <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md border ${relayStatus?.esp32Connected ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-slate-800/50 text-slate-500 border-slate-700/50'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${relayStatus?.esp32Connected ? 'bg-green-400 animate-ping' : 'bg-slate-600'}`}></span>
                    {relayStatus?.esp32Connected ? 'Live Stream' : 'Offline'}
                </div>

                {/* Technical Stats Badge */}
                {relayStatus && (
                    <div className="rounded-lg bg-black/40 p-2 text-[9px] font-mono text-slate-400 backdrop-blur-md border border-white/5 space-y-0.5">
                        <div className="flex justify-between gap-3">
                            <span>FLY.IO CLOUD:</span>
                            <span className="text-blue-400 font-bold text-center">ONLINE</span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span>HARDWARE:</span>
                            <span className={relayStatus.esp32Connected ? 'text-green-400' : 'text-red-400'}>
                                {relayStatus.esp32Connected ? 'CONNECTED' : 'DISCONNECTED'}
                            </span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span>TRANSFERRED:</span>
                            <span className="text-slate-300">{(relayStatus.framesReceived).toLocaleString()} frames</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Corner Logo */}
            <div className="absolute right-4 bottom-4 opacity-30 select-none pointer-events-none">
                <span className="text-xs font-bold tracking-tighter text-white italic">MODRANY RYBICKY</span>
            </div>
        </div>
    );
}
