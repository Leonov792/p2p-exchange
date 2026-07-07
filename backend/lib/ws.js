// WebSocket Server for real-time deal updates
// ============================================
const http = require("http");
const crypto = require("crypto");

const clients = new Map();

function createWSServer(server) {
  server.on("upgrade", (req, socket, head) => {
    if (req.headers["upgrade"] !== "websocket") {
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n"
    );

    const userId = new URL(req.url, "http://localhost").searchParams.get("user_id") || "anon";
    clients.set(socket, userId);

    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });
}

function broadcast(event, data) {
  const message = JSON.stringify({ event, data, time: Date.now() });
  const frame = createFrame(message);

  for (const [socket, userId] of clients) {
    try {
      socket.write(frame);
    } catch {
      clients.delete(socket);
    }
  }
}

function sendToUser(userId, event, data) {
  const message = JSON.stringify({ event, data, time: Date.now() });
  const frame = createFrame(message);

  for (const [socket, uid] of clients) {
    if (String(uid) === String(userId)) {
      try { socket.write(frame); } catch { clients.delete(socket); }
    }
  }
}

function createFrame(payload) {
  const buf = Buffer.from(payload, "utf-8");
  const len = buf.length;
  if (len < 126) {
    return Buffer.concat([Buffer.from([0x81, len]), buf]);
  }
  if (len < 65536) {
    return Buffer.concat([Buffer.from([0x81, 126]), Buffer.from([len >> 8, len & 0xff]), buf]);
  }
  const ext = Buffer.alloc(8);
  ext.writeUInt32BE(len >> 32, 0);
  ext.writeUInt32BE(len & 0xffffffff, 4);
  return Buffer.concat([Buffer.from([0x81, 127]), ext, buf]);
}

module.exports = { createWSServer, broadcast, sendToUser, clients };
