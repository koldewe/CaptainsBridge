/**
 * fake-ev1.js
 * -------------------------------------------------------------------------
 * Simuleert de aanwezigheid van een Raymarine Evolution EV-1 op een
 * NMEA2000/SeaTalkNG-bus, bereikbaar via een Yacht Devices YDWG-02
 * WiFi-gateway (RAW-protocol over TCP), zodat een Axiom MFD het apparaat
 * kan ontdekken.
 *
 * LET OP - dingen die je zelf moet verifiëren:
 * 1) De YDWG-02 moet op de "NMEA Server"-pagina een poort hebben met
 *    protocol = RAW, richting = Both (anders kun je alleen ontvangen).
 * 2) canboatjs-exportnamen verschillen per versie. Check na installatie:
 *      node -e "console.log(Object.keys(require('@canboat/canboatjs')))"
 *    en pas de require() hieronder aan als namen afwijken.
 * 3) PGN 65379 ("Seatalk: Pilot Mode") is NIET door Raymarine gepubliceerd.
 *    De veldnamen/waarden hieronder komen uit community reverse-engineering
 *    (canboat-project) en zijn niet 100% gegarandeerd voor elke firmware.
 *    Verifieer met een live capture (bv. canboatjs' analyzerjs op het
 *    RAW-verkeer) wat een echte EV-1 exact verstuurt, en pas de fields aan.
 * 4) Test dit UITSLUITEND op een geïsoleerd testsegment (eigen voeding +
 *    2 terminators, alleen Axiom + gateway erop). Injecteer dit niet op
 *    een live stuurbus met echte instrumenten/AIS/autopilot.
 *
 * Installatie:
 *   npm install @canboat/canboatjs
 * Gebruik:
 *   node fake-ev1.js
 * -------------------------------------------------------------------------
 */

const net = require('net');
const canboatjs = require('@canboat/canboatjs');

// Pas dit aan als de daadwerkelijke exportnamen in jouw canboatjs-versie
// anders heten (zie punt 2 hierboven).
const FromPgn = canboatjs.FromPgn;
const pgnToYdgwRawFormat = canboatjs.pgnToYdgwRawFormat;

// ---- CONFIG ---------------------------------------------------------------
const GATEWAY_HOST = '192.168.4.1'; // standaard YDWG-02 IP; pas aan indien anders
const GATEWAY_PORT = 1457;          // standaard RAW-poort; check jouw gateway-config
const OUR_ADDRESS = 35;             // NMEA2000 bronadres dat wij claimen (0-251)

// ---- VERBINDING MET DE GATEWAY --------------------------------------------
const socket = net.createConnection(GATEWAY_PORT, GATEWAY_HOST, () => {
  console.log(`Verbonden met gateway ${GATEWAY_HOST}:${GATEWAY_PORT}`);
  announcePresence();
  startHeartbeat();
});

socket.on('error', (err) => {
  console.error('Socket-fout:', err.message);
});

// ---- INKOMEND VERKEER PARSEN EN REAGEREN -----------------------------------
const parser = new FromPgn();
let rxBuffer = '';

socket.on('data', (chunk) => {
  rxBuffer += chunk.toString('ascii');
  const lines = rxBuffer.split('\n');
  rxBuffer = lines.pop(); // laatste (mogelijk onvolledige) regel bewaren

  lines.forEach((line) => {
    line = line.trim();
    if (!line) return;
    try {
      const pgn = parser.parseString(line);
      if (pgn) handleIncomingPgn(pgn);
    } catch (err) {
      // Niet elke regel is een geldig/volledig frame; negeren
    }
  });
});

// Bekende Seatalk1 "Keystroke"-datagrammen (commando 0x86), gevonden in de
// signalk-autopilot broncode (raymarinest.js). Checksum-regel: byte4 = 0xFF - byte3.
const KNOWN_KEYSTROKES = {
  '06': '-10',
  '21': '-1 -10 (tack bakboord)',
  '22': '+1 +10 (tack stuurboord)',
  '03': 'onbekend (live waargenomen in een ander project, betekenis niet bevestigd)'
  // +1, -1, +10 zijn hier nog niet bevestigd -- vullen zodra we ze zelf vangen.
};

function scanForKeystroke(hexString) {
  // hexString: aaneengesloten hex zonder spaties, bv "3b9ff08186119cc1..."
  const clean = hexString.replace(/\s+/g, '').toLowerCase();
  const idx = clean.indexOf('8611');
  if (idx === -1) return;
  const keyCode = clean.substr(idx + 4, 2);
  const checksum = clean.substr(idx + 6, 2);
  const expectedChecksum = (0xFF - parseInt(keyCode, 16)) & 0xFF;
  const checksumOk = parseInt(checksum, 16) === expectedChecksum;
  const known = KNOWN_KEYSTROKES[keyCode] || '!! NIEUWE, ONBEKENDE KEYCODE !!';
  console.log(
    `>>> SEATALK1 KEYSTROKE GEVONDEN: 86 11 ${keyCode} ${checksum} ` +
    `(checksum ${checksumOk ? 'klopt' : 'KLOPT NIET -- controleer parsing'}) ` +
    `=> ${known}`
  );
}

function handleIncomingPgn(pgn) {
  console.log(`RX PGN ${pgn.pgn} van src ${pgn.src}:`, JSON.stringify(pgn.fields));

  // BELANGRIJK: dit is de PGN waar we specifiek op willen letten. Als de
  // +1/+10/-1/-10-knoppen na deze wijziging verschijnen, komt een druk op
  // zo'n knop hier binnen -- log dan de EXACTE ruwe bytes, want de
  // key-codes (welke waarde = "+1", welke = "-10", etc.) zijn niet
  // gepubliceerd en moeten we uit deze capture zelf afleiden.
  if (pgn.pgn === 65371) {
    console.log('!!! KEYPAD MESSAGE (65371) ONTVANGEN !!!', JSON.stringify(pgn.fields));
  }

  // 126720 kan een getunnelde SeaTalk1 "Keystroke" (0x86) bevatten.
  // canboat decodeert de proprietary inhoud niet zelf (bevestigd: alleen
  // Manufacturer/Industry + ruwe "Data"-hex) dus we scannen die hex zelf.
  if (pgn.pgn === 126720 && pgn.fields && pgn.fields['Data']) {
    scanForKeystroke(pgn.fields['Data']);
  }

  // Axiom vraagt om Product Info of PGN List
  if (pgn.pgn === 59904 && pgn.fields && pgn.fields['PGN'] !== undefined) {
    const requestedPgn = pgn.fields['PGN'];
    if (requestedPgn === 126996) sendProductInfo();
    if (requestedPgn === 126464) sendPgnList();
  }
}

// ---- VERZEND-HELPERS --------------------------------------------------------
function sendPgn(pgnObject) {
  try {
    const line = pgnToYdgwRawFormat(pgnObject);
    socket.write(line + '\r\n');
    console.log(`TX PGN ${pgnObject.pgn}`);
  } catch (err) {
    console.error(`Kon PGN ${pgnObject.pgn} niet coderen:`, err.message);
  }
}

function announcePresence() {
  // 60928 - ISO Address Claim
  sendPgn({
    pgn: 60928,
    src: OUR_ADDRESS,
    dst: 255,
    fields: {
      'Unique Number': 999001,
      'Manufacturer Code': 1851,   // Raymarine
      'Device Function': 150,      // Autopilot
      'Device Class': 40,          // Steering and Control surfaces
      'Device Instance Lower': 0,
      'Device Instance Upper': 0,
      'System Instance': 0,
      'Industry Group': 4          // Marine
    }
  });

  sendProductInfo();
  sendPgnList();
}

function sendProductInfo() {
  // 126996 - Product Information (officieel gedocumenteerd door Raymarine)
  sendPgn({
    pgn: 126996,
    src: OUR_ADDRESS,
    dst: 255,
    fields: {
      'NMEA 2000 Version': 1300,
      'Product Code': 70096,
      'Model ID': 'EV-1',
      'Software Version Code': '3.16',
      'Model Version': 'E70096',
      'Model Serial Code': '000001',
      'Certification Level': 1,
      'Load Equivalency': 1
    }
  });
}

function sendPgnList() {
  // 126464 - PGN List (Transmit). We voegen bewust ook 65360 en 65371 toe,
  // ook al staan die niet in Raymarine's eigen documentatie: uit analyse
  // van een echte bus-log bleek dat de Axiom de +1/+10/-1/-10-knoppen niet
  // toont zolang er geen "Pilot Locked Heading" (65360) wordt uitgezonden
  // en de pilot niet aangeeft "Keypad Message" (65371) te kunnen verwerken.
  sendPgn({
    pgn: 126464,
    src: OUR_ADDRESS,
    dst: 255,
    fields: {
      'Function Code': 0, // 0 = transmit-lijst
      list: [59392, 59904, 60928, 126208, 126464, 126996,
             127245, 127250, 65379, 65360, 65371, 65288,
             65535, 126720, 126998, 127237, 127245]
    }
  });
}

let lockedHeadingRadians = 0; // 0 rad = noord; pas aan om te testen

function sendLockedHeading() {
  // 65360 - Seatalk: Pilot Locked Heading
  // ANGLE_U16 velden in NMEA2000 zijn radialen * 10000 (resolutie 0.0001 rad)
  const headingRaw = Math.round(lockedHeadingRadians * 10000) & 0xFFFF;
  sendPgn({
    pgn: 65360,
    src: OUR_ADDRESS,
    dst: 255,
    fields: {
      'Manufacturer Code': 1851,
      'Industry Code': 4,
      'SID': 0,
      'Target Heading True': lockedHeadingRadians,
      'Target Heading Magnetic': lockedHeadingRadians
    }
  });
}

// ---- 65379 "Seatalk: Pilot Mode" -- BYTE-EXACTE OPBOUW ---------------------
// Gebaseerd op een echte capture (EV-1 <-> Axiom, src-adres 0xCC/204):
//   StandBy:  3B 9F 00 00 00 00 02 FF
//   Auto:     3B 9F 40 00 00 00 02 FF
//   Vane:     3B 9F 00 01 00 00 02 FF
//   Track:    3B 9F 80 01 00 00 02 FF
//   No Drift: 3B 9F 81 01 00 00 02 FF
//
// Byte-indeling (0-based):
//   0-1  Manufacturer/Industry header, CONSTANT 0x3B 0x9F (Raymarine/Marine)
//   2-3  Pilot Mode, 16-bit little-endian (zie PILOT_MODE hieronder)
//   4    Pilot Mode Data, gezien: 0x00
//   5    Reserved, gezien: 0x00
//   6    "Reserved" per canboat, maar NIET 0xFF zoals normale reserved-bytes --
//        vermoedelijk de compatibiliteits-/versievlag die Yacht Devices noemde.
//        Native EV-1-waarde lijkt 0x02. Pas aan en test als de Axiom het
//        paneel niet activeert (Yacht Devices gebruikte 0x07 voor hun
//        SPX-naar-nieuwere-firmware-truc -- dat hoeft voor een EV-1 niet
//        hetzelfde te zijn).
//   7    Reserved, standaard NMEA2000-vulwaarde 0xFF

const PILOT_MODE = {
  STANDBY: 0x0000,
  AUTO: 0x0040,
  VANE: 0x0100,
  TRACK: 0x0180,
  NO_DRIFT: 0x0181
};

let compatibilityByte = 0x02; // pas aan naar 0x07 als 0x02 niet werkt -- verifieer zelf

function build65379Bytes(pilotMode) {
  return [
    0x3B, 0x9F,                          // manufacturer/industry header (constant)
    pilotMode & 0xFF,                    // Pilot Mode low byte
    (pilotMode >> 8) & 0xFF,             // Pilot Mode high byte
    0x00,                                // Pilot Mode Data
    0x00,                                // Reserved
    compatibilityByte,                   // vermoedelijke compat/versie-byte
    0xFF                                 // Reserved (standaard vulwaarde)
  ];
}

// Bouwt zelf de YDWG RAW-ASCII-regel op basis van de bekende CAN-ID-structuur,
// in plaats van te vertrouwen op canboatjs' generieke veld-encoder voor deze
// ongedocumenteerde PGN. Format o.b.v. het in de canboatjs-README getoonde
// voorbeeld: "hh:mm:ss.mmm R/T <8-hex-CAN-ID> <8 hex databytes>".
// LET OP: verifieer of jouw gateway/canboatjs-versie 'T' verwacht voor
// uitgaande frames, of dat de richting anders wordt afgeleid.
function buildYdwgRawLine(priority, pgn, src, dataBytes) {
  const pf = (pgn >> 8) & 0xFF;
  const ps = pgn & 0xFF;
  const dp = (pgn >> 16) & 0x01;
  const canId = ((priority & 0x7) << 26) | (dp << 24) | (pf << 16) | (ps << 8) | (src & 0xFF);
  const idHex = canId.toString(16).toUpperCase().padStart(8, '0');
  const dataHex = dataBytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const now = new Date();
  const ts = now.toISOString().substr(11, 12); // hh:mm:ss.mmm
  return `${ts} T ${idHex} ${dataHex}`;
}

function sendPilotMode(pilotMode) {
  const bytes = build65379Bytes(pilotMode);
  const line = buildYdwgRawLine(7, 65379, OUR_ADDRESS, bytes);
  socket.write(line + '\r\n');
  console.log(`TX PGN 65379 (Pilot Mode 0x${pilotMode.toString(16)}):`, line);
}

// ---- PERIODIEKE "IK LEEF NOG"-DATA -----------------------------------------
function startHeartbeat() {
  setInterval(() => {
    // 127250 - Vessel Heading (officieel gedocumenteerd)
    sendPgn({
      pgn: 127250, src: OUR_ADDRESS, dst: 255,
      fields: { 'Heading': 0, 'Reference': 'Magnetic' }
    });

    // 127245 - Rudder Angle (officieel gedocumenteerd)
    sendPgn({
      pgn: 127245, src: OUR_ADDRESS, dst: 255,
      fields: { 'Rudder Angle': 0, 'Instance': 0 }
    });

    // 65379 - "Seatalk: Pilot Mode" (PROPRIETARY), byte-exact opgebouwd.
    sendPilotMode(PILOT_MODE.STANDBY);

    // 65360 - "Seatalk: Pilot Locked Heading" (PROPRIETARY, nieuw).
    // Hypothese: dit is nodig zodat de Axiom een basiswaarde heeft om
    // de +1/+10/-1/-10-stapknoppen op te tonen en te bedienen.
    sendLockedHeading();
  }, 1000);
}