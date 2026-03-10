'use client';

import { useState, useEffect } from 'react';

/**
 * Component to display the MJPEG stream from the Oracle VM.
 * Direct connection between browser and relay server is used for low latency
 * and to avoid Vercel's timeout limits.
 */
export function VideoStream() {
    const [error, setError] = useState<string | null>(null);
    const streamUrl = process.env.NEXT_PUBLIC_STREAM_URL || 'http://localhost:8080/stream';

    return (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-900 shadow-2xl transition-all duration-300 hover:shadow-indigo-500/10">
            {/* MJPEG Stream directly from the relay */}
            <img
                src={streamUrl}
                alt="ESP32-CAM Video Stream"
                className={`h-full w-full object-contain transition-opacity duration-300 ${error ? 'opacity-20' : 'opacity-100'}`}
                onError={() => setError('Nepodařilo se připojit k video streamu. Zkontrolujte připojení k Oracle VM.')}
                onLoad={() => setError(null)}
            />

            {/* Error Overlay */}
            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white">
                    <div className="mb-4 text-4xl">🔌</div>
                    <p className="max-w-md text-slate-300">{error}</p>
                    <button
                        onClick={() => {
                            setError(null);
                            // Force refreshing the image source can be done by appending a timestamp
                            // but for MJPEG it might be better to just let the image reload
                        }}
                        className="mt-4 rounded-full bg-indigo-600 px-6 py-2 transition hover:bg-indigo-500 active:scale-95"
                    >
                        Zkusit znovu
                    </button>
                </div>
            )}

            {/* Info Badge */}
            <div className={`absolute left-4 top-4 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md border ${error ? 'bg-red-600/20 text-red-500 border-red-500/30' : 'bg-black/50 text-green-400 border-green-500/20'}`}>
                {error ? 'Connect Fail' : 'Live'}
            </div>
        </div>
    );
}
