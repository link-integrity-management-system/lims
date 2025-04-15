const webpush = require("web-push");
const vapidKeys = webpush.generateVAPIDKeys();

const config = require("/home/ubuntu/app/configs/config");
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");

const vapidPublicKey = vapidKeys.publicKey;
const vapidPrivatekey = vapidKeys.privateKey;

webpush.setVapidDetails(
    "mailto:admin@example.com",
    vapidPublicKey,
    vapidPrivatekey
);

async function get_clients(req, res) {
    const start = req.query.start ? req.query.start : 0;
    const stop = req.query.stop ? req.query.stop : 10;
    const clients = [];
    for await (const client of dbi.getPushClients(start, stop)) {
        clients.push(client);
    }
    return res.status(200).json({ clients: clients });
}

async function post_register(req, res) {
    const subscription = req.body.subscription;
    await dbi.registerPushClient(subscription);
    // registerPushClient(subscription);
    return res.status(200).json({ success: true });
}

async function post_register_ws(msg) {
    const subscription = msg.subscription;
    await dbi.registerPushClient(subscription);
    return { success: true };
}

async function post_notify(req, res) {
    const expired = [];
    for await (const subscription of dbi.getPushClients()) {
        try {
            await webpush.sendNotification(
                subscription,
                JSON.stringify({
                    msg: "config-update",
                })
            );
        } catch (err) {
            console.debug(`I'm sorry Dave, but I can't do that`, err);
            expired.push(subscription);
        }
    }
    await dbi.prunePushClients(expired);
    return res.status(200).json({ success: true });
}

async function get_vapidPublicKey(req, res) {
    return res.status(200).send(vapidPublicKey);
}

async function get_vapidPublicKey_ws(msg) {
    return vapidPublicKey;
}

function routeWSMessage(route) {
    if (route.indexOf("/clients/register") > -1) {
        return post_register_ws;
    } else if (route.indexOf("/clients/vapidPublicKey") > -1) {
        return get_vapidPublicKey_ws;
    }
}

module.exports = {
    get_clients: get_clients,
    post_register: post_register,
    post_register_ws: post_register_ws,
    post_notify: post_notify,
    get_vapidPublicKey: get_vapidPublicKey,
    get_vapidPublicKey_ws: get_vapidPublicKey_ws,
    routeWSMessage: routeWSMessage,
};
