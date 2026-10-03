const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
});

const messagesBuffer = new Map();

const fastPacketPgns = new Set([
    126208,
    126464,
    126720,
    126996,
    127237,
    128275,
    129025,
    129029,
    129038,
    129039,
    129044,
    129540,
    129542,
    129547,
    129794,
    129797,
    129809,
    129810,
    130577,
    130846,
    130916,
    130919,
    130934,
    130935,
    131056
]);

function reconstruct(canId, data){

    const sequenceCounter  = data[0] >> 5 & 0x07;
    const frameCounter = data[0]  & 0x1F;
    const key = `${canId}-${sequenceCounter}`;

    if (frameCounter === 0) {

        if (data.length < 2) {
            return null;
        }

        // Tweede byte bevat de totale payload-lengte
        const length = parseInt(data[1], 16);

        messagesBuffer.set(key, {

            // Totale verwachte payload-lengte
            length,

            // Eerste frame heeft 6 payload bytes
            data: data.slice(2)
        });
    }
    else {

        const message = messagesBuffer.get(key);

        // Geen bekend eerste frame
        if (!message) {
            return null;
        }

        // Vanaf frame 1 zijn er maximaal 7 payload bytes
        message.data.push(...data.slice(1));
    }


    // ========================================================
    // Controleren of het bericht compleet is
    // ========================================================

    const message = messagesBuffer.get(key);

    if (!message) {
        return null;
    }


    if (message.data.length >= message.length) {


        // Padding verwijderen
        message.data = message.data.slice(
            0,
            message.length
        );
        messagesBuffer.delete(key);
        return message;
    }
    else return null


}


function analyseCanId(input){

    const canId = parseInt(input, 16)
    const priority = (canId >> 26) & 0x07; 
    const dp = (canId >> 24) & 0x01;
    const pf = (canId >> 16) & 0xff;
    const ps = (canId >> 8) & 0xff;
    const src = canId & 0xff;

    let pgn;
    let dst;

    if (pf < 240) {
        // PDU1
        pgn = (dp << 16) | (pf << 8);
        dst = ps;
    } else {
        // PDU2
        pgn = (dp << 16) | (pf << 8) | ps;
        dst = 255;
}

    return {pgn, src, dst};
}


rl.on('line', line => {

    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) return;

    //if (parts[1] === "R") parts = parts.slice(2);

    const [canId, ...hex] = parts.slice(2);;
    const bytes = hex.map(h => parseInt(h, 16));

    const {pgn, src, dst} = analyseCanId(canId);

    let message = null;
  
    if (fastPacketPgns.has(pgn)) {
        message = reconstruct(canId, bytes);
    }
    else {
        message = {
            length: 8,
            data:  bytes
        } 
    }

    if(message)
        console.log(JSON.stringify({
            pgn: pgn,
            src: src,
            dst: dst,
            length: message.length,
            data: message.data.map(b => b.toString(16).toUpperCase().padStart(2, "0"))
        }));

    }

);