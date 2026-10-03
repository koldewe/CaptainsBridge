const net = require("net");
const {
  FromPgn,
  pgnToYdgwRawFormat,
} = require("@canboat/canboatjs");

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

const YDWG_HOST = "192.168.4.1";
const YDWG_PORT = 1457;

// Onze gesimuleerde NMEA2000 device
const SOURCE_ADDRESS = 35;       // 0x23
const DESTINATION = 255;         // broadcast

// EV-1 / Raymarine
const MANUFACTURER_CODE = 1851;
const INDUSTRY_CODE = 4;

// ------------------------------------------------------------
// TCP connection to Yacht Devices YDWG-02
// ------------------------------------------------------------

const socket = new net.Socket();

socket.setEncoding("ascii");

socket.connect(YDWG_PORT, YDWG_HOST, () => {
  console.log(`Connected to YDWG-02 ${YDWG_HOST}:${YDWG_PORT}`);
  console.log(`Source address: ${SOURCE_ADDRESS}`);
  console.log("");
  
  // Give the gateway a moment before starting NMEA2000 traffic
  setTimeout(start, 1000);
});


const parser = new FromPgn();

socket.on("data", data => {
  const lines = data.toString().split(/\r?\n/);

  for (const line of lines) {
    if (line.trim()) {
      try {
      const pgn = parser.parseString(line);
      if (pgn) handleIncomingPgn(pgn);
    } catch (err) {
      // Niet elke regel is een geldig/volledig frame; negeren
    }
      //console.log("RX:", line);
    }
  }
});

socket.on("error", err => {
  console.error("Socket error:", err.message);
});

socket.on("close", () => {
  console.log("Connection closed");
});

// ------------------------------------------------------------
// Send a canboat PGN
// ------------------------------------------------------------

function sendPgn(pgn) {
  const lines = pgnToYdgwRawFormat(pgn);

  for (const line of lines) {
    console.log("TX:", line);
    socket.write(line + "\r\n");
  }
}

// ------------------------------------------------------------
// Send an exact RAW CAN frame
//
// Useful for Raymarine proprietary PGNs where we want exact
// control over all 8 data bytes.
// ------------------------------------------------------------

function sendRaw(canId, bytes) {

  if (bytes.length !== 8) {
    throw new Error("NMEA2000 CAN frame must contain exactly 8 bytes");
  }

  const line =
    canId.toString(16).toUpperCase().padStart(8, "0") +
    " " +
    bytes
      .map(b => b.toString(16).toUpperCase().padStart(2, "0"))
      .join(" ");

  console.log("TX RAW:", line);

  socket.write(line + "\r\n");
}

// ------------------------------------------------------------
// NMEA2000 Address Claim
// PGN 60928
// ------------------------------------------------------------

function sendAddressClaim() {

  sendPgn({
    pgn: 60928,
    prio: 6,
    src: SOURCE_ADDRESS,
    dst: DESTINATION,

    fields: {
      "Unique Number": 123456,
      "Manufacturer Code": MANUFACTURER_CODE,
      "Device Instance Lower": 0,
      "Device Instance Upper": 0,
      "Device Function": 130,
      "Device Class": 25,
      "System Instance": 0,
      "Industry Group": INDUSTRY_CODE,
      "Arbitrary Address Capable": 1
    }
  });
}

// ------------------------------------------------------------
// Product Information
// PGN 126996
// ------------------------------------------------------------

function sendProductInformation() {

  sendPgn({
    pgn: 126996,
    prio: 6,
    src: SOURCE_ADDRESS,
    dst: DESTINATION,

    fields: {
      "NMEA 2000 Version": 2100,
      "Product Code": 70096,
      "Model ID": "EV-1",
      "Software Version Code": "sim-1.0",
      "Model Version": "EV-1",
      "Model Serial Code": "SIM00001",
      "Certification Level": 2,
      "Load Equivalency": 1
    }
  });
  sendPgnList();
}



function sendPgnList() {
  // 126464 - PGN List (Transmit). We voegen bewust ook 65360 en 65371 toe,
  // ook al staan die niet in Raymarine's eigen documentatie: uit analyse
  // van een echte bus-log bleek dat de Axiom de +1/+10/-1/-10-knoppen niet
  // toont zolang er geen "Pilot Locked Heading" (65360) wordt uitgezonden
  // en de pilot niet aangeeft "Keypad Message" (65371) te kunnen verwerken.
  sendPgn({
    pgn: 126464,
    src: SOURCE_ADDRESS,
    dst: DESTINATION,
    fields: {
      'Function Code': 0, // 0 = transmit-lijst
      list: [59392, 59904, 60928, 126208, 126464, 126996,
             127245, 127250, 65379, 65360, 65371, 65288,
             65535, 126720, 126998, 127237, 127245]
    }
  });
}
// ------------------------------------------------------------
// Raymarine proprietary PGN 65379
//
// Known structure:
//
// 3B 9F = Raymarine manufacturer + marine industry
//
// Pilot Mode:
//   0000 = Standby
//   0040 = Auto
//   0100 = Wind/Vane
//   0180 = Track
//   0181 = No Drift
//
// We deliberately send the complete known frame rather than
// allowing canboatjs to fill unknown bytes with FF.
// ------------------------------------------------------------

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
//  if (pgn.pgn === 126720 && pgn.fields && pgn.fields['Data']) {
//    scanForKeystroke(pgn.fields['Data']);
//  }

  // Axiom vraagt om Product Info of PGN List
  if (pgn.pgn === 59904 && pgn.fields && pgn.fields['PGN'] !== undefined) {
    const requestedPgn = pgn.fields['PGN'];
    if (requestedPgn === 126996) sendProductInfo();
    if (requestedPgn === 126464) sendPgnList();
  }
}


function sendPilotMode(mode) {

  let modeLow;
  let modeHigh;

  switch (mode) {

    case "standby":
      modeLow = 0x00;
      modeHigh = 0x00;
      break;

    case "auto":
      modeLow = 0x40;
      modeHigh = 0x00;
      break;

    case "vane2":
      modeLow = 0x00;
      modeHigh = 0x01;
      break;

    case "track":
      modeLow = 0x80;
      modeHigh = 0x01;
      break;

    case "nodrift":
      modeLow = 0x81;
      modeHigh = 0x01;
      break;

    default:
      throw new Error(`Unknown pilot mode: ${mode}`);
  }

  // PGN 65379 = 0xFF63
  //
  // Priority 7
  // Source 35 = 0x23
  //
  // CAN ID = 1C FF 63 23

  const canId = 0x1CFF6300 | SOURCE_ADDRESS;

  const data = [
    0x3B,
    0x9F,
    modeLow,
    modeHigh,
    0x00,
    0x00,
    0x02,
    0xFF
  ];

  sendRaw(canId, data);
}

// ------------------------------------------------------------
// Start sequence
// ------------------------------------------------------------

function start() {

  console.log("======================================");
  console.log(" Fake Raymarine EV-1");
  console.log("======================================");
  console.log("");

  // 1. Address Claim
  sendAddressClaim();

  // 2. Product information
  setTimeout(() => {
    sendProductInformation();
  }, 500);

  // 3. Pilot Mode
  setInterval(() => {
    sendPgn({
      pgn: 127250, src: SOURCE_ADDRESS, dst: 255,
      fields: { 'Heading': 0, 'Reference': 'Magnetic' }
    });
 
    // 127245 - Rudder Angle (officieel gedocumenteerd)
    sendPgn({
      pgn: 127245, src: SOURCE_ADDRESS, dst: 255,
      fields: { 'Rudder Angle': 0, 'Instance': 0 }
    });

    sendPilotMode("auto");
  }, 1000);

  // ----------------------------------------------------------
  // After that we deliberately STOP.
  //
  // This allows us to observe what the Axiom does before adding
  // heading, rudder, PGN list etc.
  // ----------------------------------------------------------

  setTimeout(() => {
    console.log("");
    console.log("Initial EV-1 advertisement complete.");
    console.log("No further traffic is being generated.");
  }, 1500);
}
