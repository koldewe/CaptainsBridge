const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
});

const pgnType = new Map(); // pgn -> "single" | "fastpacket"
const laatsteFrame = new Map(); // canId -> { pgn, frameCounter, sequenceCounter }

function leerPgnTypes(canId, pgn, bytes){
    if (pgnType.get(pgn) === "fastpacket")
        return true;

    const sequenceCounter  = bytes[0] >> 5 & 0x07;
    const frameCounter = bytes[0]  & 0x1F;
    const vorige = laatsteFrame.get(canId);

    const isVervolg = vorige
      && vorige.pgn === pgn
      && frameCounter === (vorige.frameCounter + 1) % 32
      && sequenceCounter === vorige.sequenceCounter;

    if (isVervolg) {
      pgnType.set(pgn, "fastpacket");
    }
    laatsteFrame.set(canId, { pgn, frameCounter, sequenceCounter });

    if (isVervolg) return true;
    else return false;
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


    //console.log(`Priority = ${priority}, DP = ${dp}, PF = ${pf}, PS = ${ps}, PGN = ${pgn}, SRC = ${src}, DST = ${dst} `);

    return {pgn, src, dst};
}

rl.on('line', line => {

    const parts = line.trim().split(/\s+/);
    if (parts[1] !== "R") return;

    const [canId, ...hex] = parts.slice(2);
    const bytes = hex.map(h => parseInt(h, 16));

    const {pgn, src, dst} = analyseCanId(canId);
    const isFastPacket = leerPgnTypes(canId, pgn, bytes);

    console.log(`CanId = ${canId}, PGN = ${pgn}, SRC = ${src}, DST = ${dst} IsFastpacket = ${isFastPacket}`);

    console.log(pgnType);

});