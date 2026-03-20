import { NextResponse } from 'next/server';

export async function GET() {
    const relayUrl = process.env.ORACLE_RELAY_URL;

    if (!relayUrl) {
        return NextResponse.json({
            online: false,
            error: 'RELAY_URL_MISSING',
            message: 'V konfiguraci chybí URL na relay server.'
        });
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${relayUrl}/status`, {
            signal: controller.signal,
            cache: 'no-store'
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return NextResponse.json({ online: false, error: 'RELAY_ERROR' });
        }

        const data = await response.json();
        return NextResponse.json({
            online: true,
            esp32Connected: data.esp32Connected,
            viewers: data.mjpegViewers,
            fps: data.framesPerSecond
        });
    } catch (err) {
        return NextResponse.json({
            online: false,
            error: 'RELAY_UNREACHABLE',
            message: 'Relay server je momentálně nedostupný.'
        });
    }
}
