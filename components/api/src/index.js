const path = require("path");

const express = require("express");
const morgan = require("morgan");
const cors = require("cors");

const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");
const { authenticateKey } = require("./utils/auth");

const clients = require("./routes/clients");
const links = require("./routes/links");
const site = require("./routes/site");
const policies = require("./routes/policies");
const csp = require("./routes/csp");

const service_clients = require("./services/clients.service");
const service_links = require("./services/links.service");

const app = express();

const allowlist = ["*"];
const corsOpts = {
    origin: function(origin, callback) {
        // enable requests without an origin as well
        const allowAny = allowlist.indexOf("*") !== -1;
        const allowOrigin = allowlist.indexOf(origin) !== -1;
        const noOrigin = !origin;
        if (allowAny || allowOrigin || noOrigin) {
            callback(null, true);
        } else {
            callback(new Error(`Origin not allowed by CORS: ${origin}`));
        }
    },
    allowedHeaders: "*",
};
const CONFIG = {
    version: 0,
    mode: 2,
};

app.use(cors(corsOpts));
app.use(morgan("combined"));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/healthcheck", function (req, res) {
    res.sendFile(path.join(__dirname, "/index.html"));
});
app.get("/config", function (req, res) {
    return res.status(200).json(CONFIG);
});
app.use("/clients", clients);
app.use("/links", links);
app.use("/site", authenticateKey);
app.use("/site", site);
app.use("/policies", authenticateKey);
app.use("/policies", policies);
app.use("/csp", csp);

app.put("/setupIndexes", async (req, res) => {
    await dbi.setupIndexes();
    return res.status(200).json({ success: true });
});

async function routeWSMessage(msg) {
    const { cmd_id, route, data } = JSON.parse(msg);
    let ret = {
        "cmd_id": cmd_id,
    };
    try {
        const service = route.split("/")[1];
        if (service == "config") {
            ret["result"] = CONFIG;
            return ret;
        }
        let router = null;
        if (service === "clients") {
            router = service_clients;
        } else if (service === "links") {
            router = service_links;
        }
        const fn = router.routeWSMessage(route);
        console.log(`  service=${service} fn=${fn.name}`)
        ret["result"] = await fn(data);
    } catch (err) {
        ret["error"] = err;
    }
    return ret;
}

module.exports = {
    app: app,
    routeWSMessage: routeWSMessage,
}
