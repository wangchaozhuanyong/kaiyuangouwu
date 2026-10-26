import { createServer, Socket } from 'node:net';

/** Test-only SMTP endpoint, bound exclusively to loopback with no external forwarding. */
export async function localSmtpSink() {
    const messages: string[] = [];
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.write('220 local-delivery-acceptance ESMTP\r\n');
        let buffer = '';
        let data: string[] | null = null;
        socket.on('data', chunk => {
            buffer += chunk.toString();
            let end: number;
            while ((end = buffer.indexOf('\r\n')) >= 0) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                if (data) {
                    if (line === '.') {
                        messages.push(data.join('\r\n'));
                        data = null;
                        socket.write('250 queued locally\r\n');
                    } else data.push(line.replace(/^\.\./, '.'));
                } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 local-delivery-acceptance\r\n');
                else if (/^DATA$/i.test(line)) {
                    data = [];
                    socket.write('354 End with dot\r\n');
                } else if (/^QUIT$/i.test(line)) socket.end('221 goodbye\r\n');
                else socket.write('250 OK\r\n');
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback SMTP address');
    return {
        port: address.port,
        messages,
        async close() {
            sockets.forEach(socket => socket.destroy());
            await new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}
