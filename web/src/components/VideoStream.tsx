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
                alt="ESP32-CAM Stream"
                className="h-full w-full object-contain"
                onError={() => setError('Nepodařilo se připojit k video streamu. Je relay server spuštěn?')}
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
            <div className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-green-400 backdrop-blur-md">
                Live
            </div>
        </div>
    );
}
