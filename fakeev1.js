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

let Heading = 0.8032;

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

  //console.log("TX RAW:", line);

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
}



function sendPgnList() {
  // 126464 - PGN List (Transmit). We voegen bewust ook 65360 en 65371 toe,
  // ook al staan die niet in Raymarine's eigen documentatie: uit analyse
  // van een echte bus-log bleek dat de Axiom de +1/+10/-1/-10-knoppen niet
  // toont zolang er geen "Pilot Locked Heading" (65360) wordt uitgezonden
  // en de pilot niet aangeeft "Keypad Message" (65371) te kunnen verwerken.
  // 59392  ISO Acknowledgement
  // 59904  ISO Request message
  // 60928  ISO Address Claim message
  // 126464 Transmit / Receive PGN List Group Function
  // 126996 standaard Productinformatie-bericht
  // 127245 Rudder data
  // 127250 Vessel Heading
  // 65379  proprietary Raymarine SeaTalk / Pilot State / Pilot Mode message
  // 65360  Seatalk: Pilot Locked Heading
  // 65371  proprietary Parameter Group Number used by Raymarine / SeaTalk
  // 65288  Raymarine SeaTalk Alarm
  // 65535  Raymarine Proprietary
  // 126720 Raymarine Proprietary Seatalk1
  // 126998 Configuration Information (Verwijderd)
  // 127237 Heading/Track control  (Verwijderd)
  // 65359  Raymarine Seatalk PilotHeading

  // 127251, rateOfTurn (nog niet geimplementeerd)
  // 127257, attitude (nog niet geimplementeerd)


  sendPgn({
    pgn: 126464,
    src: SOURCE_ADDRESS,
    dst: DESTINATION,
    fields: {
      'Function Code': 0, // 0 = transmit-lijst
      list: [59392, 59904, 60928, 126208, 126464, 126996,
             65379, 65360, 65371, 65288, 65535, 126720,
             127245, 127250, 65359]
    }
  });

  sendPgn({
    pgn: 126464,
    src: SOURCE_ADDRESS,
    dst: DESTINATION,
    fields: {
      'Function Code': 1, // 1 = Receive-lijst
      list: [59392, 59904, 60928, 126208, 126464, 126996,
             65379, 65360, 65371, 65288,
             65535, 126720]
    }
  });

}

function sendAcknowledge(pgn) {

  const firstByte = pgn & 0xFF;
  const secondByte = pgn >> 8;

  // PGN 126208  = 0x1ED00
  //
  // Priority 7
  // Destination = 0x1
  // Source 35 = 0x23
  // CAN ID = 0D ED 01 23
  // Data   = 
  // "80 08 02 63 FF 00 00 04",
  // "81 00 00 FF FF FF FF FF"

  const canId = 0x0DED0100 | SOURCE_ADDRESS;

  const data1 = [
    0x80,
    0x08,
    0x02,
    firstByte,
    secondByte,
    0x00,
    0x00,
    0x04
  ];


   setTimeout(() => {
    sendRaw(canId, data1);
  }, 500);

  

   const data2 = [
    0x81,
    0x00,
    0x00,
    0xFF,
    0xFF,
    0xFF,
    0xFF,
    0xFF
  ];

  setTimeout(() => {
    sendRaw(canId, data2);
  }, 500);
}


function handleIncomingPgn(pgn) {
  //console.log(`RX PGN ${pgn.pgn} van src ${pgn.src}:`, JSON.stringify(pgn.fields));

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
    if (requestedPgn === 126996) sendProductInformation();
    if (requestedPgn === 126464) sendPgnList();
  }


    if (pgn.pgn === 126208 && pgn.fields && pgn.fields['PGN'] !== undefined) {

    console.log("RX PGN 126208")

    const requestedPgn = pgn.fields['PGN'];
    if (requestedPgn === 65379) {
      console.log("Received  65379 - Seatalk: Pilot Mode");
      sendAcknowledge(65379);
    }
    if (requestedPgn === 65360) {
      console.log("Received  65360 - Seatalk: Pilot Locked Heading");
      sendAcknowledge(65360);
      if (pgn.fields['list'] !== undefined) {
        const list = pgn.fields['list'];
        Heading = list.find(x => x.parameterId === "targetHeadingMagnetic")?.Value ?? Heading;
      }
    }
  }
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
//   0040 = s
//   0100 = Wind/Vane
//   0180 = Track
//   0181 = No Drift
//
// We deliberately send the complete known frame rather than
// allowing canboatjs to fill unknown bytes with FF.
// ------------------------------------------------------------

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

function sendPilotHeading(heading) {

  heading = Math.round(heading * 10000); 
  const firstByte = heading & 0xFF;
  const secondByte = heading >> 8;

  // PGN 65359 = 0xFF4F
  //
  // Priority 7
  // Source 35 = 0x23
  //
  // CAN ID = 1C FF 4F 23
  // Data   = 3B 9F 00 FF FF 60 1F FF

  const canId = 0x1CFF4F00 | SOURCE_ADDRESS;

  const data = [
    0x3B,
    0x9F,
    0x00,
    0xFF,
    0xFF,
    firstByte,
    secondByte,
    0xFF
  ];

  sendRaw(canId, data);
}


function sendPilotLockedHeading(heading) {

  heading = Math.round(heading * 10000); 
  const firstByte = heading & 0xFF;
  const secondByte = heading >> 8;

  // PGN 65360 = 0xff50
  //
  // Priority 7
  // Source 35 = 0x23
  //
  // CAN ID = 1C FF 50 23
  // Data   = 3B 9F 00 FF FF 60 1F FF

  const canId = 0x1CFF5000 | SOURCE_ADDRESS;

  const data = [
    0x3B,
    0x9F,
    0x00,
    0xFF,
    0xFF,
    firstByte,
    secondByte,
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

  setTimeout(() => {
    sendPgnList();
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

    sendPilotHeading(Heading);

    sendPilotLockedHeading(Heading);

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
