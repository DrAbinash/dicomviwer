#!/usr/bin/env node
/**
 * dimse-echo-client.mjs - external SCU used by license-e2e.sh.
 * C-ECHO a local DIMSE peer and report the response status.
 *
 * Usage: node scripts/dimse-echo-client.mjs <port> <calledAeTitle>
 * exit 0 = Success, 3 = ProcessingFailure (e.g. license rejected), 1 = network/other
 */
import dcmjsDimse from "dcmjs-dimse";

const [portArg, aetArg] = process.argv.slice(2);
const port = Number(portArg);
const calledAet = (aetArg || "DICOMVIEWER").toUpperCase();
if (!Number.isInteger(port) || port < 1) {
  console.error("usage: node scripts/dimse-echo-client.mjs <port> <calledAeTitle>");
  process.exit(1);
}

const { Client, requests, constants } = dcmjsDimse;

const client = new Client();
const req = new requests.CEchoRequest();
let status = null;

req.on("response", (res) => {
  status = res.getStatus();
  try {
    console.log("status:", status, res.getErrorComment ? `(${res.getErrorComment()})` : "");
  } catch {
    console.log("status:", status);
  }
});

client.on("networkError", (e) => {
  console.error("networkError:", e.message);
  process.exit(1);
});

client.addRequest(req);
client.send("127.0.0.1", port, "LICE2E", calledAet, { connectTimeout: 8000 });

setTimeout(() => {
  if (status === constants.Status.Success) {
    console.log("ECHO_OK");
    process.exit(0);
  }
  if (status === constants.Status.ProcessingFailure) {
    console.log("ECHO_REJECTED (ProcessingFailure)");
    process.exit(3);
  }
  console.log("ECHO_UNEXPECTED", status);
  process.exit(1);
}, 3000);
