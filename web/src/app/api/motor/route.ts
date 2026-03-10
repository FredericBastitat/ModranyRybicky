import { NextResponse } from 'next/server';

/**
 * API route to proxy motor commands to the Oracle VM relay server.
 * This route is called from the browser and sends a POST request to the relay server.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { dir } = body;

        if (!dir) {
            return NextResponse.json({ error: 'Missing direction' }, { status: 400 });
        }

        const relayUrl = process.env.ORACLE_RELAY_URL || 'http://localhost:8080';

        const response = await fetch(`${relayUrl}/motor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            return NextResponse.json(errorData, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (err: any) {
        console.error('Error forwarding motor command:', err);
        return NextResponse.json({ error: 'Failed to communicate with relay server' }, { status: 500 });
    }
}
