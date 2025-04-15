const config = require("/home/ubuntu/app/configs/config");
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");

async function post_create(req, res) {
    console.debug(req.body);
    const currTime = Date.now();
    const policies = req.body.policies.map((p) => {
        return {
            created: currTime,
            expired: 0,
            ...p,
        };
    });
    try {
        await dbi.createPolicies(policies);
        return res.status(200).send({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(400).json({ error: err });
    }
}

async function post_create_ws(msg) {
    const currTime = Date.now();
    const policies = msg.policies.map((p) => {
        return {
            created: currTime,
            expired: 0,
            ...p,
        };
    });
    try {
        await dbi.createPolicies(policies);
        return { success: true };
    } catch (err) {
        console.error(err);
        return { error: err };
    }
}

function routeWSMessage(route) {
    if (route.indexOf("/policies/create") > -1) {
        return post_create_ws;
    }
}

module.exports = {
    post_create: post_create,
    post_create_ws: post_create_ws,
    routeWSMessage: routeWSMessage,
};
