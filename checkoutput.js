const fs = require('fs');
const readline = require('readline');


// --------------------------------------------------
// CANboat berichten inladen
// --------------------------------------------------

const canboat = [];

const content = fs
    .readFileSync('delta1.json', 'utf16le')
    .replace(/^\uFEFF/, '');

for (const line of content.split(/\r?\n/)) {

    if (!line.trim()) continue;

    const msg = JSON.parse(line);

    const input = msg.input[0].split(' ');

    // CANboat input:
    // 17:08:27.123 R 09F112CC FF E6 A8 FF 7F FF 7F FD

    const canId = input[2];
    const data = input.slice(3);

    canboat.push({
        pgn: msg.pgn,
        src: msg.src,
        dst: msg.dst,
        canId: canId,
        data: data
    });
}


// --------------------------------------------------
// Vergelijkingsfuncties
// --------------------------------------------------

function sameHeader(a, b) {

    return (
        a.pgn === b.pgn &&
        a.src === b.src &&
        a.dst === b.dst
    );
}


function sameData(a, b) {

    return (
        a.data.length === b.data.length &&
        a.data.every((byte, i) =>
            byte.toUpperCase() === b.data[i].toUpperCase()
        )
    );
}


// --------------------------------------------------
// Output van onze eigen parser lezen
// --------------------------------------------------

const rl = readline.createInterface({
    input: process.stdin
});

let total = 0;
let matches = 0;
let different = 0;
let notFound = 0;


rl.on('line', line => {

    if (!line.trim()) return;

    const msg = JSON.parse(line);

    total++;

    // Zoek alle CANboat berichten met dezelfde
    // PGN + source + destination
    const candidates = canboat.filter(ref =>
        sameHeader(msg, ref)
    );


    // ----------------------------------------------
    // PGN/src/dst helemaal niet gevonden
    // ----------------------------------------------

    if (candidates.length === 0) {

        notFound++;

        console.log(
            `✗ PGN ${msg.pgn} src=${msg.src} dst=${msg.dst}: NIET IN CANBOAT`
        );

        console.log(
            `  data: ${msg.data.join(' ')}`
        );

        return;
    }


    // ----------------------------------------------
    // PGN/src/dst bestaat.
    // Nu zoeken naar exacte data-match.
    // ----------------------------------------------

    const match = candidates.some(ref =>
        sameData(msg, ref)
    );


    if (match) {

        matches++;

        console.log(
            `✓ PGN ${msg.pgn} src=${msg.src}: DATA MATCH`
        );

    } else {

        different++;

        console.log(
            `~ PGN ${msg.pgn} src=${msg.src}: DATA VERSCHILT`
        );

        console.log(
            `  tool: ${msg.data.join(' ')}`
        );

        console.log(
            `  CANboat heeft:`
        );

        // Alle verschillende CANboat-data's tonen
        const uniqueData = [];

        for (const ref of candidates) {

            const data = ref.data.join(' ');

            if (!uniqueData.includes(data)) {
                uniqueData.push(data);
            }
        }

        for (const data of uniqueData) {
            console.log(`    ${data}`);
        }
    }
});


// --------------------------------------------------
// Eindresultaat
// --------------------------------------------------

rl.on('close', () => {

    console.log('');
    console.log('================================');
    console.log('RESULTAAT');
    console.log('================================');

    console.log(`Totaal          : ${total}`);
    console.log(`Exacte match    : ${matches}`);
    console.log(`Data verschilt  : ${different}`);
    console.log(`Niet in CANboat : ${notFound}`);

    console.log('================================');
});