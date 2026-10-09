const can = require('socketcan');
const EventEmitter = require('events');

class CanTransport extends EventEmitter {
    constructor() {
        super();

        this.interfaceName = process.env.CAN_INTERFACE || 'can0';
        this.channel = null;
    }

    connect() {
        this.channel = can.createRawChannel(
            this.interfaceName,
            true
        );

        this.channel.addListener('onMessage', msg => {
            // NMEA 2000 gebruikt extended CAN-frames.
            if (!msg.ext || msg.data.length !== 8) {
                return;
            }

            const id = msg.id
                .toString(16)
                .toUpperCase()
                .padStart(8, '0');

            const bytes = [...msg.data]
                .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
                .join(' ');

            const now = new Date();
            const timestamp = [
                now.getHours().toString().padStart(2, '0'),
                now.getMinutes().toString().padStart(2, '0'),
                now.getSeconds().toString().padStart(2, '0')
            ].join(':') + '.' +
                now.getMilliseconds().toString().padStart(3, '0');

            this.emit('line', `${timestamp} R ${id} ${bytes}`);
        });

        this.channel.start();

        console.log(`[CAN] Luisteren op ${this.interfaceName}`);
        this.emit('ready');
    }

    sendLine(line) {
        // Verwacht bijvoorbeeld:
        // 19:08:47.722 T 19FA0401 33 00 00 F5 31 74 14 66

        const match = line.match(
            /^\S+\s+T\s+([0-9A-Fa-f]{8})\s+((?:[0-9A-Fa-f]{2}\s*)+)$/
        );

        if (!match) {
            throw new Error(`Ongeldige CAN-regel: ${line}`);
        }

        const id = parseInt(match[1], 16);
        const bytes = match[2].trim().split(/\s+/)
            .map(b => parseInt(b, 16));

        if (bytes.length !== 8) {
            throw new Error(
                `Verwacht 8 databytes, ontvangen: ${bytes.length}`
            );
        }

        this.channel.send({
            id,
            ext: true,
            data: Buffer.from(bytes)
        });
    }
}

module.exports = CanTransport;