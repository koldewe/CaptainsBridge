const net = require('net');
const EventEmitter = require('events');

class WifiTransport extends EventEmitter {
    constructor() {
        super();

        this.host = process.env.YDWG_HOST || '192.168.4.1';
        this.port = Number(process.env.YDWG_PORT || 1457);
        this.socket = null;
        this.buffer = '';
    }

    connect() {
        this.socket = net.createConnection(
            this.port,
            this.host
        );

        this.socket.on('connect', () => {
            console.log(
                `[WiFi] Verbonden met ${this.host}:${this.port}`
            );
            this.emit('ready');
        });

        this.socket.on('data', data => {
            this.buffer += data.toString('ascii');

            const lines = this.buffer.split(/\r?\n/);
            this.buffer = lines.pop();

            for (const line of lines) {
                if (line.trim()) {
                    this.emit('line', line.trim());
                }
            }
        });

        this.socket.on('error', err => {
            this.emit('error', err);
        });

        this.socket.on('close', () => {
            this.emit('close');
        });
    }

    sendLine(line) {
        if (!this.socket || this.socket.destroyed) {
            throw new Error('WiFi-transport is niet verbonden');
        }

        this.socket.write(line + '\r\n');
    }
}

module.exports = WifiTransport;