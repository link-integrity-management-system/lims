const { app, routeWSMessage } = require("./index");
const ws = require("ws");

const ip = "0.0.0.0";
const port = 3000;


const wss = new ws.WebSocketServer({ noServer: true });
wss.on("connection", function connection(ws) {
    ws.on("error", console.error);
    ws.on("message", async (msg) => {
        console.log("[websocket] incoming: %s", msg);
        let response = await routeWSMessage(msg);
        response = JSON.stringify(response);
        console.log(`[websocket] response: %s`, response);
        ws.send(response);
    });
});

const server = app.listen(port, ip, (err) => {
    if (err) throw err;
    console.log(`Server running on ${ip}:${port}`);
});

server.on("upgrade", (request, socket, head) => {
    console.log(`received upgrade request...`)
    wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit("connection", ws, request);
    });
});
