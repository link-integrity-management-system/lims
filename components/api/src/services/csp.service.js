const config = require("/home/ubuntu/app/configs/config");
const dbi = require("/home/ubuntu/app/shared/database_js/dbiface");

async function post_report(req, res) {
    try {
        console.log(JSON.stringify(req.body));
        return res.status(200).send(req.body);
    } catch (err) {
        console.error(err);
        return res.status(400).json({ error: err });
    }
}

async function post_report_ws(msg) {
    return msg;
}


module.exports = {
    post_report: post_report,
    post_report_ws: post_report_ws,
};
