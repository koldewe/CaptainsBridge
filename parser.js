const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
});

rl.on('line', line => {
    const match = line.match(/^\S+\s+R\s+([0-9A-Fa-f]{8})\s/);
    if (!match) return;

    const canId = parseInt(match[1], 16);

    const pf  = (canId >> 16) & 0xff;
    const ps  = (canId >> 8) & 0xff;
    const src = canId & 0xff;

    const pgn = pf < 240
        ? pf << 8
        : (pf << 8) | ps;

    const dst = pf < 240
        ? ps
        : 255;

    console.log(JSON.stringify({ pgn, src, dst }));
});