const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

const rl = readline.createInterface({ input, output });

// 1DEFFFCC
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

    console.log(`Priority = ${priority}, DP = ${dp}, PF = ${pf}, PS = ${ps}, PGN = ${pgn}, SRC = ${src}, DST = ${dst} `);
}


async function main() {
while (true) {
    const antwoord = await rl.question('Geef een CAN-ID: ');
    analyseCanId(antwoord);

    if (antwoord === 'q') {
        break;
    }

}

rl.close();
}

main();